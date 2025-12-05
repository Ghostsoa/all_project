// 命令历史管理模块
import { state } from './state.js';
import { showToast } from './toast.js';
import { api } from './api.js';
import { escapeHtml, formatTime } from './utils.js';

// 内存缓存：每个服务器的命令历史
const commandCache = new Map(); // Map<serverID, commands[]>

let commandSaveQueue = [];
let commandSaveTimer = null;
let loadHistoryTimer = null;

export function saveCommandToHistory(serverId, command) {
    // 1. 立即更新内存缓存（去重：相同命令更新时间并移到最前）
    let cached = commandCache.get(serverId) || [];
    
    // 查找是否已存在相同命令
    const existingIndex = cached.findIndex(c => c.command === command);
    
    if (existingIndex >= 0) {
        // 已存在：更新时间并移到最前
        const existing = cached[existingIndex];
        existing.created_at = new Date().toISOString();
        
        // 从原位置删除
        cached = [...cached.slice(0, existingIndex), ...cached.slice(existingIndex + 1)];
        // 添加到最前
        cached.unshift(existing);
    } else {
        // 不存在：创建新命令并添加到最前
        const newCommand = {
            id: Date.now(),
            server_id: serverId,
            command: command,
            created_at: new Date().toISOString()
        };
        cached.unshift(newCommand);
    }
    
    commandCache.set(serverId, cached);
    
    // 2. 立即更新UI（无延迟）
    const session = state.terminals.get(state.activeSessionId);
    if (session && session.server.id === serverId) {
        renderCommandHistory(cached);
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
    const displayName = serverId === 0 ? '💻 本地终端' : serverName || '未知服务器';
    document.getElementById('commandsServerName').textContent = displayName;
    
    // 1. 先从缓存读取（立即显示）
    if (commandCache.has(serverId)) {
        renderCommandHistory(commandCache.get(serverId));
    }
    
    // 2. 后台静默刷新
    if (loadHistoryTimer) clearTimeout(loadHistoryTimer);
    
    loadHistoryTimer = setTimeout(async () => {
        try {
            const data = await api.getCommands(serverId);
            
            if (data.success) {
                const commands = data.data || [];
                commandCache.set(serverId, commands); // 更新缓存
                
                // 如果还在查看这个服务器，静默更新UI
                const session = state.terminals.get(state.activeSessionId);
                if (session && session.server.id === serverId) {
                    renderCommandHistory(commands);
                }
            }
        } catch (error) {
            console.error('加载命令历史失败:', error);
        }
    }, 300);
}

let isSelectMode = false;
let selectedCommands = new Set();

function renderCommandHistory(commands) {
    const list = document.getElementById('commandsList');
    
    if (commands.length === 0) {
        list.innerHTML = '<div class="commands-empty"><p>暂无命令记录</p></div>';
        return;
    }
    
    if (isSelectMode) {
        list.innerHTML = `
            <div class="command-select-header">
                <button class="btn-select-all" onclick="window.selectAllCommands()">✓ 全选</button>
                <button class="btn-delete-selected" onclick="window.deleteSelectedCommands()">🗑️ 删除选中</button>
                <button class="btn-cancel-select" onclick="window.cancelSelectMode()">✕ 取消</button>
            </div>
        ` + commands.map(cmd => {
            const date = new Date(cmd.created_at);
            const timeStr = formatTime(date);
            const isSelected = selectedCommands.has(cmd.id);
            
            return `
                <div class="command-item ${isSelected ? 'selected' : ''}" onclick="window.toggleCommandSelect(${cmd.id})">
                    <div class="command-checkbox">${isSelected ? '☑' : '☐'}</div>
                    <div class="command-content">
                        <div class="command-text">${escapeHtml(cmd.command)}</div>
                        <div class="command-meta">
                            <span class="command-time">⏰ ${timeStr}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    } else {
        list.innerHTML = commands.map(cmd => {
            const date = new Date(cmd.created_at);
            const timeStr = formatTime(date);
            const escapedCmd = escapeHtml(cmd.command).replace(/'/g, "\\'");
            
            return `
                <div class="command-item">
                    <div class="command-text">${escapeHtml(cmd.command)}</div>
                    <div class="command-meta">
                        <span class="command-time">${timeStr}</span>
                        <div class="command-actions">
                            <span class="command-link" onclick="window.copyCommand('${escapedCmd}')" title="复制到剪贴板">复制</span>
                            <span class="command-link" onclick="window.writeCommandToTerminal('${escapedCmd}')" title="填充到终端">填充</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }
}

export function enterSelectMode() {
    isSelectMode = true;
    selectedCommands.clear();
    const session = state.terminals.get(state.activeSessionId);
    if (session) {
        loadCommandHistory(session.server.id, session.server.name);
    }
}

window.toggleCommandSelect = function(id) {
    if (selectedCommands.has(id)) {
        selectedCommands.delete(id);
    } else {
        selectedCommands.add(id);
    }
    const session = state.terminals.get(state.activeSessionId);
    if (session) {
        loadCommandHistory(session.server.id, session.server.name);
    }
};

window.selectAllCommands = function() {
    const items = document.querySelectorAll('.command-item');
    items.forEach(item => {
        const checkbox = item.querySelector('.command-checkbox');
        if (checkbox) {
            const match = item.onclick.toString().match(/toggleCommandSelect\((\d+)\)/);
            if (match) {
                selectedCommands.add(parseInt(match[1]));
            }
        }
    });
    const session = state.terminals.get(state.activeSessionId);
    if (session) {
        loadCommandHistory(session.server.id, session.server.name);
    }
};

window.cancelSelectMode = function() {
    isSelectMode = false;
    selectedCommands.clear();
    const session = state.terminals.get(state.activeSessionId);
    if (session) {
        loadCommandHistory(session.server.id, session.server.name);
    }
};

window.deleteSelectedCommands = async function() {
    if (selectedCommands.size === 0) {
        showToast('请先选择要删除的命令', 'warning');
        return;
    }
    
    if (!confirm(`确定要删除选中的 ${selectedCommands.size} 条命令吗？`)) return;
    
    try {
        // TODO: 实现批量删除API
        showToast('批量删除功能待后端支持', 'info');
        isSelectMode = false;
        selectedCommands.clear();
        const session = state.terminals.get(state.activeSessionId);
        if (session) {
            loadCommandHistory(session.server.id, session.server.name);
        }
    } catch (error) {
        console.error('删除失败:', error);
        showToast('删除失败', 'error');
    }
};

export async function clearCurrentCommands() {
    const session = state.terminals.get(state.activeSessionId);
    if (!session) {
        showToast('请先选择一个终端', 'warning');
        return;
    }
    
    // 进入选择模式
    enterSelectMode();
}
