// AI 助手功能

let currentAIMode = 'chat';  // 'chat' | 'agent'
let contextBubbleVisible = false;
let historyVisible = false;

// 切换AI模式
window.switchAIMode = function(mode) {
    currentAIMode = mode;
    
    // 更新模式按钮
    document.querySelectorAll('.mode-btn').forEach(btn => {
        if (btn.dataset.mode === mode) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    
    // 切换上下文信息显示
    const chatContext = document.getElementById('contextChat');
    const agentContext = document.getElementById('contextAgent');
    
    if (mode === 'chat') {
        if (chatContext) chatContext.style.display = 'block';
        if (agentContext) agentContext.style.display = 'none';
    } else {
        if (chatContext) chatContext.style.display = 'none';
        if (agentContext) agentContext.style.display = 'block';
    }
    
    console.log(`🔄 切换到${mode === 'chat' ? 'Chat' : 'Agent'}模式`);
};

// 切换上下文信息气泡
window.toggleContextInfo = function() {
    contextBubbleVisible = !contextBubbleVisible;
    const bubble = document.getElementById('contextBubble');
    const btn = event.target.closest('.tool-btn');
    
    if (bubble) {
        bubble.style.display = contextBubbleVisible ? 'block' : 'none';
    }
    
    if (btn) {
        if (contextBubbleVisible) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    }
};

// 切换对话历史
window.toggleHistory = function() {
    historyVisible = !historyVisible;
    const sidebar = document.getElementById('historySidebar');
    
    if (sidebar) {
        sidebar.style.display = historyVisible ? 'flex' : 'none';
    }
};

// 发送AI消息（统一入口）
window.sendAIMessage = function() {
    const input = document.getElementById('aiInput');
    const message = input.value.trim();
    
    if (!message) {
        return;
    }
    
    const model = document.getElementById('modelSelect').value;
    console.log(`🤖 [${currentAIMode}模式] [${model}] 发送:`, message);
    
    // 添加用户消息到界面
    addAIMessage('user', message);
    
    // 清空输入框
    input.value = '';
    
    // TODO: 调用AI API
    setTimeout(() => {
        const response = `模式: ${currentAIMode === 'chat' ? 'Chat' : 'Agent'}\n模型: ${model}\n\n收到消息: ${message}\n\n（AI功能开发中...）`;
        addAIMessage('assistant', response);
    }, 500);
};

// 添加AI消息
function addAIMessage(role, content) {
    const messagesDiv = document.getElementById('aiMessages');
    
    // 移除欢迎界面
    const welcome = messagesDiv.querySelector('.ai-welcome');
    if (welcome) {
        welcome.remove();
    }
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `ai-message ${role}`;
    
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.textContent = content;
    
    const time = document.createElement('div');
    time.className = 'message-time';
    time.textContent = new Date().toLocaleTimeString('zh-CN', { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
    
    messageDiv.appendChild(bubble);
    messageDiv.appendChild(time);
    messagesDiv.appendChild(messageDiv);
    
    // 滚动到底部
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}


// 更新上下文信息（Chat模式）
export function updateChatContext(context) {
    if (!context) return;
    
    const serverEl = document.getElementById('ctxServer');
    const pathEl = document.getElementById('ctxPath');
    
    if (serverEl) serverEl.textContent = context.server || '未连接';
    if (pathEl) pathEl.textContent = context.path || '-';
}

// 更新上下文信息（Agent模式）
export function updateAgentContext(context) {
    if (!context) return;
    
    const projectEl = document.getElementById('ctxProject');
    
    if (projectEl) projectEl.textContent = context.project || '未配置项目';
}

// 向后兼容
export function updateTerminalSnapshot(snapshot) {
    updateChatContext({
        server: snapshot.server,
        path: snapshot.cwd
    });
}

export function updateWorkspaceInfo(workspace) {
    updateAgentContext({
        project: workspace.rootPath || workspace.name
    });
}

// Ctrl+Enter 发送消息
document.addEventListener('DOMContentLoaded', () => {
    const aiInput = document.getElementById('aiInput');
    
    if (aiInput) {
        aiInput.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'Enter') {
                e.preventDefault();
                sendAIMessage();
            }
        });
    }
});
