package storage

import "time"

// SaveCommand 保存命令历史
func SaveCommand(serverID, command string) error {
	var store CommandHistoryStore
	if err := readJSON(commandsFile, &store); err != nil {
		// 文件可能不存在或格式错误，初始化
		store = CommandHistoryStore{Commands: make(map[string][]CommandHistory)}
	}

	if store.Commands == nil {
		store.Commands = make(map[string][]CommandHistory)
	}

	history := CommandHistory{
		ServerID:  serverID,
		Command:   command,
		Timestamp: time.Now(),
	}

	store.Commands[serverID] = append(store.Commands[serverID], history)

	// 限制每个服务器最多保留1000条
	if len(store.Commands[serverID]) > 1000 {
		store.Commands[serverID] = store.Commands[serverID][len(store.Commands[serverID])-1000:]
	}

	return writeJSON(commandsFile, &store)
}

// GetCommandsByServer 获取指定服务器的命令历史
func GetCommandsByServer(serverID string, limit int) ([]CommandHistory, error) {
	var store CommandHistoryStore
	if err := readJSON(commandsFile, &store); err != nil {
		return []CommandHistory{}, nil
	}

	commands, ok := store.Commands[serverID]
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

// GetRecentCommands 获取最近的命令（跨所有服务器）
func GetRecentCommands(limit int) ([]CommandHistory, error) {
	var store CommandHistoryStore
	if err := readJSON(commandsFile, &store); err != nil {
		return []CommandHistory{}, nil
	}

	// 收集所有命令
	allCommands := []CommandHistory{}
	for _, commands := range store.Commands {
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
	var store CommandHistoryStore
	if err := readJSON(commandsFile, &store); err != nil {
		return err
	}

	delete(store.Commands, serverID)

	return writeJSON(commandsFile, &store)
}
