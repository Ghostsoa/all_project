// AI 工具调用管理器

class AIToolsManager {
    constructor() {
        // 待处理的编辑预览
        this.pendingEdits = new Map();
        
        // 已应用的编辑（localStorage持久化）
        this.appliedEdits = new Set(
            JSON.parse(localStorage.getItem('appliedEdits') || '[]')
        );
        
        // 初始化Pending Actions Bar显示
        setTimeout(() => this.updatePendingActionsBar(), 100);
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
        
        // code_search特殊处理
        if (toolName === 'code_search') {
            return this.renderCodeSearchTool(toolResult, toolCallId);
        }
        
        // baidu_search特殊处理
        if (toolName === 'baidu_search') {
            return this.renderBaiduSearchTool(toolResult, toolCallId);
        }
        
        // read_url_content特殊处理
        if (toolName === 'read_url_content') {
            return this.renderReadURLContentTool(toolResult, toolCallId);
        }
        
        // 文件操作工具列表
        const fileOperationTools = ['read_file', 'write_file', 'edit_file', 'list_directory', 'grep_search', 'find_files'];
        
        if (!fileOperationTools.includes(toolName)) {
            return this.renderGenericTool(toolResult, toolName);
        }

        // 从工具名称提取type（read_file → read, list_directory → list）
        const typeMap = {
            'read_file': 'read',
            'write_file': 'write',
            'edit_file': 'edit',
            'list_directory': 'list',
            'grep_search': 'grep',
            'find_files': 'find'
        };
        const type = typeMap[toolName];

        const { status, success } = toolResult;
        
        // 如果工具执行失败，显示失败状态
        if (success === false) {
            console.log('❌ 工具失败，渲染失败状态');
            return this.renderFailedTool(toolResult, toolName);
        }
        
        // 如果status是accepted或rejected，显示完成状态（不可交互）
        if (status === 'accepted' || status === 'rejected') {
            // 确保toolResult包含type
            toolResult = { ...toolResult, type };
            return this.renderCompletedToolResult(toolResult, toolCallId, status);
        }
        
        // 如果status是pending，需要从toolCallArgs获取完整参数
        if (status === 'pending' && toolCallArgs) {
            // 合并tool结果和tool_calls参数
            toolResult = { ...toolResult, ...toolCallArgs, type };
            
            // 对于 edit_file，需要将 old_string/new_string 包装成 operations 数组
            if (type === 'edit' && toolCallArgs.old_string && toolCallArgs.new_string) {
                toolResult.operations = [{
                    old_string: toolCallArgs.old_string,
                    new_string: toolCallArgs.new_string
                }];
            }
        }
        
        // 渲染pending状态（可交互）
        switch (type) {
            case 'read':
                return this.renderReadTool(toolResult);
            case 'list':
                return this.renderListTool(toolResult);
            case 'grep':
                return this.renderGrepTool(toolResult);
            case 'find':
                return this.renderFindTool(toolResult);
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
        
        const statusText = status === 'accepted' ? '✓' : '✗';
        const statusColor = status === 'accepted' ? '#10b981' : '#ef4444';
        
        return `
            <div class="tool-call">
                <div class="tool-card tool-card-completed" data-tool-call-id="${toolCallId}">
                    <div class="tool-card-left">
                        <span class="tool-card-icon">${fileIcon}</span>
                        <span class="tool-card-name">${fileName}</span>
                    </div>
                    <div class="tool-card-right">
                        <span class="tool-card-status" style="color: ${statusColor}">${statusText}</span>
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
        const { file_path, size, start_line, end_line, total_lines } = result;
        const fileName = file_path.split('/').pop();
        
        // 构建行号范围显示
        let lineRange = '';
        if (start_line && end_line) {
            if (start_line === 1 && end_line === total_lines) {
                // 读取整个文件
                lineRange = ` (${total_lines} lines)`;
            } else {
                // 读取部分行
                lineRange = ` <span style="color: rgba(255,255,255,0.5);">#L${start_line}-${end_line}</span>`;
            }
        }
        
        return `
            <div class="tool-call">
                <div class="tool-simple completed">
                    <i class="fa-solid fa-book-open tool-simple-icon"></i>
                    Read <strong>${fileName}</strong>${lineRange}
                </div>
            </div>
        `;
    }

    /**
     * 渲染 list 工具
     */
    renderListTool(result) {
        const { file_path, items = [], truncated, truncated_msg } = result;
        const count = items.length;
        const dirName = file_path ? file_path.split('/').pop() || file_path : 'directory';
        
        // 生成唯一ID用于折叠
        const resultId = `list-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        // 渲染文件列表
        let filesHTML = '';
        if (items.length > 0) {
            filesHTML = items.map(file => {
                const icon = file.is_dir ? 'fa-folder' : 'fa-file';
                const sizeText = file.is_dir ? 'dir' : this.formatSize(file.size);
                
                return `
                    <div class="find-file-item">
                        <i class="fa-solid ${icon} find-file-icon"></i>
                        <span class="find-file-path">${file.name}</span>
                        <span class="find-file-size">${sizeText}</span>
                    </div>
                `;
            }).join('');
        }
        
        // 截断提示
        const truncatedWarning = truncated ? `<div class="tool-truncated-warning">${truncated_msg}</div>` : '';
        
        return `
            <div class="tool-call">
                <div class="tool-result-expandable">
                    <div class="tool-result-header" onclick="this.parentElement.classList.toggle('expanded')">
                        <i class="fa-solid fa-folder-open tool-result-icon"></i>
                        <span class="tool-result-title">
                            list "<strong>${dirName}</strong>"
                        </span>
                        <span class="tool-result-count">${count} items</span>
                        <i class="fa-solid fa-chevron-down tool-result-toggle"></i>
                    </div>
                    <div class="tool-result-content" id="${resultId}">
                        ${truncatedWarning}
                        ${filesHTML || '<div class="grep-no-matches">Empty directory</div>'}
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * 渲染 grep 工具（内容搜索）
     */
    renderGrepTool(result) {
        const { query, path, file_count, match_count, matches = [], is_regex, truncated, truncated_msg } = result;
        const searchType = is_regex ? 'Regex' : 'Text';
        
        // 生成唯一ID用于折叠
        const resultId = `grep-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        // 渲染匹配列表（带上下文）
        let matchesHTML = '';
        if (matches.length > 0) {
            matchesHTML = matches.map(match => {
                const relativePath = match.file_path.replace(/\\/g, '/');
                const displayPath = relativePath.length > 60 ? '...' + relativePath.slice(-57) : relativePath;
                
                // 渲染上下文
                let contextHTML = '';
                if (match.context_before && match.context_before.length > 0) {
                    contextHTML += match.context_before.map((line, idx) => 
                        `<div class="grep-context-line">${match.line - match.context_before.length + idx}: ${this.escapeHtml(line)}</div>`
                    ).join('');
                }
                contextHTML += `<div class="grep-match-line-content">${match.line}: ${this.escapeHtml(match.content)}</div>`;
                if (match.context_after && match.context_after.length > 0) {
                    contextHTML += match.context_after.map((line, idx) => 
                        `<div class="grep-context-line">${match.line + idx + 1}: ${this.escapeHtml(line)}</div>`
                    ).join('');
                }
                
                return `
                    <div class="grep-match-item">
                        <div class="grep-match-header">
                            <span class="grep-match-path">${displayPath}</span>
                            <span class="grep-match-line">#${match.line}</span>
                        </div>
                        <div class="grep-match-context">
                            ${contextHTML}
                        </div>
                    </div>
                `;
            }).join('');
        }
        
        // 截断提示
        const truncatedWarning = truncated ? `<div class="tool-truncated-warning">${truncated_msg}</div>` : '';
        
        return `
            <div class="tool-call">
                <div class="tool-result-expandable">
                    <div class="tool-result-header" onclick="this.parentElement.classList.toggle('expanded')">
                        <i class="fa-solid fa-magnifying-glass tool-result-icon"></i>
                        <span class="tool-result-title">
                            ${searchType} grep "<strong>${query}</strong>"
                        </span>
                        <span class="tool-result-count">${match_count} matches in ${file_count} files</span>
                        <i class="fa-solid fa-chevron-down tool-result-toggle"></i>
                    </div>
                    <div class="tool-result-content" id="${resultId}">
                        ${truncatedWarning}
                        ${matchesHTML || '<div class="grep-no-matches">No matches found</div>'}
                    </div>
                </div>
            </div>
        `;
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * 渲染 find 工具（文件名查找）
     */
    renderFindTool(result) {
        const { pattern, path, count, results = [], truncated, truncated_msg } = result;
        
        // 生成唯一ID用于折叠
        const resultId = `find-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        // 渲染文件列表
        let filesHTML = '';
        if (results.length > 0) {
            filesHTML = results.map(file => {
                const relativePath = file.path.replace(/\\/g, '/');
                const displayPath = relativePath.length > 60 ? '...' + relativePath.slice(-57) : relativePath;
                const icon = file.is_dir ? 'fa-folder' : 'fa-file';
                const sizeText = file.is_dir ? 'dir' : this.formatSize(file.size);
                
                return `
                    <div class="find-file-item">
                        <i class="fa-solid ${icon} find-file-icon"></i>
                        <span class="find-file-path">${displayPath}</span>
                        <span class="find-file-size">${sizeText}</span>
                    </div>
                `;
            }).join('');
        }
        
        // 截断提示
        const truncatedWarning = truncated ? `<div class="tool-truncated-warning">${truncated_msg}</div>` : '';
        
        return `
            <div class="tool-call">
                <div class="tool-result-expandable">
                    <div class="tool-result-header" onclick="this.parentElement.classList.toggle('expanded')">
                        <i class="fa-solid fa-file-magnifying-glass tool-result-icon"></i>
                        <span class="tool-result-title">
                            find "<strong>${pattern}</strong>"
                        </span>
                        <span class="tool-result-count">${count} files</span>
                        <i class="fa-solid fa-chevron-down tool-result-toggle"></i>
                    </div>
                    <div class="tool-result-content" id="${resultId}">
                        ${truncatedWarning}
                        ${filesHTML || '<div class="grep-no-matches">No files found</div>'}
                    </div>
                </div>
            </div>
        `;
    }

    // ==================== 复杂工具（edit/write）====================
    
    /**
     * 渲染 edit 工具
     */
    renderEditTool(result, toolCallId) {
        const { server_id, file_path, operations, lines_deleted = 0, lines_added = 0 } = result;
        const fileName = file_path.split('/').pop();
        const fileIcon = this.getFileIconHTML(fileName);
        
        console.log('📝 renderEditTool:', { toolCallId, file_path, operations, lines_deleted, lines_added });
        
        // 保存到待处理列表（使用tool_call_id作为key）
        // 注意：new_content存储在后端pending state中，Accept时后端会读取
        this.pendingEdits.set(toolCallId, {
            tool_call_id: toolCallId,
            server_id,
            file_path,
            operations,
            status: 'pending',
            type: 'edit'
        });
        
        console.log('💾 保存到pendingEdits:', this.pendingEdits.get(toolCallId));
        
        // 自动检查并应用到已打开的编辑器
        setTimeout(() => {
            this.autoApplyToOpenEditor(toolCallId);
        }, 100);
        
        // 更新Pending Actions Bar
        this.updatePendingActionsBar();
        
        return `
            <div class="tool-call">
                <div class="tool-card" data-tool-call-id="${toolCallId}" onclick="aiToolsManager.handleToolClick('${toolCallId}')">
                    <div class="tool-card-left">
                        <span class="tool-card-icon">${fileIcon}</span>
                        <span class="tool-card-name">${fileName}</span>
                    </div>
                    <div class="tool-card-right">
                        ${lines_added > 0 ? `<span class="tool-card-stat added">+${lines_added}</span>` : ''}
                        ${lines_deleted > 0 ? `<span class="tool-card-stat deleted">-${lines_deleted}</span>` : ''}
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * 渲染 write 工具
     */
    renderWriteTool(result, toolCallId) {
        const { server_id, file_path, size, content, total_lines = 0 } = result;
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
        
        // 更新Pending Actions Bar
        this.updatePendingActionsBar();
        
        return `
            <div class="tool-call">
                <div class="tool-card" data-tool-call-id="${toolCallId}" onclick="aiToolsManager.handleToolClick('${toolCallId}')">
                    <div class="tool-card-left">
                        <span class="tool-card-icon">${fileIcon}</span>
                        <span class="tool-card-name">${fileName}</span>
                    </div>
                    <div class="tool-card-right">
                        <span class="tool-card-stat added">+${total_lines}</span>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * 渲染code_search工具结果（简洁列表格式）
     */
    renderCodeSearchTool(result, toolCallId) {
        // code_search返回纯文本，包含XML格式的代码片段
        const resultText = typeof result === 'string' ? result : (result.content || result.result || '');
        
        // 解析<file>标签
        const filePattern = /<file name="([^"]+)" start_line="(\d+)" end_line="(\d+)" full_length="(\d+)">/g;
        const files = [];
        let match;
        
        while ((match = filePattern.exec(resultText)) !== null) {
            files.push({
                path: match[1],
                startLine: parseInt(match[2]),
                endLine: parseInt(match[3]),
                fullLength: parseInt(match[4])
            });
        }
        
        if (files.length === 0) {
            // 没有找到文件标签，显示原始内容或提示
            if (resultText && resultText.trim().length > 0) {
                return `
                    <div class="tool-call">
                        <div class="tool-simple completed">
                            <i class="fa-solid fa-magnifying-glass-chart tool-simple-icon"></i>
                            code_search (查看详情)
                        </div>
                        <div style="white-space: pre-wrap; font-family: monospace; font-size: 12px; color: rgba(255,255,255,0.7); padding: 8px; background: rgba(0,0,0,0.2); border-radius: 4px; margin-top: 4px;">
                            ${this.escapeHtml(resultText)}
                        </div>
                    </div>
                `;
            }
            return `
                <div class="tool-call">
                    <div class="tool-simple completed">
                        <i class="fa-solid fa-magnifying-glass-chart tool-simple-icon"></i>
                        code_search: No results
                    </div>
                </div>
            `;
        }
        
        // 渲染文件列表（类似grep结果）
        const resultId = `code-search-${toolCallId}`;
        const filesHTML = files.map((file, index) => {
            const fileName = file.path.split('/').pop() || file.path;
            const fileIcon = this.getFileIconHTML(fileName);
            const lineRange = `${file.startLine}-${file.endLine}`;
            
            return `
                <div class="grep-match-item">
                    <i class="${fileIcon} grep-match-icon"></i>
                    <span class="grep-match-path">${this.escapeHtml(file.path)}</span>
                    <span class="grep-match-line">lines ${lineRange}</span>
                </div>
            `;
        }).join('');
        
        return `
            <div class="tool-call">
                <div class="tool-result-expandable">
                    <div class="tool-result-header" onclick="this.parentElement.classList.toggle('expanded')">
                        <i class="fa-solid fa-magnifying-glass-chart tool-result-icon"></i>
                        <span class="tool-result-title">
                            code_search
                        </span>
                        <span class="tool-result-count">${files.length} snippets</span>
                        <i class="fa-solid fa-chevron-down tool-result-toggle"></i>
                    </div>
                    <div class="tool-result-content" id="${resultId}">
                        ${filesHTML}
                    </div>
                </div>
            </div>
        `;
    }
    
    /**
     * 渲染baidu_search工具结果（展开式搜索结果列表）
     */
    renderBaiduSearchTool(result, toolCallId) {
        // 获取结果文本（result应该是JSON字符串）
        let resultText = typeof result === 'string' ? result : (result.content || result.result || '');
        
        // 解析JSON格式的搜索结果
        let searchData;
        try {
            searchData = JSON.parse(resultText);
        } catch (e) {
            console.error('❌ 解析百度搜索结果失败:', e);
            console.error('原始内容(前200字符):', resultText.substring(0, 200));
            return `
                <div class="tool-call">
                    <div class="tool-simple completed">
                        <i class="fa-solid fa-magnifying-glass tool-simple-icon"></i>
                        baidu_search: 解析结果失败
                    </div>
                </div>
            `;
        }
        
        const { query, count, results } = searchData;
        
        // 如果没有搜索结果
        if (!results || results.length === 0) {
            return `
                <div class="tool-call">
                    <div class="tool-simple completed">
                        <i class="fa-solid fa-magnifying-glass tool-simple-icon"></i>
                        baidu_search: "${this.escapeHtml(query)}" - 未找到相关结果
                    </div>
                </div>
            `;
        }
        
        // 渲染搜索结果列表
        const resultId = `baidu-search-${toolCallId}`;
        const resultsHTML = results.map((item) => {
            // 限制标题长度
            const title = item.title.length > 60 ? item.title.substring(0, 60) + '...' : item.title;
            // 限制内容长度
            const content = item.content && item.content.length > 100 
                ? item.content.substring(0, 100) + '...' 
                : (item.content || '');
            
            return `
                <div class="search-result-item">
                    <div class="search-result-header">
                        <span class="search-result-number">[${item.id}]</span>
                        <a href="${this.escapeHtml(item.url)}" target="_blank" class="search-result-title" title="${this.escapeHtml(item.title)}">
                            ${this.escapeHtml(title)}
                        </a>
                    </div>
                    ${content ? `<div class="search-result-content">${this.escapeHtml(content)}</div>` : ''}
                    ${item.date ? `<div class="search-result-date">📅 ${this.escapeHtml(item.date)}</div>` : ''}
                </div>
            `;
        }).join('');
        
        return `
            <div class="tool-call">
                <div class="tool-result-expandable expanded">
                    <div class="tool-result-header" onclick="this.parentElement.classList.toggle('expanded')">
                        <i class="fa-solid fa-magnifying-glass tool-result-icon"></i>
                        <span class="tool-result-title">
                            "${this.escapeHtml(query)}"
                        </span>
                        <span class="tool-result-count">${count} 条结果</span>
                        <i class="fa-solid fa-chevron-down tool-result-toggle"></i>
                    </div>
                    <div class="tool-result-content" id="${resultId}">
                        ${resultsHTML}
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * 渲染read_url_content工具结果（可展开式）
     */
    renderReadURLContentTool(result, toolCallId) {
        let resultText = typeof result === 'string' ? result : (result.content || result.result || '');
        
        // 解析JSON格式的结果
        let urlData;
        try {
            urlData = JSON.parse(resultText);
        } catch (e) {
            console.error('❌ 解析URL内容结果失败:', e);
            return `
                <div class="tool-call">
                    <div class="tool-simple completed">
                        <i class="fa-solid fa-link tool-simple-icon"></i>
                        read_url_content: 解析结果失败
                    </div>
                </div>
            `;
        }
        
        const { type, url, title, content, meta } = urlData;
        
        // 根据类型选择不同的渲染方式
        if (type === 'github_repo') {
            return this.renderGitHubRepo(urlData, toolCallId);
        } else if (type === 'github_file') {
            return this.renderGitHubFile(urlData, toolCallId);
        } else {
            return this.renderWebPage(urlData, toolCallId);
        }
    }
    
    /**
     * 渲染GitHub仓库
     */
    renderGitHubRepo(data, toolCallId) {
        const { url, title, content, meta } = data;
        const { owner, repo, description, stars, forks, language, topics, tree } = meta || {};
        
        // 构建头部信息
        let headerInfo = '';
        if (stars !== undefined) {
            headerInfo += `⭐ ${this.formatNumber(stars)}`;
        }
        if (forks !== undefined) {
            headerInfo += ` | 🍴 ${this.formatNumber(forks)}`;
        }
        if (language) {
            headerInfo += ` | ${this.escapeHtml(language)}`;
        }
        
        const resultId = `url-content-${toolCallId}`;
        
        return `
            <div class="tool-call">
                <div class="tool-result-expandable">
                    <div class="tool-result-header" onclick="this.parentElement.classList.toggle('expanded')">
                        <i class="fa-brands fa-github tool-result-icon"></i>
                        <span class="tool-result-title">
                            ${this.escapeHtml(title || url)}
                        </span>
                        <span class="tool-result-count">${headerInfo}</span>
                        <i class="fa-solid fa-chevron-down tool-result-toggle"></i>
                    </div>
                    <div class="tool-result-content" id="${resultId}">
                        <div class="url-content-body">
                            ${this.renderMarkdown(content)}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
    
    /**
     * 渲染GitHub文件
     */
    renderGitHubFile(data, toolCallId) {
        const { url, title, content, meta } = data;
        const { owner, repo, path, size } = meta || {};
        
        const sizeText = size ? this.formatFileSize(size) : '';
        const resultId = `url-content-${toolCallId}`;
        
        return `
            <div class="tool-call">
                <div class="tool-result-expandable">
                    <div class="tool-result-header" onclick="this.parentElement.classList.toggle('expanded')">
                        <i class="fa-solid fa-file-code tool-result-icon"></i>
                        <span class="tool-result-title">
                            ${this.escapeHtml(title || path)}
                        </span>
                        <span class="tool-result-count">${owner}/${repo} ${sizeText}</span>
                        <i class="fa-solid fa-chevron-down tool-result-toggle"></i>
                    </div>
                    <div class="tool-result-content" id="${resultId}">
                        <div class="url-content-code">
                            <pre><code>${this.escapeHtml(content)}</code></pre>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
    
    /**
     * 渲染普通网页
     */
    renderWebPage(data, toolCallId) {
        const { url, title, content, meta } = data;
        const { author, site_name } = meta || {};
        
        let headerInfo = '';
        if (site_name) {
            headerInfo += this.escapeHtml(site_name);
        }
        if (author) {
            headerInfo += (headerInfo ? ' | ' : '') + this.escapeHtml(author);
        }
        
        const resultId = `url-content-${toolCallId}`;
        
        return `
            <div class="tool-call">
                <div class="tool-result-expandable">
                    <div class="tool-result-header" onclick="this.parentElement.classList.toggle('expanded')">
                        <i class="fa-solid fa-globe tool-result-icon"></i>
                        <span class="tool-result-title">
                            ${this.escapeHtml(title || url)}
                        </span>
                        <span class="tool-result-count">${headerInfo}</span>
                        <i class="fa-solid fa-chevron-down tool-result-toggle"></i>
                    </div>
                    <div class="tool-result-content" id="${resultId}">
                        <div class="url-content-body">
                            <div style="white-space: pre-wrap; line-height: 1.6;">${this.escapeHtml(content)}</div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
    
    /**
     * 简单的Markdown渲染（基础支持）
     */
    renderMarkdown(markdown) {
        if (!markdown) return '';
        
        let html = this.escapeHtml(markdown);
        
        // 代码块
        html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
        
        // 标题
        html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
        html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
        
        // 粗体
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        
        // 链接
        html = html.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank">$1</a>');
        
        // 换行
        html = html.replace(/\n/g, '<br>');
        
        return html;
    }
    
    /**
     * 格式化数字（1000 -> 1K）
     */
    formatNumber(num) {
        if (num >= 1000000) {
            return (num / 1000000).toFixed(1) + 'M';
        }
        if (num >= 1000) {
            return (num / 1000).toFixed(1) + 'K';
        }
        return num.toString();
    }
    
    /**
     * 格式化文件大小
     */
    formatFileSize(bytes) {
        if (bytes >= 1024 * 1024) {
            return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
        }
        if (bytes >= 1024) {
            return (bytes / 1024).toFixed(1) + 'KB';
        }
        return bytes + 'B';
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
        
        // 文件操作工具列表
        const fileOperationTools = ['read_file', 'write_file', 'edit_file', 'list_directory', 'grep_search', 'find_files'];
        
        // 非文件操作工具，显示简单样式
        if (!fileOperationTools.includes(name)) {
            return `
                <div class="tool-call">
                    <div class="tool-simple completed">
                        <i class="fa-solid fa-check tool-simple-icon"></i>
                        ${name} completed
                    </div>
                </div>
            `;
        }

        // 从工具名提取type
        const typeMap = {
            'read_file': 'read',
            'write_file': 'write',
            'edit_file': 'edit',
            'list_directory': 'list',
            'grep_search': 'grep',
            'find_files': 'find'
        };
        const type = typeMap[name];
        
        const { file_path, directory_path } = argsObj;

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
            const dirName = (directory_path || file_path).split('/').pop() || '/';
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
        
        // 文件操作工具列表
        const fileOperationTools = ['read_file', 'write_file', 'edit_file', 'list_directory', 'grep_search', 'find_files'];
        
        // 非文件操作工具，显示简单样式
        if (!fileOperationTools.includes(name)) {
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
        
        // 从工具名提取type
        const typeMap = {
            'read_file': 'read',
            'write_file': 'write',
            'edit_file': 'edit',
            'list_directory': 'list',
            'grep_search': 'grep',
            'find_files': 'find'
        };
        const type = typeMap[name];
        
        const { file_path, directory_path, search_path, query, pattern } = argsObj;

        if (type === 'read' || type === 'list' || type === 'grep' || type === 'find') {
            let icon, action, displayText;
            
            if (type === 'read') {
                const fileName = file_path.split('/').pop();
                icon = 'book-open';
                action = 'Reading';
                displayText = fileName;
            } else if (type === 'list') {
                const dirName = (directory_path || file_path).split('/').pop() || '/';
                icon = 'folder-open';
                action = 'Listing';
                displayText = dirName;
            } else if (type === 'grep') {
                icon = 'magnifying-glass';
                action = 'Searching';
                displayText = `"${query}"`;
            } else if (type === 'find') {
                icon = 'file-magnifying-glass';
                action = 'Finding';
                displayText = `"${pattern}"`;
            }
            
            return `
                <div class="tool-call">
                    <div class="tool-simple executing">
                        <i class="fa-solid fa-${icon} tool-simple-icon"></i>
                        ${action} <strong>${displayText}</strong>...
                    </div>
                </div>
            `;
        } else {
            // edit/write 显示卡片 + spinner
            const fileName = file_path.split('/').pop();
            const fileIcon = this.getFileIconHTML(fileName);
            
            return `
                <div class="tool-call">
                    <div class="tool-card tool-card-loading">
                        <div class="tool-card-left">
                            <span class="tool-card-icon">${fileIcon}</span>
                            <span class="tool-card-name">${fileName}</span>
                        </div>
                        <div class="tool-card-right">
                            <div class="tool-spinner"></div>
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
        
        // 先清除同一文件的所有pending装饰（避免叠加显示）
        for (const [existingToolCallId, edit] of this.pendingEdits.entries()) {
            if (edit.file_path === filePath && edit.status === 'pending' && edit.zoneIds) {
                console.log('🧹 清除旧的diff装饰:', existingToolCallId);
                this.clearDiffDecorations(existingToolCallId);
            }
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
                
                // 从后往前为每组创建Zone（避免行号偏移）
                for (let groupIdx = groups.length - 1; groupIdx >= 0; groupIdx--) {
                    const group = groups[groupIdx];
                    const firstIdx = group[0];
                    const lastIdx = group[group.length - 1];
                    
                    // 整个组内的所有行都标记为红色删除（包括中间没变化的行）
                    for (let idx = firstIdx; idx <= lastIdx; idx++) {
                        const lineNum = start_line + idx;
                        console.log(`  🔴 标记第 ${lineNum} 行为红色删除`);
                        decorations.push({
                            range: new monaco.Range(lineNum, 1, lineNum, model.getLineMaxColumn(lineNum)),
                            options: {
                                isWholeLine: true,
                                className: 'diff-line-deleted',
                                glyphMarginClassName: 'diff-glyph-deleted'
                            }
                        });
                    }
                    
                    // 创建Zone只显示绿色添加行
                    const domNode = document.createElement('div');
                    domNode.className = 'diff-zone-widget';
                    domNode.style.fontSize = `${fontSize}px`;
                    domNode.style.fontFamily = fontFamily;
                    domNode.style.lineHeight = `${lineHeight}px`;
                    
                    const linesHtml = [];
                    
                    // 显示整个组范围的所有绿色行（对应红色行）
                    for (let idx = firstIdx; idx <= lastIdx; idx++) {
                        const newLine = newLines[idx] || '';
                        linesHtml.push(`<div class="diff-zone-line diff-zone-added">${this.escapeHtml(newLine)}</div>`);
                    }
                    
                    domNode.innerHTML = linesHtml.join('');
                    console.log(`📦 组 ${groupIdx + 1} 包含 ${linesHtml.length} 行HTML`);
                    
                    // 只有当有添加行时才创建Zone
                    if (linesHtml.length > 0) {
                        const zoneLineNumber = start_line + lastIdx;
                        console.log(`🎯 组 ${groupIdx + 1}: firstIdx=${firstIdx}, lastIdx=${lastIdx}, start_line=${start_line}`);
                        console.log(`   Zone将插入在第 ${zoneLineNumber} 行之后`);
                        
                        const zoneWidget = {
                            domNode: domNode,
                            afterLineNumber: zoneLineNumber,
                            heightInLines: linesHtml.length,
                            suppressMouseDown: true
                        };
                        
                        zoneWidgets.push(zoneWidget);
                    }
                }
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
     * 自动应用到已打开的编辑器
     * @param {string} toolCallId 
     */
    autoApplyToOpenEditor(toolCallId) {
        console.log('🔍 autoApplyToOpenEditor调用:', toolCallId);
        
        const edit = this.pendingEdits.get(toolCallId);
        if (!edit || edit.type !== 'edit') {
            console.log('❌ edit不存在或类型错误:', { edit, type: edit?.type });
            return;
        }
        
        const { file_path, operations, server_id } = edit;
        console.log('📋 edit信息:', { file_path, operations: operations?.length, server_id });
        
        // 检查当前服务器是否匹配
        const currentServerId = this.getCurrentServerId();
        if (server_id !== currentServerId) {
            console.log('⏭️ 服务器不匹配，跳过自动应用:', { current: currentServerId, target: server_id });
            return;
        }
        
        // 检查文件是否已打开
        const editor = window.getEditorByPath && window.getEditorByPath(file_path);
        if (!editor) {
            console.log('⏭️ 文件未打开，跳过自动应用:', file_path);
            return;
        }
        
        // 检查这个edit是否是该文件的最后一个pending（只显示最后一个的累计diff）
        let lastPendingToolCallId = null;
        let pendingCount = 0;
        for (const [tid, e] of this.pendingEdits.entries()) {
            if (e.file_path === file_path && e.status === 'pending' && e.type === 'edit') {
                lastPendingToolCallId = tid;  // Map保持插入顺序，最后遍历到的就是最新的
                pendingCount++;
            }
        }
        
        console.log('📊 该文件pending统计:', { 总数: pendingCount, 最后一个: lastPendingToolCallId, 当前: toolCallId });
        
        if (lastPendingToolCallId !== toolCallId) {
            console.log('⏭️ 不是最后一个pending，跳过显示diff');
            return;
        }
        
        console.log('✨ 自动应用diff到已打开的编辑器:', file_path);
        this.applyDiffDecorations(file_path, operations, toolCallId);
    }
    
    /**
     * 检查所有pending的编辑，自动应用到已打开的编辑器
     * 用于历史记录加载后
     */
    checkAllPendingEdits() {
        console.log('🔍 检查所有pending编辑:', this.pendingEdits.size, '个');
        
        // 按文件分组，只显示每个文件的最后一个pending
        const fileLatestEdits = new Map();  // filePath -> {toolCallId, edit}
        
        for (const [toolCallId, edit] of this.pendingEdits.entries()) {
            if (edit.type === 'edit' && edit.status === 'pending') {
                // 覆盖同文件的edit（保留最后一个）
                fileLatestEdits.set(edit.file_path, { toolCallId, edit });
            }
        }
        
        // 只应用每个文件的最后一个pending
        console.log(`📊 ${fileLatestEdits.size} 个文件有pending编辑`);
        for (const { toolCallId } of fileLatestEdits.values()) {
            this.autoApplyToOpenEditor(toolCallId);
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
    async refreshEditorContent(filePath, serverId, markAsSaved = true) {
        console.log('🔄 刷新编辑器内容:', { filePath, serverId, markAsSaved });
        
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
                const currentContent = model.getValue();
                const newContent = data.content;
                
                // 如果内容相同，不需要更新
                if (currentContent === newContent) {
                    console.log('✅ 编辑器内容无变化，跳过更新');
                    return;
                }
                
                // 更新内容（会触发onChange，可能标记为未保存）
                model.setValue(newContent);
                console.log('✅ 编辑器内容已刷新');
                
                // 如果需要标记为已保存（Reject All恢复到磁盘状态）
                if (markAsSaved && window.getTabIdByPath && window.markAsUnmodified) {
                    const tabId = window.getTabIdByPath(filePath);
                    if (tabId) {
                        // 延迟标记，确保onChange事件已处理完
                        setTimeout(() => {
                            window.markAsUnmodified(tabId);
                            console.log('✅ 已标记为已保存状态');
                        }, 50);
                    }
                }
            }
        } catch (error) {
            console.error('刷新编辑器失败:', error);
        }
    }

    /**
     * 获取当前服务器 ID
     */
    getCurrentServerId() {
        // 检查是否是本地模式（从filetree获取sessionID）
        if (window.getCurrentSessionID) {
            const sessionId = window.getCurrentSessionID();
            console.log('🔍 filetree sessionID:', sessionId);
            if (sessionId === 'local') {
                return 'local';
            }
        }
        
        // 从全局函数获取远程服务器ID
        if (window.getCurrentServerID) {
            const serverId = window.getCurrentServerID();
            console.log('🔍 remote serverId:', serverId);
            return serverId;
        }
        
        console.log('❌ 无法获取serverId');
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
     * 获取当前会话 ID（conversationID）
     */
    getCurrentSessionId() {
        // 优先从AI聊天界面获取会话ID（真实的conversationID）
        if (window.getCurrentConversationID) {
            const conversationID = window.getCurrentConversationID();
            if (conversationID) {
                return conversationID;
            }
        }
        
        // 回退：从 filetree 模块获取会话ID（可能是"local"）
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

    /**
     * 更新Pending Actions Bar
     */
    updatePendingActionsBar() {
        const pendingCount = this.pendingEdits.size;
        const actionsBar = document.getElementById('pendingActionsBar');
        const infoDiv = document.querySelector('.pending-info');
        const buttonsDiv = document.querySelector('.pending-buttons');
        
        if (!actionsBar || !infoDiv || !buttonsDiv) return;
        
        // 常驻显示
        actionsBar.style.display = 'flex';
        
        if (pendingCount === 0) {
            // 没有变动时显示默认状态
            infoDiv.innerHTML = `
                <span class="pending-file-count">No pending changes</span>
            `;
            buttonsDiv.style.display = 'none';
            return;
        }
        
        // 统计文件和改动
        const fileSet = new Set();
        let totalAdded = 0;
        let totalDeleted = 0;
        
        for (const [toolCallId, edit] of this.pendingEdits.entries()) {
            fileSet.add(edit.file_path);
            
            if (edit.type === 'edit') {
                // 从operations计算改动
                if (edit.operations) {
                    for (const op of edit.operations) {
                        const oldLines = op.old_text ? op.old_text.split('\n').length : 0;
                        const newLines = op.new_text ? op.new_text.split('\n').length : 0;
                        totalDeleted += oldLines;
                        totalAdded += newLines;
                    }
                }
            } else if (edit.type === 'write') {
                // write是纯新增
                const lines = edit.content ? edit.content.split('\n').length : 0;
                totalAdded += lines;
            }
        }
        
        const fileCount = fileSet.size;
        
        // 更新显示
        infoDiv.innerHTML = `
            <span class="pending-file-count">${fileCount} file${fileCount > 1 ? 's' : ''}</span>
            <i class="fa-solid fa-file-pen pending-file-icon"></i>
            ${totalAdded > 0 ? `<span class="pending-stat-added">+${totalAdded}</span>` : ''}
            ${totalDeleted > 0 ? `<span class="pending-stat-deleted">-${totalDeleted}</span>` : ''}
        `;
        
        buttonsDiv.style.display = 'flex';
    }

    /**
     * Accept All - 确认所有pending修改
     */
    async acceptAll() {
        const pendingCount = this.pendingEdits.size;
        if (pendingCount === 0) {
            this.showToast('没有待确认的修改', 'info');
            return;
        }

        try {
            // 调用后端Accept All API
            const response = await fetch('/api/ai/edit/apply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    status: 'accepted',
                    conversation_id: this.getCurrentSessionId()
                })
            });

            const result = await response.json();
            
            if (!result.success) {
                this.showToast('Accept All失败: ' + (result.error || '未知错误'), 'error');
                return;
            }
            
            // 清空所有pending edits
            for (const [toolCallId, edit] of this.pendingEdits.entries()) {
                this.updateToolStatus(toolCallId, 'accepted');
                this.clearDiffDecorations(toolCallId);
                this.appliedEdits.add(toolCallId);
            }
            
            this.pendingEdits.clear();
            this.saveAppliedEdits();
            
            // 更新Pending Actions Bar
            this.updatePendingActionsBar();
            
            // Accept后不需要刷新编辑器，因为：
            // 1. 后端写入的内容 = 当前pending内容（编辑器已经显示）
            // 2. 已经清除了diff装饰
            // 3. 刷新会触发"未保存"状态，造成困扰
            console.log('✅ Accept All完成，已清除diff装饰');
            
            this.showToast(`已确认所有修改 (${pendingCount}个)`, 'success');
        } catch (error) {
            console.error('Accept All失败:', error);
            this.showToast('Accept All失败: ' + error.message, 'error');
        }
    }

    /**
     * Reject All - 取消所有pending修改
     */
    async rejectAll() {
        const pendingCount = this.pendingEdits.size;
        if (pendingCount === 0) {
            this.showToast('没有待确认的修改', 'info');
            return;
        }

        try {
            // 调用后端Reject All API
            const response = await fetch('/api/ai/edit/apply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    status: 'rejected',
                    conversation_id: this.getCurrentSessionId()
                })
            });

            const result = await response.json();
            
            if (!result.success) {
                this.showToast('Reject All失败: ' + (result.error || '未知错误'), 'error');
                return;
            }
            
            // 清空所有pending edits
            const affectedFiles = new Set();
            for (const [toolCallId, edit] of this.pendingEdits.entries()) {
                this.updateToolStatus(toolCallId, 'rejected');
                this.clearDiffDecorations(toolCallId);
                affectedFiles.add(edit.file_path);
            }
            
            this.pendingEdits.clear();
            
            // 更新Pending Actions Bar
            this.updatePendingActionsBar();
            
            // 刷新所有受影响文件的编辑器（恢复到磁盘状态）
            // markAsSaved=true 因为恢复到磁盘状态就是已保存状态
            for (const filePath of affectedFiles) {
                await this.refreshEditorContent(filePath, 'local', true);
            }
            
            this.showToast(`已取消所有修改 (${pendingCount}个)`, 'success');
        } catch (error) {
            console.error('Reject All失败:', error);
            this.showToast('Reject All失败: ' + error.message, 'error');
        }
    }
}

// 全局实例
window.aiToolsManager = new AIToolsManager();

export default window.aiToolsManager;
