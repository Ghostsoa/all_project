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
            await selectAISession(sessions[0].ID || sessions[0].id);
        }
    } catch (error) {
        console.error('加载会话列表失败:', error);
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
        triggerEl.onclick = function() {
            toggleHistoryDropdown();
        };
    }

    container.innerHTML = `
        <div class="history-item new" onclick="createNewAISession(); toggleHistoryDropdown();">
            <i class="fa-solid fa-plus"></i>
            <span>新建对话</span>
        </div>
        <div class="history-divider"></div>
    ` + sessions.map(session => `
        <div class="history-item ${currentSession?.ID === session.ID || currentSession?.id === session.id ? 'active' : ''}" 
             onclick="selectAISession(${session.ID || session.id}); toggleHistoryDropdown();"
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
            // 移除思考状态
            removeThinking(thinkingId);
            
            // 发送消息到后端
            const payload = {
                session_id: sessionId,
                message: message
            };
            console.log('📤 发送消息:', payload);
            chatWebSocket.send(JSON.stringify(payload));
        };
        
        chatWebSocket.onmessage = (event) => {
            try {
                console.log('📥 收到消息:', event.data);
                const data = JSON.parse(event.data);
                
                if (data.type === 'content') {
                    // 内容增量更新
                    assistantMessage += data.content;
                    
                    if (!messageElement) {
                        messageElement = createMessageElement('assistant', assistantMessage);
                    } else {
                        updateMessageContent(messageElement, assistantMessage);
                    }
                    
                    // 收到第一条正文内容时，自动折叠思维链
                    if (reasoningContent && assistantMessage.length <= data.content.length) {
                        updateReasoningContent(messageElement, reasoningContent, true);
                    }
                    
                    scrollToBottom();
                    
                } else if (data.type === 'reasoning') {
                    // 思维链内容
                    reasoningContent += data.content;
                    
                    // 如果还没有消息元素，先创建一个
                    if (!messageElement) {
                        messageElement = createMessageElement('assistant', '正在思考...');
                    }
                    
                    updateReasoningContent(messageElement, reasoningContent);
                    scrollToBottom();
                    
                } else if (data.type === 'done') {
                    // 完成
                    console.log('✅ 对话完成');
                    
                    // 如果只有reasoning没有content，清除"正在思考..."
                    if (messageElement && assistantMessage === '') {
                        updateMessageContent(messageElement, '');
                    }
                    
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
                <span>Thought</span>
                <span class="reasoning-arrow">▼</span>
            </div>
            <div class="reasoning-content">${escapeHtml(reasoning)}</div>
        `;
        contentWrapper.appendChild(reasoningDiv);
    }
    
    // 然后添加正文内容
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.innerHTML = formatMessageContent(content);
    
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
function updateReasoningContent(messageElement, reasoning, autoCollapse = false) {
    let reasoningDiv = messageElement.querySelector('.message-reasoning');
    
    if (!reasoningDiv) {
        reasoningDiv = document.createElement('div');
        reasoningDiv.className = 'message-reasoning';
        reasoningDiv.innerHTML = `
            <div class="reasoning-header" onclick="toggleReasoning(this)">
                <span>Thought</span>
                <span class="reasoning-arrow">▼</span>
            </div>
            <div class="reasoning-content"></div>
        `;
        const contentWrapper = messageElement.querySelector('.message-content-wrapper');
        if (contentWrapper) {
            contentWrapper.insertBefore(reasoningDiv, contentWrapper.firstChild);
        }
    }
    
    const reasoningContent = reasoningDiv.querySelector('.reasoning-content');
    if (reasoningContent) {
        reasoningContent.textContent = reasoning;
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

// 格式化消息内容（完整Markdown支持）
function formatMessageContent(content) {
    if (!content) return '';
    
    let formatted = content;
    const codeBlocks = [];
    const inlineCodes = [];
    
    // 1. 先提取并保护代码块
    formatted = formatted.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
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
    
    // 6. 标题
    formatted = formatted.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    formatted = formatted.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    formatted = formatted.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    
    // 7. 无序列表
    formatted = formatted.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
    formatted = formatted.replace(/(<li>[\s\S]*?<\/li>\n?)+/g, match => {
        return '<ul>' + match + '</ul>';
    });
    
    // 8. 有序列表
    formatted = formatted.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
    formatted = formatted.replace(/(<li>[\s\S]*?<\/li>\n?)+/g, match => {
        if (!match.includes('<ul>')) {
            return '<ol>' + match + '</ol>';
        }
        return match;
    });
    
    // 9. 引用
    formatted = formatted.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
    
    // 10. 链接
    formatted = formatted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    
    // 11. 换行
    formatted = formatted.replace(/\n/g, '<br>');
    
    // 12. 恢复行内代码
    inlineCodes.forEach((code, i) => {
        formatted = formatted.replace(`__INLINECODE_${i}__`, code);
    });
    
    // 13. 恢复代码块
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
