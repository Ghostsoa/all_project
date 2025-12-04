// 主入口文件
import { state } from './config.js';
import { api } from './api.js';
import { showToast } from './utils.js';
import { loadServers, searchServers, deleteServer, renderServerList } from './server.js';
import { createTerminal, connectSSH, openLocalTerminal } from './terminal.js';
import { loadCommandHistory, clearCurrentCommands, saveCommandToHistory } from './commands.js';
import { initFileTree, setCurrentServer } from './filetree.js';
import { openFileEditor } from './editor.js';

// 页面加载
document.addEventListener('DOMContentLoaded', function() {
    loadServers();
    initTagsInput();
    checkAuthStatus();
});

// 暴露全局函数供HTML调用
window.loadServers = loadServers;
window.searchServers = searchServers;
window.deleteServer = deleteServer;
window.openLocalTerminal = openLocalTerminal;
window.clearCurrentCommands = clearCurrentCommands;
window.showToast = showToast;

// 服务器卡片展开/折叠
window.toggleServerExpand = function(serverId) {
    const serverItem = document.getElementById(`server-${serverId}`);
    if (serverItem) {
        serverItem.classList.toggle('expanded');
    }
};

// 认证检查
async function checkAuthStatus() {
    try {
        const response = await fetch('/api/servers');
        if (response.status === 401) {
            window.location.href = '/login';
        }
    } catch (error) {
        console.error('检查认证状态失败:', error);
    }
}

// 登出
window.logout = async function() {
    try {
        await api.logout();
        window.location.href = '/login';
    } catch (error) {
        console.error('登出失败:', error);
    }
};

// 选择服务器并连接
window.selectServer = async function(id) {
    try {
        const data = await api.getServer(id);
        if (!data.success) {
            alert('获取服务器信息失败');
            return;
        }
        
        const server = data.data;
        
        // 检查是否已经有该服务器的会话
        let existingSession = null;
        for (const [sid, sess] of state.terminals.entries()) {
            if (sess.server.ID === server.ID) {
                existingSession = sid;
                break;
            }
        }
        
        if (existingSession) {
            // 已有会话，直接切换
            window.switchContentTab(existingSession);
            return;
        }
        
        const sessionId = 'ssh-' + server.ID; // 使用服务器ID作为sessionId
        
        document.getElementById('noSelection').style.display = 'none';
        document.getElementById('terminalWrapper').style.display = 'flex';
        
        // 创建内容标签（终端标签，不可关闭）
        const tabsList = document.getElementById('contentTabsList');
        const tabHTML = `
            <div class="content-tab-item active" data-session-id="${sessionId}" data-type="terminal" onclick="window.switchContentTab('${sessionId}')">
                <span class="tab-icon">💻</span>
                <span class="tab-name">${server.name}</span>
            </div>
        `;
        tabsList.insertAdjacentHTML('beforeend', tabHTML);
        
        // 创建终端容器
        const contentContainer = document.getElementById('contentContainer');
        const terminalPane = document.createElement('div');
        terminalPane.id = sessionId;
        terminalPane.className = 'terminal-pane active';
        contentContainer.appendChild(terminalPane);
        
        const { term, fitAddon } = createTerminal();
        term.open(terminalPane);
        fitAddon.fit();
        
        state.terminals.set(sessionId, {
            server,
            term,
            fitAddon,
            ws: null,
            status: 'connecting',
            commandBuffer: ''
        });
        
        state.activeSessionId = sessionId;
        renderTabs();
        switchTab(sessionId);
        
        connectSSH(sessionId, server);
        loadCommandHistory(server.ID, server.name);
        
        // 文件树会在WebSocket连接成功后自动加载
    } catch (error) {
        console.error('连接失败:', error);
        alert('连接失败');
    }
};

// 标签管理
window.renderTabs = function() {
    const tabsList = document.getElementById('tabsList');
    const tabs = [];
    
    for (const [sessionId, session] of state.terminals.entries()) {
        const isActive = sessionId === state.activeSessionId;
        tabs.push(`
            <div class="tab-item ${isActive ? 'active' : ''}" onclick="window.switchTab('${sessionId}')">
                <span class="tab-name">${session.server.name}</span>
                <span class="tab-close" onclick="event.stopPropagation(); window.closeTab('${sessionId}')">×</span>
            </div>
        `);
    }
    
    tabsList.innerHTML = tabs.join('');
};

window.switchTab = function(sessionId) {
    state.activeSessionId = sessionId;
    
    document.querySelectorAll('.terminal-pane').forEach(pane => {
        pane.classList.remove('active');
    });
    document.getElementById(sessionId)?.classList.add('active');
    
    document.querySelectorAll('.tab-item').forEach(tab => {
        tab.classList.remove('active');
    });
    
    const session = state.terminals.get(sessionId);
    if (session) {
        setTimeout(() => session.fitAddon.fit(), 100);
        loadCommandHistory(session.server.ID, session.server.name);
        
        // 同步更新文件树到当前服务器（传入sessionID）
        setCurrentServer(session.server.ID, sessionId);
    }
};

window.closeTab = function(sessionId) {
    const session = state.terminals.get(sessionId);
    if (session?.ws) session.ws.close();
    
    document.getElementById(sessionId)?.remove();
    state.terminals.delete(sessionId);
    
    if (state.activeSessionId === sessionId) {
        const remaining = Array.from(state.terminals.keys());
        if (remaining.length > 0) {
            switchTab(remaining[0]);
        } else {
            document.getElementById('noSelection').style.display = 'flex';
            document.getElementById('terminalWrapper').style.display = 'none';
            
            // 清空文件树
            const fileTree = document.getElementById('fileTree');
            if (fileTree) {
                fileTree.innerHTML = '<div class="file-tree-empty">连接服务器后显示文件</div>';
            }
        }
    }
    
    renderTabs();
};

// 命令操作
window.copyCommand = function(command) {
    navigator.clipboard.writeText(command).then(() => {
        showToast('✅ 已复制到剪贴板');
    }).catch(() => {
        showToast('❌ 复制失败');
    });
};

window.writeCommandToTerminal = function(command) {
    if (!state.activeSessionId) {
        showToast('⚠️ 请先打开一个终端');
        return;
    }
    
    const session = state.terminals.get(state.activeSessionId);
    if (!session?.ws || session.ws.readyState !== WebSocket.OPEN) {
        showToast('⚠️ 终端未连接');
        return;
    }
    
    session.ws.send(command);
    showToast('✅ 已填充到终端');
};

// 标签管理
function initTagsInput() {
    const input = document.getElementById('serverTagsInput');
    if (!input) return;
    
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            addTag();
        } else if (e.key === 'Backspace' && input.value === '' && state.currentTags.length > 0) {
            state.currentTags.pop();
            renderTags();
        }
    });
}

function addTag() {
    const input = document.getElementById('serverTagsInput');
    const tag = input.value.trim();
    
    if (tag && !state.currentTags.includes(tag)) {
        state.currentTags.push(tag);
        renderTags();
        input.value = '';
    }
}

window.removeTag = function(index) {
    state.currentTags.splice(index, 1);
    renderTags();
};

function renderTags() {
    const display = document.getElementById('tagsDisplay');
    if (!display) return;
    
    display.innerHTML = state.currentTags.map((tag, index) => `
        <span class="tag-item" onclick="window.removeTag(${index})">
            ${tag}
            <span class="tag-remove">×</span>
        </span>
    `).join('');
}

// 服务器模态框
window.showAddServerModal = function() {
    document.getElementById('modalTitle').textContent = '添加服务器';
    document.getElementById('serverForm').reset();
    document.getElementById('serverId').value = '';
    state.currentTags = [];
    renderTags();
    document.getElementById('serverModal').classList.add('show');
};

window.editServer = async function(id) {
    try {
        const data = await api.getServer(id);
        
        if (data.success) {
            const server = data.data;
            document.getElementById('modalTitle').textContent = '编辑服务器';
            document.getElementById('serverId').value = server.ID;
            document.getElementById('serverName').value = server.name;
            document.getElementById('serverHost').value = server.host;
            document.getElementById('serverPort').value = server.port;
            document.getElementById('serverUsername').value = server.username;
            document.getElementById('serverPassword').value = '';
            document.getElementById('serverDescription').value = server.description || '';
            state.currentTags = server.tags || [];
            renderTags();
            document.getElementById('serverModal').classList.add('show');
        }
    } catch (error) {
        console.error('加载服务器信息失败:', error);
        alert('加载服务器信息失败');
    }
};

window.saveServer = async function() {
    const id = document.getElementById('serverId').value;
    const server = {
        name: document.getElementById('serverName').value.trim(),
        host: document.getElementById('serverHost').value.trim(),
        port: parseInt(document.getElementById('serverPort').value),
        username: document.getElementById('serverUsername').value.trim(),
        password: document.getElementById('serverPassword').value,
        auth_type: 'password',
        description: document.getElementById('serverDescription').value.trim(),
        tags: state.currentTags
    };
    
    if (!server.name || !server.host || !server.username) {
        alert('请填写必填项');
        return;
    }
    
    try {
        let data;
        if (id) {
            server.ID = parseInt(id);
            data = await api.updateServer(server);
        } else {
            if (!server.password) {
                alert('密码不能为空');
                return;
            }
            data = await api.createServer(server);
        }
        
        if (data.success) {
            closeModal();
            loadServers();
            alert(data.message || '保存成功');
        } else {
            alert(data.error || '保存失败');
        }
    } catch (error) {
        console.error('保存失败:', error);
        alert('保存失败');
    }
};

window.closeModal = function() {
    document.getElementById('serverModal').classList.remove('show');
};

// 右侧面板切换
window.showRightPanel = function(tabName) {
    document.querySelectorAll('.right-tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.right-panel-content').forEach(content => content.classList.remove('active'));
    
    event.target.classList.add('active');
    
    if (tabName === 'ai') {
        document.getElementById('aiPanel').classList.add('active');
    } else if (tabName === 'commands') {
        document.getElementById('commandsPanel').classList.add('active');
    }
};


console.log('✅ Web SSH Client Loaded');
