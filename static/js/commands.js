// 命令历史管理模块
import { state } from './config.js';
import { api } from './api.js';
import { escapeHtml, formatTime } from './utils.js';

let commandSaveQueue = [];
let commandSaveTimer = null;
let loadHistoryTimer = null;

export function saveCommandToHistory(serverId, command) {
    commandSaveQueue.push({ serverId, command });
    
    if (commandSaveTimer) clearTimeout(commandSaveTimer);
    
    commandSaveTimer = setTimeout(async () => {
        const queue = [...commandSaveQueue];
        commandSaveQueue = [];
        
        for (const item of queue) {
            try {
                api.saveCommand(item.serverId, item.command).catch(console.error);
            } catch (error) {
                console.error('保存命令失败:', error);
            }
        }
        
        const session = state.terminals.get(state.activeSessionId);
        if (session) {
            loadCommandHistory(session.server.ID, session.server.name);
        }
    }, 500);
}

export async function loadCommandHistory(serverId, serverName) {
    if (loadHistoryTimer) clearTimeout(loadHistoryTimer);
    
    loadHistoryTimer = setTimeout(async () => {
        try {
            const data = await api.getCommands(serverId);
            
            if (data.success) {
                const displayName = serverId === 0 ? '💻 本地终端' : serverName || '未知服务器';
                document.getElementById('commandsServerName').textContent = displayName;
                renderCommandHistory(data.data || []);
            }
        } catch (error) {
            console.error('加载命令历史失败:', error);
            renderCommandHistory([]);
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
        loadCommandHistory(session.server.ID, session.server.name);
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
        loadCommandHistory(session.server.ID, session.server.name);
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
        loadCommandHistory(session.server.ID, session.server.name);
    }
};

window.cancelSelectMode = function() {
    isSelectMode = false;
    selectedCommands.clear();
    const session = state.terminals.get(state.activeSessionId);
    if (session) {
        loadCommandHistory(session.server.ID, session.server.name);
    }
};

window.deleteSelectedCommands = async function() {
    if (selectedCommands.size === 0) {
        alert('请先选择要删除的命令');
        return;
    }
    
    if (!confirm(`确定要删除选中的 ${selectedCommands.size} 条命令吗？`)) return;
    
    try {
        // TODO: 实现批量删除API
        alert('批量删除功能待后端支持');
        isSelectMode = false;
        selectedCommands.clear();
        const session = state.terminals.get(state.activeSessionId);
        if (session) {
            loadCommandHistory(session.server.ID, session.server.name);
        }
    } catch (error) {
        console.error('删除失败:', error);
        alert('删除失败');
    }
};

export async function clearCurrentCommands() {
    const session = state.terminals.get(state.activeSessionId);
    if (!session) {
        alert('请先选择一个终端');
        return;
    }
    
    // 进入选择模式
    enterSelectMode();
}
