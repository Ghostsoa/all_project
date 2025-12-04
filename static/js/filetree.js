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
    
    console.log('🔧 初始化文件树...');
    
    // 显示隐藏文件勾选框事件
    const showHiddenCheckbox = document.getElementById('showHiddenFiles');
    if (showHiddenCheckbox) {
        console.log('✅ 绑定显示隐藏文件勾选框事件');
        showHiddenCheckbox.addEventListener('change', toggleHiddenFiles);
    } else {
        console.warn('❌ 未找到showHiddenFiles元素');
    }
    
    // 刷新按钮事件
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
        console.log('✅ 绑定刷新按钮事件');
        refreshBtn.addEventListener('click', refreshCurrentDirectory);
    } else {
        console.warn('❌ 未找到refreshBtn元素');
    }
    
    // 添加F5刷新快捷键
    document.addEventListener('keydown', (e) => {
        if (e.key === 'F5' && !e.ctrlKey && !e.shiftKey && !e.altKey) {
            e.preventDefault();
            refreshCurrentDirectory();
        }
    });
    
    // 全局点击事件：关闭所有右键菜单
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.context-menu')) {
            closeAllContextMenus();
        }
    });
    
    // ESC键关闭菜单
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeAllContextMenus();
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
    console.log('🔄 刷新按钮点击', { currentSessionID, currentPath });
    
    if (!currentSessionID || !currentPath) {
        console.warn('⚠️ 未连接服务器或无当前路径');
        return;
    }
    
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
    const checked = checkbox.checked;
    console.log('👁️ 切换显示隐藏文件:', checked, { currentSessionID, currentPath });
    
    setShowHiddenFiles(checked);
    
    if (currentSessionID && currentPath) {
        // 立即后台静默刷新（不清除缓存，使用stale-while-revalidate）
        console.log('🔄 静默刷新文件树...');
        const key = fileCache.makeKey(currentSessionID, currentPath);
        
        // 如果有缓存，先用缓存数据过滤显示
        if (fileCache.cache.has(key)) {
            const cached = fileCache.cache.get(key);
            const filteredFiles = filterHiddenFiles(cached.data, checked);
            renderFileTree(filteredFiles, currentPath);
        }
        
        // 后台静默刷新新数据
        fileCache.revalidateInBackground(currentSessionID, currentPath, key);
    } else {
        console.warn('⚠️ 未连接服务器或无当前路径，无法重新加载');
    }
}

// 过滤隐藏文件
function filterHiddenFiles(files, showHidden) {
    if (showHidden) {
        return files; // 显示所有
    }
    return files.filter(file => !file.name.startsWith('.')); // 隐藏.开头的
}

export async function setCurrentServer(serverID, sessionID) {
    currentServerID = serverID;
    currentSessionID = sessionID;
    
    // 本地终端特殊处理 (ID为0)
    if (serverID === 0 || serverID === '0') {
        showLocalFileWarning();
        return;
    }
    
    // 立即显示加载状态，清空旧的缓存显示
    const fileTreeContainer = document.getElementById('fileTree');
    if (fileTreeContainer) {
        fileTreeContainer.innerHTML = '<div class="file-tree-empty">📂 加载中...</div>';
    }
    
    // 设置渲染回调
    fileCache.setRenderCallback(renderFileTree);
    
    // 设置获取showHidden状态的函数
    fileCache.setShowHiddenGetter(() => showHiddenFiles);
    
    currentPath = '/root'; // 默认根目录
    await loadDirectory(currentPath);
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
    
    const fileTreeContainer = document.getElementById('fileTree');
    
    if (retryCount === 0) {
        // 第一次加载时显示加载状态（不是重试）
        fileTreeContainer.innerHTML = '<div class="file-tree-empty"><p>⏳ 加载中...</p></div>';
        // 显示全局加载状态
        if (window.updateGlobalStatus) {
            window.updateGlobalStatus('loading');
        }
    }
    
    try {
        // 使用缓存管理器：立即返回缓存 + 后台刷新
        const files = await fileCache.getOrLoad(currentSessionID, path);
        renderFileTree(files, path);
        
        // 加载成功，显示成功状态
        if (retryCount === 0 && window.updateGlobalStatus) {
            window.updateGlobalStatus('success');
        }
    } catch (error) {
        console.error('加载目录失败:', error);
        
        // 如果是SFTP未就绪，且重试次数少于5次，则等待后重试
        if (error.message && error.message.includes('SSH会话不存在') && retryCount < 5) {
            const delay = 1500 + retryCount * 1000; // 1.5s, 2.5s, 3.5s, 4.5s, 5.5s
            console.log(`⏳ SFTP未就绪，${delay/1000}秒后重试 (${retryCount + 1}/5)`);
            fileTreeContainer.innerHTML = `
                <div class="file-tree-empty">
                    <p>⏳ 等待SFTP连接...</p>
                    <p style="font-size: 10px; margin-top: 8px; color: rgba(255,255,255,0.5);">
                        正在建立连接 (${retryCount + 1}/5)
                    </p>
                    <p style="font-size: 9px; margin-top: 4px; color: rgba(255,255,255,0.3);">
                        ${(delay/1000).toFixed(1)}秒后重试...
                    </p>
                </div>
            `;
            setTimeout(() => {
                loadDirectory(path, retryCount + 1);
            }, delay);
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
            ${files.map(file => {
                const specialClass = file.is_dir ? getSpecialFolderClass(file.name) : '';
                return `
                <div class="file-item ${file.is_dir ? 'is-dir' : 'is-file'} ${specialClass}" 
                     data-path="${file.path}"
                     data-is-dir="${file.is_dir}"
                     ondblclick="window.handleFileDoubleClick('${file.path}', ${file.is_dir}, ${file.size || 0})"
                     oncontextmenu="window.showFileContextMenu(event, '${file.path}', ${file.is_dir})">
                    <span class="file-icon">${getFileIcon(file)}</span>
                    <span class="file-name">${escapeHtml(file.name)}</span>
                    ${!file.is_dir ? `<span class="file-size">${formatSize(file.size)}</span>` : ''}
                </div>
                `;
            }).join('')}
        </div>
    `;
    
    fileTreeContainer.innerHTML = html;
}

// 获取特殊文件夹的CSS类
function getSpecialFolderClass(folderName) {
    const name = folderName.toLowerCase();
    
    // 系统核心目录
    const systemFolders = ['root', 'home', 'etc', 'usr', 'var', 'opt', 'bin', 'sbin', 'lib', 'boot', 'dev', 'proc', 'sys', 'mnt', 'media'];
    if (systemFolders.includes(name)) {
        return 'folder-system';
    }
    
    // 项目目录
    const projectFolders = ['project', 'projects', 'src', 'source'];
    if (projectFolders.includes(name)) {
        return 'folder-project';
    }
    
    // 数据目录
    const dataFolders = ['data', 'database', 'backup', 'backups'];
    if (dataFolders.includes(name)) {
        return 'folder-data';
    }
    
    // 配置/日志目录
    const configFolders = ['config', 'logs', 'log', '.git', '.vscode', '.idea'];
    if (configFolders.includes(name)) {
        return 'folder-config';
    }
    
    // 构建/发布目录
    const buildFolders = ['dist', 'build', 'node_modules'];
    if (buildFolders.includes(name)) {
        return 'folder-build';
    }
    
    // 临时目录
    const tempFolders = ['tmp', 'temp', 'cache'];
    if (tempFolders.includes(name)) {
        return 'folder-temp';
    }
    
    // 资源目录
    const assetFolders = ['assets', 'static', 'public', 'uploads', 'downloads'];
    if (assetFolders.includes(name)) {
        return 'folder-assets';
    }
    
    // 测试/文档目录
    const docFolders = ['test', 'tests', 'docs', 'doc'];
    if (docFolders.includes(name)) {
        return 'folder-docs';
    }
    
    return '';
}

function getFileIcon(file) {
    if (file.is_dir) {
        // 文件夹图标
        return '<i class="fa-solid fa-folder" style="color: #fbbf24;"></i>';
    }
    
    const ext = file.name.split('.').pop().toLowerCase();
    const fileName = file.name.toLowerCase();
    
    // 特殊文件名优先匹配
    const specialFiles = {
        'dockerfile': '<i class="devicon-docker-plain colored"></i>',
        '.dockerignore': '<i class="devicon-docker-plain"></i>',
        '.gitignore': '<i class="devicon-git-plain"></i>',
        '.gitattributes': '<i class="devicon-git-plain"></i>',
        'package.json': '<i class="devicon-npm-original-wordmark colored"></i>',
        'package-lock.json': '<i class="devicon-npm-original-wordmark"></i>',
        'yarn.lock': '<i class="devicon-yarn-plain colored"></i>',
        'readme.md': '<i class="devicon-markdown-original"></i>',
    };
    
    if (specialFiles[fileName]) {
        return specialFiles[fileName];
    }
    
    // 根据扩展名匹配图标
    const iconMap = {
        // JavaScript/TypeScript
        'js': '<i class="devicon-javascript-plain colored"></i>',
        'jsx': '<i class="devicon-react-original colored"></i>',
        'ts': '<i class="devicon-typescript-plain colored"></i>',
        'tsx': '<i class="devicon-react-original colored"></i>',
        'vue': '<i class="devicon-vuejs-plain colored"></i>',
        'mjs': '<i class="devicon-javascript-plain colored"></i>',
        
        // Web
        'html': '<i class="devicon-html5-plain colored"></i>',
        'htm': '<i class="devicon-html5-plain colored"></i>',
        'css': '<i class="devicon-css3-plain colored"></i>',
        'scss': '<i class="devicon-sass-original colored"></i>',
        'sass': '<i class="devicon-sass-original colored"></i>',
        'less': '<i class="devicon-less-plain-wordmark colored"></i>',
        
        // 后端语言
        'py': '<i class="devicon-python-plain colored"></i>',
        'java': '<i class="devicon-java-plain colored"></i>',
        'class': '<i class="devicon-java-plain"></i>',
        'go': '<i class="devicon-go-original-wordmark colored"></i>',
        'cpp': '<i class="devicon-cplusplus-plain colored"></i>',
        'cc': '<i class="devicon-cplusplus-plain colored"></i>',
        'cxx': '<i class="devicon-cplusplus-plain colored"></i>',
        'c': '<i class="devicon-c-plain colored"></i>',
        'h': '<i class="devicon-c-plain"></i>',
        'hpp': '<i class="devicon-cplusplus-plain"></i>',
        'rs': '<i class="devicon-rust-original"></i>',
        'rb': '<i class="devicon-ruby-plain colored"></i>',
        'php': '<i class="devicon-php-plain colored"></i>',
        'swift': '<i class="devicon-swift-plain colored"></i>',
        'kt': '<i class="devicon-kotlin-plain colored"></i>',
        'scala': '<i class="devicon-scala-plain colored"></i>',
        'lua': '<i class="devicon-lua-plain colored"></i>',
        
        // 配置文件
        'json': '<i class="devicon-json-plain"></i>',
        'xml': '<i class="fa-solid fa-code" style="color: #ff6b35;"></i>',
        'yaml': '<i class="devicon-yaml-plain"></i>',
        'yml': '<i class="devicon-yaml-plain"></i>',
        'toml': '<i class="fa-solid fa-gear" style="color: #9ca3af;"></i>',
        'ini': '<i class="fa-solid fa-gear" style="color: #9ca3af;"></i>',
        'conf': '<i class="fa-solid fa-gear" style="color: #9ca3af;"></i>',
        'config': '<i class="fa-solid fa-gear" style="color: #9ca3af;"></i>',
        'env': '<i class="fa-solid fa-key" style="color: #fbbf24;"></i>',
        
        // 数据库
        'sql': '<i class="devicon-mysql-plain colored"></i>',
        'db': '<i class="fa-solid fa-database" style="color: #3b82f6;"></i>',
        'sqlite': '<i class="devicon-sqlite-plain colored"></i>',
        
        // 脚本
        'sh': '<i class="devicon-bash-plain"></i>',
        'bash': '<i class="devicon-bash-plain"></i>',
        'zsh': '<i class="devicon-bash-plain"></i>',
        'bat': '<i class="fa-solid fa-terminal" style="color: #6b7280;"></i>',
        'cmd': '<i class="fa-solid fa-terminal" style="color: #6b7280;"></i>',
        'ps1': '<i class="fa-solid fa-terminal" style="color: #0ea5e9;"></i>',
        
        // 文档
        'md': '<i class="devicon-markdown-original"></i>',
        'markdown': '<i class="devicon-markdown-original"></i>',
        'txt': '<i class="fa-solid fa-file-lines" style="color: #9ca3af;"></i>',
        'pdf': '<i class="fa-solid fa-file-pdf" style="color: #ef4444;"></i>',
        'doc': '<i class="fa-solid fa-file-word" style="color: #2563eb;"></i>',
        'docx': '<i class="fa-solid fa-file-word" style="color: #2563eb;"></i>',
        'xls': '<i class="fa-solid fa-file-excel" style="color: #10b981;"></i>',
        'xlsx': '<i class="fa-solid fa-file-excel" style="color: #10b981;"></i>',
        'ppt': '<i class="fa-solid fa-file-powerpoint" style="color: #f97316;"></i>',
        'pptx': '<i class="fa-solid fa-file-powerpoint" style="color: #f97316;"></i>',
        
        // 图片
        'jpg': '<i class="fa-solid fa-file-image" style="color: #8b5cf6;"></i>',
        'jpeg': '<i class="fa-solid fa-file-image" style="color: #8b5cf6;"></i>',
        'png': '<i class="fa-solid fa-file-image" style="color: #8b5cf6;"></i>',
        'gif': '<i class="fa-solid fa-file-image" style="color: #ec4899;"></i>',
        'svg': '<i class="fa-solid fa-file-image" style="color: #f59e0b;"></i>',
        'ico': '<i class="fa-solid fa-image" style="color: #06b6d4;"></i>',
        'webp': '<i class="fa-solid fa-file-image" style="color: #8b5cf6;"></i>',
        'bmp': '<i class="fa-solid fa-file-image" style="color: #8b5cf6;"></i>',
        
        // 视频/音频
        'mp4': '<i class="fa-solid fa-file-video" style="color: #ef4444;"></i>',
        'avi': '<i class="fa-solid fa-file-video" style="color: #ef4444;"></i>',
        'mov': '<i class="fa-solid fa-file-video" style="color: #ef4444;"></i>',
        'mkv': '<i class="fa-solid fa-file-video" style="color: #ef4444;"></i>',
        'mp3': '<i class="fa-solid fa-file-audio" style="color: #06b6d4;"></i>',
        'wav': '<i class="fa-solid fa-file-audio" style="color: #06b6d4;"></i>',
        'flac': '<i class="fa-solid fa-file-audio" style="color: #06b6d4;"></i>',
        
        // 压缩包
        'zip': '<i class="fa-solid fa-file-zipper" style="color: #f59e0b;"></i>',
        'tar': '<i class="fa-solid fa-file-zipper" style="color: #f59e0b;"></i>',
        'gz': '<i class="fa-solid fa-file-zipper" style="color: #f59e0b;"></i>',
        'rar': '<i class="fa-solid fa-file-zipper" style="color: #f59e0b;"></i>',
        '7z': '<i class="fa-solid fa-file-zipper" style="color: #f59e0b;"></i>',
        
        // 日志
        'log': '<i class="fa-solid fa-file-lines" style="color: #6b7280;"></i>',
        
        // Docker
        'dockerfile': '<i class="devicon-docker-plain colored"></i>',
        
        // Git
        'gitignore': '<i class="devicon-git-plain"></i>',
        
        // 其他
        'lock': '<i class="fa-solid fa-lock" style="color: #dc2626;"></i>',
        'jar': '<i class="devicon-java-plain"></i>',
        'war': '<i class="devicon-java-plain"></i>',
        'exe': '<i class="fa-solid fa-gear" style="color: #6366f1;"></i>',
        'dll': '<i class="fa-solid fa-cube" style="color: #6b7280;"></i>',
        'so': '<i class="fa-solid fa-cube" style="color: #6b7280;"></i>',
    };
    
    return iconMap[ext] || '<i class="fa-solid fa-file" style="color: #9ca3af;"></i>';
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

// 双击文件打开编辑器
window.handleFileDoubleClick = function(filePath, isDir, fileSize = 0) {
    if (isDir) {
        loadDirectory(filePath);
    } else {
        // 打开文件编辑器，传递文件大小
        openFileEditor(filePath, currentServerID, currentSessionID, fileSize);
    }
};

window.navigateUp = function(currentPath) {
    const parentPath = currentPath.split('/').slice(0, -1).join('/') || '/';
    loadDirectory(parentPath);
};

// 就地创建文件
window.createNewFile = async function(basePath) {
    closeAllContextMenus();
    
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
    closeAllContextMenus();
    
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

// 关闭所有右键菜单
function closeAllContextMenus() {
    document.querySelectorAll('.context-menu').forEach(menu => menu.remove());
}

window.showFileContextMenu = function(event, path, isDir) {
    event.preventDefault();
    
    // 先关闭所有已存在的菜单
    closeAllContextMenus();
    
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
};

// 空白区域右键菜单
function showBlankContextMenu(event, basePath) {
    // 先关闭所有已存在的菜单
    closeAllContextMenus();
    
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
}

// 复制文件
window.copyFile = function(path) {
    closeAllContextMenus();
    clipboard = { type: 'copy', path };
    showToast('已复制', 'success');
};

// 剪切文件
window.cutFile = function(path) {
    closeAllContextMenus();
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
    closeAllContextMenus();
    
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
    closeAllContextMenus();
    
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
