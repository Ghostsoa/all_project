// 文件树管理
import { state } from './config.js';
import { showToast } from './utils.js';
import { openFileEditor } from './editor.js';
import { fileCache } from './filecache.js';

let currentServerID = null;
let currentSessionID = null; // 当前会话ID
let currentPath = '/root';

// 剪贴板
let clipboard = null; // {type: 'copy'|'cut', path: '...'}

export function initFileTree() {
    const fileTreeContainer = document.getElementById('fileTree');
    if (!fileTreeContainer) return;
    
    // 加载初始目录
    loadDirectory(currentPath);
    
    // 添加F5刷新快捷键
    document.addEventListener('keydown', (e) => {
        if (e.key === 'F5' && !e.ctrlKey && !e.shiftKey && !e.altKey) {
            e.preventDefault();
            window.refreshCurrentDirectory();
        }
    });
    
    // 空白区域右键菜单
    fileTreeContainer.addEventListener('contextmenu', (e) => {
        // 如果点击的是文件项，让文件项自己处理
        if (e.target.closest('.file-tree-item')) return;
        
        e.preventDefault();
        showBlankContextMenu(e, currentPath);
    });
}

// 手动刷新当前目录
window.refreshCurrentDirectory = async function() {
    if (!currentSessionID || !currentPath) return;
    
    try {
        const files = await fileCache.refresh(currentSessionID, currentPath);
        renderFileTree(files, currentPath);
        showToast('刷新成功', 'success');
    } catch (error) {
        showToast('刷新失败: ' + error.message, 'error');
    }
}

export function setCurrentServer(serverID, sessionID) {
    currentServerID = serverID;
    currentSessionID = sessionID;
    
    // 本地终端特殊处理 (ID为0)
    if (serverID === 0 || serverID === '0') {
        showLocalFileWarning();
        return;
    }
    
    // 设置渲染回调
    fileCache.setRenderCallback(renderFileTree);
    
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
    
    currentPath = path;
    fileCache.setCurrentPath(path);
    
    // 显示加载状态（首次加载）
    const fileTreeContainer = document.getElementById('fileTree');
    if (!fileCache.cache.has(fileCache.makeKey(currentSessionID, path))) {
        fileTreeContainer.innerHTML = '<div class="file-tree-empty">📂 加载中...</div>';
    }
    
    try {
        // 使用缓存管理器：立即返回缓存 + 后台刷新
        const files = await fileCache.getOrLoad(currentSessionID, path);
        renderFileTree(files, path);
    } catch (error) {
        console.error('加载目录失败:', error);
        showToast('加载目录失败: ' + error.message, 'error');
        fileTreeContainer.innerHTML = `
            <div class="file-tree-empty">
                <p>❌ 加载失败</p>
                <p style="font-size: 10px; margin-top: 8px; color: rgba(255,255,255,0.3);">
                    ${error.message || '未知错误'}
                </p>
            </div>
        `;
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
    
    // 乐观更新：立即添加到UI
    const newFile = {
        name: fileName,
        path: filePath,
        is_dir: false,
        size: 0,
        mod_time: new Date().toISOString()
    };
    fileCache.optimisticCreate(currentSessionID, basePath, newFile);
    
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
        } else {
            showToast('创建失败: ' + data.error, 'error');
            // 失败，回滚
            await fileCache.rollback(currentSessionID, basePath);
        }
    } catch (error) {
        showToast('创建失败', 'error');
        // 失败，回滚
        await fileCache.rollback(currentSessionID, basePath);
    }
};

window.createNewFolder = async function(basePath) {
    const folderName = prompt('请输入文件夹名:');
    if (!folderName) return;
    
    const folderPath = basePath + '/' + folderName;
    
    // 乐观更新：立即添加到UI
    const newFolder = {
        name: folderName,
        path: folderPath,
        is_dir: true,
        size: 0,
        mod_time: new Date().toISOString()
    };
    fileCache.optimisticCreate(currentSessionID, basePath, newFolder);
    
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
        } else {
            showToast('创建失败: ' + data.error, 'error');
            await fileCache.rollback(currentSessionID, basePath);
        }
    } catch (error) {
        showToast('创建失败', 'error');
        await fileCache.rollback(currentSessionID, basePath);
    }
};

window.showFileContextMenu = function(event, path, isDir) {
    event.preventDefault();
    
    // 创建右键菜单
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = event.pageX + 'px';
    menu.style.top = event.pageY + 'px';
    
    const menuHTML = `
        <div class="context-menu-item" onclick="window.copyFile('${path}')"> 复制</div>
        <div class="context-menu-item" onclick="window.cutFile('${path}')"> 剪切</div>
        <div class="context-menu-divider"></div>
        <div class="context-menu-item" onclick="window.renameFile('${path}')"> 重命名</div>
        <div class="context-menu-item" onclick="window.deleteFile('${path}')"> 删除</div>
    `;
    
    menu.innerHTML = menuHTML;
    document.body.appendChild(menu);
    
    // 点击其他地方关闭菜单
    setTimeout(() => {
        const closeMenu = () => {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        };
        document.addEventListener('click', closeMenu);
    }, 0);
};

// 空白区域右键菜单
function showBlankContextMenu(event, basePath) {
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = event.pageX + 'px';
    menu.style.top = event.pageY + 'px';
    
    let menuHTML = `
        <div class="context-menu-item" onclick="window.createNewFile('${basePath}')">📄 新建文件</div>
        <div class="context-menu-item" onclick="window.createNewFolder('${basePath}')">📁 新建文件夹</div>
    `;
    
    // 如果有剪贴板内容，添加粘贴选项
    if (clipboard) {
        menuHTML += `
            <div class="context-menu-divider"></div>
            <div class="context-menu-item" onclick="window.pasteFile('${basePath}')">📌 粘贴</div>
        `;
    }
    
    menuHTML += `
        <div class="context-menu-divider"></div>
        <div class="context-menu-item" onclick="window.refreshCurrentDirectory()">🔄 刷新</div>
    `;
    
    menu.innerHTML = menuHTML;
    document.body.appendChild(menu);
    
    setTimeout(() => {
        const closeMenu = () => {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        };
        document.addEventListener('click', closeMenu);
    }, 0);
}

// 复制文件
window.copyFile = function(path) {
    clipboard = { type: 'copy', path };
    showToast('已复制', 'success');
};

// 剪切文件
window.cutFile = function(path) {
    clipboard = { type: 'cut', path };
    showToast('已剪切', 'success');
};

// 粘贴文件
window.pasteFile = async function(targetPath) {
    if (!clipboard) {
        showToast('剪贴板为空', 'error');
        return;
    }
    
    const fileName = clipboard.path.split('/').pop();
    const newPath = targetPath + '/' + fileName;
    
    try {
        if (clipboard.type === 'copy') {
            // 复制：先读取再创建
            const response = await fetch(`/api/files/read?session_id=${currentSessionID}&path=${encodeURIComponent(clipboard.path)}`);
            const data = await response.json();
            
            if (data.success) {
                const createResponse = await fetch('/api/files/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        session_id: currentSessionID,
                        path: newPath,
                        content: data.content
                    })
                });
                
                const createData = await createResponse.json();
                if (createData.success) {
                    showToast('复制成功', 'success');
                    await fileCache.rollback(currentSessionID, targetPath);
                } else {
                    showToast('复制失败', 'error');
                }
            }
        } else if (clipboard.type === 'cut') {
            // 剪切：重命名（移动）
            const response = await fetch('/api/files/rename', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: currentSessionID,
                    old_path: clipboard.path,
                    new_path: newPath
                })
            });
            
            const data = await response.json();
            if (data.success) {
                showToast('移动成功', 'success');
                
                // 刷新两个目录
                const oldParent = clipboard.path.split('/').slice(0, -1).join('/') || '/';
                await fileCache.rollback(currentSessionID, oldParent);
                await fileCache.rollback(currentSessionID, targetPath);
                
                clipboard = null; // 清空剪贴板
            } else {
                showToast('移动失败: ' + data.error, 'error');
            }
        }
    } catch (error) {
        showToast('操作失败', 'error');
    }
};

window.renameFile = async function(oldPath) {
    const oldName = oldPath.split('/').pop();
    const newName = prompt('请输入新名称:', oldName);
    if (!newName || newName === oldName) return;
    
    const parentPath = oldPath.split('/').slice(0, -1).join('/') || '/';
    const newPath = parentPath + '/' + newName;
    
    // 乐观更新：立即重命名
    fileCache.optimisticRename(currentSessionID, parentPath, oldPath, newPath, newName);
    
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
        } else {
            showToast('重命名失败: ' + data.error, 'error');
            await fileCache.rollback(currentSessionID, parentPath);
        }
    } catch (error) {
        showToast('重命名失败', 'error');
        await fileCache.rollback(currentSessionID, parentPath);
    }
};

window.deleteFile = async function(path) {
    if (!confirm('确定要删除这个文件/文件夹吗？')) return;
    
    const parentPath = path.split('/').slice(0, -1).join('/') || '/';
    
    // 乐观更新：立即从UI删除
    fileCache.optimisticDelete(currentSessionID, parentPath, path);
    
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
        } else {
            showToast('删除失败: ' + data.error, 'error');
            await fileCache.rollback(currentSessionID, parentPath);
        }
    } catch (error) {
        showToast('删除失败', 'error');
        await fileCache.rollback(currentSessionID, parentPath);
    }
};
