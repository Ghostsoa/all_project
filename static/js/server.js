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
            ? `<div class="server-tags">${server.tags.map(tag => escapeHtml(tag)).join(' · ')}</div>` 
            : '';
        return `
            <div class="server-item">
                <div class="server-name">${escapeHtml(server.name)}</div>
                <div class="server-info">${escapeHtml(server.username)}@${escapeHtml(server.host)}:${server.port}</div>
                ${tagsHtml}
                <div class="server-actions">
                    <button class="btn-small connect" onclick="window.selectServer(${server.ID})">🔌 连接</button>
                    <button class="btn-small" onclick="window.editServer(${server.ID})">✏️ 编辑</button>
                    <button class="btn-small delete" onclick="window.deleteServer(${server.ID})">🗑️ 删除</button>
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
