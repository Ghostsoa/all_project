package storage

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

// LoadCommandsCache 启动时加载命令历史到内存（只调用一次）
// 现在直接使用统一配置，保留此函数以兼容
func LoadCommandsCache() error {
	// 无需操作，配置已在Init中加载
	return nil
}

// SaveCommand 保存命令历史（统一时间线）
func SaveCommand(serverID, serverName, command string) error {
	globalConfigLock.Lock()
	defer globalConfigLock.Unlock()

	if globalConfig == nil {
		return fmt.Errorf("配置未加载")
	}

	if globalConfig.Commands == nil {
		globalConfig.Commands = []CommandHistory{}
	}

	// 去重：查找相同服务器的相同命令
	existingIndex := -1
	for i := len(globalConfig.Commands) - 1; i >= 0; i-- {
		cmd := globalConfig.Commands[i]
		if cmd.ServerID == serverID && cmd.Command == command {
			existingIndex = i
			break
		}
	}

	if existingIndex >= 0 {
		globalConfig.Commands = append(
			globalConfig.Commands[:existingIndex],
			globalConfig.Commands[existingIndex+1:]...,
		)
	}

	// 获取下一个ID
	nextID := 1
	for _, cmd := range globalConfig.Commands {
		if cmd.ID >= nextID {
			nextID = cmd.ID + 1
		}
	}

	// 创建新命令
	cmd := CommandHistory{
		ID:         nextID,
		ServerID:   serverID,
		ServerName: serverName,
		Command:    command,
		Timestamp:  time.Now(),
	}

	globalConfig.Commands = append(globalConfig.Commands, cmd)
	return writeJSON(configFile, globalConfig)
}

// GetRecentCommands 获取最近的命令（统一时间线）
func GetRecentCommands(limit int) ([]CommandHistory, error) {
	globalConfigLock.RLock()
	defer globalConfigLock.RUnlock()

	if globalConfig == nil || globalConfig.Commands == nil {
		return []CommandHistory{}, nil
	}

	commands := make([]CommandHistory, len(globalConfig.Commands))
	copy(commands, globalConfig.Commands)

	// 按时间倒序
	sort.Slice(commands, func(i, j int) bool {
		return commands[i].Timestamp.After(commands[j].Timestamp)
	})

	// 返回最近的N条（倒序，最新的在前）
	start := 0
	if limit > 0 && len(commands) > limit {
		start = len(commands) - limit
	}

	result := commands[start:]

	return result, nil
}

// GetServerCommands 获取指定服务器的命令历史
func GetServerCommands(serverID string) ([]CommandHistory, error) {
	config := GetConfig()
	if config == nil || config.Commands == nil {
		return []CommandHistory{}, nil
	}

	// 筛选指定服务器的命令
	filtered := []CommandHistory{}
	for _, cmd := range config.Commands {
		if cmd.ServerID == serverID {
			filtered = append(filtered, cmd)
		}
	}

	// 按时间倒序
	sort.Slice(filtered, func(i, j int) bool {
		return filtered[i].Timestamp.After(filtered[j].Timestamp)
	})

	return filtered, nil
}

// SearchCommands 搜索命令历史（所有服务器）
func SearchCommands(keyword string, limit int) ([]CommandHistory, error) {
	config := GetConfig()
	if config == nil || config.Commands == nil {
		return []CommandHistory{}, nil
	}

	// 搜索匹配的命令（不区分大小写）
	keyword = strings.ToLower(keyword)
	var results []CommandHistory
	for _, cmd := range config.Commands {
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

// DeleteCommand 删除命令历史
func DeleteCommand(id int) error {
	globalConfigLock.Lock()
	defer globalConfigLock.Unlock()

	if globalConfig == nil {
		return fmt.Errorf("配置未加载")
	}

	newCommands := make([]CommandHistory, 0)
	for _, cmd := range globalConfig.Commands {
		if cmd.ID != id {
			newCommands = append(newCommands, cmd)
		}
	}

	globalConfig.Commands = newCommands
	return writeJSON(configFile, globalConfig)
}

// ClearServerCommands 清空指定服务器的命令历史
func ClearServerCommands(serverID string) error {
	globalConfigLock.Lock()
	defer globalConfigLock.Unlock()

	if globalConfig == nil {
		return fmt.Errorf("配置未加载")
	}

	newCommands := make([]CommandHistory, 0)
	for _, cmd := range globalConfig.Commands {
		if cmd.ServerID != serverID {
			newCommands = append(newCommands, cmd)
		}
	}

	globalConfig.Commands = newCommands
	return writeJSON(configFile, globalConfig)
}

// ClearAllCommands 清空所有命令历史
func ClearAllCommands() error {
	globalConfigLock.Lock()
	defer globalConfigLock.Unlock()

	if globalConfig == nil {
		return fmt.Errorf("配置未加载")
	}

	globalConfig.Commands = []CommandHistory{}
	return writeJSON(configFile, globalConfig)
}
