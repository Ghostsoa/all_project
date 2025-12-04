// AI 助手功能

let currentAIMode = 'chat';  // 'chat' | 'agent'

// 切换AI模式
window.switchAIMode = function(mode) {
    currentAIMode = mode;
    
    // 更新模式标签
    document.querySelectorAll('.ai-mode-tab').forEach(tab => {
        if (tab.dataset.mode === mode) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });
    
    // 切换内容区
    document.querySelectorAll('.ai-mode-content').forEach(content => {
        content.classList.remove('active');
        content.style.display = 'none';
    });
    
    const targetContent = mode === 'chat' ? 
        document.getElementById('chatMode') : 
        document.getElementById('agentMode');
    
    if (targetContent) {
        targetContent.classList.add('active');
        targetContent.style.display = 'flex';
    }
    
    console.log(`🔄 切换到${mode === 'chat' ? '对话' : 'Agent'}模式`);
};

// 发送聊天消息
window.sendChatMessage = function() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    
    if (!message) {
        return;
    }
    
    console.log('💬 发送消息:', message);
    
    // 添加用户消息到界面
    addChatMessage('user', message);
    
    // 清空输入框
    input.value = '';
    
    // TODO: 调用AI API
    setTimeout(() => {
        addChatMessage('assistant', '收到您的消息：' + message + '\n\n（AI功能开发中...）');
    }, 500);
};

// 发送Agent任务
window.sendAgentTask = function() {
    const input = document.getElementById('agentInput');
    const task = input.value.trim();
    
    if (!task) {
        return;
    }
    
    console.log('🎯 执行任务:', task);
    
    // 添加用户消息到界面
    addAgentMessage('user', task);
    
    // 清空输入框
    input.value = '';
    
    // TODO: 调用AI API
    setTimeout(() => {
        addAgentMessage('assistant', '收到您的任务：' + task + '\n\n（Agent功能开发中...）');
    }, 500);
};

// 添加聊天消息
function addChatMessage(role, content) {
    const messagesDiv = document.getElementById('chatMessages');
    
    // 移除欢迎界面
    const welcome = messagesDiv.querySelector('.chat-welcome');
    if (welcome) {
        welcome.remove();
    }
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${role}`;
    
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

// 添加Agent消息
function addAgentMessage(role, content) {
    const messagesDiv = document.getElementById('agentMessages');
    
    // 移除欢迎界面
    const welcome = messagesDiv.querySelector('.agent-welcome');
    if (welcome) {
        welcome.remove();
    }
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${role}`;
    
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

// 显示Workspace配置
window.showWorkspaceConfig = function() {
    alert('Workspace配置功能开发中...');
};

// 更新终端快照
export function updateTerminalSnapshot(snapshot) {
    if (!snapshot) return;
    
    const serverEl = document.getElementById('snapshotServer');
    const cwdEl = document.getElementById('snapshotCwd');
    const commandEl = document.getElementById('snapshotCommand');
    
    if (serverEl) serverEl.textContent = snapshot.server || '未连接';
    if (cwdEl) cwdEl.textContent = snapshot.cwd || '-';
    if (commandEl) commandEl.textContent = snapshot.lastCommand || '-';
}

// 更新Workspace信息
export function updateWorkspaceInfo(workspace) {
    if (!workspace) return;
    
    const nameEl = document.getElementById('workspaceName');
    const serverEl = document.getElementById('workspaceServer');
    const rootEl = document.getElementById('workspaceRoot');
    const sftpDotEl = document.getElementById('sftpStatusDot');
    const sftpTextEl = document.getElementById('sftpStatusText');
    
    if (nameEl) nameEl.textContent = workspace.name || '未配置';
    if (serverEl) serverEl.textContent = workspace.server || '-';
    if (rootEl) rootEl.textContent = workspace.rootPath || '-';
    
    if (sftpDotEl && sftpTextEl) {
        if (workspace.sftpConnected) {
            sftpDotEl.classList.add('connected');
            sftpTextEl.textContent = '已连接';
        } else {
            sftpDotEl.classList.remove('connected');
            sftpTextEl.textContent = '未连接';
        }
    }
}

// Ctrl+Enter 发送消息
document.addEventListener('DOMContentLoaded', () => {
    const chatInput = document.getElementById('chatInput');
    const agentInput = document.getElementById('agentInput');
    
    if (chatInput) {
        chatInput.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'Enter') {
                e.preventDefault();
                sendChatMessage();
            }
        });
    }
    
    if (agentInput) {
        agentInput.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'Enter') {
                e.preventDefault();
                sendAgentTask();
            }
        });
    }
});
