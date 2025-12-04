// 文件树管理
import { state } from './config.js';
import { showToast } from './utils.js';
import { openFileEditor } from './editor.js';

let currentServerID = null;
let currentSessionID = null; // 当前会话ID
let currentPath = '/root';

export function initFileTree() {
    const fileTreeContainer = document.getElementById('fileTree');
    if (!fileTreeContainer) return;
    
    // 加载初始目录
    loadDirectory(currentPath);
}

export function setCurrentServer(serverID, sessionID) {
    currentServerID = serverID;
    currentSessionID = sessionID;
    
    // 本地终端特殊处理 (ID为0)
    if (serverID === 0 || serverID === '0') {
        showLocalFileWarning();
        return;
    }
    
    currentPath = '/root'; // 默认根目录
    loadDirectory(currentPath);
}

function showLocalFileWarning() {
    const fileTreeContainer = document.getElementById('fileTree');
    fileTreeContainer.innerHTML = `
        <div class="file-tree-empty">
            <p>本地终端暂不支持文件浏览</p>
            <p style="font-size: 10px; margin-top: 8px; color: rgba(255,255,255,0.3);">
                使用远程SSH连接可浏览文件
            </p>
        </div>
    `;
}

export async function loadDirectory(path) {
    if (!currentServerID) {
        console.log('未连接服务器');
        return;
    }
    
    // 显示加载状态
    const fileTreeContainer = document.getElementById('fileTree');
    fileTreeContainer.innerHTML = '<div class="file-tree-empty">📂 加载中...</div>';
    
    try {
        const response = await fetch(`/api/files/list?session_id=${currentSessionID}&path=${encodeURIComponent(path)}`);
        const data = await response.json();
        
        if (data.success) {
            renderFileTree(data.files, path);
        } else {
            showToast('加载目录失败: ' + data.error, 'error');
            fileTreeContainer.innerHTML = `
                <div class="file-tree-empty">
                    <p>❌ 加载失败</p>
                    <p style="font-size: 10px; margin-top: 8px; color: rgba(255,255,255,0.3);">
                        ${data.error || '未知错误'}
                    </p>
                </div>
            `;
        }
    } catch (error) {
        console.error('加载目录失败:', error);
        showToast('加载目录失败', 'error');
        fileTreeContainer.innerHTML = '<div class="file-tree-empty">❌ 网络错误</div>';
    }
}

function renderFileTree(files, basePath) {
    const fileTreeContainer = document.getElementById('fileTree');
    
    // 排序：目录在前，文件在后
    files.sort((a, b) => {
        if (a.is_dir && !b.is_dir) return -1;
        if (!a.is_dir && b.is_dir) return 1;
        return a.name.localeCompare(b.name);
    });
    
    const html = `
        <div class="file-tree-header">
            <span class="file-path">${basePath}</span>
            <div class="file-actions">
                <button class="file-action-btn" onclick="window.createNewFile('${basePath}')" title="新建文件">📄+</button>
                <button class="file-action-btn" onclick="window.createNewFolder('${basePath}')" title="新建文件夹">📁+</button>
            </div>
        </div>
        <div class="file-list">
            ${basePath !== '/' ? `
                <div class="file-item" onclick="window.navigateUp('${basePath}')">
                    <span class="file-icon">⬆️</span>
                    <span class="file-name">..</span>
                </div>
            ` : ''}
            ${files.map(file => `
                <div class="file-item ${file.is_dir ? 'is-dir' : 'is-file'}" 
                     data-path="${file.path}"
                     data-is-dir="${file.is_dir}"
                     ondblclick="window.handleFileDoubleClick('${file.path}', ${file.is_dir})"
                     oncontextmenu="window.showFileContextMenu(event, '${file.path}', ${file.is_dir})">
                    <span class="file-icon">${getFileIcon(file)}</span>
                    <span class="file-name">${escapeHtml(file.name)}</span>
                    ${!file.is_dir ? `<span class="file-size">${formatSize(file.size)}</span>` : ''}
                </div>
            `).join('')}
        </div>
    `;
    
    fileTreeContainer.innerHTML = html;
}

function getFileIcon(file) {
    if (file.is_dir) return '📁';
    
    const ext = file.name.split('.').pop().toLowerCase();
    const iconMap = {
        'js': '📜',
        'json': '📋',
        'go': '🔵',
        'py': '🐍',
        'html': '🌐',
        'css': '🎨',
        'md': '📝',
        'txt': '📄',
        'log': '📊',
        'sh': '⚙️',
        'yml': '⚙️',
        'yaml': '⚙️',
        'xml': '📋',
        'sql': '🗄️',
        'jpg': '🖼️',
        'jpeg': '🖼️',
        'png': '🖼️',
        'gif': '🖼️',
    };
    
    return iconMap[ext] || '📄';
}

function formatSize(bytes) {
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + 'GB';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 导出全局函数
window.handleFileDoubleClick = function(path, isDir) {
    if (isDir) {
        currentPath = path;
        loadDirectory(path);
    } else {
        openFileEditor(path, currentServerID, currentSessionID);
    }
};

window.navigateUp = function(currentPath) {
    const parentPath = currentPath.split('/').slice(0, -1).join('/') || '/';
    loadDirectory(parentPath);
};

window.createNewFile = async function(basePath) {
    const fileName = prompt('请输入文件名:');
    if (!fileName) return;
    
    const filePath = basePath + '/' + fileName;
    
    try {
        const response = await fetch('/api/files/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: currentSessionID,
                path: filePath,
                is_dir: false
            })
        });
        
        const data = await response.json();
        if (data.success) {
            showToast('文件创建成功', 'success');
            loadDirectory(basePath);
        } else {
            showToast('创建失败: ' + data.error, 'error');
        }
    } catch (error) {
        showToast('创建失败', 'error');
    }
};

window.createNewFolder = async function(basePath) {
    const folderName = prompt('请输入文件夹名:');
    if (!folderName) return;
    
    const folderPath = basePath + '/' + folderName;
    
    try {
        const response = await fetch('/api/files/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: currentSessionID,
                path: folderPath,
                is_dir: true
            })
        });
        
        const data = await response.json();
        if (data.success) {
            showToast('文件夹创建成功', 'success');
            loadDirectory(basePath);
        } else {
            showToast('创建失败: ' + data.error, 'error');
        }
    } catch (error) {
        showToast('创建失败', 'error');
    }
};

window.showFileContextMenu = function(event, path, isDir) {
    event.preventDefault();
    
    // 创建右键菜单
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = event.pageX + 'px';
    menu.style.top = event.pageY + 'px';
    
    menu.innerHTML = `
        <div class="context-menu-item" onclick="window.renameFile('${path}')">重命名</div>
        <div class="context-menu-item danger" onclick="window.deleteFile('${path}')">删除</div>
    `;
    
    document.body.appendChild(menu);
    
    // 点击其他地方关闭菜单
    setTimeout(() => {
        document.addEventListener('click', function closeMenu() {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        });
    }, 0);
};

window.renameFile = async function(oldPath) {
    const oldName = oldPath.split('/').pop();
    const newName = prompt('请输入新名称:', oldName);
    if (!newName || newName === oldName) return;
    
    const newPath = oldPath.split('/').slice(0, -1).join('/') + '/' + newName;
    
    try {
        const response = await fetch('/api/files/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: currentSessionID,
                old_path: oldPath,
                new_path: newPath
            })
        });
        
        const data = await response.json();
        if (data.success) {
            showToast('重命名成功', 'success');
            loadDirectory(currentPath);
        } else {
            showToast('重命名失败: ' + data.error, 'error');
        }
    } catch (error) {
        showToast('重命名失败', 'error');
    }
};

window.deleteFile = async function(path) {
    if (!confirm('确定要删除这个文件/文件夹吗？')) return;
    
    try {
        const response = await fetch('/api/files/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: currentSessionID,
                path: path
            })
        });
        
        const data = await response.json();
        if (data.success) {
            showToast('删除成功', 'success');
            loadDirectory(currentPath);
        } else {
            showToast('删除失败: ' + data.error, 'error');
        }
    } catch (error) {
        showToast('删除失败', 'error');
    }
};
