// 全局变量
let servers = [];
let currentTags = [];

// 多窗口管理
let terminals = new Map(); // sessionId -> { server, term, fitAddon, ws, status }
let activeSessionId = null;
let sessionCounter = 0;

// 页面加载完成
document.addEventListener('DOMContentLoaded', function() {
    loadServers();
    initTagsInput();
    checkAuthStatus();
});

// ==================== 本地终端功能 ====================

// 打开本地终端
function openLocalTerminal() {
    const sessionId = 'local-' + (++sessionCounter);
    
    // 创建终端容器
    const terminalArea = document.getElementById('terminalArea');
    const terminalPane = document.createElement('div');
    terminalPane.id = sessionId;
    terminalPane.className = 'terminal-pane';
    terminalArea.appendChild(terminalPane);
    
    // 创建终端实例
    const term = new Terminal({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: 'Consolas, Monaco, "Courier New", monospace',
        theme: {
            background: '#1e1e1e',
            foreground: '#d4d4d4',
            cursor: '#d4d4d4',
            black: '#000000',
            red: '#cd3131',
            green: '#0dbc79',
            yellow: '#e5e510',
            blue: '#2472c8',
            magenta: '#bc3fbc',
            cyan: '#11a8cd',
            white: '#e5e5e5',
            brightBlack: '#666666',
            brightRed: '#f14c4c',
            brightGreen: '#23d18b',
            brightYellow: '#f5f543',
            brightBlue: '#3b8eea',
            brightMagenta: '#d670d6',
            brightCyan: '#29b8db',
            brightWhite: '#e5e5e5'
        }
    });
    
    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalPane);
    
    // 保存会话信息（本地终端用特殊server对象）
    const localServer = {
        ID: 0,
        name: '本地终端',
        host: 'localhost',
        port: 0,
        username: 'local'
    };
    
    terminals.set(sessionId, {
        server: localServer,
        term: term,
        fitAddon: fitAddon,
        ws: null,
        status: 'connecting',
        commandBuffer: ''
    });
    
    // 切换到新标签
    activeSessionId = sessionId;
    renderTabs();
    switchTab(sessionId);
    
    // 连接本地终端
    connectLocalTerminal(sessionId);
}

// 连接本地终端
function connectLocalTerminal(sessionId) {
    const session = terminals.get(sessionId);
    const term = session.term;
    
    updateStatusLight('connecting');
    
    // 建立 WebSocket 连接（本地终端）
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/local`);
    
    ws.binaryType = 'arraybuffer';
    
    ws.onopen = () => {
        session.status = 'connected';
        updateStatusLight('connected');
    };
    
    ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
            term.write(event.data);
        } else {
            const uint8Array = new Uint8Array(event.data);
            term.write(uint8Array);
        }
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket 错误:', error);
        session.status = 'disconnected';
        updateStatusLight('disconnected');
        showDisconnectOverlay(sessionId, '连接错误', '本地终端连接失败');
    };
    
    ws.onclose = () => {
        session.status = 'disconnected';
        updateStatusLight('disconnected');
        showDisconnectOverlay(sessionId, '连接已断开', '本地终端已关闭');
    };
    
    // 监听终端输入
    session.term.onData(data => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(data);
            
            // 捕获命令（检测回车键）
            if (data === '\r' || data === '\n') {
                const command = session.commandBuffer.trim();
                if (command && command.length > 0) {
                    // 保存命令到数据库（server_id=0表示本地终端）
                    saveCommand(0, command);
                }
                session.commandBuffer = '';
            } else if (data === '\u007F' || data === '\b') {
                // 退格键
                session.commandBuffer = session.commandBuffer.slice(0, -1);
            } else if (data >= ' ' && data <= '~') {
                // 可打印字符
                session.commandBuffer += data;
            }
        }
    });
    
    session.ws = ws;
}

// 检查认证状态
async function checkAuthStatus() {
    try {
        const response = await fetch('/api/servers');
        if (response.status === 401) {
            // 未授权，跳转到登录页
            window.location.href = '/login';
        }
    } catch (error) {
        console.error('检查认证状态失败:', error);
    }
}

// 登出
async function logout() {
    if (!confirm('确定要退出登录吗？')) {
        return;
    }
    
    try {
        await fetch('/api/logout');
        window.location.href = '/login';
    } catch (error) {
        console.error('登出失败:', error);
        window.location.href = '/login';
    }
}

// 加载服务器列表
async function loadServers() {
    try {
        const response = await fetch('/api/servers');
        const data = await response.json();
        
        if (data.success) {
            servers = data.data || [];
            renderServerList();
        }
    } catch (error) {
        console.error('加载服务器列表失败:', error);
    }
}

// 渲染服务器列表
function renderServerList(filterServers = null) {
    const list = document.getElementById('serverList');
    const serversToRender = filterServers || servers;
    
    if (serversToRender.length === 0) {
        list.innerHTML = '<div class="loading">暂无服务器</div>';
        return;
    }
    
    list.innerHTML = serversToRender.map(server => {
        const tagsHtml = server.tags && server.tags.length > 0 
            ? `<div class="server-tags">🏷️ ${server.tags.map(tag => escapeHtml(tag)).join(', ')}</div>` 
            : '';
        return `
            <div class="server-item" onclick="selectServer(${server.ID})">
                <div class="server-name">${escapeHtml(server.name)}</div>
                <div class="server-info">${escapeHtml(server.username)}@${escapeHtml(server.host)}:${server.port}</div>
                ${tagsHtml}
                <div class="server-actions">
                    <button class="btn-small" onclick="event.stopPropagation(); editServer(${server.ID})">编辑</button>
                    <button class="btn-small delete" onclick="event.stopPropagation(); deleteServer(${server.ID})">删除</button>
                </div>
            </div>
        `;
    }).join('');
}

// 搜索服务器
async function searchServers() {
    const keyword = document.getElementById('searchInput').value.trim();
    
    if (!keyword) {
        renderServerList();
        return;
    }
    
    try {
        const response = await fetch(`/api/servers/search?q=${encodeURIComponent(keyword)}`);
        const data = await response.json();
        
        if (data.success) {
            renderServerList(data.data || []);
        }
    } catch (error) {
        console.error('搜索失败:', error);
    }
}

// 选择服务器 - 创建新窗口
function selectServer(id) {
    const server = servers.find(s => s.ID === id);
    if (!server) return;
    
    // 检查是否已经打开了该服务器
    for (let [sessionId, session] of terminals) {
        if (session.server.ID === id) {
            switchTab(sessionId);
            return;
        }
    }
    
    // 创建新会话
    createNewSession(server);
}

// ==================== 多窗口终端管理 ====================

// 创建新会话
function createNewSession(server) {
    const sessionId = `session-${++sessionCounter}`;
    
    // 显示终端区域
    document.getElementById('noSelection').style.display = 'none';
    document.getElementById('terminalWrapper').style.display = 'flex';
    
    // 创建终端容器
    const terminalPane = document.createElement('div');
    terminalPane.className = 'terminal-pane';
    terminalPane.id = sessionId;
    document.getElementById('terminalsContainer').appendChild(terminalPane);
    
    // 创建终端实例
    const term = new Terminal({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: '"Cascadia Code", Consolas, "Courier New", monospace',
        theme: {
            background: '#1e1e1e',
            foreground: '#d4d4d4',
            cursor: '#ffffff',
            selection: '#264f78',
            black: '#000000',
            red: '#cd3131',
            green: '#0dbc79',
            yellow: '#e5e510',
            blue: '#2472c8',
            magenta: '#bc3fbc',
            cyan: '#11a8cd',
            white: '#e5e5e5',
            brightBlack: '#666666',
            brightRed: '#f14c4c',
            brightGreen: '#23d18b',
            brightYellow: '#f5f543',
            brightBlue: '#3b8eea',
            brightMagenta: '#d670d6',
            brightCyan: '#29b8db',
            brightWhite: '#ffffff'
        }
    });
    
    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalPane);
    
    // 保存会话信息
    terminals.set(sessionId, {
        server: server,
        term: term,
        fitAddon: fitAddon,
        ws: null,
        status: 'connecting',
        commandBuffer: '' // 命令缓冲区
    });
    
    // 切换到新标签
    activeSessionId = sessionId;
    renderTabs();
    switchTab(sessionId);
    
    // 连接 SSH
    connectSSH(sessionId, server);
    
    // 窗口大小变化时调整终端
    window.addEventListener('resize', () => {
        if (activeSessionId) {
            const session = terminals.get(activeSessionId);
            if (session && session.fitAddon) {
                setTimeout(() => session.fitAddon.fit(), 100);
            }
        }
    });
}

// 连接 SSH
function connectSSH(sessionId, server) {
    const session = terminals.get(sessionId);
    if (!session) return;
    
    updateStatusLight('connecting');
    
    // 建立 WebSocket 连接
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws?server_id=${server.ID}`);
    
    ws.onopen = () => {
        session.status = 'connected';
        updateStatusLight('connected');
        hideDisconnectOverlay(sessionId);
        setTimeout(() => session.fitAddon.fit(), 100);
    };
    
    ws.onmessage = (event) => {
        if (event.data instanceof Blob) {
            event.data.arrayBuffer().then(buffer => {
                session.term.write(new Uint8Array(buffer));
            });
        } else {
            if (event.data.startsWith('SSH 连接失败')) {
                session.status = 'disconnected';
                updateStatusLight('disconnected');
                showDisconnectOverlay(sessionId, '连接失败', event.data);
            } else {
                session.term.write(event.data);
            }
        }
    };
    
    ws.onerror = (error) => {
        session.status = 'disconnected';
        updateStatusLight('disconnected');
        console.error('WebSocket error:', error);
    };
    
    ws.onclose = () => {
        session.status = 'disconnected';
        updateStatusLight('disconnected');
        showDisconnectOverlay(sessionId, '连接已断开', '网络连接中断或服务器超时');
    };
    
    // 监听终端输入
    session.term.onData(data => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(data);
            
            // 捕获命令（检测回车键）
            if (data === '\r' || data === '\n') {
                const command = session.commandBuffer.trim();
                if (command && command.length > 0) {
                    // 保存命令到数据库
                    saveCommand(server.ID, command);
                }
                session.commandBuffer = '';
            } else if (data === '\u007F' || data === '\b') {
                // 退格键
                session.commandBuffer = session.commandBuffer.slice(0, -1);
            } else if (data >= ' ' && data <= '~') {
                // 可打印字符
                session.commandBuffer += data;
            }
        }
    });
    
    session.ws = ws;
}

// 切换标签页
function switchTab(sessionId) {
    if (!terminals.has(sessionId)) return;
    
    activeSessionId = sessionId;
    
    // 更新标签状态
    document.querySelectorAll('.tab-item').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.sessionId === sessionId);
    });
    
    // 更新终端显示
    document.querySelectorAll('.terminal-pane').forEach(pane => {
        pane.classList.toggle('active', pane.id === sessionId);
    });
    
    // 调整终端大小
    const session = terminals.get(sessionId);
    setTimeout(() => session.fitAddon.fit(), 100);
    
    // 更新状态灯
    updateStatusLight(session.status);
    
    // 加载命令历史
    loadCommandHistory(session.server.ID, session.server.name);
}

// 关闭标签页
function closeTab(sessionId) {
    const session = terminals.get(sessionId);
    if (!session) return;
    
    // 关闭 WebSocket
    if (session.ws) {
        session.ws.close();
    }
    
    // 销毁终端
    session.term.dispose();
    
    // 删除 DOM
    const pane = document.getElementById(sessionId);
    if (pane) pane.remove();
    
    // 删除会话
    terminals.delete(sessionId);
    
    // 如果是当前活动标签
    if (activeSessionId === sessionId) {
        if (terminals.size > 0) {
            // 切换到第一个标签
            const firstSessionId = terminals.keys().next().value;
            switchTab(firstSessionId);
        } else {
            // 没有标签了，显示空状态
            activeSessionId = null;
            document.getElementById('noSelection').style.display = 'flex';
            document.getElementById('terminalWrapper').style.display = 'none';
        }
    }
    
    renderTabs();
}

// 渲染标签栏
function renderTabs() {
    const tabsList = document.getElementById('tabsList');
    tabsList.innerHTML = '';
    
    for (let [sessionId, session] of terminals) {
        const tab = document.createElement('div');
        tab.className = 'tab-item';
        tab.dataset.sessionId = sessionId;
        if (sessionId === activeSessionId) {
            tab.classList.add('active');
        }
        
        tab.innerHTML = `
            <span class="tab-name">${escapeHtml(session.server.name)}</span>
            <span class="tab-close" onclick="event.stopPropagation(); closeTab('${sessionId}')">×</span>
        `;
        
        tab.onclick = () => switchTab(sessionId);
        tabsList.appendChild(tab);
    }
}

// 更新状态灯带 - 纯灯带无文本
function updateStatusLight(status) {
    const light = document.getElementById('statusLight');
    light.className = 'status-light ' + status;
}

// 显示断连覆盖层
function showDisconnectOverlay(sessionId, title, message) {
    const pane = document.getElementById(sessionId);
    if (!pane) return;
    
    // 检查是否已存在覆盖层
    let overlay = pane.querySelector('.disconnect-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'disconnect-overlay';
        overlay.innerHTML = `
            <div class="disconnect-content">
                <div class="disconnect-icon">⚠️</div>
                <div class="disconnect-title">${escapeHtml(title)}</div>
                <div class="disconnect-message">${escapeHtml(message)}</div>
                <button class="btn-reconnect" onclick="reconnectSession('${sessionId}')">
                    🔄 重新连接
                </button>
            </div>
        `;
        pane.appendChild(overlay);
    }
}

// 隐藏断连覆盖层
function hideDisconnectOverlay(sessionId) {
    const pane = document.getElementById(sessionId);
    if (!pane) return;
    
    const overlay = pane.querySelector('.disconnect-overlay');
    if (overlay) {
        overlay.remove();
    }
}

// 重新连接会话
function reconnectSession(sessionId) {
    const session = terminals.get(sessionId);
    if (!session) return;
    
    // 清除旧连接
    if (session.ws) {
        session.ws.close();
    }
    
    // 清空终端
    session.term.clear();
    
    // 隐藏覆盖层
    hideDisconnectOverlay(sessionId);
    
    // 重新连接
    connectSSH(sessionId, session.server);
}

// 显示添加服务器模态框
function showAddServerModal() {
    document.getElementById('modalTitle').textContent = '添加服务器';
    document.getElementById('serverForm').reset();
    document.getElementById('serverId').value = '';
    currentTags = [];
    renderTags();
    document.getElementById('serverModal').classList.add('show');
}

// 编辑服务器
async function editServer(id) {
    try {
        const response = await fetch(`/api/server?id=${id}`);
        const data = await response.json();
        
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
            currentTags = server.tags || [];
            renderTags();
            document.getElementById('serverModal').classList.add('show');
        }
    } catch (error) {
        console.error('加载服务器信息失败:', error);
        alert('加载服务器信息失败');
    }
}

// 保存服务器
async function saveServer() {
    const id = document.getElementById('serverId').value;
    const server = {
        name: document.getElementById('serverName').value.trim(),
        host: document.getElementById('serverHost').value.trim(),
        port: parseInt(document.getElementById('serverPort').value),
        username: document.getElementById('serverUsername').value.trim(),
        password: document.getElementById('serverPassword').value,
        auth_type: 'password',
        description: document.getElementById('serverDescription').value.trim(),
        tags: currentTags
    };
    
    if (!server.name || !server.host || !server.username) {
        alert('请填写必填项');
        return;
    }
    
    try {
        let response;
        if (id) {
            // 更新
            server.ID = parseInt(id);
            response = await fetch('/api/server/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(server)
            });
        } else {
            // 创建
            if (!server.password) {
                alert('密码不能为空');
                return;
            }
            response = await fetch('/api/server/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(server)
            });
        }
        
        const data = await response.json();
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
}

// 删除服务器
async function deleteServer(id) {
    if (!confirm('确定要删除这个服务器配置吗？')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/server/delete?id=${id}`, {
            method: 'POST'
        });
        const data = await response.json();
        
        if (data.success) {
            // 关闭所有该服务器的终端会话
            for (let [sessionId, session] of terminals) {
                if (session.server.ID === id) {
                    closeTab(sessionId);
                }
            }
            
            // 刷新服务器列表
            await loadServers();
        } else {
            alert(data.error || '删除失败');
        }
    } catch (error) {
        console.error('删除失败:', error);
        alert('删除失败');
    }
}

// 关闭模态框
function closeModal() {
    document.getElementById('serverModal').classList.remove('show');
}

// HTML转义
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 点击模态框外部关闭
document.getElementById('serverModal').addEventListener('click', function(e) {
    if (e.target === this) {
        closeModal();
    }
});

// ==================== 标签管理功能 ====================

// 初始化标签输入
function initTagsInput() {
    const input = document.getElementById('serverTagsInput');
    if (!input) return;
    
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            addTag();
        } else if (e.key === 'Backspace' && input.value === '' && currentTags.length > 0) {
            // 删除最后一个标签
            currentTags.pop();
            renderTags();
        }
    });
}

// 添加标签
function addTag() {
    const input = document.getElementById('serverTagsInput');
    const tag = input.value.trim();
    
    if (tag && !currentTags.includes(tag)) {
        currentTags.push(tag);
        renderTags();
        input.value = '';
    }
}

// 删除标签
function removeTag(index) {
    currentTags.splice(index, 1);
    renderTags();
}

// 渲染标签
function renderTags() {
    const display = document.getElementById('tagsDisplay');
    if (!display) return;
    
    display.innerHTML = currentTags.map((tag, index) => `
        <span class="tag-item" onclick="removeTag(${index})">
            ${escapeHtml(tag)}
            <span class="tag-remove">×</span>
        </span>
    `).join('');
}

// ==================== 命令记录功能 ====================

// 保存命令到数据库
async function saveCommand(serverId, command) {
    try {
        await fetch('/api/command/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                server_id: serverId,
                command: command
            })
        });
        
        // 如果当前显示的是该服务器，刷新命令列表
        const session = terminals.get(activeSessionId);
        if (session && session.server.ID === serverId) {
            loadCommandHistory(serverId, session.server.name);
        }
    } catch (error) {
        console.error('保存命令失败:', error);
    }
}

// 加载命令历史
async function loadCommandHistory(serverId, serverName) {
    try {
        const response = await fetch(`/api/commands?server_id=${serverId}&limit=50`);
        const data = await response.json();
        
        if (data.success) {
            const displayName = serverId === 0 ? '💻 本地终端' : serverName || '未知服务器';
            document.getElementById('commandsServerName').textContent = displayName;
            renderCommandHistory(data.data || []);
        }
    } catch (error) {
        console.error('加载命令历史失败:', error);
        renderCommandHistory([]);
    }
}

// 渲染命令历史列表
function renderCommandHistory(commands) {
    const list = document.getElementById('commandsList');
    
    if (commands.length === 0) {
        list.innerHTML = '<div class="commands-empty"><p>暂无命令记录</p></div>';
        return;
    }
    
    list.innerHTML = commands.map(cmd => {
        const date = new Date(cmd.created_at);
        const timeStr = formatTime(date);
        
        return `
            <div class="command-item">
                <div class="command-text">${escapeHtml(cmd.command)}</div>
                <div class="command-meta">
                    <span class="command-time">⏰ ${timeStr}</span>
                    <button class="command-copy" onclick="copyCommand('${escapeHtml(cmd.command).replace(/'/g, "\\'")}')">
                        📋 复制
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// 清除当前服务器的命令历史
async function clearCurrentCommands() {
    const session = terminals.get(activeSessionId);
    if (!session) {
        alert('请先选择一个服务器');
        return;
    }
    
    if (!confirm(`确定要清除"${session.server.name}"的所有命令记录吗？`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/commands/clear?server_id=${session.server.ID}`, {
            method: 'POST'
        });
        const data = await response.json();
        
        if (data.success) {
            loadCommandHistory(session.server.ID, session.server.name);
        } else {
            alert(data.error || '清除失败');
        }
    } catch (error) {
        console.error('清除命令历史失败:', error);
        alert('清除失败');
    }
}

// 切换右侧面板标签
function switchRightTab(tabName) {
    // 更新标签状态
    document.querySelectorAll('.right-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
    });
    
    // 更新内容显示
    document.querySelectorAll('.right-panel-content').forEach(content => {
        content.classList.remove('active');
    });
    
    if (tabName === 'ai') {
        document.getElementById('aiPanel').classList.add('active');
    } else if (tabName === 'commands') {
        document.getElementById('commandsPanel').classList.add('active');
    }
}

// 复制命令到剪贴板
function copyCommand(command) {
    navigator.clipboard.writeText(command).then(() => {
        // 可以添加一个提示
        console.log('命令已复制:', command);
    }).catch(err => {
        console.error('复制失败:', err);
    });
}

// 格式化时间
function formatTime(date) {
    const now = new Date();
    const diff = now - date;
    
    // 小于1分钟
    if (diff < 60000) {
        return '刚刚';
    }
    
    // 小于1小时
    if (diff < 3600000) {
        return Math.floor(diff / 60000) + '分钟前';
    }
    
    // 小于24小时
    if (diff < 86400000) {
        return Math.floor(diff / 3600000) + '小时前';
    }
    
    // 今天
    if (date.toDateString() === now.toDateString()) {
        return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    }
    
    // 其他
    return date.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}
