package models

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"
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
	histories map[string]*ConversationHistory // key=conversationID
	mutex     sync.RWMutex
	dataDir   string
}

var fileHistoryManagerInstance *FileHistoryManager
var fileHistoryOnce sync.Once

// GetFileHistoryManager 获取单例
func GetFileHistoryManager() *FileHistoryManager {
	fileHistoryOnce.Do(func() {
		manager := &FileHistoryManager{
			histories: make(map[string]*ConversationHistory),
			dataDir:   ".file_history",
		}
		os.MkdirAll(manager.dataDir, 0755)
		if err := manager.Load(); err != nil {
			log.Printf("加载文件历史失败: %v", err)
		}
		fileHistoryManagerInstance = manager
	})
	return fileHistoryManagerInstance
}

// AddSnapshot 添加快照
func (m *FileHistoryManager) AddSnapshot(conversationID, filePath string, userMessageIndex int, content string) error {
	m.mutex.Lock()
	defer m.mutex.Unlock()

	// 获取或创建会话历史
	conv, exists := m.histories[conversationID]
	if !exists {
		conv = &ConversationHistory{
			ConversationID: conversationID,
			Files:          make(map[string]*FileHistory),
		}
		m.histories[conversationID] = conv
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

	log.Printf("📸 添加快照 Turn%d: %s (%d字节)", userMessageIndex, filePath, len(content))

	return m.saveLocked()
}

// GetLastSnapshot 获取最后一个快照
func (m *FileHistoryManager) GetLastSnapshot(conversationID, filePath string) (string, bool) {
	m.mutex.RLock()
	defer m.mutex.RUnlock()

	conv, exists := m.histories[conversationID]
	if !exists {
		return "", false
	}

	fileHist, exists := conv.Files[filePath]
	if !exists || len(fileHist.Snapshots) == 0 {
		return "", false
	}

	lastSnapshot := fileHist.Snapshots[len(fileHist.Snapshots)-1]
	return lastSnapshot.Content, true
}

// RemoveSnapshotsFrom 删除从指定messageIndex开始的快照
func (m *FileHistoryManager) RemoveSnapshotsFrom(conversationID string, fromMessageIndex int) (map[string]string, error) {
	m.mutex.Lock()
	defer m.mutex.Unlock()

	conv, exists := m.histories[conversationID]
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
				log.Printf("📂 将恢复到Turn%d快照: %s (%d字节)", fromMessageIndex, filePath, len(snapshot.Content))
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

	log.Printf("🗑️ 删除从Turn%d开始的快照，需恢复%d个文件", fromMessageIndex, len(restoredFiles))

	if err := m.saveLocked(); err != nil {
		return nil, err
	}

	return restoredFiles, nil
}

// RemoveSnapshotsAfter 删除初始快照之后的所有快照
func (m *FileHistoryManager) RemoveSnapshotsAfter(conversationID string, initialMessageIndex int) error {
	m.mutex.Lock()
	defer m.mutex.Unlock()

	conv, exists := m.histories[conversationID]
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

	log.Printf("🗑️ 删除Turn%d之后的所有快照", initialMessageIndex)

	return m.saveLocked()
}

// ClearConversation 清空会话的所有历史
func (m *FileHistoryManager) ClearConversation(conversationID string) error {
	m.mutex.Lock()
	defer m.mutex.Unlock()

	delete(m.histories, conversationID)
	log.Printf("🗑️ 清空会话历史: %s", conversationID)

	return m.saveLocked()
}

// Save 保存到文件
func (m *FileHistoryManager) Save() error {
	m.mutex.Lock()
	defer m.mutex.Unlock()
	return m.saveLocked()
}

func (m *FileHistoryManager) saveLocked() error {
	filePath := filepath.Join(m.dataDir, "history_index.json")
	data, err := json.MarshalIndent(m.histories, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filePath, data, 0644)
}

// Load 从文件加载
func (m *FileHistoryManager) Load() error {
	filePath := filepath.Join(m.dataDir, "history_index.json")
	data, err := os.ReadFile(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}

	m.mutex.Lock()
	defer m.mutex.Unlock()

	return json.Unmarshal(data, &m.histories)
}
