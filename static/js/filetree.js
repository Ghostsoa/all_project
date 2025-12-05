// 文件树管理
import { state } from './config.js';
import { showToast } from './utils.js';
import { openFileEditor } from './editor.js';
import { fileCache } from './filecache.js';
import { showConfirm } from './modal.js';
import { getShowHiddenFiles, setShowHiddenFiles } from './filetree-state.js';

let currentServerID = null;
let currentSessionID = null; // 当前会话ID
let currentPath = '/root';
let isLocalTerminal = false; // 是否为本地终端

// 剪贴板
let clipboard = null; // {type: 'copy'|'cut', path: '...'}

// Helper: 获取正确的API端点
export function getApiEndpoint(action) {
    const prefix = isLocalTerminal ? '/api/local/files' : '/api/files';
    return `${prefix}/${action}`;
}

// 获取当前sessionID（供其他模块使用）
export function getCurrentSessionID() {
    return currentSessionID;
}

// 防止重复初始化标志
let isFileTreeInitialized = false;

// 初始化文件树
export function initFileTree() {
    const fileTreeContainer = document.getElementById('fileTree');
    if (!fileTreeContainer) return;
    
    // 防止重复初始化
    if (isFileTreeInitialized) {
        console.log('⚠️ 文件树已初始化，跳过');
        return;
    }
    
    console.log('🔧 初始化文件树...');
    isFileTreeInitialized = true;
    
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
    
    // 添加F5刷新快捷键（只绑定一次）
    document.addEventListener('keydown', (e) => {
        if (e.key === 'F5' && !e.ctrlKey && !e.shiftKey && !e.altKey) {
            e.preventDefault();
            refreshCurrentDirectory();
        }
    });
    
    // 全局点击事件：关闭所有右键菜单（只绑定一次）
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.context-menu')) {
            closeAllContextMenus();
        }
    });
    
    // ESC键关闭菜单（只绑定一次）
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
    isLocalTerminal = false; // 设置为SSH模式
    
    console.log(`📡 设置SSH服务器: ${sessionID}`);
    
    // 清空预加载队列，避免旧session的任务继续执行
    fileCache.clearPreloadQueue();
    
    // 显示文件树头部（如果之前隐藏了）
    const headerContainer = document.getElementById('fileTreeHeader');
    if (headerContainer && !headerContainer.querySelector('.filetree-header')) {
        const header = createFileTreeHeader('/root');
        headerContainer.appendChild(header);
    }
    
    // 设置API端点函数
    fileCache.setApiEndpointGetter(getApiEndpoint);
    
    currentPath = '/root'; // 默认根目录
    await loadDirectory(currentPath);
}

// 设置为本地终端模式
export async function setLocalTerminal() {
    // 如果已经是本地终端模式，无需重复初始化
    if (isLocalTerminal && currentSessionID === 'local') {
        console.log('已经是本地终端模式，跳过重复初始化');
        return;
    }
    
    isLocalTerminal = true;
    currentServerID = null;
    currentSessionID = 'local'; // 本地标识
    
    console.log('� 切换到本地终端模式');
    
    // 清空预加载队列，避免SSH session的任务继续执行
    fileCache.clearPreloadQueue();
    
    // 设置API端点getter
    fileCache.setApiEndpointGetter(getApiEndpoint);
    
    // 显示文件树头部
    const headerContainer = document.getElementById('fileTreeHeader');
    if (headerContainer && !headerContainer.querySelector('.filetree-header')) {
        // 获取用户主目录
        const response = await fetch('/api/local/files/list?path=');
        const data = await response.json();
        const homePath = data.files ? data.files[0]?.path.split('/').slice(0, -1).join('/') || 'C:\\' : 'C:\\';
        
        const header = createFileTreeHeader(homePath);
        headerContainer.appendChild(header);
        currentPath = homePath;
    }
    
    // 加载本地文件
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
    
    if (!currentSessionID && !isLocalTerminal) {
        console.log('⚠️ 未连接SSH，无法加载文件树');
        fileTreeContainer.innerHTML = '<div class="file-tree-empty"><p>请先连接服务器</p></div>';
        return;
    }
    
    // 保存当前路径到state和全局变量
    state.currentPath = path;
    currentPath = path; // 更新全局变量，用于右键菜单
    
    if (retryCount === 0) {
        // 第一次加载时显示加载状态（不是重试）
        fileTreeContainer.innerHTML = '<div class="file-tree-empty"><p>⏳ 加载中...</p></div>';
        // 显示全局加载状态
        if (window.updateGlobalStatus) {
            window.updateGlobalStatus('loading');
        }
    }
    
    try {
        let files;
        // 统一使用缓存管理器实现静默刷新（本地和SSH都用）
        files = await fileCache.getOrLoad(currentSessionID, path);
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
            <span class="file-path" title="${basePath}">${basePath}</span>
            <div class="file-actions">
                <button class="file-action-btn" onclick="window.uploadFileToDirectory('${basePath}')" title="上传文件">
                    <i class="fa-solid fa-upload"></i>
                </button>
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
        // 检查文件类型
        const ext = filePath.split('.').pop()?.toLowerCase();
        
        // 图片文件
        const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico'];
        if (imageExts.includes(ext)) {
            openMediaViewer(filePath, currentServerID, currentSessionID, 'image');
            return;
        }
        
        // 视频文件
        const videoExts = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'];
        if (videoExts.includes(ext)) {
            openMediaViewer(filePath, currentServerID, currentSessionID, 'video');
            return;
        }
        
        // 音频文件
        const audioExts = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'];
        if (audioExts.includes(ext)) {
            openMediaViewer(filePath, currentServerID, currentSessionID, 'audio');
            return;
        }
        
        // 其他文件打开编辑器
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
    
    // 防止重复调用标志
    let isCreating = false;
    
    // 处理创建
    const handleCreate = async () => {
        if (isCreating) return; // 防止重复调用
        
        const fileName = input.value.trim();
        if (!fileName) {
            tempDiv.remove();
            return;
        }
        
        isCreating = true; // 设置标志
        const filePath = basePath + '/' + fileName;
        
        // 移除临时项
        tempDiv.remove();
        
        // 直接等待后端创建，不使用乐观更新（避免重复显示）
        try {
            const response = await fetch(getApiEndpoint('create'), {
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
                // 强制刷新目录，清除缓存后重新加载
                const files = await fileCache.refresh(currentSessionID, basePath);
                renderFileTree(files, basePath);
            } else {
                showToast('创建失败: ' + data.error, 'error');
            }
        } catch (error) {
            showToast('创建失败', 'error');
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
    
    // 防止重复调用标志
    let isCreating = false;
    
    // 处理创建
    const handleCreate = async () => {
        if (isCreating) return; // 防止重复调用
        
        const folderName = input.value.trim();
        if (!folderName) {
            tempDiv.remove();
            return;
        }
        
        isCreating = true; // 设置标志
        const folderPath = basePath + '/' + folderName;
        
        // 移除临时项
        tempDiv.remove();
        
        // 直接等待后端创建，不使用乐观更新（避免重复显示）
        try {
            const response = await fetch(getApiEndpoint('create'), {
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
                // 强制刷新目录，清除缓存后重新加载
                const files = await fileCache.refresh(currentSessionID, basePath);
                renderFileTree(files, basePath);
            } else {
                showToast('创建失败: ' + data.error, 'error');
            }
        } catch (error) {
            showToast('创建失败', 'error');
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
    
    let menuHTML = `
        <div class="context-menu-item" onclick="window.copyFile('${path}')">📄 复制</div>
        <div class="context-menu-item" onclick="window.cutFile('${path}')">✂️ 剪切</div>
        <div class="context-menu-divider"></div>
    `;
    
    // 如果是文件（不是目录），添加下载选项
    if (!isDir) {
        menuHTML += `<div class="context-menu-item" onclick="window.downloadFile('${path}', '${currentSessionID}')">⬇️ 下载</div>`;
        menuHTML += `<div class="context-menu-divider"></div>`;
    }
    
    menuHTML += `
        <div class="context-menu-item" onclick="window.renameFile('${path}')">✏️ 重命名</div>
        <div class="context-menu-item" onclick="window.deleteFile('${path}')">🗑️ 删除</div>
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
    
    closeAllContextMenus();
    
    const fileName = clipboard.path.split('/').pop();
    let newPath = targetPath + '/' + fileName;
    
    // 检测是否在同一目录粘贴
    const sourcePath = clipboard.path;
    if (sourcePath === newPath && clipboard.type === 'copy') {
        // 同目录复制，添加副本后缀
        const ext = fileName.includes('.') ? fileName.substring(fileName.lastIndexOf('.')) : '';
        const baseName = ext ? fileName.substring(0, fileName.lastIndexOf('.')) : fileName;
        newPath = targetPath + '/' + baseName + '_副本' + ext;
    }
    
    try {
        if (clipboard.type === 'copy') {
            // 复制：在SSH服务器上直接执行cp命令
            const response = await fetch(getApiEndpoint('copy'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: currentSessionID,
                    source_path: clipboard.path,
                    target_path: newPath
                })
            });
            
            const data = await response.json();
            if (data.success) {
                showToast('复制成功', 'success');
                // 强制刷新当前目录
                const files = await fileCache.refresh(currentSessionID, currentPath);
                renderFileTree(files, currentPath);
            } else {
                showToast('复制失败: ' + data.error, 'error');
            }
        } else if (clipboard.type === 'cut') {
            // 剪切：重命名（移动）
            const response = await fetch(getApiEndpoint('rename'), {
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
                
                // 强制刷新当前目录
                const files = await fileCache.refresh(currentSessionID, currentPath);
                renderFileTree(files, currentPath);
                
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
    
    // 防止重复调用标志
    let isRenaming = false;
    
    // 处理重命名
    const handleRename = async () => {
        if (isRenaming) return; // 防止重复调用
        
        const newName = input.value.trim();
        if (!newName || newName === oldName) {
            input.replaceWith(nameSpan);
            return;
        }
        
        isRenaming = true; // 设置标志
        const newPath = parentPath + '/' + newName;
        
        // 先恢复输入框为原名称
        input.replaceWith(nameSpan);
        
        // 直接等待后端重命名，不使用乐观更新（避免重复显示）
        try {
            const response = await fetch(getApiEndpoint('rename'), {
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
                // 强制刷新目录，显示真实文件名
                const files = await fileCache.refresh(currentSessionID, parentPath);
                renderFileTree(files, parentPath);
            } else {
                showToast('重命名失败: ' + data.error, 'error');
            }
        } catch (error) {
            showToast('重命名失败', 'error');
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
    
    // 直接等待后端删除，不使用乐观更新（避免UI闪烁）
    try {
        const response = await fetch(getApiEndpoint('delete'), {
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
            // 强制刷新当前目录
            const files = await fileCache.refresh(currentSessionID, parentPath);
            renderFileTree(files, parentPath);
        } else {
            showToast('删除失败: ' + data.error, 'error');
        }
    } catch (error) {
        showToast('删除失败', 'error');
    }
};

// ========== 文件上传功能 ==========

// 手动选择文件上传
window.uploadFileToDirectory = function(basePath) {
    // 创建隐藏的文件input
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true; // 支持多文件
    input.style.display = 'none';
    
    input.onchange = async (e) => {
        const files = Array.from(e.target.files);
        if (files.length > 0) {
            await uploadFiles(files, basePath);
        }
        input.remove();
    };
    
    document.body.appendChild(input);
    input.click();
};

// 上传任务管理
const uploadTasks = new Map();

// 上传文件到服务器（支持进度显示和取消）
async function uploadFiles(files, targetPath) {
    if (!currentSessionID) {
        showToast('未连接到服务器', 'error');
        return;
    }
    
    // 并行上传所有文件（不阻塞UI）
    const uploadPromises = [];
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        // 生成不含小数点的taskId（避免CSS选择器错误）
        const taskId = `${Date.now()}-${i}`;
        uploadPromises.push(uploadSingleFile(file, targetPath, taskId));
        // 稍微延迟，避免taskId重复
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    // 等待所有上传完成（但不阻塞UI）
    Promise.all(uploadPromises).catch(err => {
        console.error('部分文件上传失败:', err);
    });
}

// 上传单个文件（支持分片上传）
async function uploadSingleFile(file, targetPath, taskId) {
    const filePath = targetPath === '/' ? `/${file.name}` : `${targetPath}/${file.name}`;
    const CHUNK_SIZE = 80 * 1024 * 1024; // 80MB每片，留20MB余量
    
    // 创建上传任务
    const task = {
        id: taskId,
        file: file,
        path: filePath,
        cancelled: false,
        controller: new AbortController()
    };
    uploadTasks.set(taskId, task);
    
    // 创建进度UI
    const progressUI = createUploadProgressUI(taskId, file.name, file.size);
    
    try {
        const startTime = Date.now();
        
        // 判断是否需要分片上传
        if (file.size > 100 * 1024 * 1024) {
            // 大于100MB，使用分片上传
            await uploadFileInChunks(file, filePath, taskId, task, startTime);
        } else {
            // 小于100MB，直接上传
            await uploadFileComplete(file, filePath, taskId, task, startTime);
        }
        
        // 上传成功
        console.log('Upload success, updating UI and refreshing directory:', targetPath);
        updateUploadProgress(taskId, 100, file.size, 0, 'success');
        
        // 强制刷新当前目录，清除缓存
        try {
            const files = await fileCache.refresh(currentSessionID, targetPath);
            renderFileTree(files, targetPath);
            console.log('Directory refreshed successfully');
        } catch (refreshError) {
            console.error('Failed to refresh directory:', refreshError);
            showToast('上传成功，但刷新列表失败', 'warning');
        }
        
        // 延迟移除进度UI
        setTimeout(() => {
            removeUploadProgress(taskId);
            uploadTasks.delete(taskId);
        }, 2000);
        
    } catch (error) {
        if (error.name === 'AbortError' || error.message === '已取消') {
            updateUploadProgress(taskId, 0, file.size, 0, 'cancelled');
            showToast(`已取消上传: ${file.name}`, 'info');
        } else {
            updateUploadProgress(taskId, 0, file.size, 0, 'error', error.message);
            showToast(`上传失败: ${file.name}`, 'error');
        }
        setTimeout(() => {
            removeUploadProgress(taskId);
            uploadTasks.delete(taskId);
        }, 3000);
    }
}

// 完整上传小文件（<100MB）- 使用FormData和XMLHttpRequest实现真实进度
async function uploadFileComplete(file, filePath, taskId, task, startTime) {
    return new Promise((resolve, reject) => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('session_id', currentSessionID);
        formData.append('path', filePath);
        
        const xhr = new XMLHttpRequest();
        
        // 监听上传进度
        let lastTime = Date.now();
        let lastLoaded = 0;
        
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                const progress = (e.loaded / e.total) * 100;
                
                // 计算实时速度
                const now = Date.now();
                const timeDiff = (now - lastTime) / 1000;
                const bytesDiff = e.loaded - lastLoaded;
                const speed = timeDiff > 0 ? bytesDiff / timeDiff : 0;
                
                lastTime = now;
                lastLoaded = e.loaded;
                
                updateUploadProgress(taskId, progress, file.size, speed, 'uploading');
            }
        };
        
        // 上传完成，等待服务器处理
        xhr.upload.onload = () => {
            console.log('Upload data sent, waiting for server response...');
            const speedSpan = document.querySelector(`#upload-${taskId} .upload-speed`);
            if (speedSpan) {
                speedSpan.textContent = '服务器处理中...';
            }
        };
        
        xhr.onload = () => {
            console.log('Upload complete, status:', xhr.status);
            if (xhr.status === 200) {
                try {
                    const data = JSON.parse(xhr.responseText);
                    console.log('Upload response:', data);
                    if (data.success) {
                        resolve();
                    } else {
                        reject(new Error(data.error || '上传失败'));
                    }
                } catch (e) {
                    console.error('Parse response error:', e, xhr.responseText);
                    reject(new Error('解析响应失败'));
                }
            } else {
                console.error('Upload failed with status:', xhr.status, xhr.responseText);
                reject(new Error(`上传失败: HTTP ${xhr.status}`));
            }
        };
        
        xhr.onerror = () => {
            console.error('Upload network error');
            reject(new Error('网络错误'));
        };
        xhr.onabort = () => {
            console.log('Upload aborted');
            reject(new Error('已取消'));
        };
        
        // 支持取消
        task.xhr = xhr;
        
        xhr.open('POST', getApiEndpoint('upload'), true);
        xhr.send(formData);
    });
}

// 分片上传大文件（>100MB）
async function uploadFileInChunks(file, filePath, taskId, task, startTime) {
    const CHUNK_SIZE = 80 * 1024 * 1024; // 80MB每片
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const uploadId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    
    let uploadedBytes = 0;
    let lastUpdateTime = startTime;
    
    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        if (task.cancelled) {
            throw new Error('已取消');
        }
        
        // 切片
        const start = chunkIndex * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);
        
        // 读取分片为Base64
        const chunkBase64 = await readFileAsBase64Blob(chunk);
        
        // 上传分片
        const response = await fetch(getApiEndpoint('upload-chunk'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: currentSessionID,
                path: filePath,
                upload_id: uploadId,
                chunk_index: chunkIndex,
                total_chunks: totalChunks,
                content: chunkBase64
            }),
            signal: task.controller.signal
        });
        
        if (task.cancelled) {
            throw new Error('已取消');
        }
        
        const data = await response.json();
        if (!data.success) {
            throw new Error(data.error || '分片上传失败');
        }
        
        // 更新进度
        uploadedBytes += (end - start);
        const progress = (uploadedBytes / file.size) * 100;
        
        // 计算速度
        const now = Date.now();
        const timeDiff = (now - lastUpdateTime) / 1000;
        const speed = timeDiff > 0 ? (end - start) / timeDiff : 0;
        lastUpdateTime = now;
        
        updateUploadProgress(taskId, progress, file.size, speed, 'uploading');
    }
}

// 读取Blob为Base64
function readFileAsBase64Blob(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const base64 = reader.result.split(',')[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// 创建上传进度UI
function createUploadProgressUI(taskId, fileName, fileSize) {
    const container = document.getElementById('uploadProgressContainer');
    
    const progressItem = document.createElement('div');
    progressItem.className = 'upload-progress-item';
    progressItem.id = `upload-${taskId}`;
    progressItem.innerHTML = `
        <div class="upload-header">
            <div class="upload-filename" title="${fileName}">${fileName}</div>
            <button class="upload-cancel" onclick="window.cancelUpload('${taskId}')">取消</button>
        </div>
        <div class="upload-progress-bar">
            <div class="upload-progress-fill" style="width: 0%"></div>
        </div>
        <div class="upload-info">
            <div class="upload-status">
                <span class="upload-size">0 / ${formatSize(fileSize)}</span>
                <span class="upload-speed">准备中...</span>
            </div>
            <span class="upload-percentage">0%</span>
        </div>
    `;
    
    container.appendChild(progressItem);
    return progressItem;
}

// 更新上传进度
function updateUploadProgress(taskId, progress, totalSize, speed, status, errorMsg) {
    const progressItem = document.getElementById(`upload-${taskId}`);
    if (!progressItem) return;
    
    const progressFill = progressItem.querySelector('.upload-progress-fill');
    const percentageSpan = progressItem.querySelector('.upload-percentage');
    const sizeSpan = progressItem.querySelector('.upload-size');
    const speedSpan = progressItem.querySelector('.upload-speed');
    const cancelBtn = progressItem.querySelector('.upload-cancel');
    
    // 更新进度条
    progressFill.style.width = progress + '%';
    percentageSpan.textContent = Math.round(progress) + '%';
    
    // 更新大小
    const loaded = totalSize * progress / 100;
    sizeSpan.textContent = `${formatSize(loaded)} / ${formatSize(totalSize)}`;
    
    // 更新速度
    if (speed > 0) {
        speedSpan.textContent = `${formatSize(speed)}/s`;
    }
    
    // 根据状态更新样式
    if (status === 'success') {
        progressFill.classList.add('success');
        cancelBtn.style.display = 'none';
        speedSpan.textContent = '完成';
        speedSpan.style.color = '#10b981';
    } else if (status === 'error') {
        progressFill.classList.add('error');
        cancelBtn.textContent = '关闭';
        speedSpan.textContent = errorMsg || '失败';
        speedSpan.style.color = '#ef4444';
    } else if (status === 'cancelled') {
        progressFill.style.width = '0%';
        cancelBtn.textContent = '关闭';
        speedSpan.textContent = '已取消';
        speedSpan.style.color = '#6b7280';
    }
}

// 移除上传进度UI
function removeUploadProgress(taskId) {
    const progressItem = document.getElementById(`upload-${taskId}`);
    if (progressItem) {
        progressItem.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            progressItem.remove();
        }, 300);
    }
}

// 取消上传
window.cancelUpload = function(taskId) {
    const task = uploadTasks.get(taskId);
    if (task) {
        task.cancelled = true;
        
        // 取消XMLHttpRequest
        if (task.xhr) {
            task.xhr.abort();
        }
        
        // 取消Fetch请求（分片上传）
        if (task.controller) {
            task.controller.abort();
        }
        
        // 延迟移除UI（让用户看到已取消状态）
        setTimeout(() => {
            removeUploadProgress(taskId);
            uploadTasks.delete(taskId);
        }, 1500);
    } else {
        // 如果任务已完成，直接移除UI
        removeUploadProgress(taskId);
        uploadTasks.delete(taskId);
    }
};

// 读取文件为Base64
function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            // 移除 data:*/*;base64, 前缀
            const base64 = reader.result.split(',')[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// 初始化拖拽上传功能
export function initDragUpload() {
    const fileTree = document.getElementById('fileTree');
    if (!fileTree) return;
    
    // 防止默认拖拽行为
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        fileTree.addEventListener(eventName, preventDefaults, false);
    });
    
    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }
    
    // 拖拽进入和悬停
    ['dragenter', 'dragover'].forEach(eventName => {
        fileTree.addEventListener(eventName, () => {
            fileTree.classList.add('drag-over');
        }, false);
    });
    
    // 拖拽离开
    ['dragleave', 'drop'].forEach(eventName => {
        fileTree.addEventListener(eventName, () => {
            fileTree.classList.remove('drag-over');
        }, false);
    });
    
    // 处理文件放下
    fileTree.addEventListener('drop', async (e) => {
        const dt = e.dataTransfer;
        const files = Array.from(dt.files);
        
        if (files.length > 0) {
            // 获取当前路径
            const currentPath = state.currentPath || '/';
            await uploadFiles(files, currentPath);
        }
    }, false);
}

// 添加拖拽样式
const style = document.createElement('style');
style.textContent = `
    .file-tree.drag-over {
        background: rgba(59, 130, 246, 0.1);
        border: 2px dashed rgba(59, 130, 246, 0.5);
    }
    
    .file-tree.drag-over::before {
        content: '📤 拖放文件到此处上传';
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        font-size: 16px;
        color: rgba(59, 130, 246, 0.9);
        background: rgba(0, 0, 0, 0.8);
        padding: 20px 40px;
        border-radius: 8px;
        pointer-events: none;
        z-index: 100;
    }
`;
document.head.appendChild(style);
