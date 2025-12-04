package handlers

import (
	"all_project/models"
	"sync"
	"time"
)

// CommandCache 命令历史内存缓存
type CommandCache struct {
	cache map[uint][]*models.CommandHistory // serverID -> commands
	mu    sync.RWMutex
	dirty map[uint]bool // 标记哪些服务器的缓存需要写入数据库
}

var globalCommandCache = &CommandCache{
	cache: make(map[uint][]*models.CommandHistory),
	dirty: make(map[uint]bool),
}

// GetCommandCache 获取全局命令缓存
func GetCommandCache() *CommandCache {
	return globalCommandCache
}

// Get 从缓存获取命令历史
func (c *CommandCache) Get(serverID uint) ([]*models.CommandHistory, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	commands, ok := c.cache[serverID]
	return commands, ok
}

// Set 设置缓存
func (c *CommandCache) Set(serverID uint, commands []*models.CommandHistory) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.cache[serverID] = commands
}

// Add 添加新命令到缓存
func (c *CommandCache) Add(serverID uint, command *models.CommandHistory) {
	c.mu.Lock()
	defer c.mu.Unlock()

	// 添加到缓存开头
	commands := c.cache[serverID]
	c.cache[serverID] = append([]*models.CommandHistory{command}, commands...)

	// 标记为脏数据
	c.dirty[serverID] = true
}

// GetDirtyServers 获取需要持久化的服务器ID列表
func (c *CommandCache) GetDirtyServers() []uint {
	c.mu.RLock()
	defer c.mu.RUnlock()

	servers := make([]uint, 0, len(c.dirty))
	for serverID := range c.dirty {
		servers = append(servers, serverID)
	}
	return servers
}

// MarkClean 标记为已持久化
func (c *CommandCache) MarkClean(serverID uint) {
	c.mu.Lock()
	defer c.mu.Unlock()

	delete(c.dirty, serverID)
}

// StartPersistWorker 启动后台持久化任务（定期写入数据库）
func (c *CommandCache) StartPersistWorker(repo *models.CommandHistoryRepository) {
	ticker := time.NewTicker(5 * time.Second) // 每5秒持久化一次

	go func() {
		for range ticker.C {
			dirtyServers := c.GetDirtyServers()

			for _, serverID := range dirtyServers {
				// 这里只标记已持久化，实际写入由SaveCommand完成
				// 因为命令已经在SaveCommand时写入了数据库
				c.MarkClean(serverID)
			}
		}
	}()
}
