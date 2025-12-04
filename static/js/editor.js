// Monaco 编辑器管理
import { state } from './config.js';
import { showToast } from './utils.js';
import { showConfirm } from './modal.js';

let editorInstances = new Map(); // 存储编辑器实例
let openFiles = new Map(); // 存储打开的文件信息

// 配置Monaco Editor（只配置一次）
// 注意：require.config只能调用一次，否则会报错
if (typeof require !== 'undefined' && typeof window.monaco === 'undefined') {
    require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' } });
}

// 动态导入marked（使用ES模块）
let markedLib = null;
const loadMarked = async () => {
    if (!markedLib) {
        try {
            markedLib = await import('https://cdn.jsdelivr.net/npm/marked@11.0.0/+esm');
            console.log('✅ marked已动态导入');
            return markedLib;
        } catch (error) {
            console.error('❌ marked导入失败:', error);
            return null;
        }
    }
    return markedLib;
};

// Office文档格式（需要特殊提示）
const OFFICE_EXTENSIONS = new Set([
    'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'
]);

// 不可编辑的文件扩展名（二进制文件、可执行文件、压缩包等）
const NON_EDITABLE_EXTENSIONS = new Set([
    // 可执行文件
    'exe', 'dll', 'so', 'dylib', 'bin', 'out', 'o', 'a',
    // 压缩包
    'zip', 'tar', 'gz', 'bz2', 'xz', 'rar', '7z', 'tgz', 'tbz2',
    // 图片
    'jpg', 'jpeg', 'png', 'gif', 'bmp', 'ico', 'svg', 'webp', 'tiff',
    // 视频
    'mp4', 'avi', 'mov', 'wmv', 'flv', 'mkv', 'webm',
    // 音频
    'mp3', 'wav', 'flac', 'aac', 'ogg', 'wma',
    // 其他二进制
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
    'class', 'jar', 'pyc', 'pyo', 'db', 'sqlite'
]);

// 大文件阈值（5MB）
const MAX_FILE_SIZE = 5 * 1024 * 1024;

export async function openFileEditor(filePath, serverID, sessionID, fileSize = 0) {
    // 如果文件已打开，切换到该标签
    if (openFiles.has(filePath)) {
        switchToTab(filePath);
        return;
    }
    
    // 检查文件类型
    const ext = filePath.split('.').pop()?.toLowerCase();
    
    // Office文档特殊提示
    if (ext && OFFICE_EXTENSIONS.has(ext)) {
        const confirmed = await showConfirm(
            `📄 Office文档（.${ext}）无法在浏览器中编辑。\n\n建议：\n• 使用sftp下载到本地后编辑\n• 或在服务器上使用命令行工具\n\n如果是CSV等文本格式，请修改为.csv扩展名。\n\n是否要查看原始内容？（可能是乱码）`,
            'Office文档提示'
        );
        if (!confirmed) return;
    }
    
    // 其他二进制文件直接拒绝
    if (ext && NON_EDITABLE_EXTENSIONS.has(ext)) {
        showToast(`无法编辑 .${ext} 文件（二进制/不支持的格式）`, 'error');
        return;
    }
    
    // 检查文件大小
    if (fileSize > MAX_FILE_SIZE) {
        const sizeMB = (fileSize / (1024 * 1024)).toFixed(2);
        const confirmed = await showConfirm(
            `文件大小为 ${sizeMB}MB，可能会导致编辑器卡顿。\n\n建议使用命令行工具编辑大文件。\n\n确定要打开吗？`,
            '大文件警告'
        );
        if (!confirmed) return;
    }
    
    // 检查是否为Markdown文件
    const isMarkdown = filePath.endsWith('.md') || filePath.endsWith('.markdown');
    
    // 先创建标签页，显示"加载中"
    const tabId = createLoadingTab(filePath, serverID, sessionID);
    
    try {
        // 读取文件内容
        const response = await fetch(`/api/files/read?session_id=${sessionID}&path=${encodeURIComponent(filePath)}`);
        const data = await response.json();
        
        if (!data.success) {
            showToast('读取文件失败: ' + data.error, 'error');
            closeEditorTab(tabId);
            return;
        }
        
        // 加载成功，创建编辑器
        if (isMarkdown) {
            initializeMarkdownEditor(tabId, filePath, data.content);
        } else {
            initializeEditor(tabId, filePath, data.content);
        }
    } catch (error) {
        console.error('打开文件失败:', error);
        showToast('打开文件失败', 'error');
        closeEditorTab(tabId);
    }
}

function createLoadingTab(filePath, serverID, sessionID) {
    const fileName = filePath.split('/').pop();
    const tabId = 'editor-' + Date.now();
    
    // 添加标签到统一内容标签栏（在终端标签后面）
    const tabsList = document.getElementById('contentTabsList');
    const tabHTML = `
        <div class="content-tab-item active" data-tab-id="${tabId}" data-path="${filePath}" onclick="window.switchContentTab('${tabId}')">
            <span class="tab-icon">${getFileIcon(fileName)}</span>
            <span class="tab-name">${fileName}</span>
            <span class="tab-close" onclick="event.stopPropagation(); window.closeContentTab('${tabId}')">×</span>
        </div>
    `;
    
    // 移除其他文件标签的active，保持终端标签
    tabsList.querySelectorAll('.content-tab-item[data-tab-id]').forEach(tab => {
        tab.classList.remove('active');
    });
    
    tabsList.insertAdjacentHTML('beforeend', tabHTML);
    
    // 创建加载中容器
    const contentContainer = document.getElementById('contentContainer');
    const editorHTML = `
        <div class="editor-pane" data-tab-id="${tabId}" data-path="${filePath}">
            <div class="editor-toolbar">
                <span class="editor-path">${filePath}</span>
                <button class="editor-save-btn" disabled>💾 保存 (Ctrl+S)</button>
            </div>
            <div class="editor-container loading" id="${tabId}">
                <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: rgba(255,255,255,0.5);">
                    📂 加载中...
                </div>
            </div>
        </div>
    `;
    contentContainer.insertAdjacentHTML('beforeend', editorHTML);
    
    // 保存文件信息
    openFiles.set(filePath, { serverID, sessionID, tabId, loading: true });
    
    // 切换到新标签
    switchToTab(filePath);
    
    return tabId;
}

async function initializeMarkdownEditor(tabId, filePath, content) {
    const container = document.getElementById(tabId);
    container.classList.remove('loading');
    container.innerHTML = ''; // 清空加载提示
    
    const fileInfo = openFiles.get(filePath);
    if (!fileInfo) return;
    
    fileInfo.loading = false;
    fileInfo.viewMode = 'split'; // 默认分屏模式：edit, preview, split
    
    // 更新工具栏，添加模式切换按钮
    const toolbar = document.querySelector(`[data-tab-id="${tabId}"] .editor-toolbar`);
    if (toolbar) {
        toolbar.innerHTML = `
            <span class="editor-path">${filePath}</span>
            <div class="markdown-toolbar">
                <button class="mode-btn active" data-mode="edit" onclick="window.switchMarkdownMode('${tabId}', 'edit')" title="编辑模式">
                    📝 编辑
                </button>
                <button class="mode-btn active" data-mode="split" onclick="window.switchMarkdownMode('${tabId}', 'split')" title="分屏模式">
                    🔀 分屏
                </button>
                <button class="mode-btn" data-mode="preview" onclick="window.switchMarkdownMode('${tabId}', 'preview')" title="预览模式">
                    👁️ 预览
                </button>
                <button class="editor-save-btn" onclick="window.saveFile('${tabId}')">💾 保存 (Ctrl+S)</button>
            </div>
        `;
    }
    
    // 创建分屏容器
    container.innerHTML = `
        <div class="markdown-container split-mode">
            <div class="markdown-editor-pane" id="${tabId}-editor"></div>
            <div class="markdown-preview-pane" id="${tabId}-preview"></div>
        </div>
    `;
    
    // 动态加载marked
    const marked = await loadMarked();
    if (marked) {
        // 配置marked
        marked.marked.setOptions({
            highlight: function(code, lang) {
                if (lang && window.hljs && window.hljs.getLanguage(lang)) {
                    return window.hljs.highlight(code, { language: lang }).value;
                }
                return code;
            },
            breaks: true,
            gfm: true
        });
        
        // 初始化Monaco编辑器
        // 初始化Monaco编辑器
        const fileName = filePath.split('/').pop();
        require(['vs/editor/editor.main'], function() {
            const editor = monaco.editor.create(document.getElementById(`${tabId}-editor`), {
                value: content,
                language: 'markdown',
                theme: 'vs-dark',
                automaticLayout: true,
                fontSize: 13,
                minimap: { enabled: false }, // Markdown不需要minimap
                wordWrap: 'on',
                lineNumbers: 'on'
            });
            
            // 保存编辑器实例
            editorInstances.set(tabId, editor);
            
            // 初始渲染预览
            updateMarkdownPreview(tabId, content);
            
            // 实时更新预览（防抖）
            let updateTimeout;
            editor.getModel().onDidChangeContent(() => {
                clearTimeout(updateTimeout);
                updateTimeout = setTimeout(() => {
                    updateMarkdownPreview(tabId, editor.getValue());
                    markAsModified(tabId);
                }, 300);
            });
            
            // Ctrl+S保存
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, function() {
                window.saveFile(tabId);
            });
        });
    }
}

function updateMarkdownPreview(tabId, markdown) {
    const previewPane = document.getElementById(`${tabId}-preview`);
    if (!previewPane) return;
    
    if (markedLib) {
        try {
            // 使用导入的marked
            const html = markedLib.marked.parse(markdown);
            previewPane.innerHTML = `<div class="markdown-body">${html}</div>`;
            
            // 高亮代码块
            if (window.hljs) {
                previewPane.querySelectorAll('pre code').forEach((block) => {
                    window.hljs.highlightElement(block);
                });
            }
        } catch (error) {
            console.error('Markdown渲染失败:', error);
            previewPane.innerHTML = `<div class="markdown-body"><pre>${markdown}</pre></div>`;
        }
    } else {
        console.warn('marked.js未加载');
        previewPane.innerHTML = `<div class="markdown-body"><pre>${markdown}</pre></div>`;
    }
}

// 切换Markdown模式
window.switchMarkdownMode = function(tabId, mode) {
    const fileInfo = Array.from(openFiles.values()).find(f => f.tabId === tabId);
    if (!fileInfo) return;
    
    fileInfo.viewMode = mode;
    
    const container = document.querySelector(`[data-tab-id="${tabId}"] .markdown-container`);
    const toolbar = document.querySelector(`[data-tab-id="${tabId}"] .markdown-toolbar`);
    
    if (!container || !toolbar) return;
    
    // 更新按钮状态
    toolbar.querySelectorAll('.mode-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.mode === mode) {
            btn.classList.add('active');
        }
    });
    
    // 切换模式
    container.className = 'markdown-container';
    if (mode === 'edit') {
        container.classList.add('edit-mode');
    } else if (mode === 'preview') {
        container.classList.add('preview-mode');
    } else {
        container.classList.add('split-mode');
    }
    
    // 刷新编辑器布局
    const editor = editorInstances.get(tabId);
    if (editor && mode !== 'preview') {
        setTimeout(() => editor.layout(), 10);
    }
};

function initializeEditor(tabId, filePath, content) {
    const container = document.getElementById(tabId);
    container.classList.remove('loading');
    container.innerHTML = ''; // 清空加载提示
    
    const fileInfo = openFiles.get(filePath);
    if (!fileInfo) return;
    
    fileInfo.loading = false;
    
    // 启用保存按钮
    const saveBtn = document.querySelector(`[data-tab-id="${tabId}"] .editor-save-btn`);
    if (saveBtn) saveBtn.disabled = false;
    
    // 初始化Monaco编辑器
    const fileName = filePath.split('/').pop();
    require(['vs/editor/editor.main'], function() {
        const editor = monaco.editor.create(container, {
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
        
        // 监听内容变化
        let changeTimeout;
        editor.getModel().onDidChangeContent(() => {
            // 防抖，避免频繁标记
            clearTimeout(changeTimeout);
            changeTimeout = setTimeout(() => {
                markAsModified(tabId);
            }, 100);
        });
    });
}

function createEditorTab(filePath, serverID, sessionID, content) {
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
    openFiles.set(filePath, { serverID, sessionID, tabId, modified: false });
    
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
    document.querySelectorAll('.content-tab-item').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelector(`.content-tab-item[data-tab-id="${fileInfo.tabId}"]`)?.classList.add('active');
    
    // 隐藏所有terminal-pane和editor-pane
    document.querySelectorAll('.terminal-pane').forEach(pane => {
        pane.classList.remove('active');
    });
    document.querySelectorAll('.editor-pane').forEach(pane => {
        pane.classList.remove('active');
    });
    
    // 显示当前editor-pane
    document.querySelector(`.editor-pane[data-tab-id="${fileInfo.tabId}"]`)?.classList.add('active');
    
    // 刷新编辑器布局
    const editor = editorInstances.get(fileInfo.tabId);
    if (editor) {
        setTimeout(() => editor.layout(), 0);
    }
}

function markAsModified(tabId) {
    const tab = document.querySelector(`.content-tab-item[data-tab-id="${tabId}"]`);
    if (tab && !tab.classList.contains('modified')) {
        tab.classList.add('modified');
        const tabName = tab.querySelector('.tab-name');
        if (!tabName.textContent.startsWith('● ')) {
            tabName.textContent = '● ' + tabName.textContent;
        }
    }
}

function markAsUnmodified(tabId) {
    const tab = document.querySelector(`.content-tab-item[data-tab-id="${tabId}"]`);
    if (tab) {
        tab.classList.remove('modified');
        const tabName = tab.querySelector('.tab-name');
        tabName.textContent = tabName.textContent.replace('● ', '');
    }
}

// 保存当前content-tabs状态（供main.js调用）
export function saveCurrentContentTabsState() {
    return document.getElementById('contentTabsList')?.innerHTML || '';
}

// 全局函数 - 内容标签切换（只处理文件标签）
window.switchContentTab = function(id) {
    const pane = document.querySelector(`.editor-pane[data-tab-id="${id}"]`);
    if (!pane) return;
    
    const filePath = pane.dataset.path;
    switchToTab(filePath);
};

window.closeContentTab = function(id) {
    // 如果是编辑器标签
    if (id.startsWith('editor-')) {
        const tab = document.querySelector(`.content-tab-item[data-tab-id="${id}"]`);
        if (tab && tab.classList.contains('modified')) {
            if (!confirm('文件未保存，确定关闭吗？')) return;
        }
        
        const pane = document.querySelector(`.editor-pane[data-tab-id="${id}"]`);
        const filePath = pane?.dataset.path;
        
        tab?.remove();
        pane?.remove();
        
        const editor = editorInstances.get(id);
        if (editor) {
            editor.dispose();
            editorInstances.delete(id);
        }
        
        if (filePath) {
            openFiles.delete(filePath);
        }
        
        // 检查是否还有文件标签
        const remainingFileTabs = document.querySelectorAll('.content-tab-item[data-tab-id]');
        if (remainingFileTabs.length === 0) {
            // 没有文件标签了，自动切回终端
            const terminalTab = document.querySelector('.content-tab-item[data-type="terminal"]');
            if (terminalTab) {
                const sessionId = terminalTab.dataset.sessionId;
                if (sessionId && window.switchToTerminal) {
                    window.switchToTerminal(sessionId);
                }
            }
        }
    } 
    // 如果是终端标签（不允许关闭）
    else {
        // 终端标签不可关闭
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
                session_id: fileInfo.sessionID,
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
