// AI 助手功能

let currentAIMode = 'chat';  // 'chat' | 'agent'
let selectedModelValue = 'gpt-4';
let selectedModelName = 'GPT-4';

// 切换对话历史下拉
window.toggleHistoryDropdown = function() {
    const menu = document.getElementById('historyDropdownMenu');
    const trigger = document.querySelector('.history-trigger');
    
    if (menu.style.display === 'none' || !menu.style.display) {
        menu.style.display = 'block';
        trigger.classList.add('open');
    } else {
        menu.style.display = 'none';
        trigger.classList.remove('open');
    }
};

// 切换模式下拉
window.toggleModeDropdown = function() {
    const menu = document.getElementById('modeDropdownMenu');
    const trigger = document.querySelector('.mode-trigger');
    
    if (menu.style.display === 'none' || !menu.style.display) {
        menu.style.display = 'block';
        trigger.classList.add('open');
    } else {
        menu.style.display = 'none';
        trigger.classList.remove('open');
    }
};

// 选择模式
window.selectMode = function(mode) {
    currentAIMode = mode;
    const modeText = mode === 'chat' ? 'Chat' : 'Agent';
    
    document.getElementById('currentMode').textContent = modeText;
    toggleModeDropdown();
    
    console.log(`🔄 切换到${modeText}模式`);
};

// 打开AI设置
window.openAISettings = function() {
    alert('设置功能开发中...');
};

// 切换模型选择器
window.toggleModelSelector = function() {
    const popup = document.getElementById('modelPopup');
    
    if (popup.style.display === 'none' || !popup.style.display) {
        popup.style.display = 'block';
    } else {
        popup.style.display = 'none';
    }
};

// 选择模型
window.selectModel = function(value, name) {
    selectedModelValue = value;
    selectedModelName = name;
    
    document.getElementById('selectedModel').textContent = name;
    toggleModelSelector();
    
    console.log(`🤖 选择模型: ${name}`);
};

// 发送AI消息（统一入口）
window.sendAIMessage = function() {
    const input = document.getElementById('aiInput');
    const message = input.value.trim();
    
    if (!message) {
        return;
    }
    
    console.log(`🤖 [${currentAIMode}模式] [${selectedModelName}] 发送:`, message);
    
    // 添加用户消息到界面
    addAIMessage('user', message);
    
    // 清空输入框
    input.value = '';
    input.style.height = 'auto'; // 重置高度
    
    // TODO: 调用AI API
    setTimeout(() => {
        const response = `模式: ${currentAIMode === 'chat' ? 'Chat' : 'Agent'}\n模型: ${selectedModelName}\n\n收到消息: ${message}\n\n（AI功能开发中...）`;
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

// 点击外部关闭下拉菜单
document.addEventListener('click', (e) => {
    // 关闭历史下拉
    const historyDropdown = document.getElementById('historyDropdownMenu');
    const historyTrigger = document.querySelector('.history-trigger');
    if (historyDropdown && !e.target.closest('.history-dropdown')) {
        historyDropdown.style.display = 'none';
        if (historyTrigger) historyTrigger.classList.remove('open');
    }
    
    // 关闭模式下拉
    const modeDropdown = document.getElementById('modeDropdownMenu');
    const modeTrigger = document.querySelector('.mode-trigger');
    if (modeDropdown && !e.target.closest('.mode-dropdown')) {
        modeDropdown.style.display = 'none';
        if (modeTrigger) modeTrigger.classList.remove('open');
    }
    
    // 关闭模型选择
    const modelPopup = document.getElementById('modelPopup');
    if (modelPopup && !e.target.closest('.inline-model-selector')) {
        modelPopup.style.display = 'none';
    }
});

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
