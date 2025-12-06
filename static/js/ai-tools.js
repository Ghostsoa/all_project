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
    renderToolResult(toolResult, toolName, toolCallId, toolCallArgs = null) {
        console.log('🎨 renderToolResult:', { toolResult, toolName, toolCallId, success: toolResult.success });
        
        if (toolName !== 'file_operation') {
            return this.renderGenericTool(toolResult, toolName);
        }

        const { type, status, success } = toolResult;
        
        // 如果工具执行失败，显示失败状态
        if (success === false) {
            console.log('❌ 工具失败，渲染失败状态');
            return this.renderFailedTool(toolResult, toolName);
        }
        
        // 如果status是accepted或rejected，显示完成状态（不可交互）
        if (status === 'accepted' || status === 'rejected') {
            return this.renderCompletedToolResult(toolResult, toolCallId, status);
        }
        
        // 如果status是pending，需要从toolCallArgs获取完整参数
        if (status === 'pending' && toolCallArgs) {
            // 合并tool结果和tool_calls参数
            toolResult = { ...toolResult, ...toolCallArgs };
        }
        
        // 渲染pending状态（可交互）
        switch (type) {
            case 'read':
                return this.renderReadTool(toolResult);
            case 'list':
                return this.renderListTool(toolResult);
            case 'edit':
                return this.renderEditTool(toolResult, toolCallId);
            case 'write':
                return this.renderWriteTool(toolResult, toolCallId);
            default:
                return this.renderGenericTool(toolResult, toolName);
        }
    }
    
    /**
     * 渲染失败的工具
     */
    renderFailedTool(result, toolName) {
        const error = result.error || '未知错误';
        return `
            <div class="tool-call">
                <div class="tool-simple completed">
                    <span class="tool-simple-icon">❌</span>
                    &lt;${toolName}: ✗ Failed&gt; ${error}
                </div>
            </div>
        `;
    }
    
    /**
     * 渲染已完成的工具结果（accepted/rejected）
     */
    renderCompletedToolResult(result, toolCallId, status) {
        const { type, file_path } = result;
        const fileName = file_path ? file_path.split('/').pop() : 'Unknown';
        const fileIcon = this.getFileIconHTML(fileName);
        
        const statusText = status === 'accepted' ? '✓ Accepted' : '✗ Rejected';
        const statusClass = status === 'accepted' ? 'tool-status-accepted' : 'tool-status-rejected';
        const typeText = type === 'write' ? 'Create' : 'Edit';
        
        return `
            <div class="tool-call">
                <div class="tool-container" data-tool-call-id="${toolCallId}">
                    <div class="tool-header">
                        <div class="tool-file-icon">
                            ${fileIcon}
                        </div>
                        <div class="tool-file-info">
                            <div class="tool-file-name">${fileName}</div>
                            <div class="tool-file-path">${file_path || ''}</div>
                        </div>
                        <div class="tool-status">
                            <span class="tool-type-badge tool-type-${type}">${typeText}</span>
                            <span class="tool-status-badge ${statusClass}">${statusText}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
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
    renderEditTool(result, toolCallId) {
        const { server_id, file_path, operations, new_content } = result;
        const fileName = file_path.split('/').pop();
        const fileIcon = this.getFileIconHTML(fileName);
        
        console.log('📝 renderEditTool:', { toolCallId, file_path, operations, new_content });
        
        // 保存到待处理列表（使用tool_call_id作为key）
        this.pendingEdits.set(toolCallId, {
            tool_call_id: toolCallId,
            server_id,
            file_path,
            operations,
            new_content,
            status: 'pending',
            type: 'edit'
        });
        
        console.log('💾 保存到pendingEdits:', this.pendingEdits.get(toolCallId));
        
        return `
            <div class="tool-call">
                <div class="tool-container" data-tool-call-id="${toolCallId}" onclick="aiToolsManager.handleToolClick('${toolCallId}')">
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
                                <button class="tool-btn tool-btn-accept" onclick="aiToolsManager.acceptEdit('${toolCallId}')">
                                    <i class="fa-solid fa-check"></i>
                                    Accept
                                </button>
                                <button class="tool-btn tool-btn-reject" onclick="aiToolsManager.rejectEdit('${toolCallId}')">
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
    renderWriteTool(result, toolCallId) {
        const { server_id, file_path, size, content } = result;
        const fileName = file_path.split('/').pop();
        const fileIcon = this.getFileIconHTML(fileName);
        
        // 保存到待处理列表
        this.pendingEdits.set(toolCallId, {
            tool_call_id: toolCallId,
            server_id,
            file_path,
            content,
            status: 'pending',
            type: 'write'
        });
        
        return `
            <div class="tool-call">
                <div class="tool-container" data-tool-call-id="${toolCallId}" onclick="aiToolsManager.handleToolClick('${toolCallId}')">
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
                            <span class="tool-status-badge tool-status-pending">Pending</span>
                            <div class="tool-actions" onclick="event.stopPropagation()">
                                <button class="tool-btn tool-btn-accept" onclick="aiToolsManager.acceptEdit('${toolCallId}')">
                                    <i class="fa-solid fa-check"></i>
                                    Accept
                                </button>
                                <button class="tool-btn tool-btn-reject" onclick="aiToolsManager.rejectEdit('${toolCallId}')">
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
     * @param {string} toolCallId 
     */
    async handleToolClick(toolCallId) {
        console.log('🖱️ handleToolClick:', toolCallId);
        const edit = this.pendingEdits.get(toolCallId);
        console.log('📦 从pendingEdits获取:', edit);
        if (edit && edit.operations) {
            console.log('📋 operations详情:', edit.operations);
        }
        if (!edit) {
            console.error('❌ 未找到编辑信息:', toolCallId);
            return;
        }

        const { server_id, file_path } = edit;
        
        // 检查当前服务器
        const currentServerId = this.getCurrentServerId();
        console.log('🖥️ 服务器检查:', { current: currentServerId, target: server_id });
        
        if (server_id === currentServerId) {
            console.log('✅ 服务器匹配，准备打开文件');
            // 同一服务器：打开文件并显示 diff
            await this.openFileWithDiff(edit, toolCallId);
        } else {
            console.log('❌ 服务器不匹配');
            // 不同服务器：提示用户
            this.showServerMismatchNotification(server_id, currentServerId);
        }
    }

    /**
     * 打开文件并显示 diff
     * @param {Object} edit 
     */
    async openFileWithDiff(edit, toolCallId) {
        const { server_id, file_path, operations, type } = edit;
        
        console.log('🔍 打开文件并显示diff:', { file_path, server_id, type, operations });
        
        try {
            // Write 工具：没有diff，只打开文件显示内容
            if (type === 'write') {
                console.log('📝 Write工具：打开文件预览');
                // TODO: 可以显示将要创建的内容
                this.showToast('点击Accept将创建此文件', 'info');
                return;
            }
            
            // Edit 工具：需要显示diff
            if (!operations || operations.length === 0) {
                console.warn('⚠️ 没有operations数据，无法显示diff');
                this.showToast('无diff数据', 'warning');
                return;
            }
            
            // 1. 获取当前 sessionID
            const sessionID = this.getCurrentSessionId();
            console.log('🔑 获取到的sessionID:', sessionID);
            
            if (!sessionID) {
                console.error('❌ sessionID为空，无法打开文件');
                this.showToast('无法获取当前会话ID', 'error');
                return;
            }
            
            // 2. 打开文件（调用 editor.js 的函数）
            console.log('📂 准备打开文件:', { file_path, server_id, sessionID });
            
            // 本地文件
            if (server_id === 'local' || sessionID === 'local') {
                console.log('📂 打开本地文件');
                if (window.openLocalFile) {
                    await window.openLocalFile(file_path);
                } else if (window.openFile) {
                    await window.openFile(file_path);
                } else {
                    console.error('❌ 未找到本地文件打开函数');
                    this.showToast('无法打开本地文件', 'error');
                    return;
                }
            } else {
                // 远程文件
                console.log('📂 打开远程文件');
                if (window.openFileEditor) {
                    await window.openFileEditor(file_path, server_id, sessionID);
                } else if (window.openFile) {
                    await window.openFile(file_path, server_id, sessionID);
                } else {
                    console.error('❌ 未找到远程文件打开函数');
                    this.showToast('无法打开远程文件', 'error');
                    return;
                }
            }
            
            // 3. 等待编辑器加载完成（给一点时间）
            await new Promise(resolve => setTimeout(resolve, 300));
            
            // 4. 应用 diff decorations
            console.log('🎨 应用diff装饰');
            this.applyDiffDecorations(file_path, operations, toolCallId);
            
        } catch (error) {
            console.error('打开文件失败:', error);
            this.showToast('无法打开文件: ' + error.message, 'error');
        }
    }

    /**
     * 应用 diff 装饰
     * @param {string} filePath 
     * @param {Array} operations 
     * @param {string} toolCallId 
     */
    applyDiffDecorations(filePath, operations, toolCallId) {
        console.log('🎨 applyDiffDecorations:', { filePath, operations, toolCallId });
        
        // 先清除旧的装饰（如果存在）
        const existingEdit = this.pendingEdits.get(toolCallId);
        if (existingEdit && existingEdit.zoneIds) {
            console.log('🧹 清除已存在的Zone装饰');
            this.clearDiffDecorations(toolCallId);
        }
        
        // 获取对应的编辑器实例
        console.log('🔍 查找编辑器实例，getEditorByPath存在:', !!window.getEditorByPath);
        let editor = window.getEditorByPath && window.getEditorByPath(filePath);
        if (!editor) {
            console.warn('❌ 找不到编辑器实例:', filePath);
            console.log('尝试使用其他方法获取编辑器...');
            
            // 尝试从全局编辑器列表获取
            if (window.editors && window.editors[filePath]) {
                console.log('✅ 从window.editors获取编辑器');
                editor = window.editors[filePath];
            } else {
                console.error('❌ 完全无法获取编辑器实例');
                this.showToast('无法获取编辑器，请确保文件已打开', 'error');
                return;
            }
        }

        console.log('✅ 获取到编辑器实例');
        const decorations = [];
        const model = editor.getModel();
        
        console.log('📝 处理operations:', operations.length, '个操作');
        
        // 收集zone widgets
        const zoneWidgets = [];
        
        operations.forEach((op, index) => {
            const { type, start_line, end_line, old_text, new_text } = op;
            console.log(`  操作 ${index + 1}:`, { type, start_line, end_line, old_text, new_text });
            
            if (type === 'replace') {
                const oldLines = old_text.split('\n');
                const newLines = new_text.split('\n');
                const maxLines = Math.max(oldLines.length, newLines.length);
                
                // 找出所有有变化的行的索引
                const changedIndices = [];
                for (let idx = 0; idx < maxLines; idx++) {
                    const oldLine = oldLines[idx] || '';
                    const newLine = newLines[idx] || '';
                    if (oldLine !== newLine) {
                        changedIndices.push(idx);
                    }
                }
                
                if (changedIndices.length === 0) {
                    console.log('⚠️ 没有变化的行');
                    return;
                }
                
                // 把连续的变化行分组
                const groups = [];
                let currentGroup = [changedIndices[0]];
                
                for (let i = 1; i < changedIndices.length; i++) {
                    if (changedIndices[i] === changedIndices[i-1] + 1) {
                        // 连续
                        currentGroup.push(changedIndices[i]);
                    } else {
                        // 不连续，开始新组
                        groups.push(currentGroup);
                        currentGroup = [changedIndices[i]];
                    }
                }
                groups.push(currentGroup);
                
                console.log(`� 找到 ${groups.length} 组变化:`, groups);
                
                // 获取编辑器的字体配置
                const editorOptions = editor.getOptions();
                const fontSize = editorOptions.get(monaco.editor.EditorOption.fontSize);
                const fontFamily = editorOptions.get(monaco.editor.EditorOption.fontFamily);
                const lineHeight = editorOptions.get(monaco.editor.EditorOption.lineHeight);
                
                // 为每组创建一个Zone
                groups.forEach((group, groupIdx) => {
                    const firstIdx = group[0];
                    const lastIdx = group[group.length - 1];
                    
                    // 隐藏这组的原始行
                    for (let idx = firstIdx; idx <= lastIdx; idx++) {
                        if (idx < (end_line - start_line + 1)) {
                            const lineNum = start_line + idx;
                            decorations.push({
                                range: new monaco.Range(lineNum, 1, lineNum, model.getLineMaxColumn(lineNum)),
                                options: {
                                    isWholeLine: true,
                                    className: 'diff-line-hidden-for-zone'
                                }
                            });
                        }
                    }
                    
                    // 创建Zone显示这组的diff
                    const domNode = document.createElement('div');
                    domNode.className = 'diff-zone-widget';
                    domNode.style.fontSize = `${fontSize}px`;
                    domNode.style.fontFamily = fontFamily;
                    domNode.style.lineHeight = `${lineHeight}px`;
                    
                    const linesHtml = [];
                    const deletedLines = [];
                    const addedLines = [];
                    
                    // 先收集所有删除和添加的行
                    for (const idx of group) {
                        const oldLine = oldLines[idx] || '';
                        const newLine = newLines[idx] || '';
                        
                        if (oldLine) {
                            deletedLines.push(oldLine);
                        }
                        if (newLine) {
                            addedLines.push(newLine);
                        }
                    }
                    
                    // 先显示所有红色删除行
                    for (const line of deletedLines) {
                        linesHtml.push(`<div class="diff-zone-line diff-zone-deleted">${this.escapeHtml(line)}</div>`);
                    }
                    
                    // 再显示所有绿色添加行
                    for (const line of addedLines) {
                        linesHtml.push(`<div class="diff-zone-line diff-zone-added">${this.escapeHtml(line)}</div>`);
                    }
                    
                    domNode.innerHTML = linesHtml.join('');
                    console.log(`📦 组 ${groupIdx + 1} 包含 ${linesHtml.length} 行HTML`);
                    
                    const zoneWidget = {
                        domNode: domNode,
                        afterLineNumber: start_line + firstIdx - 1,
                        heightInLines: linesHtml.length,
                        suppressMouseDown: true
                    };
                    
                    zoneWidgets.push(zoneWidget);
                });
            }
        });

        console.log('🎨 应用', decorations.length, '个装饰');
        
        // 应用装饰
        const decorationIds = editor.deltaDecorations([], decorations);
        console.log('✅ 装饰已应用，ID:', decorationIds);
        
        // 应用View Zones（在行下方插入diff显示）
        const zoneIds = [];
        if (zoneWidgets.length > 0) {
            editor.changeViewZones((changeAccessor) => {
                zoneWidgets.forEach(zone => {
                    const id = changeAccessor.addZone(zone);
                    zoneIds.push(id);
                    console.log('✅ Zone Widget已添加，ID:', id);
                });
            });
        }
        
        // 保存装饰ID和Zone IDs到编辑信息中
        const edit = this.pendingEdits.get(toolCallId);
        if (edit) {
            edit.decorationIds = decorationIds;
            edit.zoneIds = zoneIds;
            edit.editorInstance = editor;
            console.log('✅ 装饰ID和Zone IDs已保存到edit对象');
        }
    }
    
    /**
     * HTML 转义
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    /**
     * 计算逐字符 diff
     * @param {string} oldText 
     * @param {string} newText 
     * @returns {object} 包含高亮的HTML
     */
    computeCharDiff(oldText, newText) {
        // 简单的逐字符对比算法
        const oldChars = oldText.split('');
        const newChars = newText.split('');
        
        let oldHtml = '';
        let newHtml = '';
        
        // 找到公共前缀
        let commonPrefix = 0;
        while (commonPrefix < oldChars.length && 
               commonPrefix < newChars.length && 
               oldChars[commonPrefix] === newChars[commonPrefix]) {
            commonPrefix++;
        }
        
        // 找到公共后缀
        let commonSuffix = 0;
        while (commonSuffix < (oldChars.length - commonPrefix) && 
               commonSuffix < (newChars.length - commonPrefix) && 
               oldChars[oldChars.length - 1 - commonSuffix] === newChars[newChars.length - 1 - commonSuffix]) {
            commonSuffix++;
        }
        
        // 构建旧文本HTML（高亮变化部分）
        oldHtml += this.escapeHtml(oldChars.slice(0, commonPrefix).join(''));
        if (commonPrefix < oldChars.length - commonSuffix) {
            oldHtml += `<span class="diff-char-deleted">${this.escapeHtml(oldChars.slice(commonPrefix, oldChars.length - commonSuffix).join(''))}</span>`;
        }
        oldHtml += this.escapeHtml(oldChars.slice(oldChars.length - commonSuffix).join(''));
        
        // 构建新文本HTML（高亮变化部分）
        newHtml += this.escapeHtml(newChars.slice(0, commonPrefix).join(''));
        if (commonPrefix < newChars.length - commonSuffix) {
            newHtml += `<span class="diff-char-added">${this.escapeHtml(newChars.slice(commonPrefix, newChars.length - commonSuffix).join(''))}</span>`;
        }
        newHtml += this.escapeHtml(newChars.slice(newChars.length - commonSuffix).join(''));
        
        return { oldHtml, newHtml };
    }

    /**
     * 接受编辑
     * @param {string} toolCallId 
     */
    async acceptEdit(toolCallId) {
        const edit = this.pendingEdits.get(toolCallId);
        if (!edit) {
            console.error('未找到编辑信息:', toolCallId);
            return;
        }

        try {
            // 1. 先执行实际的文件写入
            const { file_path, server_id, content, new_content, type } = edit;
            const writeContent = type === 'edit' ? new_content : content;
            
            let writeResponse;
            
            if (server_id === 'local') {
                // 本地文件
                writeResponse = await fetch('/api/local/files/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        path: file_path,
                        content: writeContent
                    })
                });
            } else {
                // 远程文件：获取session_id
                const sessionId = this.getSessionIdByServerId(server_id);
                if (!sessionId) {
                    this.showToast('无法获取会话ID', 'error');
                    return;
                }
                
                writeResponse = await fetch('/api/files/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        session_id: sessionId,
                        path: file_path,
                        content: writeContent
                    })
                });
            }
            
            const writeResult = await writeResponse.json();
            
            if (!writeResult.success) {
                this.showToast('文件写入失败: ' + (writeResult.error || '未知错误'), 'error');
                return;
            }
            
            // 2. 写入成功后，调用API更新数据库中的tool消息状态
            const updateResponse = await fetch('/api/ai/edit/apply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    tool_call_id: toolCallId,
                    status: 'accepted'
                })
            });

            const updateResult = await updateResponse.json();
            
            if (!updateResult.success) {
                console.warn('更新状态失败:', updateResult.error);
                // 文件已写入，状态更新失败不影响
            }
            
            // 3. 更新 UI
            this.updateToolStatus(toolCallId, 'accepted');
            
            // 清除装饰
            this.clearDiffDecorations(toolCallId);
            
            // 4. 刷新编辑器内容（如果文件已打开）
            await this.refreshEditorContent(file_path, server_id);
            
            // 移除待处理列表
            this.pendingEdits.delete(toolCallId);
            
            // 标记为已应用
            this.appliedEdits.add(toolCallId);
            this.saveAppliedEdits();
            
            this.showToast('已应用并写入文件', 'success');
        } catch (error) {
            console.error('应用编辑失败:', error);
            this.showToast('应用编辑失败: ' + error.message, 'error');
        }
    }

    /**
     * 拒绝编辑
     * @param {string} toolCallId 
     */
    async rejectEdit(toolCallId) {
        const edit = this.pendingEdits.get(toolCallId);
        if (!edit) {
            console.error('未找到编辑信息:', toolCallId);
            return;
        }

        try {
            // 调用后端 API更新状态
            const response = await fetch('/api/ai/edit/apply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    tool_call_id: toolCallId,
                    status: 'rejected'
                })
            });

            const result = await response.json();
            
            if (result.success) {
                // 更新 UI
                this.updateToolStatus(toolCallId, 'rejected');
                
                // 清除装饰
                this.clearDiffDecorations(toolCallId);
                
                // 移除待处理列表
                this.pendingEdits.delete(toolCallId);
                
                this.showToast('已拒绝编辑', 'info');
            } else {
                this.showToast('操作失败: ' + result.error, 'error');
            }
        } catch (error) {
            console.error('拒绝编辑失败:', error);
            this.showToast('操作失败: ' + error.message, 'error');
        }
    }

    // ==================== 文件打开监听 ====================
    
    /**
     * 当用户打开文件时检查是否有 pending edit
     * @param {string} filePath 
     * @param {string} serverId 
     */
    onFileOpened(filePath, serverId) {
        console.log('📂 文件已打开，检查pending edits:', { filePath, serverId });
        console.log('📋 当前pendingEdits:', this.pendingEdits);
        
        // 如果 serverId 为 null/undefined，尝试获取当前 serverId
        if (!serverId) {
            serverId = this.getCurrentServerId();
            console.log('🔧 serverId为空，使用当前serverId:', serverId);
        }
        
        // 查找该文件的 pending edit
        let found = false;
        for (const [toolCallId, edit] of this.pendingEdits.entries()) {
            console.log('🔍 检查edit:', { 
                toolCallId, 
                edit_path: edit.file_path, 
                edit_server: edit.server_id,
                match: edit.file_path === filePath && edit.server_id === serverId
            });
            
            if (edit.file_path === filePath && edit.server_id === serverId) {
                console.log('✅ 找到匹配的pending edit，延迟应用diff');
                found = true;
                // 延迟应用 diff，等待编辑器完全初始化
                setTimeout(() => {
                    console.log('⏰ 延迟后应用diff');
                    this.applyDiffDecorations(filePath, edit.operations, toolCallId);
                }, 500);
            }
        }
        
        if (!found) {
            console.log('❌ 没有找到匹配的pending edit');
        }
    }

    // ==================== 辅助方法 ====================
    
    /**
     * 更新工具状态显示
     */
    updateToolStatus(toolCallId, status) {
        const container = document.querySelector(`[data-tool-call-id="${toolCallId}"]`);
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
    clearDiffDecorations(toolCallId) {
        const edit = this.pendingEdits.get(toolCallId);
        if (edit && edit.editorInstance) {
            // 清除装饰
            if (edit.decorationIds) {
                edit.editorInstance.deltaDecorations(edit.decorationIds, []);
                delete edit.decorationIds;
            }
            // 清除View Zones
            if (edit.zoneIds && edit.zoneIds.length > 0) {
                edit.editorInstance.changeViewZones((changeAccessor) => {
                    edit.zoneIds.forEach(id => {
                        changeAccessor.removeZone(id);
                    });
                });
                delete edit.zoneIds;
            }
            delete edit.editorInstance;
        }
    }

    /**
     * 刷新编辑器内容
     */
    async refreshEditorContent(filePath, serverId) {
        console.log('🔄 刷新编辑器内容:', { filePath, serverId });
        
        // 获取编辑器实例
        const editor = window.getEditorByPath && window.getEditorByPath(filePath);
        if (!editor) {
            console.log('❌ 编辑器未打开，跳过刷新');
            return;
        }
        
        try {
            // 重新读取文件内容
            const sessionId = serverId === 'local' ? 'local' : this.getSessionIdByServerId(serverId);
            const endpoint = serverId === 'local' ? '/api/local/files/read' : '/api/files/read';
            
            const response = await fetch(`${endpoint}?${serverId === 'local' ? '' : 'session_id=' + sessionId + '&'}path=${encodeURIComponent(filePath)}`);
            const data = await response.json();
            
            if (!data.success) {
                console.error('读取文件失败:', data.error);
                return;
            }
            
            // 更新编辑器内容
            const model = editor.getModel();
            if (model) {
                model.setValue(data.content);
                console.log('✅ 编辑器内容已刷新');
            }
        } catch (error) {
            console.error('刷新编辑器失败:', error);
        }
    }

    /**
     * 获取当前服务器 ID
     */
    getCurrentServerId() {
        // 检查是否是本地模式（sessionID为'local'表示本地）
        const sessionId = this.getCurrentSessionId();
        if (sessionId === 'local') {
            return 'local';
        }
        
        // 从全局函数获取远程服务器ID
        if (window.getCurrentServerID) {
            return window.getCurrentServerID();
        }
        
        return null;
    }

    /**
     * 根据server_id获取session_id
     */
    getSessionIdByServerId(serverId) {
        // 如果是当前服务器，直接返回当前session
        const currentServerId = this.getCurrentServerId();
        if (serverId === currentServerId) {
            return this.getCurrentSessionId();
        }
        
        // 否则从state中查找
        // 注意：可能需要根据实际的状态管理方式调整
        console.warn('非当前服务器，可能无法获取session_id:', serverId);
        return null;
    }

    /**
     * 获取当前会话 ID
     */
    getCurrentSessionId() {
        // 从 filetree 模块获取当前会话ID
        if (window.getCurrentSessionID) {
            return window.getCurrentSessionID();
        }
        return null;
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
