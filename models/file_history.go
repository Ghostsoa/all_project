package models

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"all_project/storage"
)

// TurnSnapshot 每轮对话的文件快照
type TurnSnapshot struct {
	UserMessageIndex int       `json:"user_message_index"` // 用户消息索引
	Content          string    `json:"content"`            // 该轮开始前的文件内容
	Timestamp        time.Time `json:"timestamp"`
}

// FileHistory 一个文件的历史快照
type FileHistory struct {
	FilePath  string         `json:"file_path"`
	Snapshots []TurnSnapshot `json:"snapshots"` // 按轮次存储快照
}

// ConversationHistory 一个会话的历史
type ConversationHistory struct {
	ConversationID string                  `json:"conversation_id"`
	Files          map[string]*FileHistory `json:"files"` // {文件路径: 历史}
}

// FileHistoryManager 管理文件历史
type FileHistoryManager struct {
	histories map[string]*ConversationHistory // key=serverID:conversationID
	mutex     sync.RWMutex
}

var fileHistoryManagerInstance *FileHistoryManager
var fileHistoryOnce sync.Once

// GetFileHistoryManager 获取单例
func GetFileHistoryManager() *FileHistoryManager {
	fileHistoryOnce.Do(func() {
		manager := &FileHistoryManager{
			histories: make(map[string]*ConversationHistory),
		}
		fileHistoryManagerInstance = manager
	})
	return fileHistoryManagerInstance
}

// getHistoryKey 获取历史key
func getHistoryKey(serverID, conversationID string) string {
	if serverID == "" {
		serverID = "local"
	}
	return serverID + ":" + conversationID
}

// AddSnapshot 添加快照
func (m *FileHistoryManager) AddSnapshot(serverID, conversationID, filePath string, userMessageIndex int, content string) error {
	m.mutex.Lock()
	defer m.mutex.Unlock()

	// 获取或创建会话历史
	historyKey := getHistoryKey(serverID, conversationID)
	conv, exists := m.histories[historyKey]
	if !exists {
		conv = &ConversationHistory{
			ConversationID: conversationID,
			Files:          make(map[string]*FileHistory),
		}
		m.histories[historyKey] = conv
	}

	// 获取或创建文件历史
	fileHist, exists := conv.Files[filePath]
	if !exists {
		fileHist = &FileHistory{
			FilePath:  filePath,
			Snapshots: []TurnSnapshot{},
		}
		conv.Files[filePath] = fileHist
	}

	// 添加快照
	snapshot := TurnSnapshot{
		UserMessageIndex: userMessageIndex,
		Content:          content,
		Timestamp:        time.Now(),
	}
	fileHist.Snapshots = append(fileHist.Snapshots, snapshot)

	log.Printf("添加快照: Turn%d %s (%d字节)", userMessageIndex, filePath, len(content))

	return m.saveLocked(serverID, conversationID)
}

// GetSnapshot 获取指定轮次的快照
func (m *FileHistoryManager) GetSnapshot(serverID, conversationID, filePath string, userMessageIndex int) (string, bool) {
	m.mutex.RLock()
	defer m.mutex.RUnlock()

	historyKey := getHistoryKey(serverID, conversationID)
	conv, exists := m.histories[historyKey]
	if !exists {
		return "", false
	}

	fileHist, exists := conv.Files[filePath]
	if !exists {
		return "", false
	}

	for _, snapshot := range fileHist.Snapshots {
		if snapshot.UserMessageIndex == userMessageIndex {
			return snapshot.Content, true
		}
	}
	return "", false
}

// RemoveSnapshotsFrom 删除从指定messageIndex开始的所有快照
func (m *FileHistoryManager) RemoveSnapshotsFrom(serverID, conversationID string, fromMessageIndex int) (map[string]string, error) {
	m.mutex.Lock()
	defer m.mutex.Unlock()

	historyKey := getHistoryKey(serverID, conversationID)
	conv, exists := m.histories[historyKey]
	if !exists {
		return nil, nil
	}

	restoredFiles := make(map[string]string)

	// 撤销逻辑：
	// 1. 找到Turn fromMessageIndex的快照，这是该轮开始前的状态
	// 2. 删除 >= fromMessageIndex 的所有快照
	// 3. 恢复到Turn fromMessageIndex快照的内容

	for filePath, fileHist := range conv.Files {
		// 先找到fromMessageIndex的快照内容（用于恢复）
		for _, snapshot := range fileHist.Snapshots {
			if snapshot.UserMessageIndex == fromMessageIndex {
				restoredFiles[filePath] = snapshot.Content
				log.Printf("将恢复到Turn%d快照: %s (%d字节)", fromMessageIndex, filePath, len(snapshot.Content))
				break
			}
		}

		// 删除 >= fromMessageIndex 的快照
		newSnapshots := []TurnSnapshot{}
		for _, snapshot := range fileHist.Snapshots {
			if snapshot.UserMessageIndex < fromMessageIndex {
				newSnapshots = append(newSnapshots, snapshot)
			}
		}

		fileHist.Snapshots = newSnapshots

		// 如果没有快照了，删除该文件历史
		if len(newSnapshots) == 0 {
			delete(conv.Files, filePath)
		}
	}

	// 如果所有文件都没有快照了，删除整个会话历史
	if len(conv.Files) == 0 {
		delete(m.histories, conversationID)
	}

	log.Printf("删除从Turn%d开始的快照，需恢复%d个文件", fromMessageIndex, len(restoredFiles))

	if err := m.saveLocked(serverID, conversationID); err != nil {
		return nil, err
	}

	return restoredFiles, nil
}

// RemoveSnapshotsAfter 删除初始快照之后的所有快照
func (m *FileHistoryManager) RemoveSnapshotsAfter(serverID, conversationID string, initialMessageIndex int) error {
	m.mutex.Lock()
	defer m.mutex.Unlock()

	historyKey := getHistoryKey(serverID, conversationID)
	conv, exists := m.histories[historyKey]
	if !exists {
		return nil
	}

	// 遍历所有文件
	for filePath, fileHist := range conv.Files {
		// 保留 <= initialMessageIndex 的快照
		newSnapshots := []TurnSnapshot{}
		for _, snapshot := range fileHist.Snapshots {
			if snapshot.UserMessageIndex <= initialMessageIndex {
				newSnapshots = append(newSnapshots, snapshot)
			}
		}

		fileHist.Snapshots = newSnapshots

		// 如果没有快照了，删除该文件历史
		if len(newSnapshots) == 0 {
			delete(conv.Files, filePath)
		}
	}

	log.Printf("删除Turn%d之后的所有快照", initialMessageIndex)

	return m.saveLocked(serverID, conversationID)
}

// RemoveSnapshot 删除快照
func (m *FileHistoryManager) RemoveSnapshot(serverID, conversationID string, userMessageIndex int) error {
	m.mutex.Lock()
	defer m.mutex.Unlock()

	historyKey := getHistoryKey(serverID, conversationID)
	conv, exists := m.histories[historyKey]
	if !exists {
		return nil
	}

	deletedCount := 0
	// 遍历所有文件
	for filePath, fileHist := range conv.Files {
		// 删除指定Turn的快照
		newSnapshots := []TurnSnapshot{}
		for _, snapshot := range fileHist.Snapshots {
			if snapshot.UserMessageIndex != userMessageIndex {
				newSnapshots = append(newSnapshots, snapshot)
			} else {
				deletedCount++
			}
		}

		fileHist.Snapshots = newSnapshots

		// 如果没有快照了，删除该文件历史
		if len(newSnapshots) == 0 {
			delete(conv.Files, filePath)
		}
	}

	// 如果所有文件都没有快照了，删除整个会话历史
	if len(conv.Files) == 0 {
		delete(m.histories, conversationID)
	}

	if deletedCount > 0 {
		log.Printf("删除Turn%d的快照: %d个文件", userMessageIndex, deletedCount)
	}

	return m.saveLocked(serverID, conversationID)
}

// ClearConversation 清空会话的所有历史
func (m *FileHistoryManager) ClearConversation(serverID, conversationID string) error {
	m.mutex.Lock()
	defer m.mutex.Unlock()

	historyKey := getHistoryKey(serverID, conversationID)
	delete(m.histories, historyKey)
	log.Printf("🗑️ 清空会话历史: %s", conversationID)

	return m.saveLocked(serverID, conversationID)
}

// saveLocked 保存文件历史到文件
func (m *FileHistoryManager) saveLocked(serverID, conversationID string) error {
	// 使用storage包的目录结构
	dir := storage.GetFileHistoryDir(serverID)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	filePath := filepath.Join(dir, conversationID+".json")
	historyKey := getHistoryKey(serverID, conversationID)

	if conv, exists := m.histories[historyKey]; exists {
		data, err := json.MarshalIndent(conv, "", "  ")
		if err != nil {
			return err
		}
		return os.WriteFile(filePath, data, 0644)
	}

	// 如果不存在，删除文件
	os.Remove(filePath)
	return nil
}
