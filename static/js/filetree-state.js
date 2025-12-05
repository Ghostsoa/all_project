// 文件树状态管理（避免循环导入）

let _showHiddenFiles = false;

export function getShowHiddenFiles() {
    return _showHiddenFiles;
}

export function setShowHiddenFiles(value) {
    _showHiddenFiles = value;
}
