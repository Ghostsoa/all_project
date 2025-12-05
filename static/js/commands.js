// 命令历史管理模块
import { state } from './config.js';
import { showToast } from './toast.js';
import { api } from './api.js';
import { escapeHtml } from './utils.js';

// 内存缓存：每个服务器的命令历史
const commandCache = new Map(); // Map<serverID, commands[]>

// 格式化命令时间
function formatCommandTime(timeStr) {
    if (!timeStr) return '未知时间';
    
    try {
        const date = new Date(timeStr);
        if (isNaN(date.getTime())) return '未知时间';
        
        const now = new Date();
        const diff = now - date;
        
        // 小于1分钟
        if (diff < 60000) {
            return '刚刚';
        }
        
        // 小于1小时
        if (diff < 3600000) {
            const minutes = Math.floor(diff / 60000);
            return `${minutes}分钟前`;
        }
        
        // 小于24小时
        if (diff < 86400000) {
            const hours = Math.floor(diff / 3600000);
            return `${hours}小时前`;
        }
        
        // 同一年
        if (date.getFullYear() === now.getFullYear()) {
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const hour = String(date.getHours()).padStart(2, '0');
            const minute = String(date.getMinutes()).padStart(2, '0');
            return `${month}-${day} ${hour}:${minute}`;
        }
        
        // 不同年
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    } catch (error) {
        console.error('时间格式化失败:', error);
        return '未知时间';
    }
}

let commandSaveQueue = [];
let commandSaveTimer = null;
let loadHistoryTimer = null;

export function saveCommandToHistory(serverId, command) {
    // 统一转为字符串
    serverId = String(serverId);
    
    // 1. 立即更新内存缓存（去重：相同命令更新时间并移到最前）
    let cached = commandCache.get(serverId) || [];
    
    // 查找是否已存在相同命令
    const existingIndex = cached.findIndex(c => c.command === command);
    
    if (existingIndex >= 0) {
        // 已存在：更新时间，移到最前
        const existing = cached[existingIndex];
        existing.timestamp = new Date().toISOString();
        existing.created_at = existing.timestamp; // 兼容旧字段
        
        // 从原位置删除
        cached = [...cached.slice(0, existingIndex), ...cached.slice(existingIndex + 1)];
        // 添加到最前
        cached.unshift(existing);
    } else {
        // 不存在：创建新命令并添加到最前
        const timestamp = new Date().toISOString();
        const newCommand = {
            id: Date.now(),
            server_id: serverId,
            command: command,
            timestamp: timestamp,
            created_at: timestamp  // 兼容旧字段
        };
        cached.unshift(newCommand);
    }
    
    commandCache.set(serverId, cached);
    
    // 2. 立即更新UI（无延迟）
    const session = state.terminals.get(state.activeSessionId);
    if (session) {
        const isLocal = state.activeSessionId === 'local';
        const sessionServerId = isLocal ? '0' : (session.server ? session.server.id : null);
        // 类型转换比较：都转为字符串
        if (String(sessionServerId) === String(serverId)) {
            console.log('🔄 立即更新命令UI:', command);
            renderCommandHistory(cached);
        }
    }
    
    // 3. 异步保存到服务器（批量）
    commandSaveQueue.push({ serverId, command });
    if (commandSaveTimer) clearTimeout(commandSaveTimer);
    
    commandSaveTimer = setTimeout(async () => {
        const queue = [...commandSaveQueue];
        commandSaveQueue = [];
        
        for (const item of queue) {
            try {
                await api.saveCommand(item.serverId, item.command);
            } catch (error) {
                console.error('保存命令失败:', error);
            }
        }
    }, 2000); // 2秒批量保存
}

export async function loadCommandHistory(serverId, serverName) {
    // 统一转为字符串
    serverId = String(serverId);
    
    const displayName = serverId === '0' ? '💻 本地终端' : serverName || '未知服务器';
    document.getElementById('commandsServerName').textContent = displayName;
    
    console.log('🔍 加载命令历史:', serverId, serverName);
    
    // 1. 先从缓存读取（立即显示）
    if (commandCache.has(serverId)) {
        console.log('📦 从缓存加载命令:', commandCache.get(serverId).length, '条');
        renderCommandHistory(commandCache.get(serverId));
    }
    
    // 2. 后台刷新
    // 如果没有缓存，立即加载；如果有缓存，延迟加载
    const delay = commandCache.has(serverId) ? 300 : 0;
    
    if (loadHistoryTimer) clearTimeout(loadHistoryTimer);
    
    loadHistoryTimer = setTimeout(async () => {
        try {
            const data = await api.getCommands(serverId);
            
            if (data.success) {
                const commands = data.data || [];
                console.log('✅ 从服务器加载命令:', commands.length, '条');
                commandCache.set(serverId, commands); // 更新缓存
                
                // 直接渲染，不检查activeSessionId（因为可能还没初始化）
                renderCommandHistory(commands);
            }
        } catch (error) {
            console.error('❌ 加载命令历史失败:', error);
        }
    }, delay);
}

function renderCommandHistory(commands) {
    const list = document.getElementById('commandsList');
    
    if (commands.length === 0) {
        list.innerHTML = '<div class="commands-empty"><p>暂无命令记录</p></div>';
        return;
    }
    
    list.innerHTML = commands.map((cmd, index) => {
        const timeStr = formatCommandTime(cmd.timestamp || cmd.created_at);
        const escapedCmd = escapeHtml(cmd.command).replace(/'/g, "\\'");
        
        return `
            <div class="command-item">
                <div class="command-text">${escapeHtml(cmd.command)}</div>
                <div class="command-meta">
                    <span class="command-time">${timeStr}</span>
                    <div class="command-actions">
                        <span class="command-link" onclick="window.copyCommand('${escapedCmd}')" title="复制到剪贴板">
                            <i class="fa-solid fa-copy"></i> 复制
                        </span>
                        <span class="command-link" onclick="window.writeCommandToTerminal('${escapedCmd}')" title="填充到终端">
                            <i class="fa-solid fa-terminal"></i> 填充
                        </span>
                        <span class="command-link delete" onclick="window.deleteCommand(${index})" title="删除">
                            <i class="fa-solid fa-trash"></i> 删除
                        </span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// 删除单条命令
window.deleteCommand = async function(index) {
    const session = state.terminals.get(state.activeSessionId);
    if (!session) {
        showToast('请先选择一个终端', 'warning');
        return;
    }

    const isLocal = state.activeSessionId === 'local';
    const serverId = isLocal ? '0' : (session.server ? session.server.id : '0');
    const cached = commandCache.get(serverId) || [];
    
    if (index < 0 || index >= cached.length) {
        showToast('命令不存在', 'error');
        return;
    }

    const command = cached[index];
    
    // 使用确认对话框
    const confirmed = await window.showConfirm(
        `确定要删除命令 "${command.command}" 吗？`,
        '删除命令'
    );
    
    if (!confirmed) return;

    // 从缓存中删除
    cached.splice(index, 1);
    commandCache.set(serverId, cached);
    
    // 立即更新UI
    renderCommandHistory(cached);
    showToast('已删除', 'success');

    // 异步保存到服务器（TODO: 需要后端支持单条删除API）
    // 目前通过清空后重新保存所有命令来实现
};

// 全部删除
window.clearAllCommands = async function() {
    const session = state.terminals.get(state.activeSessionId);
    if (!session) {
        showToast('请先选择一个终端', 'warning');
        return;
    }

    const isLocal = state.activeSessionId === 'local';
    const serverId = isLocal ? '0' : (session.server ? session.server.id : '0');
    const serverName = isLocal ? '本地终端' : (session.server ? session.server.name : '未知服务器');

    // 使用确认对话框
    const confirmed = await window.showConfirm(
        `确定要清空 "${serverName}" 的所有命令记录吗？此操作不可恢复！`,
        '清空命令记录'
    );
    
    if (!confirmed) return;

    try {
        // 清空缓存
        commandCache.set(serverId, []);
        renderCommandHistory([]);
        
        // 调用后端清空API
        const data = await api.clearCommands(serverId);
        if (data.success) {
            showToast('已清空所有命令', 'success');
        } else {
            showToast('清空失败: ' + (data.error || '未知错误'), 'error');
        }
    } catch (error) {
        console.error('清空命令失败:', error);
        showToast('清空失败', 'error');
    }
}
