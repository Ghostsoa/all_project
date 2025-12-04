// AI对话管理模块

import { apiRequest } from './api.js';
import { state } from './config.js';

// 全局变量
let currentSession = null;
let chatWebSocket = null;
let sessions = [];
let availableConfigs = []; // 可用的AI配置列表

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

let tempSelectedModel = null;
let tempSelectedEndpoint = null;
let originalModel = null;
let originalEndpoint = null;

// 更新模型显示
function updateModelDisplay() {
    const modelEl = document.getElementById('selectedModel');
    if (!modelEl) return;
    
    if (currentSession?.config?.ai_model) {
        const model = currentSession.config.ai_model;
        modelEl.textContent = model.display_name || model.name || '未知模型';
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
        resetTempSelection();
    } else {
        // 记录原始选择 - 从当前会话的config中读取
        originalModel = currentSession?.config?.ai_model?.ID || null;
        originalEndpoint = currentSession?.config?.ai_endpoint?.ID || null;
        tempSelectedModel = originalModel;
        tempSelectedEndpoint = originalEndpoint;
        
        // 加载模型和接口列表（只加载一次）
        await loadModelAndEndpointLists();
        
        // 隐藏保存/取消按钮
        document.getElementById('popupActions').style.display = 'none';
        
        popup.style.display = 'block';
    }
};

// 加载模型和接口列表
async function loadModelAndEndpointLists() {
    // 加载模型列表
    try {
        const modelData = await apiRequest('/api/ai/models');
        const models = modelData.data || [];
        renderModelList(models);
    } catch (error) {
        console.error('加载模型列表失败:', error);
        document.getElementById('modelList').innerHTML = '<div class="loading-small">加载失败</div>';
    }
    
    // 加载接口列表
    try {
        const endpointData = await apiRequest('/api/ai/endpoints');
        const endpoints = endpointData.data || [];
        renderEndpointList(endpoints);
    } catch (error) {
        console.error('加载接口列表失败:', error);
        document.getElementById('endpointList').innerHTML = '<div class="loading-small">加载失败</div>';
    }
}

// 渲染模型列表
function renderModelList(models) {
    const container = document.getElementById('modelList');
    if (!container) return;
    
    if (models.length === 0) {
        container.innerHTML = '<div class="loading-small">暂无模型</div>';
        return;
    }
    
    container.innerHTML = models.map(model => `
        <div class="model-option ${tempSelectedModel === model.ID ? 'active' : ''}"
             onclick="selectTempModel(${model.ID})"
             data-model-id="${model.ID}">
            <div class="model-info">
                <div class="model-name">${escapeHtml(model.display_name || model.name)}</div>
            </div>
            ${tempSelectedModel === model.ID ? '<i class="fa-solid fa-check"></i>' : ''}
        </div>
    `).join('');
}

// 渲染接口列表
function renderEndpointList(endpoints) {
    const container = document.getElementById('endpointList');
    if (!container) return;
    
    if (endpoints.length === 0) {
        container.innerHTML = '<div class="loading-small">暂无接口</div>';
        return;
    }
    
    container.innerHTML = endpoints.map(endpoint => `
        <div class="model-option ${tempSelectedEndpoint === endpoint.ID ? 'active' : ''}"
             onclick="selectTempEndpoint(${endpoint.ID})"
             data-endpoint-id="${endpoint.ID}">
            <div class="model-info">
                <div class="model-name">${escapeHtml(endpoint.name)}</div>
                <div class="model-endpoint">${escapeHtml(endpoint.base_url || '')}</div>
            </div>
            ${tempSelectedEndpoint === endpoint.ID ? '<i class="fa-solid fa-check"></i>' : ''}
        </div>
    `).join('');
}

// 临时选择模型
window.selectTempModel = function(modelId) {
    tempSelectedModel = modelId;
    
    // 只更新UI高亮状态
    const modelOptions = document.querySelectorAll('#modelList .model-option');
    modelOptions.forEach(opt => {
        const optModelId = parseInt(opt.dataset.modelId);
        const oldCheck = opt.querySelector('i.fa-check');
        
        if (optModelId === modelId) {
            opt.classList.add('active');
            if (!oldCheck) {
                const icon = document.createElement('i');
                icon.className = 'fa-solid fa-check';
                opt.appendChild(icon);
            }
        } else {
            opt.classList.remove('active');
            if (oldCheck) oldCheck.remove();
        }
    });
    
    checkIfChanged();
};

// 临时选择接口
window.selectTempEndpoint = function(endpointId) {
    tempSelectedEndpoint = endpointId;
    
    // 只更新UI高亮状态
    const endpointOptions = document.querySelectorAll('#endpointList .model-option');
    endpointOptions.forEach(opt => {
        const optEndpointId = parseInt(opt.dataset.endpointId);
        const oldCheck = opt.querySelector('i.fa-check');
        
        if (optEndpointId === endpointId) {
            opt.classList.add('active');
            if (!oldCheck) {
                const icon = document.createElement('i');
                icon.className = 'fa-solid fa-check';
                opt.appendChild(icon);
            }
        } else {
            opt.classList.remove('active');
            if (oldCheck) oldCheck.remove();
        }
    });
    
    checkIfChanged();
};

// 检查是否有改动
function checkIfChanged() {
    const hasChanged = tempSelectedModel !== originalModel || tempSelectedEndpoint !== originalEndpoint;
    const actionsEl = document.getElementById('popupActions');
    if (actionsEl) {
        actionsEl.style.display = hasChanged ? 'flex' : 'none';
    }
}

// 重置临时选择
function resetTempSelection() {
    tempSelectedModel = null;
    tempSelectedEndpoint = null;
    originalModel = null;
    originalEndpoint = null;
}

// 取消配置修改
window.cancelModelConfig = function() {
    toggleModelSelector(); // 关闭弹窗
};

// 保存模型配置
window.saveModelConfig = async function() {
    if (!currentSession) return;
    if (!tempSelectedModel || !tempSelectedEndpoint) {
        alert('请同时选择模型和API接口');
        return;
    }
    
    try {
        await apiRequest('/api/ai/session/update-config', {
            method: 'POST',
            body: JSON.stringify({
                session_id: currentSession.ID,
                ai_model_id: tempSelectedModel,
                ai_endpoint_id: tempSelectedEndpoint
            })
        });
        
        // 重新加载会话信息
        const data = await apiRequest(`/api/ai/session?id=${currentSession.ID}`);
        currentSession = data.data;
        updateModelDisplay();
        
        toggleModelSelector(); // 关闭弹窗
    } catch (error) {
        console.error('保存配置失败:', error);
        alert('保存配置失败: ' + error.message);
    }
};

// ========== 会话管理 ==========

// 加载会话列表
export async function loadSessions() {
    showAILoading('正在加载中');
    try {
        const data = await apiRequest('/api/ai/sessions');
        sessions = data.data || [];
        renderSessionList();
        
        // 如果有会话，自动选择第一个
        if (sessions.length > 0 && !currentSession) {
            await selectAISession(sessions[0].ID);
        } else {
            hideAILoading();
        }
    } catch (error) {
        console.error('加载会话列表失败:', error);
        hideAILoading();
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
        <div class="history-item ${currentSession?.ID === session.ID ? 'active' : ''}" 
             data-action="select-session"
             data-session-id="${session.ID}">
            <div class="history-item-title">${escapeHtml(session.title)}</div>
            <div class="history-item-meta">
                <span>${formatTime(session.last_active_at)}</span>
                ${session.config?.ai_model ? `<span class="model-tag">${escapeHtml(session.config.ai_model.display_name || session.config.ai_model.name)}</span>` : ''}
            </div>
            <button class="history-item-delete" data-action="delete-session" data-session-id="${session.ID}" title="删除">
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
            selectAISession(parseInt(sessionId));
            toggleHistoryDropdown();
        } else if (action === 'delete-session' && sessionId) {
            e.stopPropagation();
            deleteAISession(parseInt(sessionId));
        }
    };
}

// 选择会话
window.selectAISession = async function(sessionId) {
    showAILoading('正在加载中');
    try {
        const data = await apiRequest(`/api/ai/session?id=${sessionId}`);
        currentSession = data.data;
        
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
            appendMessage(msg.role, msg.content, msg.reasoning_content);
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
        const data = await apiRequest('/api/ai/session/create', 'POST', {
            title: title
            // config_id 不传，后端会使用默认配置
        });
        
        currentSession = data.data;
        
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
        if (currentSession?.ID === sessionId || currentSession?.id === sessionId) {
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
        await apiRequest(`/api/ai/session/clear?id=${currentSession.ID}`, 'POST');
        
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
 * @param {number} contextLines - 光标前后获取多少行（默认10行）
 * @returns {object|null} { filePath, fileName, cursor, content, ... }
 */
window.getEditorContext = function(contextLines = 10) {
    try {
        // 获取当前激活的编辑器pane
        const activeEditor = document.querySelector('.editor-pane.active');
        if (!activeEditor) {
            return null;
        }
        
        const filePath = activeEditor.dataset.path;
        const fileName = filePath ? filePath.split('/').pop() : 'unknown';
        const editor = activeEditor.querySelector('.CodeMirror');
        
        if (!editor || !editor.CodeMirror) {
            return null;
        }
        
        const cm = editor.CodeMirror;
        const cursor = cm.getCursor();
        const lineCount = cm.lineCount();
        
        // 获取光标周围的代码上下文
        const startLine = Math.max(0, cursor.line - contextLines);
        const endLine = Math.min(lineCount - 1, cursor.line + contextLines);
        const contextCodeLines = [];
        
        for (let i = startLine; i <= endLine; i++) {
            const lineText = cm.getLine(i);
            const prefix = i === cursor.line ? '→ ' : '  ';
            contextCodeLines.push(`${prefix}${i + 1}: ${lineText}`);
        }
        
        // 获取当前行内容
        const currentLineText = cm.getLine(cursor.line);
        
        return {
            filePath: filePath,
            fileName: fileName,
            cursor: {
                line: cursor.line + 1, // 转为1-based
                column: cursor.ch + 1
            },
            currentLine: currentLineText,
            contextContent: contextCodeLines.join('\n'),
            totalLines: lineCount,
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
    
    try {
        // 建立WebSocket连接进行流式对话
        await streamChat(currentSession.ID, message, thinkingId);
    } catch (error) {
        console.error('发送消息失败:', error);
        removeThinking(thinkingId);
        appendMessage('assistant', '抱歉，发生了错误: ' + error.message);
    }
};

// 流式对话
async function streamChat(sessionId, message, thinkingId) {
    return new Promise((resolve, reject) => {
        // 关闭之前的连接
        if (chatWebSocket) {
            chatWebSocket.close();
        }
        
        // 建立WebSocket连接
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/ai`;
        
        chatWebSocket = new WebSocket(wsUrl);
        
        let assistantMessage = '';
        let reasoningContent = '';
        let messageElement = null;
        
        chatWebSocket.onopen = () => {
            console.log('✅ WebSocket连接已建立');
            // 不删除thinking，等收到消息后无缝切换
            
            // 收集上下文信息
            const terminalInfo = window.getTerminalBuffer(50);
            const editorInfo = window.getEditorContext(10);
            
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
                // 构建指针信息文本
                payload.cursor_info = 
                    `文件: ${editorInfo.fileName}\n` +
                    `路径: ${editorInfo.filePath}\n` +
                    `语言: ${editorInfo.language}\n` +
                    `光标位置: 行 ${editorInfo.cursor.line}, 列 ${editorInfo.cursor.column}\n` +
                    `总行数: ${editorInfo.totalLines}\n` +
                    `当前行: ${editorInfo.currentLine}\n\n` +
                    `代码上下文:\n${editorInfo.contextContent}`;
                
                // 如果没有终端信息，使用编辑器的来源信息
                if (!terminalInfo) {
                    payload.source_info = `编辑器 - ${editorInfo.filePath}`;
                }
                
                console.log(`📝 编辑器上下文 - ${editorInfo.fileName}, 光标在 ${editorInfo.cursor.line}:${editorInfo.cursor.column}`);
            }
            
            console.log('📤 发送消息:', {
                session_id: payload.session_id,
                message: payload.message,
                has_real_time_info: !!payload.real_time_info,
                has_cursor_info: !!payload.cursor_info,
                source_info: payload.source_info
            });
            
            chatWebSocket.send(JSON.stringify(payload));
        };
        
        chatWebSocket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                
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
                    
                } else if (data.type === 'error') {
                    // 错误
                    console.error('❌ 对话错误:', data.content);
                    
                    // 清理thinking元素
                    removeThinking(thinkingId);
                    
                    if (!messageElement) {
                        appendMessage('assistant', '抱歉，发生了错误: ' + data.content);
                    }
                    reject(new Error(data.content));
                }
            } catch (error) {
                console.error('解析消息失败:', error, '原始数据:', event.data);
            }
        };
        
        chatWebSocket.onerror = (error) => {
            console.error('❌ WebSocket错误:', error);
            removeThinking(thinkingId);
            reject(error);
        };
        
        chatWebSocket.onclose = (event) => {
            console.log('🔌 WebSocket连接已关闭');
            console.log('关闭代码:', event.code, '原因:', event.reason, '是否正常:', event.wasClean);
            chatWebSocket = null;
        };
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
function appendMessage(role, content, reasoning = null) {
    const messagesContainer = document.getElementById('aiMessages');
    if (!messagesContainer) return;
    
    // 移除欢迎信息
    const welcome = messagesContainer.querySelector('.ai-welcome');
    if (welcome) {
        welcome.remove();
    }
    
    const messageDiv = createMessageElement(role, content, reasoning);
    messagesContainer.appendChild(messageDiv);
}

// 创建消息元素
function createMessageElement(role, content, reasoning = null) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `ai-message ${role}`;
    
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
        codeBlocks.push(`<div class="code-block">
            <div class="code-header">
                <span class="code-lang">${lang || 'text'}</span>
                <button class="code-copy-btn" onclick="copyCode('${codeId}')" title="复制代码">
                    <i class="fa-solid fa-copy"></i>
                </button>
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
window.copyCode = function(codeId) {
    const codeElement = document.getElementById(codeId);
    if (!codeElement) return;
    
    const text = codeElement.textContent;
    navigator.clipboard.writeText(text).then(() => {
        // 显示复制成功提示
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
    }).catch(err => {
        console.error('复制失败:', err);
    });
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
