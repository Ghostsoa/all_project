// 文件树缓存管理器 - Stale-While-Revalidate + 智能预加载
import { showToast } from './utils.js';

class FileTreeCache {
    constructor() {
        this.cache = new Map(); // 缓存：Map<key, {data, timestamp}>
        this.loading = new Set(); // 正在加载的key
        this.preloadQueue = []; // 预加载队列
        this.preloading = false; // 是否正在预加载
        this.currentPath = null; // 当前显示的路径
        this.renderCallback = null; // 渲染回调
        this.showHiddenGetter = null; // 获取showHidden状态的函数
    }
    
    // 设置获取showHidden状态的函数
    setShowHiddenGetter(getter) {
        this.showHiddenGetter = getter;
    }
    
    // 设置渲染回调
    setRenderCallback(callback) {
        this.renderCallback = callback;
    }
    
    // 设置当前路径
    setCurrentPath(path) {
        this.currentPath = path;
    }
    
    // 主方法：获取或加载目录
    async getOrLoad(sessionID, path) {
        const key = this.makeKey(sessionID, path);
        
        // 1. 有缓存？立即返回 + 悲观刷新
        if (this.cache.has(key)) {
            const cached = this.cache.get(key);
            
            // 后台悲观刷新（假设已过期）
            this.revalidateInBackground(sessionID, path, key);
            
            return cached.data;
        }
        
        // 2. 无缓存，首次加载
        return await this.fetchAndCache(sessionID, path, key);
    }
    
    // 获取并缓存
    async fetchAndCache(sessionID, path, key) {
        if (this.loading.has(key)) {
            // 避免重复请求，等待现有请求
            return await this.waitForLoad(key);
        }
        
        this.loading.add(key);
        
        try {
            const files = await this.fetchFiles(sessionID, path);
            
            // 保存到缓存
            this.cache.set(key, {
                data: files,
                timestamp: Date.now()
            });
            
            // 智能预加载第一层子目录
            this.schedulePreload(sessionID, files);
            
            return files;
        } catch (error) {
            console.error('加载目录失败:', error);
            throw error;
        } finally {
            this.loading.delete(key);
        }
    }
    
    // 后台悲观刷新
    async revalidateInBackground(sessionID, path, key) {
        if (this.loading.has(key)) return;
        
        this.loading.add(key);
        
        try {
            const newData = await this.fetchFiles(sessionID, path);
            const cached = this.cache.get(key);
            
            if (!cached) {
                this.cache.set(key, { data: newData, timestamp: Date.now() });
                return;
            }
            
            // 对比数据是否变化
            if (!this.isEqual(cached.data, newData)) {
                // 有变化！更新缓存
                this.cache.set(key, { data: newData, timestamp: Date.now() });
                
                // 如果用户还在这个目录，静默更新UI
                if (this.currentPath === path && this.renderCallback) {
                    this.renderCallback(newData, path);
                    console.log('✅ 静默刷新:', path, '(检测到变化)');
                }
            } else {
                // 无变化，只更新时间戳
                cached.timestamp = Date.now();
                console.log('✅ 后台验证:', path, '(无变化)');
            }
        } catch (error) {
            console.error('后台刷新失败:', path, error);
            // 失败不影响用户体验，因为有缓存兜底
        } finally {
            this.loading.delete(key);
        }
    }
    
    // 智能预加载：仅第一层子目录，限制5个
    schedulePreload(sessionID, files) {
        const dirs = files.filter(f => f.is_dir);
        const limit = Math.min(dirs.length, 5); // 最多5个
        
        for (let i = 0; i < limit; i++) {
            const dir = dirs[i];
            const key = this.makeKey(sessionID, dir.path);
            
            // 已有缓存或正在加载？跳过
            if (this.cache.has(key) || this.loading.has(key)) continue;
            
            // 加入预加载队列
            this.preloadQueue.push({ sessionID, path: dir.path, key });
        }
        
        // 开始处理预加载队列
        this.processPreloadQueue();
    }
    
    // 处理预加载队列（并发加载）
    async processPreloadQueue() {
        if (this.preloading) return;
        this.preloading = true;
        
        // 获取所有待加载项
        const items = [...this.preloadQueue];
        this.preloadQueue = [];
        
        // 过滤掉已缓存或正在加载的
        const toLoad = items.filter(item => 
            !this.cache.has(item.key) && !this.loading.has(item.key)
        );
        
        if (toLoad.length > 0) {
            console.log(`🚀 并发预加载 ${toLoad.length} 个目录...`);
            
            // 并发加载所有目录
            await Promise.allSettled(
                toLoad.map(async ({ sessionID, path, key }) => {
                    try {
                        await this.fetchAndCache(sessionID, path, key);
                        console.log('✅ 预加载完成:', path);
                    } catch (error) {
                        console.error('❌ 预加载失败:', path, error.message);
                    }
                })
            );
        }
        
        this.preloading = false;
    }
    
    // 乐观更新：创建文件
    optimisticCreate(sessionID, parentPath, newFile) {
        const key = this.makeKey(sessionID, parentPath);
        const cached = this.cache.get(key);
        
        if (cached) {
            // 添加到列表开头
            cached.data.unshift(newFile);
            cached.timestamp = Date.now();
            
            // 立即更新UI
            if (this.currentPath === parentPath && this.renderCallback) {
                this.renderCallback(cached.data, parentPath);
            }
        }
    }
    
    // 乐观更新：删除文件
    optimisticDelete(sessionID, parentPath, filePath) {
        const key = this.makeKey(sessionID, parentPath);
        const cached = this.cache.get(key);
        
        if (cached) {
            // 从列表删除
            cached.data = cached.data.filter(f => f.path !== filePath);
            cached.timestamp = Date.now();
            
            // 立即更新UI
            if (this.currentPath === parentPath && this.renderCallback) {
                this.renderCallback(cached.data, parentPath);
            }
        }
    }
    
    // 乐观更新：重命名文件
    optimisticRename(sessionID, parentPath, oldPath, newPath, newName) {
        const key = this.makeKey(sessionID, parentPath);
        const cached = this.cache.get(key);
        
        if (cached) {
            const file = cached.data.find(f => f.path === oldPath);
            if (file) {
                file.path = newPath;
                file.name = newName;
                cached.timestamp = Date.now();
                
                // 立即更新UI
                if (this.currentPath === parentPath && this.renderCallback) {
                    this.renderCallback(cached.data, parentPath);
                }
            }
        }
    }
    
    // 回滚：清除缓存，重新加载
    async rollback(sessionID, path) {
        const key = this.makeKey(sessionID, path);
        this.cache.delete(key);
        
        // 如果用户在这个目录，重新加载
        if (this.currentPath === path) {
            const files = await this.fetchAndCache(sessionID, path, key);
            if (this.renderCallback) {
                this.renderCallback(files, path);
            }
        }
    }
    
    // 手动刷新
    async refresh(sessionID, path) {
        const key = this.makeKey(sessionID, path);
        this.cache.delete(key);
        return await this.fetchAndCache(sessionID, path, key);
    }
    
    // 清除所有缓存
    clearAll() {
        this.cache.clear();
        this.preloadQueue = [];
    }
    
    // 清除特定服务器的缓存
    clearServer(sessionID) {
        const prefix = `${sessionID}:`;
        for (const key of this.cache.keys()) {
            if (key.startsWith(prefix)) {
                this.cache.delete(key);
            }
        }
    }
    
    // 工具方法
    makeKey(sessionID, path) {
        return `${sessionID}:${path}`;
    }
    
    async fetchFiles(sessionID, path) {
        const showHidden = this.showHiddenGetter ? this.showHiddenGetter() : false;
        console.log('📂 加载目录:', path, '显示隐藏文件:', showHidden);
        
        const response = await fetch(
            `/api/files/list?session_id=${sessionID}&path=${encodeURIComponent(path)}&show_hidden=${showHidden}`
        );
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || '加载失败');
        }
        
        console.log('✅ 返回', data.files.length, '个文件');
        return data.files || [];
    }
    
    isEqual(oldData, newData) {
        if (!oldData || !newData) return false;
        if (oldData.length !== newData.length) return false;
        
        // 对比文件名和修改时间
        for (let i = 0; i < oldData.length; i++) {
            if (oldData[i].name !== newData[i].name) return false;
            if (oldData[i].mod_time !== newData[i].mod_time) return false;
        }
        
        return true;
    }
    
    async waitForLoad(key) {
        // 等待现有加载完成
        let attempts = 0;
        while (this.loading.has(key) && attempts < 50) {
            await this.sleep(100);
            attempts++;
        }
        
        const cached = this.cache.get(key);
        return cached ? cached.data : [];
    }
    
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    // 获取缓存统计
    getStats() {
        return {
            cacheSize: this.cache.size,
            loadingCount: this.loading.size,
            preloadQueueLength: this.preloadQueue.length,
            preloading: this.preloading
        };
    }
}

// 导出单例
export const fileCache = new FileTreeCache();
