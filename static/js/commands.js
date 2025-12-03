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

function renderCommandHistory(commands) {
    const list = document.getElementById('commandsList');
    
    if (commands.length === 0) {
        list.innerHTML = '<div class="commands-empty"><p>暂无命令记录</p></div>';
        return;
    }
    
    list.innerHTML = commands.map(cmd => {
        const date = new Date(cmd.created_at);
        const timeStr = formatTime(date);
        const escapedCmd = escapeHtml(cmd.command).replace(/'/g, "\\'");
        
        return `
            <div class="command-item">
                <div class="command-text">${escapeHtml(cmd.command)}</div>
                <div class="command-meta">
                    <span class="command-time">⏰ ${timeStr}</span>
                    <div>
                        <button class="command-action" onclick="window.writeCommandToTerminal('${escapedCmd}')" title="填充到终端">
                            ⚡ 填充
                        </button>
                        <button class="command-action" onclick="window.copyCommand('${escapedCmd}')" title="复制到剪贴板">
                            📋 复制
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

export async function clearCurrentCommands() {
    const session = state.terminals.get(state.activeSessionId);
    if (!session) {
        alert('请先选择一个终端');
        return;
    }
    
    if (!confirm('确定要清除当前服务器的所有命令历史吗？')) return;
    
    try {
        const data = await api.clearCommands(session.server.ID);
        if (data.success) {
            loadCommandHistory(session.server.ID, session.server.name);
            alert('清除成功');
        } else {
            alert(data.error || '清除失败');
        }
    } catch (error) {
        console.error('清除失败:', error);
        alert('清除失败');
    }
}
