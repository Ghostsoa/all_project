package models

import (
	"all_project/storage"
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// EditOperation 单次编辑操作
type EditOperation struct {
	ToolCallID string `json:"tool_call_id"`
	MessageID  string `json:"message_id"`
	OldString  string `json:"old_string"`
	NewString  string `json:"new_string"`
}

// TurnEdits 一轮对话的编辑
type TurnEdits struct {
	UserMessageIndex int                        `json:"user_message_index"` // 用户消息索引
	FileEdits        map[string][]EditOperation `json:"file_edits"`         // {文件路径: [edit操作]}
	Timestamp        time.Time                  `json:"timestamp"`
}

// ConversationPending 一个会话的pending状态
type ConversationPending struct {
	ConversationID string      `json:"conversation_id"`
	Turns          []TurnEdits `json:"turns"` // 按轮次存储
	UpdatedAt      time.Time   `json:"updated_at"`
}

// PendingStateManager 管理pending状态
type PendingStateManager struct {
	states map[string]*ConversationPending // key=serverID:conversationID
	mutex  sync.RWMutex
}

var pendingStateManagerInstance *PendingStateManager
var pendingStateOnce sync.Once

// GetPendingStateManager 获取单例
func GetPendingStateManager() *PendingStateManager {
	pendingStateOnce.Do(func() {
		manager := &PendingStateManager{
			states: make(map[string]*ConversationPending),
		}
		pendingStateManagerInstance = manager
	})
	return pendingStateManagerInstance
}

// getStateKey 获取状态key
func getStateKey(serverID, conversationID string) string {
	if serverID == "" {
		serverID = "local"
	}
	return serverID + ":" + conversationID
}

// AddEdit 添加一个编辑操作到当前轮次
func (m *PendingStateManager) AddEdit(serverID, conversationID, filePath string, userMessageIndex int, edit EditOperation) error {
	m.mutex.Lock()
	defer m.mutex.Unlock()

	// 获取或创建会话pending
	stateKey := getStateKey(serverID, conversationID)
	conv, exists := m.states[stateKey]
	if !exists {
		conv = &ConversationPending{
			ConversationID: conversationID,
			Turns:          []TurnEdits{},
			UpdatedAt:      time.Now(),
		}
		m.states[stateKey] = conv
	}

	// 查找或创建当前轮次
	var currentTurn *TurnEdits
	for i := range conv.Turns {
		if conv.Turns[i].UserMessageIndex == userMessageIndex {
			currentTurn = &conv.Turns[i]
			break
		}
	}

	if currentTurn == nil {
		// 创建新轮次
		newTurn := TurnEdits{
			UserMessageIndex: userMessageIndex,
			FileEdits:        make(map[string][]EditOperation),
			Timestamp:        time.Now(),
		}
		conv.Turns = append(conv.Turns, newTurn)
		currentTurn = &conv.Turns[len(conv.Turns)-1]
	}

	// 添加edit到该轮次
	currentTurn.FileEdits[filePath] = append(currentTurn.FileEdits[filePath], edit)
	conv.UpdatedAt = time.Now()

	log.Printf("📝 添加edit到Turn%d: %s (共%d个edit)", userMessageIndex, filePath, len(currentTurn.FileEdits[filePath]))

	return m.saveLocked(serverID, conversationID)
}

// GetCurrentContent 获取文件的当前pending内容（应用所有轮次的edits）
func (m *PendingStateManager) GetCurrentContent(serverID, conversationID, filePath string, diskContent string) string {
	m.mutex.RLock()
	defer m.mutex.RUnlock()

	stateKey := getStateKey(serverID, conversationID)
	conv, exists := m.states[stateKey]
	if !exists || len(conv.Turns) == 0 {
		return diskContent
	}

	// 从磁盘内容开始，逐轮应用edits
	content := diskContent
	for _, turn := range conv.Turns {
		if edits, ok := turn.FileEdits[filePath]; ok {
			for _, edit := range edits {
				content = strings.Replace(content, edit.OldString, edit.NewString, 1)
			}
		}
	}

	return content
}

// GetAllPendingFiles 获取所有有pending的文件
func (m *PendingStateManager) GetAllPendingFiles(serverID, conversationID string) map[string]bool {
	m.mutex.RLock()
	defer m.mutex.RUnlock()

	files := make(map[string]bool)
	stateKey := getStateKey(serverID, conversationID)
	conv, exists := m.states[stateKey]
	if !exists {
		return files
	}

	for _, turn := range conv.Turns {
		for filePath := range turn.FileEdits {
			files[filePath] = true
		}
	}

	return files
}

// ClearAll 清空会话的所有pending
func (m *PendingStateManager) ClearAll(serverID, conversationID string) error {
	m.mutex.Lock()
	defer m.mutex.Unlock()

	stateKey := getStateKey(serverID, conversationID)
	delete(m.states, stateKey)
	log.Printf("🧹 清空会话pending: %s", conversationID)

	return m.saveLocked(serverID, conversationID)
}

// RemoveTurnsFrom 删除从指定messageIndex开始的所有轮次
func (m *PendingStateManager) RemoveTurnsFrom(serverID, conversationID string, fromMessageIndex int) error {
	m.mutex.Lock()
	defer m.mutex.Unlock()

	stateKey := getStateKey(serverID, conversationID)
	conv, exists := m.states[stateKey]
	if !exists {
		return nil
	}

	// 保留 < fromMessageIndex 的轮次
	newTurns := []TurnEdits{}
	for _, turn := range conv.Turns {
		if turn.UserMessageIndex < fromMessageIndex {
			newTurns = append(newTurns, turn)
		}
	}

	conv.Turns = newTurns
	conv.UpdatedAt = time.Now()

	log.Printf("🗑️ 删除从Turn%d开始的轮次，剩余%d轮", fromMessageIndex, len(newTurns))

	return m.saveLocked(serverID, conversationID)
}

// GetTurns 获取所有轮次（用于计算快照）
func (m *PendingStateManager) GetTurns(serverID, conversationID string) []TurnEdits {
	m.mutex.RLock()
	defer m.mutex.RUnlock()

	stateKey := getStateKey(serverID, conversationID)
	conv, exists := m.states[stateKey]
	if !exists {
		return []TurnEdits{}
	}

	return conv.Turns
}

// saveLocked 保存pending状态到文件
func (m *PendingStateManager) saveLocked(serverID, conversationID string) error {
	// 使用storage包的目录结构
	dir := storage.GetPendingStateDir(serverID)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	filePath := filepath.Join(dir, conversationID+".json")
	stateKey := getStateKey(serverID, conversationID)

	if conv, exists := m.states[stateKey]; exists {
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
