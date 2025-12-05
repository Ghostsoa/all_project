package storage

import (
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
		commandStore = CommandHistoryStore{Commands: make(map[string][]CommandHistory)}
	}

	if commandStore.Commands == nil {
		commandStore.Commands = make(map[string][]CommandHistory)
	}

	commandsLoaded = true
	return nil
}

// SaveCommand 保存命令历史（操作内存+写文件，不重新读文件）
func SaveCommand(serverID, command string) error {
	commandStoreLock.Lock()
	defer commandStoreLock.Unlock()

	// 确保已加载
	if !commandsLoaded {
		if err := readJSON(commandsFile, &commandStore); err != nil {
			commandStore = CommandHistoryStore{Commands: make(map[string][]CommandHistory)}
		}
		if commandStore.Commands == nil {
			commandStore.Commands = make(map[string][]CommandHistory)
		}
		commandsLoaded = true
	}

	history := CommandHistory{
		ServerID:  serverID,
		Command:   command,
		Timestamp: time.Now(),
	}

	// 去重：如果命令已存在，更新时间并移到最后
	commands := commandStore.Commands[serverID]
	existingIndex := -1
	for i, cmd := range commands {
		if cmd.Command == command {
			existingIndex = i
			break
		}
	}

	if existingIndex >= 0 {
		// 已存在：删除旧的
		commands = append(commands[:existingIndex], commands[existingIndex+1:]...)
	}

	// 添加到最后
	commandStore.Commands[serverID] = append(commands, history)

	// 限制每个服务器最多保留1000条
	if len(commandStore.Commands[serverID]) > 1000 {
		commandStore.Commands[serverID] = commandStore.Commands[serverID][len(commandStore.Commands[serverID])-1000:]
	}

	// 只写文件，不重新读取
	return writeJSON(commandsFile, &commandStore)
}

// GetCommandsByServer 获取指定服务器的命令历史（从内存读取）
func GetCommandsByServer(serverID string, limit int) ([]CommandHistory, error) {
	commandStoreLock.RLock()
	defer commandStoreLock.RUnlock()

	// 确保已加载
	if !commandsLoaded {
		return []CommandHistory{}, nil
	}

	commands, ok := commandStore.Commands[serverID]
	if !ok {
		return []CommandHistory{}, nil
	}

	// 返回最近的N条
	if limit > 0 && len(commands) > limit {
		commands = commands[len(commands)-limit:]
	}

	// 倒序（最新的在前）
	reversed := make([]CommandHistory, len(commands))
	for i, cmd := range commands {
		reversed[len(commands)-1-i] = cmd
	}

	return reversed, nil
}

// GetRecentCommands 获取最近的命令（跨所有服务器，从内存读取）
func GetRecentCommands(limit int) ([]CommandHistory, error) {
	commandStoreLock.RLock()
	defer commandStoreLock.RUnlock()

	if !commandsLoaded {
		return []CommandHistory{}, nil
	}

	// 收集所有命令
	allCommands := []CommandHistory{}
	for _, commands := range commandStore.Commands {
		allCommands = append(allCommands, commands...)
	}

	// 按时间倒序排序
	for i := 0; i < len(allCommands)-1; i++ {
		for j := i + 1; j < len(allCommands); j++ {
			if allCommands[i].Timestamp.Before(allCommands[j].Timestamp) {
				allCommands[i], allCommands[j] = allCommands[j], allCommands[i]
			}
		}
	}

	// 限制数量
	if limit > 0 && len(allCommands) > limit {
		allCommands = allCommands[:limit]
	}

	return allCommands, nil
}

// ClearCommandsByServer 清空指定服务器的命令历史
func ClearCommandsByServer(serverID string) error {
	commandStoreLock.Lock()
	defer commandStoreLock.Unlock()

	if !commandsLoaded {
		return nil
	}

	delete(commandStore.Commands, serverID)

	return writeJSON(commandsFile, &commandStore)
}
