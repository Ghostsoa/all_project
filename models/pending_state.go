package models

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Version 文件的一个修改版本
type Version struct {
	ToolCallID string    `json:"tool_call_id"`
	MessageID  string    `json:"message_id"` // 关联的消息ID
	Content    string    `json:"content"`
	Timestamp  time.Time `json:"timestamp"`
}

// PendingFile 一个文件的pending状态
type PendingFile struct {
	Versions       []Version `json:"versions"`
	CurrentVersion int       `json:"current_version"`
}

// ConversationState 一个会话的状态
type ConversationState struct {
	Files     map[string]*PendingFile `json:"files"`
	UpdatedAt time.Time               `json:"updated_at"`
}

// PendingStateManager 状态管理器
type PendingStateManager struct {
	states   map[string]*ConversationState
	mutex    sync.RWMutex
	filepath string
}

var globalManager *PendingStateManager
var once sync.Once

// GetPendingStateManager 获取全局状态管理器
func GetPendingStateManager() *PendingStateManager {
	once.Do(func() {
		stateDir := ".pending_states"
		os.MkdirAll(stateDir, 0755)

		globalManager = &PendingStateManager{
			states:   make(map[string]*ConversationState),
			filepath: filepath.Join(stateDir, "pending_states.json"),
		}

		// 启动时加载
		globalManager.Load()
	})
	return globalManager
}

// GetCurrentContent 获取文件的当前pending内容
func (m *PendingStateManager) GetCurrentContent(conversationID, filePath string) (string, bool) {
	m.mutex.RLock()
	defer m.mutex.RUnlock()

	conv, exists := m.states[conversationID]
	if !exists {
		return "", false
	}

	pendingFile, exists := conv.Files[filePath]
	if !exists || len(pendingFile.Versions) == 0 {
		return "", false
	}

	currentVersion := pendingFile.Versions[pendingFile.CurrentVersion]
	return currentVersion.Content, true
}

// AddVersion 添加新版本
func (m *PendingStateManager) AddVersion(conversationID, filePath, toolCallID, content, messageID string) error {
	m.mutex.Lock()
	defer m.mutex.Unlock()

	// 获取或创建conversation状态
	conv, exists := m.states[conversationID]
	if !exists {
		conv = &ConversationState{
			Files:     make(map[string]*PendingFile),
			UpdatedAt: time.Now(),
		}
		m.states[conversationID] = conv
	}

	// 获取或创建文件pending状态
	pendingFile, exists := conv.Files[filePath]
	if !exists {
		pendingFile = &PendingFile{
			Versions:       []Version{},
			CurrentVersion: -1,
		}
		conv.Files[filePath] = pendingFile
	}

	// 添加新版本
	newVersion := Version{
		ToolCallID: toolCallID,
		MessageID:  messageID,
		Content:    content,
		Timestamp:  time.Now(),
	}

	pendingFile.Versions = append(pendingFile.Versions, newVersion)
	pendingFile.CurrentVersion = len(pendingFile.Versions) - 1
	conv.UpdatedAt = time.Now()

	// 保存到文件
	return m.Save()
}

// RemoveFile 清除文件的所有pending状态（Accept后）
func (m *PendingStateManager) RemoveFile(conversationID, filePath string) error {
	m.mutex.Lock()
	defer m.mutex.Unlock()

	conv, exists := m.states[conversationID]
	if !exists {
		return nil
	}

	delete(conv.Files, filePath)
	conv.UpdatedAt = time.Now()

	// 如果conversation没有文件了，删除整个conversation
	if len(conv.Files) == 0 {
		delete(m.states, conversationID)
	}

	return m.Save()
}

// RejectVersion 拒绝某个版本（回滚）
func (m *PendingStateManager) RejectVersion(conversationID, filePath, toolCallID string) error {
	m.mutex.Lock()
	defer m.mutex.Unlock()

	conv, exists := m.states[conversationID]
	if !exists {
		return nil
	}

	pendingFile, exists := conv.Files[filePath]
	if !exists {
		return nil
	}

	// 找到要拒绝的版本
	rejectIndex := -1
	for i, v := range pendingFile.Versions {
		if v.ToolCallID == toolCallID {
			rejectIndex = i
			break
		}
	}

	if rejectIndex == -1 {
		return nil
	}

	// 删除这个版本及之后的所有版本（链式取消）
	pendingFile.Versions = pendingFile.Versions[:rejectIndex]

	if len(pendingFile.Versions) == 0 {
		// 没有版本了，删除整个文件
		delete(conv.Files, filePath)
		if len(conv.Files) == 0 {
			delete(m.states, conversationID)
		}
	} else {
		pendingFile.CurrentVersion = len(pendingFile.Versions) - 1
	}

	conv.UpdatedAt = time.Now()
	return m.Save()
}

// AcceptVersion 接受某个版本（删除它及之前的，保留之后的）
func (m *PendingStateManager) AcceptVersion(conversationID, filePath, toolCallID string) (string, []Version, error) {
	m.mutex.Lock()
	defer m.mutex.Unlock()

	conv, exists := m.states[conversationID]
	if !exists {
		return "", nil, nil
	}

	pendingFile, exists := conv.Files[filePath]
	if !exists {
		return "", nil, nil
	}

	// 找到要接受的版本
	acceptIndex := -1
	for i, v := range pendingFile.Versions {
		if v.ToolCallID == toolCallID {
			acceptIndex = i
			break
		}
	}

	if acceptIndex == -1 {
		return "", nil, nil
	}

	// 获取这个版本的内容（用于写入磁盘）
	acceptedContent := pendingFile.Versions[acceptIndex].Content

	// 获取后续版本（需要保留的）
	var remainingVersions []Version
	if acceptIndex < len(pendingFile.Versions)-1 {
		remainingVersions = pendingFile.Versions[acceptIndex+1:]
	}

	// 清除整个文件的pending
	delete(conv.Files, filePath)
	if len(conv.Files) == 0 {
		delete(m.states, conversationID)
	}

	conv.UpdatedAt = time.Now()
	m.Save()

	return acceptedContent, remainingVersions, nil
}

// RestoreVersions 恢复版本列表（用于Accept后保留后续版本）
func (m *PendingStateManager) RestoreVersions(conversationID, filePath string, versions []Version) error {
	if len(versions) == 0 {
		return nil
	}

	m.mutex.Lock()
	defer m.mutex.Unlock()

	// 获取或创建conversation状态
	conv, exists := m.states[conversationID]
	if !exists {
		conv = &ConversationState{
			Files:     make(map[string]*PendingFile),
			UpdatedAt: time.Now(),
		}
		m.states[conversationID] = conv
	}

	// 创建新的pending file
	pendingFile := &PendingFile{
		Versions:       versions,
		CurrentVersion: len(versions) - 1,
	}
	conv.Files[filePath] = pendingFile
	conv.UpdatedAt = time.Now()

	return m.Save()
}

// Save 保存到JSON文件
func (m *PendingStateManager) Save() error {
	data, err := json.MarshalIndent(m.states, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(m.filepath, data, 0644)
}

// Load 从JSON文件加载
func (m *PendingStateManager) Load() error {
	data, err := os.ReadFile(m.filepath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil // 文件不存在是正常的
		}
		return err
	}

	m.mutex.Lock()
	defer m.mutex.Unlock()

	return json.Unmarshal(data, &m.states)
}

// RemoveVersionsByMessageID 删除消息时自动清理相关的pending版本
func (m *PendingStateManager) RemoveVersionsByMessageID(conversationID, messageID string) error {
	m.mutex.Lock()
	defer m.mutex.Unlock()

	conv, exists := m.states[conversationID]
	if !exists {
		return nil
	}

	// 遍历所有文件
	for filePath, pendingFile := range conv.Files {
		// 找到要删除的版本索引
		deleteIndex := -1
		for i, v := range pendingFile.Versions {
			if v.MessageID == messageID {
				deleteIndex = i
				break
			}
		}

		if deleteIndex != -1 {
			// 删除这个版本及之后的所有版本（链式）
			pendingFile.Versions = pendingFile.Versions[:deleteIndex]

			if len(pendingFile.Versions) == 0 {
				// 没有版本了，删除整个文件
				delete(conv.Files, filePath)
			} else {
				pendingFile.CurrentVersion = len(pendingFile.Versions) - 1
			}
		}
	}

	// 如果conversation没有文件了，删除整个conversation
	if len(conv.Files) == 0 {
		delete(m.states, conversationID)
	}

	conv.UpdatedAt = time.Now()
	return m.Save()
}

// GetVersionHistory 获取文件的版本历史
func (m *PendingStateManager) GetVersionHistory(conversationID, filePath string) []Version {
	m.mutex.RLock()
	defer m.mutex.RUnlock()

	conv, exists := m.states[conversationID]
	if !exists {
		return nil
	}

	pendingFile, exists := conv.Files[filePath]
	if !exists {
		return nil
	}

	return pendingFile.Versions
}
