// 文件树管理
import { state } from './config.js';
import { showToast } from './utils.js';
import { openFileEditor } from './editor.js';
import { fileCache } from './filecache.js';
import { showConfirm } from './modal.js';

let currentServerID = null;
let currentSessionID = null; // 当前会话ID
let currentPath = '/root';

// 剪贴板
let clipboard = null; // {type: 'copy'|'cut', path: '...'}

// 是否显示隐藏文件
export let showHiddenFiles = false;
export function setShowHiddenFiles(value) {
    showHiddenFiles = value;
}

export function initFileTree() {
    const fileTreeContainer = document.getElementById('fileTree');
    if (!fileTreeContainer) return;
    
    // 显示隐藏文件勾选框事件
    const showHiddenCheckbox = document.getElementById('showHiddenFiles');
    if (showHiddenCheckbox) {
        showHiddenCheckbox.addEventListener('change', toggleHiddenFiles);
    }
    
    // 刷新按钮事件
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', refreshCurrentDirectory);
    }
    
    // 添加F5刷新快捷键
    document.addEventListener('keydown', (e) => {
        if (e.key === 'F5' && !e.ctrlKey && !e.shiftKey && !e.altKey) {
            e.preventDefault();
            refreshCurrentDirectory();
        }
    });
    
    // 空白区域右键菜单
    fileTreeContainer.addEventListener('contextmenu', (e) => {
        // 如果点击的是文件项或文件操作按钮，让它们自己处理
        if (e.target.closest('.file-item') || 
            e.target.closest('.file-action-btn') ||
            e.target.closest('.file-tree-header')) {
            return;
        }
        
        // 空白区域右键
        e.preventDefault();
        e.stopPropagation();
        showBlankContextMenu(e, currentPath);
    });
}

// 手动刷新当前目录
async function refreshCurrentDirectory() {
    if (!currentSessionID || !currentPath) return;
    
    try {
        const files = await fileCache.refresh(currentSessionID, currentPath);
        renderFileTree(files, currentPath);
        showToast('刷新成功', 'success');
    } catch (error) {
        showToast('刷新失败: ' + error.message, 'error');
    }
}

// 切换显示隐藏文件
function toggleHiddenFiles() {
    const checkbox = document.getElementById('showHiddenFiles');
    setShowHiddenFiles(checkbox.checked);
    
    // 清除缓存，重新加载当前目录
    if (currentSessionID && currentPath) {
        fileCache.cache.clear();
        loadDirectory(currentPath);
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
    
    // 设置获取showHidden状态的函数
    fileCache.setShowHiddenGetter(() => showHiddenFiles);
    
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

export async function loadDirectory(path, retryCount = 0) {
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
        
        // 如果是SFTP未就绪，且重试次数少于3次，则等待后重试
        if (error.message && error.message.includes('SSH会话不存在') && retryCount < 3) {
            console.log(`SFTP未就绪，${1 + retryCount * 0.5}秒后重试 (${retryCount + 1}/3)`);
            fileTreeContainer.innerHTML = `
                <div class="file-tree-empty">
                    <p>⏳ 等待连接...</p>
                    <p style="font-size: 10px; margin-top: 8px; color: rgba(255,255,255,0.5);">
                        正在建立SFTP连接 (${retryCount + 1}/3)
                    </p>
                </div>
            `;
            setTimeout(() => {
                loadDirectory(path, retryCount + 1);
            }, 1000 + retryCount * 500); // 1s, 1.5s, 2s
            return;
        }
        
        // 超过重试次数或其他错误
        showToast('加载目录失败: ' + error.message, 'error');
        fileTreeContainer.innerHTML = `
            <div class="file-tree-empty">
                <p>❌ 加载失败</p>
                <p style="font-size: 10px; margin-top: 8px; color: rgba(255,255,255,0.3);">
                    ${error.message || '未知错误'}
                </p>
                <button onclick="window.refreshCurrentDirectory()" style="margin-top: 10px; padding: 6px 12px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; color: white; cursor: pointer;">
                    🔄 重试
                </button>
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

// 就地创建文件
window.createNewFile = async function(basePath) {
    const fileList = document.querySelector('.file-list');
    if (!fileList) return;
    
    // 创建临时文件项（带输入框的完整文件项）
    const tempDiv = document.createElement('div');
    tempDiv.className = 'file-item editing is-file';
    tempDiv.innerHTML = `
        <span class="file-icon">📄</span>
        <input type="text" class="file-name-input" value="未命名文件.txt" autofocus>
    `;
    
    // 插入到列表开头（跳过..返回项）
    const firstRealItem = Array.from(fileList.children).find(child => 
        !child.textContent.includes('..')
    );
    if (firstRealItem) {
        fileList.insertBefore(tempDiv, firstRealItem);
    } else {
        fileList.appendChild(tempDiv);
    }
    
    const input = tempDiv.querySelector('.file-name-input');
    input.focus();
    input.select(); // 全选文件名
    
    // 处理创建
    const handleCreate = async () => {
        const fileName = input.value.trim();
        if (!fileName) {
            tempDiv.remove();
            return;
        }
        
        const filePath = basePath + '/' + fileName;
        
        // 移除临时项，添加到缓存
        tempDiv.remove();
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
                await fileCache.rollback(currentSessionID, basePath);
            }
        } catch (error) {
            showToast('创建失败', 'error');
            await fileCache.rollback(currentSessionID, basePath);
        }
    };
    
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleCreate();
        } else if (e.key === 'Escape') {
            tempDiv.remove(); // 取消创建，删除临时项
        }
    });
    
    input.addEventListener('blur', () => {
        setTimeout(() => handleCreate(), 100);
    });
};

// 就地创建文件夹
window.createNewFolder = async function(basePath) {
    const fileList = document.querySelector('.file-list');
    if (!fileList) return;
    
    // 创建临时文件夹项（带输入框的完整文件夹项）
    const tempDiv = document.createElement('div');
    tempDiv.className = 'file-item editing is-dir';
    tempDiv.innerHTML = `
        <span class="file-icon">📁</span>
        <input type="text" class="file-name-input" value="新建文件夹" autofocus>
    `;
    
    // 插入到列表开头（跳过..返回项）
    const firstRealItem = Array.from(fileList.children).find(child => 
        !child.textContent.includes('..')
    );
    if (firstRealItem) {
        fileList.insertBefore(tempDiv, firstRealItem);
    } else {
        fileList.appendChild(tempDiv);
    }
    
    const input = tempDiv.querySelector('.file-name-input');
    input.focus();
    input.select(); // 全选文件夹名
    
    // 处理创建
    const handleCreate = async () => {
        const folderName = input.value.trim();
        if (!folderName) {
            tempDiv.remove();
            return;
        }
        
        const folderPath = basePath + '/' + folderName;
        
        // 移除临时项，添加到缓存
        tempDiv.remove();
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
    
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleCreate();
        } else if (e.key === 'Escape') {
            tempDiv.remove(); // 取消创建，删除临时项
        }
    });
    
    input.addEventListener('blur', () => {
        setTimeout(() => handleCreate(), 100);
    });
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

// 就地重命名
window.renameFile = async function(oldPath) {
    const oldName = oldPath.split('/').pop();
    const parentPath = oldPath.split('/').slice(0, -1).join('/') || '/';
    
    // 找到对应的文件项
    const fileItem = document.querySelector(`[data-path="${oldPath}"]`);
    if (!fileItem) return;
    
    const nameSpan = fileItem.querySelector('.file-name');
    if (!nameSpan) return;
    
    // 创建输入框
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'file-name-input';
    input.value = oldName;
    input.style.cssText = 'flex: 1; background: rgba(255,255,255,0.1); border: 1px solid rgba(59,130,246,0.5); border-radius: 3px; padding: 2px 6px; color: white; outline: none;';
    
    // 替换名称为输入框
    nameSpan.replaceWith(input);
    input.focus();
    input.select();
    
    // 处理重命名
    const handleRename = async () => {
        const newName = input.value.trim();
        if (!newName || newName === oldName) {
            input.replaceWith(nameSpan);
            return;
        }
        
        const newPath = parentPath + '/' + newName;
        
        // 替换回名称
        nameSpan.textContent = newName;
        input.replaceWith(nameSpan);
        
        // 乐观更新
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
    
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleRename();
        } else if (e.key === 'Escape') {
            input.replaceWith(nameSpan);
        }
    });
    
    input.addEventListener('blur', () => {
        setTimeout(() => handleRename(), 100);
    });
};

window.deleteFile = async function(path) {
    const fileName = path.split('/').pop();
    const confirmed = await showConfirm(
        `确定要删除 "${fileName}" 吗？此操作不可恢复。`,
        '删除确认'
    );
    if (!confirmed) return;
    
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
