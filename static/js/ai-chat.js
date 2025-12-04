// AI对话管理模块

import { apiRequest } from './api.js';

// 全局变量
let currentSession = null;
let chatWebSocket = null;
let sessions = [];

// ========== 会话管理 ==========

// 加载会话列表
export async function loadSessions() {
    try {
        const data = await apiRequest('/api/ai/sessions');
        sessions = data.data || [];
        renderSessionList();
        
        // 如果有会话，自动选择第一个
        if (sessions.length > 0 && !currentSession) {
            await selectSession(sessions[0].ID || sessions[0].id);
        }
    } catch (error) {
        console.error('加载会话列表失败:', error);
    }
}

// 渲染会话列表
function renderSessionList() {
    const container = document.getElementById('aiConversationHistory');
    if (!container) return;

    if (sessions.length === 0) {
        container.innerHTML = `
            <div class="empty-history">
                <i class="fa-solid fa-comments"></i>
                <p>暂无对话历史</p>
            </div>
        `;
        return;
    }

    container.innerHTML = sessions.map(session => `
        <div class="history-item ${currentSession?.ID === session.ID ? 'active' : ''}" 
             onclick="selectAISession(${session.ID || session.id})"
             data-session-id="${session.ID || session.id}">
            <div class="history-item-title">${escapeHtml(session.title)}</div>
            <div class="history-item-meta">
                <span>${formatTime(session.last_active_at)}</span>
                ${session.config?.ai_model ? `<span class="model-tag">${escapeHtml(session.config.ai_model.display_name || session.config.ai_model.name)}</span>` : ''}
            </div>
            <button class="history-item-delete" onclick="event.stopPropagation(); deleteAISession(${session.ID || session.id})" title="删除">
                <i class="fa-solid fa-trash"></i>
            </button>
        </div>
    `).join('');
}

// 选择会话
window.selectAISession = async function(sessionId) {
    try {
        const data = await apiRequest(`/api/ai/session?id=${sessionId}`);
        currentSession = data.data;
        
        // 更新UI
        renderSessionList();
        
        // 加载消息
        await loadMessages(sessionId);
        
        // 显示对话区域
        showChatArea();
    } catch (error) {
        console.error('选择会话失败:', error);
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
        if (currentSession?.ID === sessionId) {
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
        const wsUrl = `${protocol}//${window.location.host}/ws/ai?session_id=${sessionId}&message=${encodeURIComponent(message)}`;
        
        chatWebSocket = new WebSocket(wsUrl);
        
        let assistantMessage = '';
        let reasoningContent = '';
        let messageElement = null;
        
        chatWebSocket.onopen = () => {
            console.log('✅ WebSocket连接已建立');
            // 移除思考状态
            removeThinking(thinkingId);
        };
        
        chatWebSocket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                
                if (data.type === 'content') {
                    // 内容增量更新
                    assistantMessage += data.content;
                    
                    if (!messageElement) {
                        messageElement = createMessageElement('assistant', assistantMessage);
                    } else {
                        updateMessageContent(messageElement, assistantMessage);
                    }
                    
                    scrollToBottom();
                    
                } else if (data.type === 'reasoning') {
                    // 思维链内容
                    reasoningContent += data.content;
                    
                    if (messageElement) {
                        updateReasoningContent(messageElement, reasoningContent);
                    }
                    
                } else if (data.type === 'done') {
                    // 完成
                    console.log('✅ 对话完成');
                    resolve();
                    
                } else if (data.type === 'error') {
                    // 错误
                    console.error('❌ 对话错误:', data.content);
                    if (!messageElement) {
                        appendMessage('assistant', '抱歉，发生了错误: ' + data.content);
                    }
                    reject(new Error(data.content));
                }
            } catch (error) {
                console.error('解析消息失败:', error, event.data);
            }
        };
        
        chatWebSocket.onerror = (error) => {
            console.error('❌ WebSocket错误:', error);
            removeThinking(thinkingId);
            reject(error);
        };
        
        chatWebSocket.onclose = () => {
            console.log('🔌 WebSocket连接已关闭');
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
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.innerHTML = formatMessageContent(content);
    
    contentWrapper.appendChild(contentDiv);
    
    // 如果有思维链内容
    if (reasoning) {
        const reasoningDiv = document.createElement('div');
        reasoningDiv.className = 'message-reasoning';
        reasoningDiv.innerHTML = `
            <div class="reasoning-header">
                <i class="fa-solid fa-brain"></i>
                <span>思考过程</span>
            </div>
            <div class="reasoning-content">${escapeHtml(reasoning)}</div>
        `;
        contentWrapper.appendChild(reasoningDiv);
    }
    
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
function updateReasoningContent(messageElement, reasoning) {
    let reasoningDiv = messageElement.querySelector('.message-reasoning');
    
    if (!reasoningDiv) {
        reasoningDiv = document.createElement('div');
        reasoningDiv.className = 'message-reasoning';
        reasoningDiv.innerHTML = `
            <div class="reasoning-header">
                <i class="fa-solid fa-brain"></i>
                <span>思考过程</span>
            </div>
            <div class="reasoning-content"></div>
        `;
        
        const contentWrapper = messageElement.querySelector('.message-content-wrapper');
        if (contentWrapper) {
            contentWrapper.appendChild(reasoningDiv);
        }
    }
    
    const reasoningContentDiv = reasoningDiv.querySelector('.reasoning-content');
    if (reasoningContentDiv) {
        reasoningContentDiv.textContent = reasoning;
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
                <div class="typing-indicator">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
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

// 格式化消息内容（支持Markdown）
function formatMessageContent(content) {
    // 简单的Markdown支持
    let formatted = escapeHtml(content);
    
    // 代码块
    formatted = formatted.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
        return `<pre><code class="language-${lang || 'text'}">${code.trim()}</code></pre>`;
    });
    
    // 行内代码
    formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // 粗体
    formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    
    // 换行
    formatted = formatted.replace(/\n/g, '<br>');
    
    return formatted;
}

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
