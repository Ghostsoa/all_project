package storage

import (
	"strings"
	"sync"
	"time"
)

// 内存缓存
var (
	commandStore     CommandHistoryStore
	commandStoreLock sync.RWMutex
	commandsLoaded   bool
)

// LoadCommandsCache 启动时加载命令历史到内存（只调用一次）
func LoadCommandsCache() error {
	commandStoreLock.Lock()
	defer commandStoreLock.Unlock()

	if err := readJSON(commandsFile, &commandStore); err != nil {
		// 文件不存在，初始化空store
		commandStore = CommandHistoryStore{
			Commands: []CommandHistory{},
			NextID:   1,
		}
	}

	if commandStore.Commands == nil {
		commandStore.Commands = []CommandHistory{}
	}

	commandsLoaded = true
	return nil
}

// SaveCommand 保存命令历史（统一时间线）
func SaveCommand(serverID, serverName, command string) error {
	commandStoreLock.Lock()
	defer commandStoreLock.Unlock()

	// 确保已加载
	if !commandsLoaded {
		if err := readJSON(commandsFile, &commandStore); err != nil {
			commandStore = CommandHistoryStore{
				Commands: []CommandHistory{},
				NextID:   1,
			}
		}
		if commandStore.Commands == nil {
			commandStore.Commands = []CommandHistory{}
		}
		commandsLoaded = true
	}

	// 去重：查找相同服务器的相同命令
	existingIndex := -1
	for i := len(commandStore.Commands) - 1; i >= 0; i-- {
		cmd := commandStore.Commands[i]
		if cmd.ServerID == serverID && cmd.Command == command {
			existingIndex = i
			break
		}
	}

	// 如果找到重复命令，删除旧的
	if existingIndex >= 0 {
		commandStore.Commands = append(
			commandStore.Commands[:existingIndex],
			commandStore.Commands[existingIndex+1:]...,
		)
	}

	// 创建新命令记录
	history := CommandHistory{
		ID:         commandStore.NextID,
		ServerID:   serverID,
		ServerName: serverName,
		Command:    command,
		Timestamp:  time.Now(),
	}

	// 添加到列表末尾（最新的）
	commandStore.Commands = append(commandStore.Commands, history)
	commandStore.NextID++

	// 限制总数最多保留2000条
	if len(commandStore.Commands) > 2000 {
		commandStore.Commands = commandStore.Commands[len(commandStore.Commands)-2000:]
	}

	// 写入文件
	return writeJSON(commandsFile, &commandStore)
}

// GetRecentCommands 获取最近的命令（统一时间线）
func GetRecentCommands(limit int) ([]CommandHistory, error) {
	commandStoreLock.RLock()
	defer commandStoreLock.RUnlock()

	if !commandsLoaded {
		return []CommandHistory{}, nil
	}

	commands := commandStore.Commands

	// 返回最近的N条（倒序，最新的在前）
	start := 0
	if limit > 0 && len(commands) > limit {
		start = len(commands) - limit
	}

	result := commands[start:]

	// 倒序（最新的在前）
	reversed := make([]CommandHistory, len(result))
	for i, cmd := range result {
		reversed[len(result)-1-i] = cmd
	}

	return reversed, nil
}

// GetCommandsByServer 获取指定服务器的命令历史
func GetCommandsByServer(serverID string, limit int) ([]CommandHistory, error) {
	commandStoreLock.RLock()
	defer commandStoreLock.RUnlock()

	if !commandsLoaded {
		return []CommandHistory{}, nil
	}

	// 筛选指定服务器的命令
	filtered := []CommandHistory{}
	for _, cmd := range commandStore.Commands {
		if cmd.ServerID == serverID {
			filtered = append(filtered, cmd)
		}
	}

	// 返回最近的N条
	if limit > 0 && len(filtered) > limit {
		filtered = filtered[len(filtered)-limit:]
	}

	// 倒序（最新的在前）
	reversed := make([]CommandHistory, len(filtered))
	for i, cmd := range filtered {
		reversed[len(filtered)-1-i] = cmd
	}

	return reversed, nil
}

// DeleteCommand 删除指定ID的命令
func DeleteCommand(id int) error {
	commandStoreLock.Lock()
	defer commandStoreLock.Unlock()

	if !commandsLoaded {
		return nil
	}

	// 找到并删除
	for i, cmd := range commandStore.Commands {
		if cmd.ID == id {
			commandStore.Commands = append(commandStore.Commands[:i], commandStore.Commands[i+1:]...)
			break
		}
	}

	return writeJSON(commandsFile, &commandStore)
}

// ClearCommandsByServer 清空指定服务器的命令历史
func ClearCommandsByServer(serverID string) error {
	commandStoreLock.Lock()
	defer commandStoreLock.Unlock()

	if !commandsLoaded {
		return nil
	}

	// 筛选出非该服务器的命令
	filtered := []CommandHistory{}
	for _, cmd := range commandStore.Commands {
		if cmd.ServerID != serverID {
			filtered = append(filtered, cmd)
		}
	}

	commandStore.Commands = filtered

	return writeJSON(commandsFile, &commandStore)
}

// ClearAllCommands 清空所有命令历史
func ClearAllCommands() error {
	commandStoreLock.Lock()
	defer commandStoreLock.Unlock()

	commandStore.Commands = []CommandHistory{}
	commandStore.NextID = 1

	return writeJSON(commandsFile, &commandStore)
}

// SearchCommands 搜索命令（支持命令内容和服务器名称搜索）
func SearchCommands(keyword string, limit int) ([]CommandHistory, error) {
	commandStoreLock.RLock()
	defer commandStoreLock.RUnlock()

	if !commandsLoaded {
		return []CommandHistory{}, nil
	}

	// 搜索匹配的命令（不区分大小写）
	keyword = strings.ToLower(keyword)
	results := []CommandHistory{}
	for _, cmd := range commandStore.Commands {
		cmdLower := strings.ToLower(cmd.Command)
		nameLower := strings.ToLower(cmd.ServerName)
		if strings.Contains(cmdLower, keyword) || strings.Contains(nameLower, keyword) {
			results = append(results, cmd)
		}
	}

	// 返回最近的N条
	if limit > 0 && len(results) > limit {
		results = results[len(results)-limit:]
	}

	// 倒序（最新的在前）
	reversed := make([]CommandHistory, len(results))
	for i, cmd := range results {
		reversed[len(results)-1-i] = cmd
	}

	return reversed, nil
}
