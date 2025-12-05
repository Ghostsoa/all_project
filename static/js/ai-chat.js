// AI对话管理模块

import { apiRequest } from './api.js';
import { state } from './config.js';
import { getEditorInstance } from './editor.js';
import { showToast } from './toast.js';

// 全局变量
let currentSession = null;
let chatWebSocket = null;
let sessions = [];
let availableConfigs = []; // 可用的AI配置列表
let chatWSHeartbeatInterval = null; // 心跳定时器
let isReconnecting = false; // 重连标志
let isGenerating = false; // 是否正在生成

// 分页相关
let currentOffset = 0;
const PAGE_SIZE = 20; // 每页20条消息
let isLoadingMore = false;
let hasMoreMessages = true;
let totalMessages = 0;

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
        showToast('切换模型失败: ' + error.message, 'error');
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
                <h3>Agent</h3>
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
        showToast('加载会话失败: ' + error.message, 'error');
    }
};

// 加载消息（初始加载）
async function loadMessages(sessionId) {
    try {
        // 重置分页状态
        currentOffset = 0;
        hasMoreMessages = true;
        totalMessages = 0;
        
        const data = await apiRequest(`/api/ai/messages?session_id=${sessionId}&limit=${PAGE_SIZE}&offset=0`);
        const messages = data.data || [];
        totalMessages = data.total || 0;
        hasMoreMessages = data.has_more || false;
        
        const messagesContainer = document.getElementById('aiMessages');
        if (!messagesContainer) return;
        
        // 清空欢迎信息
        messagesContainer.innerHTML = '';
        
        // 渲染消息（传递索引作为messageId）
        messages.forEach((msg, index) => {
            appendMessage(msg.role, msg.content, msg.reasoning_content, currentOffset + index);
        });
        
        // 滚动到底部（强制）
        scrollToBottom(true);
        
        // 添加滚动监听（如果还没有）
        setupScrollListener();
        
        console.log(`📊 初始加载: ${messages.length}/${totalMessages} 条消息, 还有更多: ${hasMoreMessages}`);
    } catch (error) {
        console.error('加载消息失败:', error);
    }
}

// 加载更多消息（向上滚动时）
async function loadMoreMessages() {
    if (!currentSession || isLoadingMore || !hasMoreMessages) {
        return;
    }
    
    isLoadingMore = true;
    console.log('📥 加载更多消息...');
    
    // 显示加载指示器
    showLoadingIndicator();
    
    try {
        // 计算下一页的offset
        currentOffset += PAGE_SIZE;
        
        const data = await apiRequest(
            `/api/ai/messages?session_id=${currentSession.id}&limit=${PAGE_SIZE}&offset=${currentOffset}`
        );
        
        const messages = data.data || [];
        hasMoreMessages = data.has_more || false;
        
        if (messages.length === 0) {
            hasMoreMessages = false;
            console.log('✅ 没有更多消息了');
            return;
        }
        
        const messagesContainer = document.getElementById('aiMessages');
        if (!messagesContainer) return;
        
        // 在顶部插入消息（从后往前插入，保持时间顺序）
        // 后端返回的是按时间顺序[msg3, msg4]，我们从后往前插：先插msg4，再插msg3
        // 结果：[msg3, msg4, msg5, msg6] - 正确的时间顺序
        // 计算基础索引：totalMessages - currentOffset - messages.length
        const baseIndex = totalMessages - currentOffset - messages.length;
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            prependMessage(msg.role, msg.content, msg.reasoning_content, baseIndex + i);
        }
        
        console.log(`📊 加载了 ${messages.length} 条消息, offset: ${currentOffset}, 还有更多: ${hasMoreMessages}`);
    } catch (error) {
        console.error('加载更多消息失败:', error);
        currentOffset -= PAGE_SIZE; // 回滚offset
    } finally {
        hideLoadingIndicator();
        isLoadingMore = false;
    }
}

// 在顶部插入消息
function prependMessage(role, content, reasoningContent, messageId) {
    const messagesContainer = document.getElementById('aiMessages');
    if (!messagesContainer) return;
    
    const messageDiv = createMessageElement(role, content, reasoningContent, messageId);
    
    // 插入到最前面（跳过欢迎信息，插在第一条消息之前）
    const firstMessage = messagesContainer.querySelector('.ai-message');
    if (firstMessage) {
        messagesContainer.insertBefore(messageDiv, firstMessage);
    } else {
        // 如果没有消息，直接添加
        messagesContainer.appendChild(messageDiv);
    }
}

// 设置滚动监听
function setupScrollListener() {
    const messagesContainer = document.getElementById('aiMessages');
    if (!messagesContainer) return;
    
    // 移除旧的监听器（如果有）
    messagesContainer.removeEventListener('scroll', handleScroll);
    
    // 添加新的监听器
    messagesContainer.addEventListener('scroll', handleScroll);
}

// 处理滚动事件
function handleScroll(e) {
    const container = e.target;
    
    // 当滚动到顶部100px以内时，加载更多
    if (container.scrollTop < 100 && hasMoreMessages && !isLoadingMore) {
        loadMoreMessages();
    }
}

// 显示加载指示器
function showLoadingIndicator() {
    const messagesContainer = document.getElementById('aiMessages');
    if (!messagesContainer) return;
    
    // 检查是否已存在
    let indicator = messagesContainer.querySelector('.loading-more-indicator');
    if (indicator) return;
    
    indicator = document.createElement('div');
    indicator.className = 'loading-more-indicator';
    indicator.innerHTML = `
        <div class="loading-spinner-small"></div>
        <span>加载更多消息...</span>
    `;
    
    // 插入到最前面
    messagesContainer.insertBefore(indicator, messagesContainer.firstChild);
}

// 隐藏加载指示器
function hideLoadingIndicator() {
    const messagesContainer = document.getElementById('aiMessages');
    if (!messagesContainer) return;
    
    const indicator = messagesContainer.querySelector('.loading-more-indicator');
    if (indicator) {
        indicator.remove();
    }
}

// 创建新会话
window.createNewAISession = async function() {
    const defaultTitle = '新对话 - ' + new Date().toLocaleString();
    const title = await showAIPrompt('请输入对话标题:', '创建新对话', defaultTitle);
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
        showToast('创建会话失败: ' + error.message, 'error');
    }
};

// 删除会话（智能切换）
window.deleteAISession = async function(sessionId) {
    const confirmed = await showAIConfirm(
        '确定要删除这个对话吗？',
        '删除对话'
    );
    if (!confirmed) return;
    
    try {
        // 记录是否删除的是当前会话
        const isDeletingCurrentSession = currentSession?.id === sessionId;
        
        // 删除会话
        await apiRequest(`/api/ai/session/delete?id=${sessionId}`, 'POST');
        showToast('已删除', 'success');
        
        // 重新加载会话列表
        const data = await apiRequest('/api/ai/sessions');
        sessions = data.data || [];
        renderSessionList();
        
        // 智能切换逻辑
        if (isDeletingCurrentSession) {
            // 删除的是当前会话
            if (sessions.length > 0) {
                // 还有其他会话，自动切换到最新的（第一个）
                console.log('🔄 切换到最新会话:', sessions[0].title);
                await selectAISession(sessions[0].id);
            } else {
                // 没有其他会话了，显示欢迎界面
                currentSession = null;
                showWelcomeScreen();
            }
        }
        // 如果删除的不是当前会话，不需要做任何切换，列表已更新
        
    } catch (error) {
        console.error('删除会话失败:', error);
        showToast('删除会话失败: ' + error.message, 'error');
    }
};

// 清空当前对话
window.clearCurrentAIChat = async function() {
    if (!currentSession) {
        showToast('请先选择一个对话', 'warning');
        return;
    }
    
    const confirmed = await showAIConfirm(
        '确定要清空当前对话的所有消息吗？',
        '清空对话'
    );
    if (!confirmed) return;
    
    try {
        await apiRequest(`/api/ai/session/clear?id=${currentSession.id}`, 'POST');
        
        // 清空消息显示
        const messagesContainer = document.getElementById('aiMessages');
        if (messagesContainer) {
            messagesContainer.innerHTML = `
                <div class="ai-welcome">
                    <h3>对话已清空</h3>
                    <p>开始新的对话吧</p>
                </div>
            `;
        }
    } catch (error) {
        console.error('清空对话失败:', error);
        showToast('清空对话失败: ' + error.message, 'error');
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
        showToast('消息内容不能为空', 'warning');
        return;
    }
    
    try {
        await editMessage(messageId, newContent);
        // 更新显示
        contentDiv.innerHTML = escapeHtml(newContent).replace(/\n/g, '<br>');
        // 重新加载消息以更新历史
        await loadMessages(currentSession.id);
    } catch (error) {
        showToast('编辑失败: ' + error.message, 'error');
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
    scrollToBottom(true); // 发送消息时强制滚动
    
    // 显示思考中状态
    const thinkingId = showThinking();
    
    // 显示停止按钮
    showStopButton();
    
    try {
        // 建立WebSocket连接进行流式对话
        await streamChat(currentSession.id, message, thinkingId);
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
                    const newReasoning = data.reasoning_content || data.content || '';
                    if (newReasoning) {
                        reasoningContent += newReasoning;
                    } else {
                        console.warn('⚠️ 收到空的reasoning数据:', data);
                    }
                    
                    // 如果还没有消息元素，将thinking转换为正式消息
                    if (!messageElement) {
                        messageElement = convertThinkingToMessage(thinkingId);
                        if (!messageElement) {
                            messageElement = createMessageElement('assistant', '');
                        }
                    }
                    
                    // 只有内容不为空时才更新思维链
                    if (reasoningContent) {
                        updateReasoningContent(messageElement, reasoningContent, false, true);
                        scrollToBottom();
                    }
                    
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

// 创建消息元素（只创建，不添加到容器）
function createMessageElement(role, content, reasoning = null, messageId = null) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `ai-message ${role}`;
    if (messageId) {
        messageDiv.dataset.messageId = messageId;
    }
    
    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = role === 'user' ? 'User' : 'Agent';
    
    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'message-content-wrapper';
    
    // 如果有思维链内容，先添加思维链（默认折叠）
    if (reasoning) {
        const reasoningDiv = document.createElement('div');
        reasoningDiv.className = 'message-reasoning';
        reasoningDiv.innerHTML = `
            <div class="reasoning-header collapsed" onclick="toggleReasoning(this)">
                <span class="thought-text">Thought</span>
                <i class="fa-solid fa-chevron-right reasoning-arrow"></i>
            </div>
            <div class="reasoning-content collapsed">${formatMessageContent(reasoning)}</div>
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
    
    // 添加消息索引（用于编辑/删除）
    if (messageId !== null && messageId !== undefined) {
        messageDiv.dataset.messageIndex = messageId;
    }
    
    // 添加消息操作按钮（类似命令记录样式）
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'message-actions';
    
    if (role === 'user') {
        // 用户消息：复制、编辑、撤销
        actionsDiv.innerHTML = `
            <span class="message-action-link" onclick="copyMessageContent(this)" title="复制">
                <i class="fa-solid fa-copy"></i> 复制
            </span>
            <span class="message-action-link" onclick="editMessage(this)" title="编辑">
                <i class="fa-solid fa-edit"></i> 编辑
            </span>
            <span class="message-action-link revoke" onclick="revokeMessage(this)" title="撤销此消息及之后的消息">
                <i class="fa-solid fa-rotate-left"></i> 撤销
            </span>
        `;
    } else {
        // AI消息：只有复制（不含思维链）
        actionsDiv.innerHTML = `
            <span class="message-action-link" onclick="copyMessageContent(this)" title="复制回复">
                <i class="fa-solid fa-copy"></i> 复制
            </span>
        `;
    }
    
    messageDiv.appendChild(actionsDiv);
    
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
                <i class="fa-solid fa-chevron-right reasoning-arrow"></i>
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
        <div class="message-avatar">Agent</div>
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
                    <i class="fa-solid fa-play"></i> Run
                </button>` : '';
        
        codeBlocks.push(`<div class="code-block">
            <div class="code-header">
                <span class="code-lang">${lang || 'text'}</span>
                <div class="code-actions">
                    ${executeBtn}
                    <button class="code-copy-btn" onclick="copyCode('${codeId}', event)" title="复制代码">
                        <i class="fa-solid fa-copy"></i> Copy
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
    
    // 6. 分隔线（--- 或 *** 或 ___）
    formatted = formatted.replace(/^(?:---|\*\*\*|___)\s*$/gm, '<hr>');
    
    // 7. 标题（消耗末尾换行）
    formatted = formatted.replace(/^### (.+)\n?$/gm, '<h3>$1</h3>');
    formatted = formatted.replace(/^## (.+)\n?$/gm, '<h2>$1</h2>');
    formatted = formatted.replace(/^# (.+)\n?$/gm, '<h1>$1</h1>');
    
    // 8. 无序列表（标记为UL）
    formatted = formatted.replace(/^[-*] (.+)\n?$/gm, '<li class="ul-item">$1</li>');
    
    // 9. 有序列表（标记为OL）
    formatted = formatted.replace(/^\d+\. (.+)\n?$/gm, '<li class="ol-item">$1</li>');
    
    // 10. 合并连续的无序列表项
    formatted = formatted.replace(/(<li class="ul-item">[\s\S]*?<\/li>(?:\n*<li class="ul-item">[\s\S]*?<\/li>)*)/g, match => {
        const cleaned = match.replace(/\n/g, '').replace(/ class="ul-item"/g, '');
        return '<ul>' + cleaned + '</ul>';
    });
    
    // 11. 合并连续的有序列表项
    formatted = formatted.replace(/(<li class="ol-item">[\s\S]*?<\/li>(?:\n*<li class="ol-item">[\s\S]*?<\/li>)*)/g, match => {
        const cleaned = match.replace(/\n/g, '').replace(/ class="ol-item"/g, '');
        return '<ol>' + cleaned + '</ol>';
    });
    
    // 12. 引用（消耗末尾换行）
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
                btn.innerHTML = '<i class="fa-solid fa-check"></i> Copied';
                btn.classList.add('copied');
                setTimeout(() => {
                    btn.innerHTML = originalHTML;
                    btn.classList.remove('copied');
                }, 1500);
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
        showToast('请先打开一个终端', 'warning');
        return;
    }
    
    const sessionId = activeTerminal.id;
    const session = state.terminals.get(sessionId);
    
    if (!session || !session.ws || session.ws.readyState !== WebSocket.OPEN) {
        showToast('终端未连接', 'warning');
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

// 滚动到底部（智能滚动：只在用户本来就在底部时才滚动）
function scrollToBottom(force = false) {
    const messagesContainer = document.getElementById('aiMessages');
    if (!messagesContainer) return;
    
    // 如果强制滚动，直接滚到底部
    if (force) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        return;
    }
    
    // 检测用户是否在底部附近（距离底部50px以内）
    const isNearBottom = messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight < 50;
    
    // 只有用户在底部时才自动滚动
    if (isNearBottom) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    // 否则，用户正在查看历史消息，不打扰
}

// ========== 消息操作功能 ==========

// 气泡式确认框（类似对话气泡，无遮罩）
function showAIConfirm(message, title = '确认操作') {
    return new Promise((resolve) => {
        const aiPanel = document.getElementById('aiPanel');
        if (!aiPanel) {
            resolve(false);
            return;
        }
        
        // 移除旧的气泡
        const oldBubble = document.querySelector('.ai-bubble-confirm');
        if (oldBubble) oldBubble.remove();
        
        // 创建气泡确认框
        const bubble = document.createElement('div');
        bubble.className = 'ai-bubble-confirm';
        bubble.innerHTML = `
            <div class="ai-bubble-title">${escapeHtml(title)}</div>
            <div class="ai-bubble-message">${escapeHtml(message)}</div>
            <div class="ai-bubble-buttons">
                <button class="ai-bubble-btn ai-bubble-btn-cancel">取消</button>
                <button class="ai-bubble-btn ai-bubble-btn-ok">确定</button>
            </div>
        `;
        
        aiPanel.appendChild(bubble);
        
        // 淡入动画
        setTimeout(() => bubble.classList.add('show'), 10);
        
        // 绑定事件
        const cancelBtn = bubble.querySelector('.ai-bubble-btn-cancel');
        const okBtn = bubble.querySelector('.ai-bubble-btn-ok');
        
        const closeBubble = (result) => {
            bubble.classList.remove('show');
            setTimeout(() => {
                bubble.remove();
                resolve(result);
            }, 200);
        };
        
        cancelBtn.onclick = () => closeBubble(false);
        okBtn.onclick = () => closeBubble(true);
        
        // 点击外部关闭
        const handleClickOutside = (e) => {
            if (!bubble.contains(e.target)) {
                closeBubble(false);
                document.removeEventListener('click', handleClickOutside);
            }
        };
        setTimeout(() => document.addEventListener('click', handleClickOutside), 100);
        
        // ESC键关闭
        const handleEsc = (e) => {
            if (e.key === 'Escape') {
                closeBubble(false);
                document.removeEventListener('keydown', handleEsc);
            }
        };
        document.addEventListener('keydown', handleEsc);
    });
}

// 气泡式输入框（类似对话气泡，无遮罩）
function showAIPrompt(message, title = '输入', defaultValue = '') {
    return new Promise((resolve) => {
        const aiPanel = document.getElementById('aiPanel');
        if (!aiPanel) {
            resolve(null);
            return;
        }
        
        // 移除旧的气泡
        const oldBubble = document.querySelector('.ai-bubble-confirm');
        if (oldBubble) oldBubble.remove();
        
        // 创建气泡输入框
        const bubble = document.createElement('div');
        bubble.className = 'ai-bubble-confirm';
        bubble.innerHTML = `
            <div class="ai-bubble-title">${escapeHtml(title)}</div>
            <div class="ai-bubble-message">${escapeHtml(message)}</div>
            <input type="text" class="ai-bubble-input" value="${escapeHtml(defaultValue)}" placeholder="请输入...">
            <div class="ai-bubble-buttons">
                <button class="ai-bubble-btn ai-bubble-btn-cancel">取消</button>
                <button class="ai-bubble-btn ai-bubble-btn-ok">确定</button>
            </div>
        `;
        
        aiPanel.appendChild(bubble);
        
        const input = bubble.querySelector('.ai-bubble-input');
        
        // 淡入动画并聚焦
        setTimeout(() => {
            bubble.classList.add('show');
            input.focus();
            input.select();
        }, 10);
        
        // 绑定事件
        const cancelBtn = bubble.querySelector('.ai-bubble-btn-cancel');
        const okBtn = bubble.querySelector('.ai-bubble-btn-ok');
        
        const closeBubble = (result) => {
            bubble.classList.remove('show');
            setTimeout(() => {
                bubble.remove();
                resolve(result);
            }, 200);
        };
        
        cancelBtn.onclick = () => closeBubble(null);
        okBtn.onclick = () => {
            const value = input.value.trim();
            closeBubble(value || null);
        };
        
        // 回车确认
        input.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const value = input.value.trim();
                closeBubble(value || null);
            } else if (e.key === 'Escape') {
                closeBubble(null);
            }
        };
        
        // ESC键关闭
        const handleEsc = (e) => {
            if (e.key === 'Escape') {
                closeBubble(null);
                document.removeEventListener('keydown', handleEsc);
            }
        };
        document.addEventListener('keydown', handleEsc);
    });
}

// 复制消息内容（不含思维链）
window.copyMessageContent = function(element) {
    const messageDiv = element.closest('.ai-message');
    if (!messageDiv) return;
    
    // 只复制正文内容，不包含思维链
    const contentDiv = messageDiv.querySelector('.message-content');
    if (!contentDiv) return;
    
    const content = contentDiv.textContent || contentDiv.innerText;
    
    // 复制到剪贴板
    navigator.clipboard.writeText(content).then(() => {
        showToast('已复制到剪贴板', 'success');
    }).catch(err => {
        console.error('复制失败:', err);
        showToast('复制失败', 'error');
    });
};

// 编辑用户消息（就地编辑）
window.editMessage = function(element) {
    const messageDiv = element.closest('.ai-message');
    if (!messageDiv) return;
    
    const contentDiv = messageDiv.querySelector('.message-content');
    if (!contentDiv) return;
    
    // 保存原始内容
    const originalContent = contentDiv.textContent || contentDiv.innerText;
    
    // 隐藏操作按钮
    const actionsDiv = messageDiv.querySelector('.message-actions');
    if (actionsDiv) actionsDiv.style.display = 'none';
    
    // 创建编辑UI
    contentDiv.innerHTML = '';
    const textarea = document.createElement('textarea');
    textarea.className = 'message-edit-textarea';
    textarea.value = originalContent;
    contentDiv.appendChild(textarea);
    
    // 创建编辑按钮
    const editButtons = document.createElement('div');
    editButtons.className = 'message-edit-buttons';
    editButtons.innerHTML = `
        <button class="btn-edit-save" title="保存"><i class="fa-solid fa-check"></i></button>
        <button class="btn-edit-cancel" title="取消"><i class="fa-solid fa-times"></i></button>
    `;
    contentDiv.appendChild(editButtons);
    
    textarea.focus();
    textarea.select();
    
    // 保存按钮
    editButtons.querySelector('.btn-edit-save').onclick = async () => {
        const newContent = textarea.value.trim();
        if (!newContent) {
            showToast('内容不能为空', 'warning');
            return;
        }
        
        if (newContent === originalContent) {
            cancelEdit();
            return;
        }
        
        try {
            // 获取消息索引
            const messageIndex = parseInt(messageDiv.dataset.messageIndex);
            if (isNaN(messageIndex)) {
                showToast('消息索引无效', 'error');
                return;
            }
            
            // 调用后端API
            const data = await apiRequest('/api/ai/message/update', 'POST', {
                session_id: currentSession.id,
                message_index: messageIndex,
                new_content: newContent
            });
            
            if (data.success) {
                // 更新UI
                contentDiv.innerHTML = escapeHtml(newContent).replace(/\n/g, '<br>');
                if (actionsDiv) actionsDiv.style.display = 'flex';
                showToast('已保存', 'success');
            } else {
                throw new Error(data.error || '更新失败');
            }
        } catch (error) {
            console.error('编辑消息失败:', error);
            showToast('编辑失败: ' + error.message, 'error');
            cancelEdit();
        }
    };
    
    // 取消按钮
    editButtons.querySelector('.btn-edit-cancel').onclick = cancelEdit;
    
    function cancelEdit() {
        contentDiv.innerHTML = escapeHtml(originalContent).replace(/\n/g, '<br>');
        if (actionsDiv) actionsDiv.style.display = 'flex';
    }
};

// 撤销消息（撤销该消息及之后的所有消息）
window.revokeMessage = async function(element) {
    const messageDiv = element.closest('.ai-message');
    if (!messageDiv) return;
    
    // 使用气泡式确认对话框
    const confirmed = await showAIConfirm(
        '确定要撤销此消息及之后的所有消息吗？此操作不可恢复！',
        '撤销消息'
    );
    
    if (!confirmed) return;
    
    try {
        // 获取消息索引
        const messageIndex = parseInt(messageDiv.dataset.messageIndex);
        if (isNaN(messageIndex)) {
            showToast('消息索引无效', 'error');
            return;
        }
        
        // 调用后端API撤销消息
        const data = await apiRequest('/api/ai/message/revoke', 'POST', {
            session_id: currentSession.id,
            message_index: messageIndex
        });
        
        if (data.success) {
            // 从DOM删除该消息及之后的所有消息
            let nextSibling = messageDiv;
            while (nextSibling) {
                const toRemove = nextSibling;
                nextSibling = nextSibling.nextElementSibling;
                // 跳过欢迎信息
                if (toRemove.classList.contains('ai-message')) {
                    toRemove.remove();
                }
            }
            showToast('已撤销', 'success');
        } else {
            throw new Error(data.error || '撤销失败');
        }
    } catch (error) {
        console.error('撤销消息失败:', error);
        showToast('撤销失败: ' + error.message, 'error');
    }
};

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
