// AI 工具调用管理器

class AIToolsManager {
    constructor() {
        // 待处理的编辑预览
        this.pendingEdits = new Map();
        
        // 已应用的编辑（localStorage持久化）
        this.appliedEdits = new Set(
            JSON.parse(localStorage.getItem('appliedEdits') || '[]')
        );
    }

    /**
     * 获取文件图标HTML
     * @param {string} fileName 
     * @returns {string} HTML字符串
     */
    getFileIconHTML(fileName) {
        const ext = fileName.split('.').pop()?.toLowerCase();
        const iconMap = {
            'js': '<i class="devicon-javascript-plain colored"></i>',
            'ts': '<i class="devicon-typescript-plain colored"></i>',
            'jsx': '<i class="devicon-react-original colored"></i>',
            'tsx': '<i class="devicon-react-original colored"></i>',
            'vue': '<i class="devicon-vuejs-plain colored"></i>',
            'html': '<i class="devicon-html5-plain colored"></i>',
            'css': '<i class="devicon-css3-plain colored"></i>',
            'scss': '<i class="devicon-sass-original colored"></i>',
            'py': '<i class="devicon-python-plain colored"></i>',
            'java': '<i class="devicon-java-plain colored"></i>',
            'go': '<i class="devicon-go-original-wordmark colored"></i>',
            'cpp': '<i class="devicon-cplusplus-plain colored"></i>',
            'c': '<i class="devicon-c-plain colored"></i>',
            'rs': '<i class="devicon-rust-original"></i>',
            'json': '<i class="devicon-json-plain"></i>',
            'md': '<i class="devicon-markdown-original"></i>',
            'txt': '<i class="fa-solid fa-file-lines" style="color: #9ca3af;"></i>',
        };
        return iconMap[ext] || '<i class="fa-solid fa-file" style="color: #9ca3af;"></i>';
    }

    // ==================== 渲染工具调用消息 ====================
    
    /**
     * 渲染工具结果消息
     * @param {Object} toolResult - 工具返回结果
     * @param {string} toolName - 工具名称
     * @returns {string} HTML
     */
    renderToolResult(toolResult, toolName) {
        if (toolName !== 'file_operation') {
            return this.renderGenericTool(toolResult, toolName);
        }

        const { type } = toolResult;
        
        switch (type) {
            case 'read':
                return this.renderReadTool(toolResult);
            case 'list':
                return this.renderListTool(toolResult);
            case 'edit':
                return this.renderEditTool(toolResult);
            case 'write':
                return this.renderWriteTool(toolResult);
            default:
                return this.renderGenericTool(toolResult, toolName);
        }
    }

    // ==================== 简单工具（read/list）====================
    
    /**
     * 渲染 read 工具
     */
    renderReadTool(result) {
        const { file_path, size } = result;
        const fileName = file_path.split('/').pop();
        
        return `
            <div class="tool-call">
                <div class="tool-simple completed">
                    <i class="fa-solid fa-book-open tool-simple-icon"></i>
                    Read <strong>${fileName}</strong> (${this.formatSize(size)})
                </div>
            </div>
        `;
    }

    /**
     * 渲染 list 工具
     */
    renderListTool(result) {
        const { path, count } = result;
        const dirName = path.split('/').pop() || path;
        
        return `
            <div class="tool-call">
                <div class="tool-simple completed">
                    <i class="fa-solid fa-folder-open tool-simple-icon"></i>
                    List <strong>${dirName}</strong> (${count} items)
                </div>
            </div>
        `;
    }

    // ==================== 复杂工具（edit/write）====================
    
    /**
     * 渲染 edit 工具
     */
    renderEditTool(result) {
        const { preview_id, server_id, file_path, operations } = result;
        const fileName = file_path.split('/').pop();
        const fileIcon = this.getFileIconHTML(fileName);
        
        // 保存到待处理列表
        this.pendingEdits.set(preview_id, {
            preview_id,
            server_id,
            file_path,
            operations,
            status: 'pending',
            type: 'edit'
        });
        
        return `
            <div class="tool-call">
                <div class="tool-container" data-preview-id="${preview_id}" onclick="aiToolsManager.handleToolClick('${preview_id}')">
                    <div class="tool-header">
                        <div class="tool-file-icon">
                            ${fileIcon}
                        </div>
                        <div class="tool-file-info">
                            <div class="tool-file-name">${fileName}</div>
                            <div class="tool-file-path">${file_path}</div>
                        </div>
                        <div class="tool-status">
                            <span class="tool-type-badge tool-type-edit">Edit</span>
                            <span class="tool-status-badge tool-status-pending">Pending</span>
                            <div class="tool-actions" onclick="event.stopPropagation()">
                                <button class="tool-btn tool-btn-accept" onclick="aiToolsManager.acceptEdit('${preview_id}')">
                                    <i class="fa-solid fa-check"></i>
                                    Accept
                                </button>
                                <button class="tool-btn tool-btn-reject" onclick="aiToolsManager.rejectEdit('${preview_id}')">
                                    <i class="fa-solid fa-xmark"></i>
                                    Reject
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * 渲染 write 工具
     */
    renderWriteTool(result) {
        const { server_id, file_path, size } = result;
        const fileName = file_path.split('/').pop();
        const fileIcon = this.getFileIconHTML(fileName);
        
        return `
            <div class="tool-call">
                <div class="tool-container">
                    <div class="tool-header">
                        <div class="tool-file-icon">
                            ${fileIcon}
                        </div>
                        <div class="tool-file-info">
                            <div class="tool-file-name">${fileName}</div>
                            <div class="tool-file-path">${file_path}</div>
                        </div>
                        <div class="tool-status">
                            <span class="tool-type-badge tool-type-write">Create</span>
                            <span class="tool-status-badge tool-status-accepted">✓ Created (${this.formatSize(size)})</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * 通用工具渲染
     */
    renderGenericTool(result, toolName) {
        return `
            <div class="tool-call">
                <div class="tool-simple completed">
                    <i class="fa-solid fa-wrench tool-simple-icon"></i>
                    ${toolName}: ${result.success ? '✓ Success' : '✗ Failed'}
                </div>
            </div>
        `;
    }

    // ==================== 渲染执行中的工具 ====================
    
    /**
     * 渲染已完成的工具调用（用于历史消息）
     * @param {Object} toolData - {tool_call_id, name, arguments}
     * @param {Object} argsObj - 解析后的参数对象
     * @returns {string} HTML
     */
    renderToolCallCompleted(toolData, argsObj) {
        const { name } = toolData;
        
        if (name !== 'file_operation') {
            return `
                <div class="tool-call">
                    <div class="tool-simple completed">
                        <i class="fa-solid fa-check tool-simple-icon"></i>
                        ${name} completed
                    </div>
                </div>
            `;
        }

        const { type, file_path } = argsObj;

        if (type === 'read') {
            const fileName = file_path.split('/').pop();
            return `
                <div class="tool-call">
                    <div class="tool-simple completed">
                        <i class="fa-solid fa-book-open tool-simple-icon"></i>
                        Read <strong>${fileName}</strong>
                    </div>
                </div>
            `;
        } else if (type === 'list') {
            const dirName = file_path.split('/').pop() || file_path;
            return `
                <div class="tool-call">
                    <div class="tool-simple completed">
                        <i class="fa-solid fa-folder-open tool-simple-icon"></i>
                        List <strong>${dirName}</strong>
                    </div>
                </div>
            `;
        } else if (type === 'edit') {
            const fileName = file_path.split('/').pop();
            const fileIcon = this.getFileIconHTML(fileName);
            
            return `
                <div class="tool-call">
                    <div class="tool-container">
                        <div class="tool-header">
                            <div class="tool-file-icon">
                                ${fileIcon}
                            </div>
                            <div class="tool-file-info">
                                <div class="tool-file-name">${fileName}</div>
                                <div class="tool-file-path">${file_path}</div>
                            </div>
                            <div class="tool-status">
                                <span class="tool-type-badge tool-type-edit">Edit</span>
                                <span class="tool-status-badge tool-status-accepted">✓ Completed</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        } else if (type === 'write') {
            const fileName = file_path.split('/').pop();
            const fileIcon = this.getFileIconHTML(fileName);
            
            return `
                <div class="tool-call">
                    <div class="tool-container">
                        <div class="tool-header">
                            <div class="tool-file-icon">
                                ${fileIcon}
                            </div>
                            <div class="tool-file-info">
                                <div class="tool-file-name">${fileName}</div>
                                <div class="tool-file-path">${file_path}</div>
                            </div>
                            <div class="tool-status">
                                <span class="tool-type-badge tool-type-write">Create</span>
                                <span class="tool-status-badge tool-status-accepted">✓ Created</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }
        
        return '';
    }
    
    /**
     * 渲染执行中的工具调用
     * @param {Object} toolData - {tool_call_id, name, arguments}
     * @returns {string} HTML
     */
    renderExecutingTool(toolData) {
        const { name, arguments: args } = toolData;
        
        if (name !== 'file_operation') {
            return `
                <div class="tool-call">
                    <div class="tool-simple executing">
                        <i class="fa-solid fa-spinner fa-spin tool-simple-icon"></i>
                        ${name}...
                    </div>
                </div>
            `;
        }

        const argsObj = JSON.parse(args);
        const { type, file_path } = argsObj;

        if (type === 'read' || type === 'list') {
            const fileName = file_path.split('/').pop();
            const icon = type === 'read' ? 'book-open' : 'folder-open';
            const action = type === 'read' ? 'Reading' : 'Listing';
            
            return `
                <div class="tool-call">
                    <div class="tool-simple executing">
                        <i class="fa-solid fa-${icon} tool-simple-icon"></i>
                        ${action} <strong>${fileName}</strong>...
                    </div>
                </div>
            `;
        } else {
            // edit/write 显示横条 + spinner
            const fileName = file_path.split('/').pop();
            const fileIcon = this.getFileIconHTML(fileName);
            const actionType = type === 'edit' ? 'Edit' : 'Create';
            
            return `
                <div class="tool-call">
                    <div class="tool-container">
                        <div class="tool-header">
                            <div class="tool-file-icon">
                                ${fileIcon}
                            </div>
                            <div class="tool-file-info">
                                <div class="tool-file-name">${fileName}</div>
                                <div class="tool-file-path">${file_path}</div>
                            </div>
                            <div class="tool-status">
                                <div class="tool-spinner"></div>
                                <span class="tool-type-badge tool-type-${type}">${actionType}</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }
    }

    // ==================== 用户交互 ====================
    
    /**
     * 处理工具横条点击
     * @param {string} previewId 
     */
    async handleToolClick(previewId) {
        const edit = this.pendingEdits.get(previewId);
        if (!edit) return;

        const { server_id, file_path } = edit;
        
        // 检查当前服务器
        const currentServerId = this.getCurrentServerId();
        
        if (server_id === currentServerId) {
            // 同一服务器：打开文件并显示 diff
            await this.openFileWithDiff(edit);
        } else {
            // 不同服务器：提示用户
            this.showServerMismatchNotification(server_id, currentServerId);
        }
    }

    /**
     * 打开文件并显示 diff
     * @param {Object} edit 
     */
    async openFileWithDiff(edit) {
        const { server_id, file_path, operations, preview_id } = edit;
        
        try {
            // 1. 打开文件（调用 editor.js 的函数）
            if (window.openFile) {
                await window.openFile(file_path, server_id);
            }
            
            // 2. 应用 diff decorations
            this.applyDiffDecorations(file_path, operations, preview_id);
            
        } catch (error) {
            console.error('打开文件失败:', error);
            this.showToast('无法打开文件: ' + error.message, 'error');
        }
    }

    /**
     * 应用 diff 装饰
     * @param {string} filePath 
     * @param {Array} operations 
     * @param {string} previewId 
     */
    applyDiffDecorations(filePath, operations, previewId) {
        // 获取对应的编辑器实例
        const editor = window.getEditorByPath && window.getEditorByPath(filePath);
        if (!editor) {
            console.warn('找不到编辑器实例:', filePath);
            return;
        }

        const decorations = [];
        const model = editor.getModel();
        
        operations.forEach(op => {
            const { type, start_line, end_line } = op;
            
            if (type === 'replace') {
                // 高亮修改的行
                decorations.push({
                    range: new monaco.Range(start_line, 1, end_line, 1),
                    options: {
                        isWholeLine: true,
                        className: 'diff-line-modified',
                        glyphMarginClassName: 'diff-glyph-modified',
                        minimap: {
                            color: '#3b82f6',
                            position: monaco.editor.MinimapPosition.Inline
                        }
                    }
                });
            }
        });

        // 应用装饰并保存ID（用于后续清除）
        const decorationIds = editor.deltaDecorations([], decorations);
        
        // 保存装饰ID到编辑信息中
        const edit = this.pendingEdits.get(previewId);
        if (edit) {
            edit.decorationIds = decorationIds;
            edit.editorInstance = editor;
        }
    }

    /**
     * 接受编辑
     * @param {string} previewId 
     */
    async acceptEdit(previewId) {
        const edit = this.pendingEdits.get(previewId);
        if (!edit) return;

        try {
            // 调用后端 API
            const response = await fetch('/api/ai/edit/apply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ preview_id: previewId })
            });

            const result = await response.json();
            
            if (result.success) {
                // 更新 UI
                this.updateToolStatus(previewId, 'accepted');
                
                // 清除装饰
                this.clearDiffDecorations(previewId);
                
                // 移除待处理列表
                this.pendingEdits.delete(previewId);
                
                // 标记为已应用
                this.appliedEdits.add(previewId);
                this.saveAppliedEdits();
                
                this.showToast('已应用编辑', 'success');
            } else {
                this.showToast('应用失败: ' + result.error, 'error');
            }
        } catch (error) {
            console.error('应用编辑失败:', error);
            this.showToast('应用编辑失败', 'error');
        }
    }

    /**
     * 拒绝编辑
     * @param {string} previewId 
     */
    async rejectEdit(previewId) {
        const edit = this.pendingEdits.get(previewId);
        if (!edit) return;

        try {
            // 调用后端 API
            const response = await fetch('/api/ai/edit/reject', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ preview_id: previewId })
            });

            const result = await response.json();
            
            if (result.success) {
                // 更新 UI
                this.updateToolStatus(previewId, 'rejected');
                
                // 清除装饰
                this.clearDiffDecorations(previewId);
                
                // 移除待处理列表
                this.pendingEdits.delete(previewId);
                
                this.showToast('已拒绝编辑', 'info');
            } else {
                this.showToast('操作失败: ' + result.error, 'error');
            }
        } catch (error) {
            console.error('拒绝编辑失败:', error);
            this.showToast('操作失败', 'error');
        }
    }

    // ==================== 文件打开监听 ====================
    
    /**
     * 当用户打开文件时检查是否有 pending edit
     * @param {string} filePath 
     * @param {string} serverId 
     */
    onFileOpened(filePath, serverId) {
        // 查找该文件的 pending edit
        for (const [previewId, edit] of this.pendingEdits.entries()) {
            if (edit.file_path === filePath && edit.server_id === serverId) {
                // 自动显示 diff
                this.applyDiffDecorations(filePath, edit.operations, previewId);
            }
        }
    }

    // ==================== 辅助方法 ====================
    
    /**
     * 更新工具状态显示
     */
    updateToolStatus(previewId, status) {
        const container = document.querySelector(`[data-preview-id="${previewId}"]`);
        if (!container) return;

        const statusBadge = container.querySelector('.tool-status-badge');
        const actions = container.querySelector('.tool-actions');
        
        if (statusBadge) {
            statusBadge.className = `tool-status-badge tool-status-${status}`;
            statusBadge.textContent = status === 'accepted' ? '✓ Accepted' : '✗ Rejected';
        }
        
        if (actions) {
            actions.remove();
        }
    }

    /**
     * 清除 diff 装饰
     */
    clearDiffDecorations(previewId) {
        const edit = this.pendingEdits.get(previewId);
        if (edit && edit.editorInstance && edit.decorationIds) {
            edit.editorInstance.deltaDecorations(edit.decorationIds, []);
        }
    }

    /**
     * 获取当前服务器ID
     */
    getCurrentServerId() {
        // 从全局状态获取当前服务器ID
        // local 或远程服务器ID
        if (window.currentSessionId === 'local') {
            return 'local';
        }
        const session = window.state?.terminals?.get(window.currentSessionId);
        return session?.server?.id || null;
    }

    /**
     * 显示服务器不匹配通知
     */
    showServerMismatchNotification(targetServerId, currentServerId) {
        const targetName = targetServerId === 'local' ? '本地' : `服务器 ${targetServerId}`;
        const currentName = currentServerId === 'local' ? '本地' : `服务器 ${currentServerId}`;
        
        this.showToast(
            `此文件在 ${targetName}，当前在 ${currentName}。请先切换到对应服务器。`,
            'warning'
        );
    }

    /**
     * 格式化文件大小
     */
    formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    /**
     * 显示提示
     */
    showToast(message, type = 'info') {
        if (window.showToast) {
            window.showToast(message, type);
        } else {
            console.log(`[${type}] ${message}`);
        }
    }

    /**
     * 保存已应用的编辑
     */
    saveAppliedEdits() {
        localStorage.setItem('appliedEdits', JSON.stringify([...this.appliedEdits]));
    }
}

// 全局实例
window.aiToolsManager = new AIToolsManager();

export default window.aiToolsManager;
