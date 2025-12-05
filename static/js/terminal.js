// 终端管理模块
import { state, config } from './config.js';
import { showToast } from './utils.js';
import { saveCommandToHistory } from './commands.js';

export function createTerminal() {
    const term = new Terminal({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: 'JetBrains Mono, Consolas, Monaco, "Courier New", monospace',
        fontWeight: '400',
        fontWeightBold: '700',
        allowTransparency: true,
        theme: {
            background: '#000000',
            foreground: '#ffffff',
            cursor: '#ffffff',
            cursorAccent: '#000000',
            selectionBackground: 'rgba(255, 255, 255, 0.3)',
            // ANSI 颜色 - 支持彩色终端
            black: '#000000',
            red: '#ff6b6b',
            green: '#51cf66',
            yellow: '#ffd93d',
            blue: '#74c0fc',
            magenta: '#da77f2',
            cyan: '#4dabf7',
            white: '#f8f9fa',
            // Bright 颜色
            brightBlack: '#495057',
            brightRed: '#ff8787',
            brightGreen: '#69db7c',
            brightYellow: '#ffe066',
            brightBlue: '#91d7ff',
            brightMagenta: '#e599f7',
            brightCyan: '#66d9ef',
            brightWhite: '#ffffff'
        },
        // 启用更多终端特性
        convertEol: true,
        scrollback: 10000,
        tabStopWidth: 8
    });
    
    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    
    // 启用WebGL渲染器以提升性能和颜色显示
    try {
        const webglAddon = new WebglAddon.WebglAddon();
        term.loadAddon(webglAddon);
        console.log('✅ WebGL渲染器已启用');
    } catch (e) {
        console.warn('⚠️ WebGL渲染器加载失败，使用Canvas渲染:', e.message);
    }
    
    return { term, fitAddon };
}

export function connectSSH(sessionId, server) {
    const session = state.terminals.get(sessionId);
    const { term } = session;
    
    console.log(`[SSH连接] sessionId=${sessionId}, server=${server.name}`);
    
    updateStatusLight('connecting');
    
    const ws = new WebSocket(`${config.WS_PROTOCOL}//${config.WS_HOST}/ws?server_id=${server.id}&session_id=${sessionId}`);
    ws.binaryType = 'arraybuffer';
    
    let fileTreeLoaded = false; // 标记文件树是否已加载
    let firstDataReceived = false; // 标记是否收到第一次数据
    
    ws.onopen = () => {
        session.status = 'connecting'; // 先保持连接中
        // 不立即更新状态灯，等文件树加载完成
    };
    
    ws.onmessage = (event) => {
        // 确保写入正确的term实例
        const currentSession = state.terminals.get(sessionId);
        if (!currentSession) {
            console.error(`[SSH消息] session不存在: ${sessionId}`);
            return;
        }
        
        if (typeof event.data === 'string') {
            currentSession.term.write(event.data);
        } else {
            currentSession.term.write(new Uint8Array(event.data));
        }
        
        // 收到第一次数据后，说明SSH已就绪，延迟加载文件树
        if (!firstDataReceived) {
            firstDataReceived = true;
            
            // 收到SSH输出后，等待1.5秒确保SFTP也初始化完成
            if (!fileTreeLoaded && window.setCurrentServer) {
                fileTreeLoaded = true;
                setTimeout(async () => {
                    console.log('🔌 SSH已连接，开始加载文件树...');
                    await window.setCurrentServer(server.id, sessionId);
                    // 文件树加载完成后，更新状态
                    session.status = 'connected';
                    updateStatusLight('connected');
                    console.log('✅ 初始化完成');
                }, 1500); // 增加到1.5秒
            }
        }
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket 错误:', error);
        session.status = 'disconnected';
        updateStatusLight('disconnected');
        showDisconnectOverlay(sessionId, '连接错误', 'SSH连接失败');
    };
    
    ws.onclose = () => {
        session.status = 'disconnected';
        updateStatusLight('disconnected');
        showDisconnectOverlay(sessionId, '连接已断开', 'SSH会话已关闭');
    };
    
    // 清除旧的onData监听器（如果有）
    if (session.disposeOnData) {
        session.disposeOnData.dispose();
    }
    
    // 绑定新的onData监听器
    session.disposeOnData = term.onData(data => {
        const currentSession = state.terminals.get(sessionId);
        if (!currentSession || !currentSession.ws) {
            console.error(`[用户输入] session或ws不存在: ${sessionId}`);
            return;
        }
        
        if (currentSession.ws.readyState === WebSocket.OPEN) {
            currentSession.ws.send(data);
            
            // 捕获命令
            if (data === '\r' || data === '\n') {
                const command = currentSession.commandBuffer.trim();
                if (command && command.length > 0) {
                    saveCommandToHistory(server.id, server.name, command);
                }
                currentSession.commandBuffer = '';
            } else if (data === '\u007F' || data === '\b') {
                currentSession.commandBuffer = currentSession.commandBuffer.slice(0, -1);
            } else if (data >= ' ' && data <= '~') {
                currentSession.commandBuffer += data;
            }
        }
    });
    
    session.ws = ws;
}

export function openLocalTerminal() {
    const sessionId = 'local'; // 固定的sessionId，全局唯一
    
    // 检查是否已经存在本地终端会话
    if (state.terminals.has(sessionId)) {
        console.log('✅ 本地终端已存在，直接切换（不重新加载）');
        const session = state.terminals.get(sessionId);
        
        // 确保状态正确
        if (session && session.ws && session.ws.readyState === WebSocket.OPEN) {
            console.log('✅ 本地终端连接正常');
        }
        
        // 只切换显示，不重新加载
        window.switchTab(sessionId);
        return;
    }
    
    console.log('🚀 首次打开本地终端');
    
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
    
    const { term, fitAddon } = createTerminal();
    term.open(terminalPane);
    
    const localServer = {
        ID: 0,
        name: '本地终端',
        host: 'localhost',
        port: 0,
        username: 'local'
    };
    
    state.terminals.set(sessionId, {
        server: localServer,
        term,
        fitAddon,
        ws: null,
        status: 'connecting',
        commandBuffer: ''
    });
    
    state.activeSessionId = sessionId;
    window.renderTabs();
    window.switchTab(sessionId);
    
    connectLocalTerminal(sessionId);
}

function connectLocalTerminal(sessionId) {
    const session = state.terminals.get(sessionId);
    const { term } = session;
    
    // 如果已有连接且已连接或正在连接，则不重复连接
    if (session.ws) {
        const wsState = session.ws.readyState;
        if (wsState === WebSocket.CONNECTING) {
            console.log('本地终端正在连接，跳过重复连接');
            return;
        } else if (wsState === WebSocket.OPEN) {
            console.log('本地终端已连接，跳过重复连接');
            return;
        } else {
            // CLOSING或CLOSED，关闭并重新连接
            session.ws.close(1000, 'reconnecting');
        }
    }
    
    updateStatusLight('connecting');
    
    const ws = new WebSocket(`${config.WS_PROTOCOL}//${config.WS_HOST}/ws/local`);
    ws.binaryType = 'arraybuffer';
    session.ws = ws; // 保存连接
    
    // 心跳保活
    let heartbeatInterval;
    
    ws.onopen = async () => {
        session.status = 'connected';
        updateStatusLight('connected');
        
        // 调整终端大小以适配容器
        setTimeout(() => {
            session.fitAddon.fit();
            console.log('🔧 终端大小已调整');
        }, 100);
        
        // 启动心跳
        heartbeatInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(new Uint8Array([0])); // 发送空字节保活
            }
        }, 30000); // 每30秒一次
        
        // 发送换行符触发shell显示提示符
        setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send('\r'); // 发送回车，触发提示符
                console.log('✅ 本地终端已就绪');
            }
        }, 200); // 等待200ms让shell启动完成
        
        // 加载本地文件树
        if (window.setLocalTerminal) {
            try {
                await window.setLocalTerminal();
            } catch (error) {
                console.error('加载本地文件树失败:', error);
            }
        }
    };
    
    ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
            term.write(event.data);
        } else {
            term.write(new Uint8Array(event.data));
        }
    };
    
    ws.onerror = (error) => {
        console.error('本地终端 WebSocket 错误:', error);
        clearInterval(heartbeatInterval); // 清理心跳
        session.status = 'disconnected';
        updateStatusLight('error');
        // 本地终端出错，尝试重连
        setTimeout(() => {
            console.log('尝试重连本地终端...');
            connectLocalTerminal(sessionId);
        }, 2000);
    };
    
    ws.onclose = (event) => {
        console.log('本地终端 WebSocket 关闭:', event.code, event.reason);
        clearInterval(heartbeatInterval); // 清理心跳
        session.status = 'disconnected';
        updateStatusLight('disconnected');
        
        // 如果不是正常关闭（1000），尝试自动重连
        if (event.code !== 1000 && event.reason !== 'reconnecting') {
            term.write('\r\n\x1b[33m连接已断开，2秒后自动重连...\x1b[0m\r\n');
            setTimeout(() => {
                console.log('自动重连本地终端...');
                connectLocalTerminal(sessionId);
            }, 2000);
        } else if (event.code === 1000 && event.reason !== 'reconnecting') {
            showDisconnectOverlay(sessionId, '连接已断开', '本地终端已关闭');
        }
    };
    
    term.onData(data => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(data);
            
            if (data === '\r' || data === '\n') {
                const command = session.commandBuffer.trim();
                if (command && command.length > 0) {
                    saveCommandToHistory('0', '本地', command);
                }
                session.commandBuffer = '';
            } else if (data === '\u007F' || data === '\b') {
                session.commandBuffer = session.commandBuffer.slice(0, -1);
            } else if (data >= ' ' && data <= '~') {
                session.commandBuffer += data;
            }
        }
    });
    
    session.ws = ws;
}

function updateStatusLight(status) {
    const light = document.querySelector('.status-light');
    if (!light) return;
    
    light.className = 'status-light ' + status;
}

function showDisconnectOverlay(sessionId, title, message) {
    const pane = document.getElementById(sessionId);
    if (!pane) return;
    
    const overlay = document.createElement('div');
    overlay.className = 'disconnect-overlay';
    overlay.innerHTML = `
        <div class="disconnect-content">
            <div class="disconnect-icon">⚠️</div>
            <div class="disconnect-title">${title}</div>
            <div class="disconnect-message">${message}</div>
            <button class="btn-reconnect" onclick="window.closeTab('${sessionId}')">关闭</button>
        </div>
    `;
    pane.appendChild(overlay);
}
