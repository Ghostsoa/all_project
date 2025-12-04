// 主入口文件
import { state } from './config.js';
import { api } from './api.js';
import { showToast } from './utils.js';
import { loadServers, searchServers, deleteServer, renderServerList } from './server.js';
import { createTerminal, connectSSH, openLocalTerminal } from './terminal.js';
import { loadCommandHistory, clearCurrentCommands, saveCommandToHistory } from './commands.js';
import { initFileTree, setCurrentServer, setLocalTerminal, loadDirectory, initDragUpload } from './filetree.js';
import { openFileEditor } from './editor.js';

// ========== 全局状态灯管理器 ==========
let globalStatusTimeout = null;

/**
 * 更新全局状态灯
 * @param {string} status - 状态: 'loading', 'success', 'error', 'idle'
 */
window.updateGlobalStatus = function(status) {
    const light = document.getElementById('globalStatusLight');
    if (!light) return;
    
    // 清除之前的定时器
    if (globalStatusTimeout) {
        clearTimeout(globalStatusTimeout);
        globalStatusTimeout = null;
    }
    
    // 移除所有状态类
    light.classList.remove('loading', 'success', 'error');
    
    if (status === 'loading') {
        light.classList.add('loading');
    } else if (status === 'success') {
        light.classList.add('success');
        // 成功后800ms自动恢复idle
        globalStatusTimeout = setTimeout(() => {
            light.classList.remove('success');
        }, 800);
    } else if (status === 'error') {
        light.classList.add('error');
        // 错误后2秒自动恢复idle
        globalStatusTimeout = setTimeout(() => {
            light.classList.remove('error');
        }, 2000);
    }
    // idle状态不需要特殊处理，已经移除所有类
};

// 保存每个服务器的content-tabs状态
const serverContentTabs = new Map(); // sessionId -> HTML string
const serverActivePane = new Map(); // sessionId -> { type: 'terminal'|'editor', id: string }

// 页面加载
document.addEventListener('DOMContentLoaded', function() {
    loadServers();
    initTagsInput();
    checkAuthStatus();
    initFileTree(); // 初始化文件树
    initDragUpload(); // 初始化拖拽上传
    
    // 自动打开本地终端作为默认
    setTimeout(() => {
        openLocalTerminal();
    }, 500);
});

// 暴露全局函数供HTML调用
window.loadServers = loadServers;
window.searchServers = searchServers;
window.deleteServer = deleteServer;
window.openLocalTerminal = openLocalTerminal;
window.clearCurrentCommands = clearCurrentCommands;
window.showToast = showToast;
window.setCurrentServer = setCurrentServer; // 暴露文件树加载函数
window.setLocalTerminal = setLocalTerminal; // 暴露本地文件树加载函数

// 服务器卡片展开/折叠
window.toggleServerExpand = function(serverId) {
    const serverItem = document.getElementById(`server-${serverId}`);
    if (serverItem) {
        serverItem.classList.toggle('expanded');
    }
};

// 侧边栏折叠/展开
window.toggleSidebar = function() {
    const sidebar = document.querySelector('.sidebar');
    const mainContainer = document.querySelector('.main-container');
    const toggleText = document.querySelector('.toggle-text');
    
    sidebar.classList.toggle('collapsed');
    mainContainer.classList.toggle('sidebar-collapsed');
    
    // 切换文本
    if (sidebar.classList.contains('collapsed')) {
        if (toggleText) toggleText.textContent = '展开';
        // 保存折叠状态到localStorage
        localStorage.setItem('sidebarCollapsed', 'true');
    } else {
        if (toggleText) toggleText.textContent = '折叠';
        localStorage.setItem('sidebarCollapsed', 'false');
    }
};

// 页面加载时恢复侧边栏折叠状态
document.addEventListener('DOMContentLoaded', function() {
    const collapsed = localStorage.getItem('sidebarCollapsed') === 'true';
    if (collapsed) {
        const sidebar = document.querySelector('.sidebar');
        const mainContainer = document.querySelector('.main-container');
        const toggleText = document.querySelector('.toggle-text');
        
        sidebar.classList.add('collapsed');
        mainContainer.classList.add('sidebar-collapsed');
        if (toggleText) toggleText.textContent = '展开';
    }
});

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
        
        // 在content-tabs-bar创建固定的终端标签
        const contentTabsList = document.getElementById('contentTabsList');
        const terminalTabHTML = `
            <div class="content-tab-item active" data-session-id="${sessionId}" data-type="terminal" onclick="window.switchToTerminal('${sessionId}')">
                <span class="tab-icon">💻</span>
                <span class="tab-name">终端</span>
            </div>
        `;
        contentTabsList.innerHTML = terminalTabHTML; // 清空并添加终端标签
        
        // 创建终端容器
        const contentContainer = document.getElementById('contentContainer');
        const terminalPane = document.createElement('div');
        terminalPane.id = sessionId;
        terminalPane.className = 'terminal-pane active';
        contentContainer.appendChild(terminalPane);
        
        console.log(`[创建终端] sessionId=${sessionId}, pane已创建，ID=${terminalPane.id}`);
        
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
        
        connectSSH(sessionId, server);
        loadCommandHistory(server.ID, server.name);
        
        // 渲染顶部SSH服务器标签
        renderTabs();
        switchTab(sessionId);
        
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

// 切换到终端（从content-tabs-bar的终端标签点击）
window.switchToTerminal = function(sessionId) {
    // 切换content-tab-item的active状态
    document.querySelectorAll('.content-tab-item').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelector(`.content-tab-item[data-session-id="${sessionId}"]`)?.classList.add('active');
    
    // 隐藏所有editor-pane
    document.querySelectorAll('.editor-pane').forEach(pane => {
        pane.classList.remove('active');
    });
    
    // 显示终端pane
    document.querySelectorAll('.terminal-pane').forEach(pane => {
        pane.classList.remove('active');
    });
    document.getElementById(sessionId)?.classList.add('active');
    
    // 刷新终端布局
    const session = state.terminals.get(sessionId);
    if (session) {
        setTimeout(() => session.fitAddon.fit(), 100);
    }
};

// 切换SSH服务器标签（顶部tabs-bar）
window.switchTab = function(sessionId) {
    const prevSessionId = state.activeSessionId;
    
    // 保存当前服务器的状态
    if (prevSessionId) {
        const contentTabsList = document.getElementById('contentTabsList');
        serverContentTabs.set(prevSessionId, contentTabsList.innerHTML);
        
        // 保存当前激活的pane
        const activeTerminal = document.querySelector('.terminal-pane.active');
        const activeEditor = document.querySelector('.editor-pane.active');
        if (activeTerminal) {
            serverActivePane.set(prevSessionId, { type: 'terminal', id: activeTerminal.id });
        } else if (activeEditor) {
            const tabId = activeEditor.dataset.tabId;
            const path = activeEditor.dataset.path;
            serverActivePane.set(prevSessionId, { type: 'editor', id: tabId, path });
        }
    }
    
    state.activeSessionId = sessionId;
    
    // 隐藏所有pane
    document.querySelectorAll('.terminal-pane').forEach(pane => {
        pane.classList.remove('active');
    });
    document.querySelectorAll('.editor-pane').forEach(pane => {
        pane.classList.remove('active');
    });
    
    // 切换顶部tab-item高亮
    document.querySelectorAll('.tab-item').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // 恢复该服务器的content-tabs状态
    const contentTabsList = document.getElementById('contentTabsList');
    if (serverContentTabs.has(sessionId)) {
        // 恢复保存的标签HTML
        contentTabsList.innerHTML = serverContentTabs.get(sessionId);
        
        // 恢复激活状态
        const savedActive = serverActivePane.get(sessionId);
        if (savedActive) {
            if (savedActive.type === 'terminal') {
                // 激活终端
                const terminalPane = document.getElementById(savedActive.id);
                if (terminalPane) {
                    terminalPane.classList.add('active');
                    console.log(`[激活终端pane] ${savedActive.id}`);
                }
                contentTabsList.querySelector('.content-tab-item[data-type="terminal"]')?.classList.add('active');
            } else if (savedActive.type === 'editor') {
                // 激活编辑器
                const editorPane = document.querySelector(`.editor-pane[data-tab-id="${savedActive.id}"]`);
                if (editorPane) {
                    editorPane.classList.add('active');
                }
                contentTabsList.querySelector(`.content-tab-item[data-tab-id="${savedActive.id}"]`)?.classList.add('active');
            }
        } else {
            // 没有保存的状态，默认激活终端
            const terminalPane = document.getElementById(sessionId);
            if (terminalPane) {
                terminalPane.classList.add('active');
                console.log(`[激活终端pane-默认] ${sessionId}`);
            }
            contentTabsList.querySelector('.content-tab-item[data-type="terminal"]')?.classList.add('active');
        }
    } else {
        // 首次，创建终端标签并激活
        contentTabsList.innerHTML = `
            <div class="content-tab-item active" data-session-id="${sessionId}" data-type="terminal" onclick="window.switchToTerminal('${sessionId}')">
                <span class="tab-icon">💻</span>
                <span class="tab-name">终端</span>
            </div>
        `;
        const terminalPane = document.getElementById(sessionId);
        if (terminalPane) {
            terminalPane.classList.add('active');
            console.log(`[激活终端pane-首次] ${sessionId}`);
        } else {
            console.error(`[错误] 找不到terminal-pane: ${sessionId}`);
        }
    }
    
    const session = state.terminals.get(sessionId);
    if (session) {
        console.log(`[切换] sessionId=${sessionId}, pane元素=`, document.getElementById(sessionId));
        console.log(`[切换] 当前active的pane=`, document.querySelector('.terminal-pane.active'));
        console.log(`[切换] 所有terminal-pane:`, document.querySelectorAll('.terminal-pane'));
        
        setTimeout(() => {
            session.fitAddon.fit();
            session.term.focus();  // 强制focus到当前terminal
            console.log(`[切换] 已focus到terminal:`, sessionId);
        }, 100);
        
        // 检查是否为本地终端
        const isLocal = sessionId.startsWith('local');
        
        if (!isLocal) {
            loadCommandHistory(session.server.ID, session.server.name);
        }
        
        // 只在首次切换或上次sessionID不同时更新文件树（避免闪烁）
        if (!prevSessionId || prevSessionId !== sessionId) {
            if (isLocal) {
                // 本地终端
                setLocalTerminal();
            } else {
                // SSH终端
                setCurrentServer(session.server.ID, sessionId);
            }
        }
    }
    
    // 更新renderTabs以高亮当前tab
    renderTabs();
};

window.closeTab = function(sessionId) {
    const session = state.terminals.get(sessionId);
    if (session?.ws) session.ws.close();
    
    document.getElementById(sessionId)?.remove();
    state.terminals.delete(sessionId);
    
    // 清理保存的状态
    serverContentTabs.delete(sessionId);
    serverActivePane.delete(sessionId);
    
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
