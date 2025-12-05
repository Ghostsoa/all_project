// 命令历史管理模块（统一时间线）
import { state } from './config.js';
import { showToast } from './toast.js';
import { api } from './api.js';
import { escapeHtml } from './utils.js';

// 统一时间线缓存
let allCommands = []; // 所有命令的统一列表
let currentFilter = null; // 当前筛选的服务器ID（null=显示全部）
let searchKeyword = ''; // 搜索关键词

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

export function saveCommandToHistory(serverId, serverName, command) {
    // 统一转为字符串
    serverId = String(serverId);
    
    // 去重：查找相同服务器的相同命令
    const existingIndex = allCommands.findIndex(cmd => 
        cmd.server_id === serverId && cmd.command === command
    );
    
    // 如果找到重复，先删除旧的
    if (existingIndex >= 0) {
        allCommands.splice(existingIndex, 1);
    }
    
    // 1. 添加到内存缓存（最新的在前）
    const newCommand = {
        id: Date.now(), // 临时ID
        server_id: serverId,
        server_name: serverName,
        command: command,
        timestamp: new Date().toISOString()
    };
    
    // 添加到列表开头
    allCommands.unshift(newCommand);
    
    // 限制缓存大小
    if (allCommands.length > 500) {
        allCommands = allCommands.slice(0, 500);
    }
    
    // 2. 立即更新UI
    renderCommandHistory();
    
    // 3. 异步保存到服务器
    commandSaveQueue.push({ serverId, serverName, command });
    if (commandSaveTimer) clearTimeout(commandSaveTimer);
    
    commandSaveTimer = setTimeout(async () => {
        const queue = [...commandSaveQueue];
        commandSaveQueue = [];
        
        for (const item of queue) {
            try {
                await api.saveCommand(item.serverId, item.serverName, item.command);
            } catch (error) {
                console.error('保存命令失败:', error);
            }
        }
    }, 1000); // 1秒批量保存
}

export async function loadCommandHistory() {
    console.log('🔍 加载命令历史（统一时间线）');
    
    try {
        // 加载最近的命令（统一时间线）
        const data = await api.getRecentCommands(200); // 加载最近200条
        
        if (data.success) {
            allCommands = data.data || [];
            console.log('✅ 加载命令:', allCommands.length, '条');
            renderCommandHistory();
        }
    } catch (error) {
        console.error('❌ 加载命令历史失败:', error);
        renderCommandHistory();
    }
}

function renderCommandHistory() {
    const list = document.getElementById('commandsList');
    
    // 筛选命令
    let filtered = allCommands;
    
    // 按服务器筛选
    if (currentFilter !== null) {
        filtered = filtered.filter(cmd => cmd.server_id === currentFilter);
    }
    
    // 按关键词搜索
    if (searchKeyword) {
        const keyword = searchKeyword.toLowerCase();
        filtered = filtered.filter(cmd => 
            cmd.command.toLowerCase().includes(keyword) ||
            cmd.server_name.toLowerCase().includes(keyword)
        );
    }
    
    if (filtered.length === 0) {
        list.innerHTML = '<div class="commands-empty"><p>暂无命令记录</p></div>';
        return;
    }
    
    list.innerHTML = filtered.map((cmd) => {
        const timeStr = formatCommandTime(cmd.timestamp);
        const escapedCmd = escapeHtml(cmd.command).replace(/'/g, "\\'");
        const serverTag = cmd.server_id === '0' ? 'local' : 'remote';
        
        return `
            <div class="command-item">
                <div class="command-header">
                    <span class="server-tag ${serverTag}" title="${escapeHtml(cmd.server_name)}">
                        ${escapeHtml(cmd.server_name)}
                    </span>
                    <span class="command-time">${timeStr}</span>
                </div>
                <div class="command-text">${escapeHtml(cmd.command)}</div>
                <div class="command-actions">
                    <span class="command-link" onclick="window.copyCommand('${escapedCmd}')" title="复制">
                        <i class="fa-solid fa-copy"></i> 复制
                    </span>
                    <span class="command-link" onclick="window.writeCommandToTerminal('${escapedCmd}')" title="填充">
                        <i class="fa-solid fa-terminal"></i> 填充
                    </span>
                    <span class="command-link delete" onclick="window.deleteCommand(${cmd.id})" title="删除">
                        <i class="fa-solid fa-trash"></i> 删除
                    </span>
                </div>
            </div>
        `;
    }).join('');
}

// 删除单条命令
window.deleteCommand = async function(cmdId) {
    const cmd = allCommands.find(c => c.id === cmdId);
    if (!cmd) {
        showToast('命令不存在', 'error');
        return;
    }
    
    // 使用确认对话框
    const confirmed = await window.showConfirm(
        `确定要删除命令 "${cmd.command}" 吗？`,
        '删除命令'
    );
    
    if (!confirmed) return;

    try {
        // 从缓存中删除
        allCommands = allCommands.filter(c => c.id !== cmdId);
        renderCommandHistory();
        showToast('已删除', 'success');

        // 调用后端删除API
        await api.deleteCommand(cmdId);
    } catch (error) {
        console.error('删除命令失败:', error);
        showToast('删除失败', 'error');
    }
};

// 清空所有命令
window.clearAllCommands = async function() {
    // 使用确认对话框
    const confirmed = await window.showConfirm(
        '确定要清空所有命令记录吗？此操作不可恢复！',
        '清空所有命令'
    );
    
    if (!confirmed) return;

    try {
        // 清空缓存
        allCommands = [];
        renderCommandHistory();
        
        // 调用后端清空API
        const data = await api.clearAllCommands();
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

// 搜索命令
window.searchCommands = async function(keyword) {
    searchKeyword = keyword.trim();
    
    if (searchKeyword) {
        try {
            // 调用搜索API
            const data = await api.searchCommands(searchKeyword, 200);
            if (data.success) {
                allCommands = data.data || [];
                renderCommandHistory();
            }
        } catch (error) {
            console.error('搜索命令失败:', error);
        }
    } else {
        // 清空搜索，重新加载全部
        await loadCommandHistory();
    }
}

// 筛选服务器
window.filterByServer = function(serverId) {
    currentFilter = serverId;
    renderCommandHistory();
}
