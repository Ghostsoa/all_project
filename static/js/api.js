// API 请求模块
import { config } from './config.js';

// 通用API请求函数
export async function apiRequest(url, method = 'GET', data = null) {
    const options = {
        method,
        headers: {
            'Content-Type': 'application/json'
        }
    };

    if (data && method !== 'GET') {
        options.body = JSON.stringify(data);
    }

    const response = await fetch(url, options);
    
    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(error.error || `请求失败: ${response.status}`);
    }

    return response.json();
}

export const api = {
    // 服务器相关
    async getServers() {
        const res = await fetch(`${config.API_BASE}/servers`);
        return res.json();
    },
    
    async getServer(id) {
        const res = await fetch(`${config.API_BASE}/server?id=${id}`);
        return res.json();
    },
    
    async createServer(server) {
        const res = await fetch(`${config.API_BASE}/server/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(server)
        });
        return res.json();
    },
    
    async updateServer(server) {
        const res = await fetch(`${config.API_BASE}/server/update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(server)
        });
        return res.json();
    },
    
    async deleteServer(id) {
        const res = await fetch(`${config.API_BASE}/server/delete?id=${id}`, {
            method: 'POST'
        });
        return res.json();
    },
    
    async searchServers(keyword) {
        const res = await fetch(`${config.API_BASE}/servers/search?q=${encodeURIComponent(keyword)}`);
        return res.json();
    },
    
    // 命令历史相关（统一时间线）
    async saveCommand(serverId, serverName, command) {
        return fetch(`${config.API_BASE}/command/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                server_id: String(serverId), 
                server_name: serverName,
                command 
            })
        }).then(res => res.json());
    },
    
    async getRecentCommands(limit = 200) {
        const res = await fetch(`${config.API_BASE}/commands/recent?limit=${limit}`);
        return res.json();
    },
    
    async searchCommands(keyword, limit = 200) {
        const res = await fetch(`${config.API_BASE}/commands/search?keyword=${encodeURIComponent(keyword)}&limit=${limit}`);
        return res.json();
    },
    
    async deleteCommand(id) {
        const res = await fetch(`${config.API_BASE}/command/delete?id=${id}`, {
            method: 'POST'
        });
        return res.json();
    },
    
    async clearAllCommands() {
        const res = await fetch(`${config.API_BASE}/commands/clear-all`, {
            method: 'POST'
        });
        return res.json();
    },
    
    async getCommands(serverId, limit = 50) {
        const res = await fetch(`${config.API_BASE}/commands?server_id=${serverId}&limit=${limit}`);
        return res.json();
    },
    
    async clearCommands(serverId) {
        const res = await fetch(`${config.API_BASE}/commands/clear?server_id=${serverId}`, {
            method: 'POST'
        });
        return res.json();
    },
    
    // 认证相关
    async logout() {
        const res = await fetch(`${config.API_BASE}/logout`, {
            method: 'POST'
        });
        return res.json();
    }
};
