// 全局配置和状态管理
export const state = {
    servers: [],
    terminals: new Map(),
    currentServer: null,
    activeSessionId: null,
    sessionCounter: 0,
    currentTags: []
};

export const config = {
    API_BASE: '/api',
    WS_PROTOCOL: window.location.protocol === 'https:' ? 'wss:' : 'ws:',
    WS_HOST: window.location.host
};
