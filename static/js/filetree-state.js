// 文件树状态管理（避免循环导入）

let _showHiddenFiles = false;

export function getShowHiddenFiles() {
    return _showHiddenFiles;
}

export function setShowHiddenFiles(value) {
    console.log('⚙️ setShowHiddenFiles:', value, '(旧值:', _showHiddenFiles, ')');
    _showHiddenFiles = value;
    console.log('✅ showHiddenFiles已更新为:', _showHiddenFiles);
}
