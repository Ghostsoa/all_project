// Monaco 编辑器管理
import { state } from './config.js';
import { showToast } from './utils.js';

let editorInstances = new Map(); // 存储编辑器实例
let openFiles = new Map(); // 存储打开的文件信息

export async function openFileEditor(filePath, serverID) {
    // 如果文件已打开，切换到该标签
    if (openFiles.has(filePath)) {
        switchToTab(filePath);
        return;
    }
    
    try {
        // 读取文件内容
        const response = await fetch(`/api/files/read?server_id=${serverID}&path=${encodeURIComponent(filePath)}`);
        const data = await response.json();
        
        if (!data.success) {
            showToast('读取文件失败: ' + data.error, 'error');
            return;
        }
        
        // 创建编辑器标签
        createEditorTab(filePath, serverID, data.content);
    } catch (error) {
        console.error('打开文件失败:', error);
        showToast('打开文件失败', 'error');
    }
}

function createEditorTab(filePath, serverID, content) {
    const fileName = filePath.split('/').pop();
    const tabId = 'editor-' + Date.now();
    
    // 添加标签
    const tabsList = document.querySelector('.tabs-list');
    const tabHTML = `
        <div class="tab-item" data-tab-id="${tabId}" data-path="${filePath}" onclick="window.switchToEditorTab('${tabId}')">
            <span class="tab-icon">${getFileIcon(fileName)}</span>
            <span class="tab-name">${fileName}</span>
            <span class="tab-close" onclick="event.stopPropagation(); window.closeEditorTab('${tabId}')">×</span>
        </div>
    `;
    tabsList.insertAdjacentHTML('beforeend', tabHTML);
    
    // 创建编辑器容器
    const terminalsContainer = document.getElementById('terminalsContainer');
    const editorHTML = `
        <div class="editor-pane" data-tab-id="${tabId}" data-path="${filePath}">
            <div class="editor-toolbar">
                <span class="editor-path">${filePath}</span>
                <button class="editor-save-btn" onclick="window.saveFile('${tabId}')">💾 保存 (Ctrl+S)</button>
            </div>
            <div class="editor-container" id="${tabId}"></div>
        </div>
    `;
    terminalsContainer.insertAdjacentHTML('beforeend', editorHTML);
    
    // 初始化Monaco编辑器
    require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' } });
    require(['vs/editor/editor.main'], function() {
        const editor = monaco.editor.create(document.getElementById(tabId), {
            value: content,
            language: getLanguage(fileName),
            theme: 'vs-dark',
            automaticLayout: true,
            fontSize: 13,
            minimap: { enabled: true },
            scrollBeyondLastLine: false,
            wordWrap: 'on'
        });
        
        // 保存编辑器实例
        editorInstances.set(tabId, editor);
        
        // Ctrl+S保存
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, function() {
            window.saveFile(tabId);
        });
        
        // 标记为未修改
        editor.getModel().onDidChangeContent(() => {
            markAsModified(tabId);
        });
    });
    
    // 保存文件信息
    openFiles.set(filePath, {
        tabId,
        serverID,
        modified: false
    });
    
    // 切换到新标签
    switchToTab(filePath);
}

function getLanguage(fileName) {
    const ext = fileName.split('.').pop().toLowerCase();
    const langMap = {
        'js': 'javascript',
        'json': 'json',
        'go': 'go',
        'py': 'python',
        'html': 'html',
        'css': 'css',
        'md': 'markdown',
        'txt': 'plaintext',
        'sh': 'shell',
        'yml': 'yaml',
        'yaml': 'yaml',
        'xml': 'xml',
        'sql': 'sql'
    };
    return langMap[ext] || 'plaintext';
}

function getFileIcon(fileName) {
    const ext = fileName.split('.').pop().toLowerCase();
    const iconMap = {
        'js': '📜', 'json': '📋', 'go': '🔵',
        'py': '🐍', 'html': '🌐', 'css': '🎨',
        'md': '📝', 'txt': '📄'
    };
    return iconMap[ext] || '📄';
}

function switchToTab(filePath) {
    const fileInfo = openFiles.get(filePath);
    if (!fileInfo) return;
    
    // 切换标签激活状态
    document.querySelectorAll('.tab-item').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelector(`[data-tab-id="${fileInfo.tabId}"]`).classList.add('active');
    
    // 切换内容显示
    document.querySelectorAll('.terminal-pane, .editor-pane').forEach(pane => {
        pane.classList.remove('active');
    });
    document.querySelector(`.editor-pane[data-tab-id="${fileInfo.tabId}"]`).classList.add('active');
    
    // 刷新编辑器布局
    const editor = editorInstances.get(fileInfo.tabId);
    if (editor) {
        setTimeout(() => editor.layout(), 0);
    }
}

function markAsModified(tabId) {
    const tab = document.querySelector(`[data-tab-id="${tabId}"]`);
    if (tab && !tab.classList.contains('modified')) {
        tab.classList.add('modified');
        const tabName = tab.querySelector('.tab-name');
        if (!tabName.textContent.startsWith('● ')) {
            tabName.textContent = '● ' + tabName.textContent;
        }
    }
}

function markAsUnmodified(tabId) {
    const tab = document.querySelector(`[data-tab-id="${tabId}"]`);
    if (tab) {
        tab.classList.remove('modified');
        const tabName = tab.querySelector('.tab-name');
        tabName.textContent = tabName.textContent.replace('● ', '');
    }
}

// 全局函数
window.switchToEditorTab = function(tabId) {
    const pane = document.querySelector(`.editor-pane[data-tab-id="${tabId}"]`);
    if (!pane) return;
    
    const filePath = pane.dataset.path;
    switchToTab(filePath);
};

window.closeEditorTab = function(tabId) {
    // 检查是否有未保存的修改
    const tab = document.querySelector(`[data-tab-id="${tabId}"]`);
    if (tab && tab.classList.contains('modified')) {
        if (!confirm('文件未保存，确定关闭吗？')) return;
    }
    
    // 删除标签和编辑器
    const pane = document.querySelector(`.editor-pane[data-tab-id="${tabId}"]`);
    const filePath = pane?.dataset.path;
    
    tab?.remove();
    pane?.remove();
    
    // 清理数据
    const editor = editorInstances.get(tabId);
    if (editor) {
        editor.dispose();
        editorInstances.delete(tabId);
    }
    
    if (filePath) {
        openFiles.delete(filePath);
    }
    
    // 如果关闭后没有其他标签，切换回终端
    const remainingTabs = document.querySelectorAll('.tab-item');
    if (remainingTabs.length === 1) { // 只剩下终端标签
        window.switchToTerminalTab();
    }
};

window.saveFile = async function(tabId) {
    const editor = editorInstances.get(tabId);
    if (!editor) return;
    
    const pane = document.querySelector(`.editor-pane[data-tab-id="${tabId}"]`);
    const filePath = pane.dataset.path;
    const fileInfo = openFiles.get(filePath);
    
    if (!fileInfo) return;
    
    const content = editor.getValue();
    
    try {
        const response = await fetch('/api/files/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                server_id: fileInfo.serverID,
                path: filePath,
                content: content
            })
        });
        
        const data = await response.json();
        if (data.success) {
            showToast('保存成功', 'success');
            markAsUnmodified(tabId);
        } else {
            showToast('保存失败: ' + data.error, 'error');
        }
    } catch (error) {
        console.error('保存文件失败:', error);
        showToast('保存失败', 'error');
    }
};

// 切换回终端标签
window.switchToTerminalTab = function() {
    document.querySelectorAll('.tab-item').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelector('.tab-item[data-type="terminal"]')?.classList.add('active');
    
    document.querySelectorAll('.terminal-pane, .editor-pane').forEach(pane => {
        pane.classList.remove('active');
    });
    document.querySelectorAll('.terminal-pane').forEach(pane => {
        if (!pane.classList.contains('editor-pane')) {
            pane.classList.add('active');
        }
    });
};
