// 服务器管理模块
import { state } from './config.js';
import { api } from './api.js';
import { escapeHtml } from './utils.js';

export async function loadServers() {
    try {
        const data = await api.getServers();
        if (data.success) {
            state.servers = data.data || [];
            renderServerList();
        }
    } catch (error) {
        console.error('加载服务器列表失败:', error);
    }
}

export function renderServerList(filterServers = null) {
    const list = document.getElementById('serverList');
    const serversToRender = filterServers || state.servers;
    
    if (serversToRender.length === 0) {
        list.innerHTML = '<div class="loading">暂无服务器</div>';
        return;
    }
    
    list.innerHTML = serversToRender.map(server => {
        const tagsHtml = server.tags && server.tags.length > 0 
            ? `<div class="server-tags">${server.tags.map(tag => `<span class="server-tag">${escapeHtml(tag)}</span>`).join('')}</div>` 
            : '';
        return `
            <div class="server-item" id="server-${server.ID}">
                <!-- 折叠状态：只显示名字和连接按钮 -->
                <div class="server-compact" onclick="window.toggleServerExpand(${server.ID})">
                    <div class="server-name-compact">
                        <span class="expand-icon">▶</span>
                        ${escapeHtml(server.name)}
                    </div>
                    <button class="btn-small connect" onclick="event.stopPropagation(); window.selectServer(${server.ID})">🔌</button>
                </div>
                
                <!-- 展开内容：详细信息 -->
                <div class="server-expanded">
                    <div class="server-info-detail">
                        <div class="server-address">📍 ${escapeHtml(server.username)}@${escapeHtml(server.host)}:${server.port}</div>
                        ${tagsHtml}
                    </div>
                    <div class="server-actions-expanded">
                        <button class="btn-small" onclick="window.editServer(${server.ID})">✏️ 编辑</button>
                        <button class="btn-small delete" onclick="window.deleteServer(${server.ID})">🗑️ 删除</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

export async function searchServers() {
    const keyword = document.getElementById('searchInput').value.trim();
    
    if (!keyword) {
        renderServerList();
        return;
    }
    
    try {
        const data = await api.searchServers(keyword);
        if (data.success) {
            renderServerList(data.data);
        }
    } catch (error) {
        console.error('搜索失败:', error);
    }
}

export async function deleteServer(id) {
    if (!confirm('确定要删除这个服务器吗？')) return;
    
    try {
        const data = await api.deleteServer(id);
        if (data.success) {
            // 关闭相关终端
            for (const [sessionId, session] of state.terminals.entries()) {
                if (session.server.ID === id) {
                    if (session.ws) session.ws.close();
                    state.terminals.delete(sessionId);
                }
            }
            await loadServers();
            alert('删除成功');
        } else {
            alert(data.error || '删除失败');
        }
    } catch (error) {
        console.error('删除失败:', error);
        alert('删除失败');
    }
}
