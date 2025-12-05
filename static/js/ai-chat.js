// AI对话管理模块

import { apiRequest } from './api.js';
import { state } from './config.js';
import { getEditorInstance } from './editor.js';

// 全局变量
let currentSession = null;
let chatWebSocket = null;
let sessions = [];
let availableConfigs = []; // 可用的AI配置列表
let chatWSHeartbeatInterval = null; // 心跳定时器
let isReconnecting = false; // 重连标志
let isGenerating = false; // 是否正在生成

// ========== Loading 控制 ==========

function showAILoading(text = '正在加载中') {
    const overlay = document.getElementById('aiLoadingOverlay');
    const textEl = document.getElementById('aiLoadingText');
    if (overlay) {
        if (textEl) textEl.textContent = text;
        overlay.style.display = 'flex';
    }
}

function hideAILoading() {
    const overlay = document.getElementById('aiLoadingOverlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
}

// ========== 模型配置管理 ==========

let allModels = []; // 缓存所有模型
let modelsLoaded = false; // 模型是否已加载

// 更新模型显示
function updateModelDisplay() {
    const modelEl = document.getElementById('selectedModel');
    if (!modelEl) return;
    
    if (currentSession?.model_id) {
        // 根据model_id查找模型信息
        const model = allModels.find(m => m.id === currentSession.model_id);
        modelEl.textContent = model ? (model.name || model.id) : currentSession.model_id;
    } else {
        modelEl.textContent = '选择模型';
    }
}

// 切换模型选择器
window.toggleModelSelector = async function() {
    const popup = document.getElementById('modelPopup');
    if (!popup) return;
    
    const isOpen = popup.style.display === 'block';
    
    if (isOpen) {
        popup.style.display = 'none';
    } else {
        // 如果还没加载过，先加载
        if (!modelsLoaded) {
            await loadModelList();
        } else {
            // 使用缓存，直接渲染
            renderModelList(allModels);
        }
        popup.style.display = 'block';
    }
};

// 加载模型列表
async function loadModelList() {
    try {
        const modelData = await apiRequest('/api/ai/models');
        allModels = modelData.data || [];
        modelsLoaded = true;
        renderModelList(allModels);
    } catch (error) {
        console.error('加载模型列表失败:', error);
        const container = document.getElementById('modelList');
        if (container) container.innerHTML = '<div class="loading-small">加载失败</div>';
    }
}

// 刷新模型列表缓存（供应商编辑后调用）
window.refreshModelCache = async function() {
    console.log('🔄 刷新模型列表缓存...');
    modelsLoaded = false;
    await loadModelList();
};

// 渲染模型列表
function renderModelList(models) {
    const container = document.getElementById('modelList');
    if (!container) return;
    
    if (models.length === 0) {
        container.innerHTML = '<div class="loading-small">暂无模型</div>';
        return;
    }
    
    const currentModelId = currentSession?.model_id;
    
    container.innerHTML = models.map(model => `
        <div class="model-option ${currentModelId === model.id ? 'active' : ''}"
             onclick="selectTempModel('${model.id}')"
             data-model-id="${model.id}">
            <div class="model-info">
                <div class="model-name">${escapeHtml(model.name || model.id)}</div>
            </div>
            ${currentModelId === model.id ? '<i class="fa-solid fa-check"></i>' : ''}
        </div>
    `).join('');
}

// endpoint已移除，供应商信息自动关联到模型

// 选择模型并立即切换
window.selectTempModel = async function(modelId) {
    if (!currentSession) return;
    
    try {
        // 立即更新会话模型
        await apiRequest('/api/ai/session/update-model', 'POST', {
            session_id: currentSession.id,
            model_id: modelId
        });
        
        // 更新本地会话信息
        currentSession.model_id = modelId;
        
        // 更新显示
        updateModelDisplay();
        
        // 关闭弹窗
        toggleModelSelector();
    } catch (error) {
        console.error('切换模型失败:', error);
        alert('切换模型失败: ' + error.message);
    }
};

// ========== 会话管理 ==========

// 加载会话列表
export async function loadSessions() {
    showAILoading('正在加载会话...');
    try {
        const data = await apiRequest('/api/ai/sessions');
        sessions = data.data || [];
        renderSessionList();
        
        // 后台预加载模型列表（不阻塞）
        if (!modelsLoaded) {
            loadModelList().catch(err => console.error('预加载模型列表失败:', err));
        }
        
        // 如果有会话，自动选择第一个
        if (sessions.length > 0 && !currentSession) {
            await selectAISession(sessions[0].id);
        } else {
            // 没有会话，隐藏加载，显示欢迎界面
            hideAILoading();
            showWelcomeScreen();
        }
    } catch (error) {
        console.error('加载会话列表失败:', error);
        hideAILoading();
        showWelcomeScreen();
    }
}

// 显示欢迎界面
function showWelcomeScreen() {
    const messagesContainer = document.getElementById('aiMessages');
    if (messagesContainer) {
        messagesContainer.innerHTML = `
            <div class="ai-welcome">
                <div class="welcome-icon">🤖</div>
                <h3>AI 助手</h3>
                <p>开始对话，获取智能帮助</p>
            </div>
        `;
    }
}

// 渲染会话列表
function renderSessionList() {
    const container = document.getElementById('aiConversationHistory');
    const triggerEl = document.querySelector('.history-trigger');
    const titleEl = document.getElementById('currentConversationTitle');
    const arrowEl = document.querySelector('.history-arrow');
    
    if (!container) return;

    if (sessions.length === 0) {
        // 没有对话历史：显示"开始新的对话 +"
        if (titleEl) titleEl.textContent = '开始新的对话';
        if (arrowEl) arrowEl.textContent = '+';
        
        // 修改点击行为：直接创建新对话
        if (triggerEl) {
            triggerEl.onclick = function() {
                createNewAISession();
            };
        }
        
        // 清空下拉内容
        container.innerHTML = '';
        return;
    }

    // 有对话历史：显示"对话历史 ▼"
    const currentTitle = currentSession?.title || '对话历史';
    if (titleEl) titleEl.textContent = currentTitle;
    if (arrowEl) arrowEl.textContent = '▼';
    
    // 恢复点击行为：展开/收起列表
    if (triggerEl) {
        // 移除旧的事件监听器（如果存在）
        const newTrigger = triggerEl.cloneNode(true);
        triggerEl.parentNode.replaceChild(newTrigger, triggerEl);
        
        // 使用addEventListener代替onclick，确保事件冒泡正常工作
        newTrigger.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            toggleHistoryDropdown();
        });
    }

    container.innerHTML = `
        <div class="history-item new" data-action="create-new">
            <i class="fa-solid fa-plus"></i>
            <span>新建对话</span>
        </div>
        <div class="history-divider"></div>
    ` + sessions.map(session => `
        <div class="history-item ${currentSession?.id === session.id ? 'active' : ''}" 
             data-action="select-session"
             data-session-id="${session.id}">
            <div class="history-item-title">${escapeHtml(session.title)}</div>
            <div class="history-item-meta">
                <span>${formatTime(session.updated_at)}</span>
                ${session.model_id ? `<span class="model-tag">${escapeHtml(session.model_id)}</span>` : ''}
            </div>
            <button class="history-item-delete" data-action="delete-session" data-session-id="${session.id}" title="删除">
                <i class="fa-solid fa-trash"></i>
            </button>
        </div>
    `).join('');
    
    // 添加事件委托
    container.onclick = function(e) {
        const target = e.target.closest('[data-action]');
        if (!target) return;
        
        const action = target.dataset.action;
        const sessionId = target.dataset.sessionId;
        
        if (action === 'create-new') {
            createNewAISession();
            toggleHistoryDropdown();
        } else if (action === 'select-session' && sessionId) {
            selectAISession(sessionId);
            toggleHistoryDropdown();
        } else if (action === 'delete-session' && sessionId) {
            e.stopPropagation();
            deleteAISession(sessionId);
        }
    };
}

// 选择会话
window.selectAISession = async function(sessionId) {
    showAILoading('正在加载对话...');
    try {
        const data = await apiRequest(`/api/ai/session?id=${sessionId}`);
        currentSession = data.data;
        
        // 确保模型列表已加载
        if (!modelsLoaded) {
            await loadModelList();
        }
        
        // 更新UI
        renderSessionList();
        updateModelDisplay(); // 更新模型显示
        
        // 加载消息
        await loadMessages(sessionId);
        
        // 显示对话区域
        showChatArea();
        
        hideAILoading();
    } catch (error) {
        console.error('选择会话失败:', error);
        hideAILoading();
        alert('加载会话失败: ' + error.message);
    }
};

// 加载消息
async function loadMessages(sessionId) {
    try {
        const data = await apiRequest(`/api/ai/messages?session_id=${sessionId}&limit=50`);
        const messages = data.data || [];
        
        const messagesContainer = document.getElementById('aiMessages');
        if (!messagesContainer) return;
        
        // 清空欢迎信息
        messagesContainer.innerHTML = '';
        
        // 渲染消息
        messages.forEach(msg => {
            appendMessage(msg.role, msg.content, msg.reasoning_content, msg.ID);
        });
        
        // 滚动到底部
        scrollToBottom();
    } catch (error) {
        console.error('加载消息失败:', error);
    }
}

// 创建新会话
window.createNewAISession = async function() {
    const title = prompt('请输入对话标题:', '新对话 - ' + new Date().toLocaleString());
    if (!title) return;
    
    try {
        // 后端会自动处理默认模型：继承最新会话或使用第一个模型
        const data = await apiRequest('/api/ai/session/create', 'POST', {
            title: title
        });
        
        currentSession = data.data;
        
        // 确保模型列表已加载
        if (!modelsLoaded) {
            await loadModelList();
        }
        
        // 重新加载会话列表
        await loadSessions();
        
        // 清空消息区域，显示欢迎信息
        const messagesContainer = document.getElementById('aiMessages');
        if (messagesContainer) {
            messagesContainer.innerHTML = `
                <div class="ai-welcome">
                    <div class="welcome-icon">🤖</div>
                    <h3>新对话已创建</h3>
                    <p>开始对话吧</p>
                </div>
            `;
        }
        
        showChatArea();
        
        // 关闭下拉菜单
        const menu = document.getElementById('historyDropdownMenu');
        if (menu) menu.style.display = 'none';
    } catch (error) {
        console.error('创建会话失败:', error);
        alert('创建会话失败: ' + error.message);
    }
};

// 删除会话
window.deleteAISession = async function(sessionId) {
    if (!confirm('确定要删除这个对话吗？')) return;
    
    try {
        await apiRequest(`/api/ai/session/delete?id=${sessionId}`, 'POST');
        
        // 如果删除的是当前会话，清空当前会话
        if (currentSession?.id === sessionId) {
            currentSession = null;
            const messagesContainer = document.getElementById('aiMessages');
            if (messagesContainer) {
                messagesContainer.innerHTML = `
                    <div class="ai-welcome">
                        <div class="welcome-icon">🤖</div>
                        <h3>AI 助手</h3>
                        <p>选择一个对话或创建新对话</p>
                    </div>
                `;
            }
        }
        
        // 重新加载会话列表
        await loadSessions();
    } catch (error) {
        console.error('删除会话失败:', error);
        alert('删除会话失败: ' + error.message);
    }
};

// 清空当前对话
window.clearCurrentAIChat = async function() {
    if (!currentSession) {
        alert('请先选择一个对话');
        return;
    }
    
    if (!confirm('确定要清空当前对话的所有消息吗？')) return;
    
    try {
        await apiRequest(`/api/ai/session/clear?id=${currentSession.id}`, 'POST');
        
        // 清空消息显示
        const messagesContainer = document.getElementById('aiMessages');
        if (messagesContainer) {
            messagesContainer.innerHTML = `
                <div class="ai-welcome">
                    <div class="welcome-icon">🤖</div>
                    <h3>对话已清空</h3>
                    <p>开始新的对话吧</p>
                </div>
            `;
        }
    } catch (error) {
        console.error('清空对话失败:', error);
        alert('清空对话失败: ' + error.message);
    }
};

// ========== 消息操作处理 ==========

/**
 * 开始编辑消息
 */
window.startEditMessage = function(messageId) {
    const messageEl = document.querySelector(`.ai-message[data-message-id="${messageId}"]`);
    if (!messageEl) return;
    
    const contentDiv = messageEl.querySelector('.message-content');
    const originalContent = contentDiv.textContent.trim();
    
    // 创建编辑界面
    const textarea = document.createElement('textarea');
    textarea.className = 'message-edit-textarea';
    textarea.value = originalContent;
    textarea.rows = 3;
    
    const buttons = document.createElement('div');
    buttons.className = 'message-edit-buttons';
    buttons.innerHTML = `
        <button class="btn-edit-save" onclick="saveEditedMessage(${messageId})" title="保存">✓</button>
        <button class="btn-edit-cancel" onclick="cancelEditMessage(${messageId})" title="取消">×</button>
    `;
    
    // 保存原始内容用于取消
    contentDiv.dataset.originalContent = originalContent;
    
    // 替换内容
    contentDiv.innerHTML = '';
    contentDiv.appendChild(textarea);
    contentDiv.appendChild(buttons);
    textarea.focus();
};

/**
 * 保存编辑的消息
 */
window.saveEditedMessage = async function(messageId) {
    const messageEl = document.querySelector(`.ai-message[data-message-id="${messageId}"]`);
    if (!messageEl) return;
    
    const contentDiv = messageEl.querySelector('.message-content');
    const textarea = contentDiv.querySelector('textarea');
    const newContent = textarea.value.trim();
    
    if (!newContent) {
        alert('消息内容不能为空');
        return;
    }
    
    try {
        await editMessage(messageId, newContent);
        // 更新显示
        contentDiv.innerHTML = escapeHtml(newContent).replace(/\n/g, '<br>');
        // 重新加载消息以更新历史
        await loadMessages(currentSession.id);
    } catch (error) {
        alert('编辑失败: ' + error.message);
        // 恢复原始内容
        const originalContent = contentDiv.dataset.originalContent;
        contentDiv.innerHTML = escapeHtml(originalContent).replace(/\n/g, '<br>');
    }
};

/**
 * 取消编辑消息
 */
window.cancelEditMessage = function(messageId) {
    const messageEl = document.querySelector(`.ai-message[data-message-id="${messageId}"]`);
    if (!messageEl) return;
    
    const contentDiv = messageEl.querySelector('.message-content');
    const originalContent = contentDiv.dataset.originalContent;
    
    // 恢复原始显示
    contentDiv.innerHTML = escapeHtml(originalContent).replace(/\n/g, '<br>');
};

/**
 * 确认撤回消息
 */
window.confirmRevokeMessage = function(messageId) {
    if (confirm('确定要撤回此消息及之后的所有消息吗？此操作不可恢复！')) {
        revokeMessageHandler(messageId);
    }
};

/**
 * 撤回消息处理
 */
async function revokeMessageHandler(messageId) {
    try {
        await revokeMessage(messageId);
        // 重新加载消息
        await loadMessages(currentSession.id);
    } catch (error) {
        alert('撤回失败: ' + error.message);
    }
}

// ========== 消息操作API ==========

/**
 * 编辑消息
 */
async function editMessage(messageId, content) {
    try {
        const data = await apiRequest('/api/ai/message/edit', 'POST', {
            message_id: messageId,
            content: content
        });
        return data;
    } catch (error) {
        console.error('编辑消息失败:', error);
        throw error;
    }
}

/**
 * 删除单条消息
 */
async function deleteMessage(messageId) {
    try {
        await apiRequest(`/api/ai/message/delete?id=${messageId}`, 'POST');
    } catch (error) {
        console.error('删除消息失败:', error);
        throw error;
    }
}

/**
 * 撤回消息（删除该消息及后续所有消息）
 */
async function revokeMessage(messageId) {
    try {
        await apiRequest(`/api/ai/message/revoke?id=${messageId}`, 'POST');
    } catch (error) {
        console.error('撤回消息失败:', error);
        throw error;
    }
}

// ========== 上下文信息获取接口 ==========

/**
 * 获取当前激活终端的缓冲区数据
 * @param {number} lines - 获取最近多少行（默认50行）
 * @returns {object|null} { content: string, serverName: string, sessionId: string }
 */
window.getTerminalBuffer = function(lines = 50) {
    try {
        // 获取当前激活的终端pane
        const activeTerminal = document.querySelector('.terminal-pane.active');
        if (!activeTerminal) {
            return null;
        }
        
        const sessionId = activeTerminal.id;
        const terminalSession = state.terminals.get(sessionId);
        
        if (!terminalSession || !terminalSession.term) {
            return null;
        }
        
        // 获取终端缓冲区数据
        const buffer = terminalSession.term.buffer.active;
        const bufferLines = [];
        const startLine = Math.max(0, buffer.baseY + buffer.cursorY - lines);
        const endLine = buffer.baseY + buffer.cursorY;
        
        for (let i = startLine; i <= endLine; i++) {
            const line = buffer.getLine(i);
            if (line) {
                bufferLines.push(line.translateToString(true));
            }
        }
        
        const content = bufferLines.join('\n').trim();
        const serverName = terminalSession.server?.name || '本地终端';
        
        return {
            content: content,
            serverName: serverName,
            sessionId: sessionId,
            lineCount: bufferLines.length
        };
    } catch (error) {
        console.error('获取终端缓冲区失败:', error);
        return null;
    }
};

/**
 * 获取当前激活编辑器的文件信息和光标上下文
 * @param {number} contextLines - 光标前后获取多少行（默认100行）
 * @returns {object|null} { filePath, fileName, cursor, content, ... }
 */
window.getEditorContext = function(contextLines = 100) {
    try {
        // 获取当前激活的编辑器pane
        const activeEditorPane = document.querySelector('.editor-pane.active');
        if (!activeEditorPane) {
            return null;
        }
        
        const tabId = activeEditorPane.dataset.tabId;
        const filePath = activeEditorPane.dataset.path;
        const fileName = filePath ? filePath.split('/').pop() : 'unknown';
        
        // 获取Monaco编辑器实例
        const editor = getEditorInstance(tabId);
        if (!editor) {
            console.log('❌ Monaco编辑器实例不存在');
            return null;
        }
        
        // 获取光标位置和选中范围
        const position = editor.getPosition();
        const selection = editor.getSelection();
        const model = editor.getModel();
        const lineCount = model.getLineCount();
        
        let contextCodeLines = [];
        let isFullFile = false;
        let isSelection = false;
        let selectionRange = null;
        
        // 优先级1: 检查是否有选中内容
        if (selection && !selection.isEmpty()) {
            isSelection = true;
            const startLine = selection.startLineNumber;
            const endLine = selection.endLineNumber;
            selectionRange = { start: startLine, end: endLine };
            
            // 发送选中的行
            for (let i = startLine; i <= endLine; i++) {
                const lineText = model.getLineContent(i);
                const prefix = '✓ ';  // 选中标记
                contextCodeLines.push(`${prefix}${i}: ${lineText}`);
            }
        }
        // 优先级2: 小文件发送完整内容
        else if (lineCount <= 200) {
            isFullFile = true;
            for (let i = 1; i <= lineCount; i++) {
                const lineText = model.getLineContent(i);
                const prefix = i === position.lineNumber ? '→ ' : '  ';
                contextCodeLines.push(`${prefix}${i}: ${lineText}`);
            }
        }
        // 优先级3: 大文件发送光标周围
        else {
            const startLine = Math.max(1, position.lineNumber - contextLines);
            const endLine = Math.min(lineCount, position.lineNumber + contextLines);
            
            for (let i = startLine; i <= endLine; i++) {
                const lineText = model.getLineContent(i);
                const prefix = i === position.lineNumber ? '→ ' : '  ';
                contextCodeLines.push(`${prefix}${i}: ${lineText}`);
            }
        }
        
        // 获取当前行内容
        const currentLineText = model.getLineContent(position.lineNumber);
        
        return {
            filePath: filePath,
            fileName: fileName,
            cursor: {
                line: position.lineNumber,
                column: position.column
            },
            currentLine: currentLineText,
            contextContent: contextCodeLines.join('\n'),
            totalLines: lineCount,
            isFullFile: isFullFile,      // 标记是否为完整文件
            isSelection: isSelection,    // 标记是否为选中内容
            selectionRange: selectionRange,  // 选中范围
            language: getFileLanguage(fileName)
        };
    } catch (error) {
        console.error('获取编辑器上下文失败:', error);
        return null;
    }
};

/**
 * 根据文件名获取语言类型
 */
function getFileLanguage(fileName) {
    const ext = fileName.split('.').pop().toLowerCase();
    const langMap = {
        'js': 'JavaScript',
        'ts': 'TypeScript',
        'go': 'Go',
        'py': 'Python',
        'java': 'Java',
        'cpp': 'C++',
        'c': 'C',
        'css': 'CSS',
        'html': 'HTML',
        'json': 'JSON',
        'md': 'Markdown',
        'sh': 'Shell',
        'sql': 'SQL'
    };
    return langMap[ext] || ext.toUpperCase();
}

// ========== WebSocket 连接管理 ==========

/**
 * 确保AI WebSocket连接已建立
 * @returns {Promise<WebSocket>} 返回可用的WebSocket连接
 */
async function ensureAIChatConnection() {
    // 如果连接已存在且正常，直接返回
    if (chatWebSocket && chatWebSocket.readyState === WebSocket.OPEN) {
        console.log('✅ AI连接已存在');
        return chatWebSocket;
    }
    
    // 如果正在连接，等待
    if (chatWebSocket && chatWebSocket.readyState === WebSocket.CONNECTING) {
        console.log('⏳ 等待连接建立...');
        return new Promise((resolve, reject) => {
            const checkInterval = setInterval(() => {
                if (chatWebSocket.readyState === WebSocket.OPEN) {
                    clearInterval(checkInterval);
                    resolve(chatWebSocket);
                } else if (chatWebSocket.readyState === WebSocket.CLOSED) {
                    clearInterval(checkInterval);
                    reject(new Error('连接失败'));
                }
            }, 100);
        });
    }
    
    // 建立新连接
    console.log('🔌 建立AI WebSocket连接...');
    return connectAIChat();
}

/**
 * 建立AI聊天WebSocket连接
 */
function connectAIChat() {
    return new Promise((resolve, reject) => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/ai`;
        
        chatWebSocket = new WebSocket(wsUrl);
        
        chatWebSocket.onopen = () => {
            console.log('✅ AI WebSocket连接已建立');
            startAIChatHeartbeat();
            resolve(chatWebSocket);
        };
        
        chatWebSocket.onerror = (error) => {
            console.error('❌ AI WebSocket连接错误:', error);
            reject(error);
        };
        
        chatWebSocket.onclose = (event) => {
            console.log('🔌 AI WebSocket连接已关闭:', event.code, event.reason);
            stopAIChatHeartbeat();
            
            // 非正常关闭，尝试重连
            if (event.code !== 1000 && !isReconnecting) {
                attemptReconnect();
            }
        };
    });
}

/**
 * 启动心跳
 */
function startAIChatHeartbeat() {
    stopAIChatHeartbeat(); // 先清除旧的
    
    chatWSHeartbeatInterval = setInterval(() => {
        if (chatWebSocket && chatWebSocket.readyState === WebSocket.OPEN) {
            // 发送心跳ping（后端需要支持）
            try {
                chatWebSocket.send(JSON.stringify({ type: 'ping' }));
            } catch (error) {
                console.error('心跳发送失败:', error);
            }
        }
    }, 30000); // 每30秒一次
}

/**
 * 停止心跳
 */
function stopAIChatHeartbeat() {
    if (chatWSHeartbeatInterval) {
        clearInterval(chatWSHeartbeatInterval);
        chatWSHeartbeatInterval = null;
    }
}

/**
 * 尝试重连（最多3次）
 */
async function attemptReconnect(retries = 3) {
    if (isReconnecting) return;
    isReconnecting = true;
    
    console.log(`🔄 尝试重连... (剩余${retries}次)`);
    
    for (let i = 0; i < retries; i++) {
        try {
            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1))); // 递增延迟
            await connectAIChat();
            console.log('✅ 重连成功');
            isReconnecting = false;
            return;
        } catch (error) {
            console.error(`❌ 重连失败 (${i + 1}/${retries}):`, error);
        }
    }
    
    isReconnecting = false;
    console.error('❌ 重连失败，已达最大重试次数');
}

// ========== 按钮状态管理 ==========

/**
 * 显示停止按钮，隐藏发送按钮
 */
function showStopButton() {
    const stopBtn = document.getElementById('stopGenerateBtn');
    const sendBtn = document.getElementById('sendAIBtn');
    if (stopBtn) stopBtn.style.display = 'flex';
    if (sendBtn) sendBtn.style.display = 'none';
    isGenerating = true;
}

/**
 * 隐藏停止按钮，显示发送按钮
 */
function hideStopButton() {
    const stopBtn = document.getElementById('stopGenerateBtn');
    const sendBtn = document.getElementById('sendAIBtn');
    if (stopBtn) stopBtn.style.display = 'none';
    if (sendBtn) sendBtn.style.display = 'flex';
    isGenerating = false;
}

/**
 * 停止AI生成
 */
window.stopAIGeneration = function() {
    if (!isGenerating) return;
    
    if (chatWebSocket && chatWebSocket.readyState === WebSocket.OPEN) {
        try {
            chatWebSocket.send(JSON.stringify({
                type: 'stop',
                session_id: currentSession?.ID
            }));
            console.log('⏹️ 已发送停止信号，等待后端响应...');
            // ✅ 不立即隐藏按钮，等后端返回stopped信号
        } catch (error) {
            console.error('发送停止信号失败:', error);
            hideStopButton();
        }
    } else {
        // 如果连接已断开，直接隐藏按钮
        hideStopButton();
    }
};

// ========== 消息发送 ==========

// 发送AI消息
window.sendAIMessage = async function() {
    const input = document.getElementById('aiInput');
    const message = input.value.trim();
    
    if (!message) return;
    
    // 如果没有会话，先创建
    if (!currentSession) {
        await createNewAISession();
        if (!currentSession) return; // 创建失败
    }
    
    // 清空输入框
    input.value = '';
    input.style.height = 'auto';
    
    // 显示用户消息
    appendMessage('user', message);
    scrollToBottom();
    
    // 显示思考中状态
    const thinkingId = showThinking();
    
    // 显示停止按钮
    showStopButton();
    
    try {
        // 建立WebSocket连接进行流式对话
        await streamChat(currentSession.ID, message, thinkingId);
    } catch (error) {
        console.error('发送消息失败:', error);
        removeThinking(thinkingId);
        appendMessage('assistant', '抱歉，发生了错误: ' + error.message);
    } finally {
        // 隐藏停止按钮
        hideStopButton();
    }
};

// 流式对话
async function streamChat(sessionId, message, thinkingId) {
    return new Promise(async (resolve, reject) => {
        // 确保连接可用
        try {
            await ensureAIChatConnection();
        } catch (error) {
            reject(new Error('无法建立连接'));
            return;
        }
        
        let assistantMessage = '';
        let reasoningContent = '';
        let messageElement = null;
        
        // 收集上下文信息
        const terminalInfo = window.getTerminalBuffer(200);  // 终端200行
        const editorInfo = window.getEditorContext(100);     // 编辑器前后100行
        
        // 构建payload
        const payload = {
            session_id: sessionId,
            message: message
        };
        
        // 如果有终端信息，添加实时信息
        if (terminalInfo) {
            payload.real_time_info = terminalInfo.content;
            payload.source_info = `终端 - ${terminalInfo.serverName}`;
            console.log(`📺 终端上下文 - ${terminalInfo.serverName}, ${terminalInfo.lineCount}行`);
        }
        
        // 如果有编辑器信息，添加指针信息
        if (editorInfo) {
            // 构建范围信息文本
            let rangeInfo;
            let contextType;
            
            if (editorInfo.isSelection) {
                // 选中内容 - 优先级最高
                rangeInfo = `内容类型: 用户选中内容 ✓\n选中范围: 第${editorInfo.selectionRange.start}-${editorInfo.selectionRange.end}行 (共${editorInfo.selectionRange.end - editorInfo.selectionRange.start + 1}行)\n总行数: ${editorInfo.totalLines}`;
                contextType = `选中${editorInfo.selectionRange.end - editorInfo.selectionRange.start + 1}行`;
            } else if (editorInfo.isFullFile) {
                // 完整文件 - 小文件
                rangeInfo = `内容类型: 完整文件\n文件行数: ${editorInfo.totalLines}`;
                contextType = '完整文件';
            } else {
                // 光标周围 - 大文件
                rangeInfo = `内容类型: 光标周围上下文\n显示范围: 第${Math.max(1, editorInfo.cursor.line - 100)}-${Math.min(editorInfo.totalLines, editorInfo.cursor.line + 100)}行\n总行数: ${editorInfo.totalLines}`;
                contextType = '光标前后100行';
            }
            
            payload.cursor_info = 
                `文件: ${editorInfo.fileName}\n` +
                `路径: ${editorInfo.filePath}\n` +
                `语言: ${editorInfo.language}\n` +
                `${rangeInfo}\n` +
                `光标位置: 行 ${editorInfo.cursor.line}, 列 ${editorInfo.cursor.column}\n` +
                `当前行: ${editorInfo.currentLine}\n\n` +
                `代码内容:\n${editorInfo.contextContent}`;
            
            // 如果没有终端信息，使用编辑器的来源信息
            if (!terminalInfo) {
                payload.source_info = `编辑器 - ${editorInfo.filePath}`;
            }
            
            console.log(`📝 编辑器上下文 - ${editorInfo.fileName}, ${contextType}, 光标在 ${editorInfo.cursor.line}:${editorInfo.cursor.column}`);
        }
        
        console.log('📤 发送消息:', {
            session_id: payload.session_id,
            message: payload.message,
            has_real_time_info: !!payload.real_time_info,
            has_cursor_info: !!payload.cursor_info,
            source_info: payload.source_info
        });
        
        // 设置消息处理器（临时的，仅用于这次对话）
        const originalOnMessage = chatWebSocket.onmessage;
        
        chatWebSocket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                
                // 忽略心跳消息
                if (data.type === 'pong') {
                    return;
                }
                
                if (data.type === 'content') {
                    // 内容增量更新
                    const isFirstContent = assistantMessage === '';
                    assistantMessage += data.content;
                    
                    if (!messageElement) {
                        // 第一条消息：将thinking元素转换为正式消息
                        messageElement = convertThinkingToMessage(thinkingId);
                        if (!messageElement) {
                            messageElement = createMessageElement('assistant', assistantMessage);
                        } else {
                            updateMessageContent(messageElement, assistantMessage);
                        }
                    } else {
                        updateMessageContent(messageElement, assistantMessage);
                    }
                    
                    // 收到第一条正文内容时：1) 自动折叠思维链 2) 停止流光
                    if (isFirstContent) {
                        if (reasoningContent) {
                            updateReasoningContent(messageElement, reasoningContent, true, false);
                        }
                        // 停止思维链header的流光
                        const reasoningHeader = messageElement.querySelector('.reasoning-header');
                        if (reasoningHeader) {
                            reasoningHeader.classList.remove('shimmer-text');
                        }
                    }
                    
                    scrollToBottom();
                    
                } else if (data.type === 'reasoning') {
                    // 思维链内容
                    reasoningContent += data.content;
                    
                    // 如果还没有消息元素，将thinking转换为正式消息
                    if (!messageElement) {
                        messageElement = convertThinkingToMessage(thinkingId);
                        if (!messageElement) {
                            messageElement = createMessageElement('assistant', '');
                        }
                    }
                    
                    // 更新思维链，第一次创建时带流光
                    updateReasoningContent(messageElement, reasoningContent, false, true);
                    scrollToBottom();
                    
                } else if (data.type === 'done') {
                    // 完成
                    console.log('✅ 对话完成');
                    
                    // 停止所有流光效果
                    if (messageElement) {
                        const shimmerElements = messageElement.querySelectorAll('.shimmer-text');
                        shimmerElements.forEach(el => el.classList.remove('shimmer-text'));
                    }
                    
                    // 如果只有reasoning没有content，清除空内容
                    if (messageElement && assistantMessage === '') {
                        updateMessageContent(messageElement, '');
                    }
                    
                    // 清理可能残留的thinking元素
                    removeThinking(thinkingId);
                    
                    resolve();
                    
                } else if (data.type === 'stopped') {
                    // 停止生成（后端已推送"[生成已停止]"文本）
                    console.log('⏹️ 生成已停止');
                    
                    // 清理thinking元素
                    removeThinking(thinkingId);
                    
                    resolve();
                    
                } else if (data.type === 'error') {
                    // 错误
                    const errorMsg = data.error || data.content || '未知错误';
                    console.error('❌ 对话错误:', errorMsg);
                    
                    // 清理thinking元素
                    removeThinking(thinkingId);
                    
                    if (!messageElement) {
                        appendMessage('assistant', '抱歉，发生了错误: ' + errorMsg);
                    }
                    reject(new Error(errorMsg));
                }
            } catch (error) {
                console.error('解析消息失败:', error, '原始数据:', event.data);
            }
        };
        
        // 发送消息
        try {
            chatWebSocket.send(JSON.stringify(payload));
        } catch (error) {
            console.error('❌ 发送消息失败:', error);
            chatWebSocket.onmessage = originalOnMessage; // 恢复原处理器
            removeThinking(thinkingId);
            reject(error);
        }
    });
}

// ========== UI辅助函数 ==========

// 显示对话区域
function showChatArea() {
    const welcome = document.querySelector('.ai-welcome');
    if (welcome && currentSession) {
        welcome.style.display = 'none';
    }
}

// 添加消息
function appendMessage(role, content, reasoning = null, messageId = null) {
    const messagesContainer = document.getElementById('aiMessages');
    if (!messagesContainer) return;
    
    // 移除欢迎信息
    const welcome = messagesContainer.querySelector('.ai-welcome');
    if (welcome) {
        welcome.remove();
    }
    
    const messageDiv = createMessageElement(role, content, reasoning, messageId);
    messagesContainer.appendChild(messageDiv);
}

// 创建消息元素
function createMessageElement(role, content, reasoning = null, messageId = null) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `ai-message ${role}`;
    if (messageId) {
        messageDiv.dataset.messageId = messageId;
    }
    
    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = role === 'user' ? '👤' : '🤖';
    
    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'message-content-wrapper';
    
    // 如果有思维链内容，先添加思维链
    if (reasoning) {
        const reasoningDiv = document.createElement('div');
        reasoningDiv.className = 'message-reasoning';
        reasoningDiv.innerHTML = `
            <div class="reasoning-header" onclick="toggleReasoning(this)">
                <span class="thought-text">Thought</span>
                <span class="reasoning-arrow">▼</span>
            </div>
            <div class="reasoning-content">${formatMessageContent(reasoning)}</div>
        `;
        contentWrapper.appendChild(reasoningDiv);
    }
    
    // 然后添加正文内容
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    // 用户消息只做简单转义，AI消息应用Markdown渲染
    if (role === 'user') {
        contentDiv.innerHTML = escapeHtml(content).replace(/\n/g, '<br>');
    } else {
        contentDiv.innerHTML = formatMessageContent(content);
    }
    
    contentWrapper.appendChild(contentDiv);
    
    messageDiv.appendChild(avatar);
    messageDiv.appendChild(contentWrapper);
    
    // 为用户消息添加操作按钮（在气泡外下方）
    if (role === 'user' && messageId) {
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'message-actions';
        actionsDiv.innerHTML = `
            <button class="message-action-btn" onclick="startEditMessage(${messageId})" title="编辑">🖊</button>
            <button class="message-action-btn" onclick="confirmRevokeMessage(${messageId})" title="撤回">⎌</button>
        `;
        messageDiv.appendChild(actionsDiv);
    }
    
    const messagesContainer = document.getElementById('aiMessages');
    if (messagesContainer) {
        messagesContainer.appendChild(messageDiv);
    }
    
    return messageDiv;
}

// 更新消息内容
function updateMessageContent(messageElement, content) {
    const contentDiv = messageElement.querySelector('.message-content');
    if (contentDiv) {
        contentDiv.innerHTML = formatMessageContent(content);
    }
}

// 更新思维链内容
function updateReasoningContent(messageElement, reasoning, autoCollapse = false, addShimmer = false) {
    let reasoningDiv = messageElement.querySelector('.message-reasoning');
    let isNewDiv = false;
    
    if (!reasoningDiv) {
        isNewDiv = true;
        reasoningDiv = document.createElement('div');
        reasoningDiv.className = 'message-reasoning';
        reasoningDiv.innerHTML = `
            <div class="reasoning-header" onclick="toggleReasoning(this)">
                <span class="thought-text">Thought</span>
                <span class="reasoning-arrow">▼</span>
            </div>
            <div class="reasoning-content"></div>
        `;
        const contentWrapper = messageElement.querySelector('.message-content-wrapper');
        if (contentWrapper) {
            contentWrapper.insertBefore(reasoningDiv, contentWrapper.firstChild);
        }
        
        // 第一次创建时添加流光
        if (addShimmer) {
            const header = reasoningDiv.querySelector('.reasoning-header');
            if (header) {
                header.classList.add('shimmer-text');
            }
        }
    }
    
    const reasoningContent = reasoningDiv.querySelector('.reasoning-content');
    if (reasoningContent) {
        // 使用Markdown渲染思维链内容
        reasoningContent.innerHTML = formatMessageContent(reasoning);
    }
    
    // 自动折叠
    if (autoCollapse) {
        const header = reasoningDiv.querySelector('.reasoning-header');
        const content = reasoningDiv.querySelector('.reasoning-content');
        if (header && content) {
            header.classList.add('collapsed');
            content.classList.add('collapsed');
        }
    }
}

// 显示思考中状态
function showThinking() {
    const messagesContainer = document.getElementById('aiMessages');
    if (!messagesContainer) return null;
    
    const thinkingDiv = document.createElement('div');
    thinkingDiv.className = 'ai-message assistant thinking';
    thinkingDiv.id = 'thinking-' + Date.now();
    thinkingDiv.innerHTML = `
        <div class="message-avatar">🤖</div>
        <div class="message-content-wrapper">
            <div class="message-content">
                <span class="typing-indicator shimmer-text">Running</span>
            </div>
        </div>
    `;
    
    messagesContainer.appendChild(thinkingDiv);
    scrollToBottom();
    
    return thinkingDiv.id;
}

// 移除思考状态
function removeThinking(thinkingId) {
    if (thinkingId) {
        const thinkingDiv = document.getElementById(thinkingId);
        if (thinkingDiv) {
            thinkingDiv.remove();
        }
    }
}

// 将thinking元素转换为正式消息元素（无缝切换）
function convertThinkingToMessage(thinkingId) {
    if (!thinkingId) return null;
    
    const thinkingDiv = document.getElementById(thinkingId);
    if (!thinkingDiv) return null;
    
    // 移除thinking类和id
    thinkingDiv.classList.remove('thinking');
    thinkingDiv.removeAttribute('id');
    
    // 清空内容，保留结构
    const contentDiv = thinkingDiv.querySelector('.message-content');
    if (contentDiv) {
        contentDiv.innerHTML = '';
    }
    
    return thinkingDiv;
}

// 格式化消息内容（完整Markdown支持）
function formatMessageContent(content) {
    if (!content) return '';
    
    let formatted = content;
    const codeBlocks = [];
    const inlineCodes = [];
    
    // 1. 先提取并保护代码块（包括末尾换行）
    formatted = formatted.replace(/```(\w+)?\n([\s\S]*?)```\n?/g, (match, lang, code) => {
        const escapedCode = escapeHtml(code.trim());
        const codeId = 'code-' + Math.random().toString(36).substr(2, 9);
        const placeholder = `__CODEBLOCK_${codeBlocks.length}__`;
        const isBash = lang === 'bash' || lang === 'sh' || lang === 'shell';
        const executeBtn = isBash ? `<button class="code-execute-btn" onclick="executeCode('${codeId}')" title="在终端执行">
                    <i class="fa-solid fa-play"></i>
                </button>` : '';
        
        codeBlocks.push(`<div class="code-block">
            <div class="code-header">
                <span class="code-lang">${lang || 'text'}</span>
                <div class="code-actions">
                    ${executeBtn}
                    <button class="code-copy-btn" onclick="copyCode('${codeId}', event)" title="复制代码">
                        <i class="fa-solid fa-copy"></i>
                    </button>
                </div>
            </div>
            <pre><code id="${codeId}" class="language-${lang || 'text'}">${escapedCode}</code></pre>
        </div>`);
        return placeholder;
    });
    
    // 2. 提取并保护行内代码
    formatted = formatted.replace(/`([^`\n]+)`/g, (match, code) => {
        const placeholder = `__INLINECODE_${inlineCodes.length}__`;
        inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
        return placeholder;
    });
    
    // 3. 转义HTML（但保留占位符）
    formatted = escapeHtml(formatted);
    
    // 4. 粗体
    formatted = formatted.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    
    // 5. 斜体
    formatted = formatted.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    
    // 6. 标题（消耗末尾换行）
    formatted = formatted.replace(/^### (.+)\n?$/gm, '<h3>$1</h3>');
    formatted = formatted.replace(/^## (.+)\n?$/gm, '<h2>$1</h2>');
    formatted = formatted.replace(/^# (.+)\n?$/gm, '<h1>$1</h1>');
    
    // 7. 无序列表
    formatted = formatted.replace(/^[-*] (.+)\n?$/gm, '<li>$1</li>');
    formatted = formatted.replace(/(<li>[\s\S]*?<\/li>)+/g, match => {
        return '<ul>' + match.replace(/\n/g, '') + '</ul>';
    });
    
    // 8. 有序列表
    formatted = formatted.replace(/^\d+\. (.+)\n?$/gm, '<li>$1</li>');
    formatted = formatted.replace(/(<li>[\s\S]*?<\/li>)+/g, match => {
        if (!match.includes('<ul>')) {
            return '<ol>' + match.replace(/\n/g, '') + '</ol>';
        }
        return match;
    });
    
    // 9. 引用（消耗末尾换行）
    formatted = formatted.replace(/^&gt; (.+)\n?$/gm, '<blockquote>$1</blockquote>');
    
    // 10. 链接
    formatted = formatted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    
    // 11. 清理已处理元素后的多余换行
    formatted = formatted.replace(/<\/(h[123]|blockquote|ul|ol)>\n/g, '</$1>');
    
    // 12. 换行转换
    formatted = formatted.replace(/\n/g, '<br>');
    
    // 13. 恢复行内代码
    inlineCodes.forEach((code, i) => {
        formatted = formatted.replace(`__INLINECODE_${i}__`, code);
    });
    
    // 14. 恢复代码块
    codeBlocks.forEach((block, i) => {
        formatted = formatted.replace(`__CODEBLOCK_${i}__`, block);
    });
    
    return formatted;
}

// 复制代码
window.copyCode = function(codeId, event) {
    const codeElement = document.getElementById(codeId);
    if (!codeElement) return;
    
    const text = codeElement.textContent;
    navigator.clipboard.writeText(text).then(() => {
        // 显示复制成功提示
        if (event) {
            const btn = event.target.closest('.code-copy-btn');
            if (btn) {
                const originalHTML = btn.innerHTML;
                btn.innerHTML = '<i class="fa-solid fa-check"></i>';
                btn.style.color = '#10b981';
                setTimeout(() => {
                    btn.innerHTML = originalHTML;
                    btn.style.color = '';
                }, 2000);
            }
        }
    }).catch(err => {
        console.error('复制失败:', err);
    });
};

/**
 * 执行代码到终端
 */
window.executeCode = function(codeId) {
    const codeElement = document.getElementById(codeId);
    if (!codeElement) return;
    
    const command = codeElement.textContent.trim();
    
    // 获取当前激活的终端
    const activeTerminal = document.querySelector('.terminal-pane.active');
    if (!activeTerminal) {
        alert('请先打开一个终端');
        return;
    }
    
    const sessionId = activeTerminal.id;
    const session = state.terminals.get(sessionId);
    
    if (!session || !session.ws || session.ws.readyState !== WebSocket.OPEN) {
        alert('终端未连接');
        return;
    }
    
    // 发送命令到终端
    session.ws.send(command + '\r');
    
    // 视觉反馈
    console.log('✅ 已执行命令:', command);
    
    // 可选：切换到终端标签
    const terminalTab = document.querySelector(`.content-tab-item[data-session-id="${sessionId}"]`);
    if (terminalTab && window.switchToTerminal) {
        window.switchToTerminal(sessionId);
    }
};

// 滚动到底部
function scrollToBottom() {
    const messagesContainer = document.getElementById('aiMessages');
    if (messagesContainer) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
}

// 格式化时间
function formatTime(timeStr) {
    const date = new Date(timeStr);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
    if (diff < 604800000) return Math.floor(diff / 86400000) + '天前';
    
    return date.toLocaleDateString();
}

// HTML转义
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 输入框自动调整高度
window.autoResizeAIInput = function() {
    const input = document.getElementById('aiInput');
    if (!input) return;
    
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 150) + 'px';
};

// 回车发送
window.handleAIInputKeydown = function(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendAIMessage();
    }
};

// 切换历史下拉菜单
window.toggleHistoryDropdown = function() {
    const menu = document.getElementById('historyDropdownMenu');
    const trigger = document.querySelector('.history-trigger');
    
    if (!menu) return;
    
    const isOpen = menu.style.display === 'block';
    
    if (isOpen) {
        menu.style.display = 'none';
        if (trigger) trigger.classList.remove('open');
    } else {
        menu.style.display = 'block';
        if (trigger) trigger.classList.add('open');
    }
};

// 切换思维链展开/折叠
window.toggleReasoning = function(headerElement) {
    const content = headerElement.nextElementSibling;
    if (!content) return;
    
    headerElement.classList.toggle('collapsed');
    content.classList.toggle('collapsed');
};

// 点击其他地方关闭下拉菜单
document.addEventListener('click', function(e) {
    const selector = document.querySelector('.ai-history-selector');
    const menu = document.getElementById('historyDropdownMenu');
    
    if (selector && !selector.contains(e.target) && menu) {
        menu.style.display = 'none';
        const trigger = document.querySelector('.history-trigger');
        if (trigger) trigger.classList.remove('open');
    }
});

// 初始化
export async function initAIChat() {
    await loadSessions();
    
    // 绑定输入框事件
    const input = document.getElementById('aiInput');
    if (input) {
        input.addEventListener('input', autoResizeAIInput);
        input.addEventListener('keydown', handleAIInputKeydown);
    }
}
