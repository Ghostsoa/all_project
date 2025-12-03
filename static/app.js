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
});

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
        status: 'connecting'
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
    
    updateStatusLight('connecting', '正在连接...');
    
    // 建立 WebSocket 连接
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws?server_id=${server.ID}`);
    
    ws.onopen = () => {
        session.status = 'connected';
        updateStatusLight('connected', `已连接到 ${server.name}`);
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
                updateStatusLight('disconnected', event.data);
            } else {
                session.term.write(event.data);
            }
        }
    };
    
    ws.onerror = (error) => {
        session.status = 'disconnected';
        updateStatusLight('disconnected', 'WebSocket 错误');
        console.error('WebSocket error:', error);
    };
    
    ws.onclose = () => {
        session.status = 'disconnected';
        if (sessionId === activeSessionId) {
            updateStatusLight('disconnected', '连接已断开 - 点击重新连接');
        }
    };
    
    // 监听终端输入
    session.term.onData(data => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(data);
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
    const statusMap = {
        'connecting': ['connecting', '正在连接...'],
        'connected': ['connected', `已连接到 ${session.server.name}`],
        'disconnected': ['disconnected', '连接已断开 - 点击重新连接']
    };
    const [lightClass, message] = statusMap[session.status] || ['disconnected', '未知状态'];
    updateStatusLight(lightClass, message);
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

// 更新状态灯带
function updateStatusLight(status, message) {
    const light = document.getElementById('statusLight');
    const messageEl = document.getElementById('statusMessage');
    
    light.className = 'status-light ' + status;
    messageEl.textContent = message;
    
    // 如果断开连接，添加重连功能
    if (status === 'disconnected' && activeSessionId) {
        messageEl.style.cursor = 'pointer';
        messageEl.onclick = () => {
            const session = terminals.get(activeSessionId);
            if (session) {
                connectSSH(activeSessionId, session.server);
            }
        };
    } else {
        messageEl.style.cursor = 'default';
        messageEl.onclick = null;
    }
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
            // 如果当前连接的是被删除的服务器，关闭终端
            if (currentServer && currentServer.ID === id) {
                closeTerminal();
            }
            loadServers();
            alert('删除成功');
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
