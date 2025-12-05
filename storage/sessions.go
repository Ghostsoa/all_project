package storage

import (
	"fmt"
	"io/ioutil"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// 按需缓存：用到哪个session缓存哪个
var (
	sessionCache     = make(map[string]*ChatSession) // sessionID -> session
	sessionCacheLock sync.RWMutex
)

// GetAllSessions 获取所有会话（只包含元数据，不包含消息）
func GetAllSessions() ([]ChatSession, error) {
	files, err := ioutil.ReadDir(sessionsDir)
	if err != nil {
		return nil, err
	}

	sessions := []ChatSession{}
	for _, file := range files {
		if filepath.Ext(file.Name()) == ".json" {
			session, err := GetSession(file.Name()[:len(file.Name())-5]) // 去掉.json
			if err != nil {
				continue
			}
			// 创建副本，只保留元数据（不影响缓存）
			sessionCopy := ChatSession{
				ID:        session.ID,
				Title:     session.Title,
				ModelID:   session.ModelID,
				CreatedAt: session.CreatedAt,
				UpdatedAt: session.UpdatedAt,
				Messages:  nil, // 不包含消息，减少内存
			}
			sessions = append(sessions, sessionCopy)
		}
	}

	// 按更新时间倒序排序
	sort.Slice(sessions, func(i, j int) bool {
		return sessions[i].UpdatedAt.After(sessions[j].UpdatedAt)
	})

	return sessions, nil
}

// GetSession 获取会话（包含完整消息，按需缓存）
func GetSession(id string) (*ChatSession, error) {
	// 1. 先查缓存
	sessionCacheLock.RLock()
	if cached, ok := sessionCache[id]; ok {
		sessionCacheLock.RUnlock()
		// 直接返回缓存的指针，不需要拷贝
		// 因为我们在所有修改操作中都已经加锁了
		return cached, nil
	}
	sessionCacheLock.RUnlock()

	// 2. 缓存未命中，从文件读取
	sessionFile := filepath.Join(sessionsDir, id+".json")
	var session ChatSession
	if err := readJSON(sessionFile, &session); err != nil {
		return nil, err
	}

	// 确保Messages不为nil
	if session.Messages == nil {
		session.Messages = []ChatMessage{}
	}

	// 3. 加入缓存
	sessionCacheLock.Lock()
	sessionCache[id] = &session
	sessionCacheLock.Unlock()

	return &session, nil
}

// CreateSession 创建会话（写入缓存+文件）
func CreateSession(session *ChatSession) error {
	session.CreatedAt = time.Now()
	session.UpdatedAt = time.Now()

	if session.Messages == nil {
		session.Messages = []ChatMessage{}
	}

	// 更新缓存
	sessionCacheLock.Lock()
	sessionCache[session.ID] = session
	sessionCacheLock.Unlock()

	// 写入文件
	sessionFile := filepath.Join(sessionsDir, session.ID+".json")
	return writeJSON(sessionFile, session)
}

// UpdateSession 更新会话（更新缓存+写文件，不重复读文件）
func UpdateSession(session *ChatSession) error {
	sessionCacheLock.Lock()
	defer sessionCacheLock.Unlock()

	// 从缓存中获取原会话保留创建时间
	if cached, ok := sessionCache[session.ID]; ok {
		session.CreatedAt = cached.CreatedAt
	}

	session.UpdatedAt = time.Now()

	// 更新缓存
	sessionCache[session.ID] = session

	// 写入文件
	sessionFile := filepath.Join(sessionsDir, session.ID+".json")
	return writeJSON(sessionFile, session)
}

// DeleteSession 删除会话（删除缓存+文件）
func DeleteSession(id string) error {
	// 删除缓存
	sessionCacheLock.Lock()
	delete(sessionCache, id)
	sessionCacheLock.Unlock()

	// 删除文件
	sessionFile := filepath.Join(sessionsDir, id+".json")
	return os.Remove(sessionFile)
}

// AddMessage 向会话添加消息（直接操作缓存）
func AddMessage(sessionID string, message ChatMessage) error {
	sessionCacheLock.Lock()
	defer sessionCacheLock.Unlock()

	// 从缓存获取或加载
	session, ok := sessionCache[sessionID]
	if !ok {
		// 缓存未命中，从文件读取
		sessionFile := filepath.Join(sessionsDir, sessionID+".json")
		var loadedSession ChatSession
		if err := readJSON(sessionFile, &loadedSession); err != nil {
			return err
		}
		session = &loadedSession
		sessionCache[sessionID] = session
	}

	// 添加消息
	message.Timestamp = time.Now()
	session.Messages = append(session.Messages, message)
	session.UpdatedAt = time.Now()

	// 写入文件
	sessionFile := filepath.Join(sessionsDir, sessionID+".json")
	return writeJSON(sessionFile, session)
}

// GetMessages 获取会话的所有消息（返回副本）- 保留兼容性
func GetMessages(sessionID string, limit int) ([]ChatMessage, error) {
	messages, _, err := GetMessagesWithPagination(sessionID, limit, 0)
	return messages, err
}

// GetMessagesWithPagination 获取会话消息（支持分页）
func GetMessagesWithPagination(sessionID string, limit, offset int) ([]ChatMessage, int, error) {
	// 1. 确保session已加载到缓存
	_, err := GetSession(sessionID)
	if err != nil {
		return nil, 0, err
	}

	// 2. 从缓存读取（加读锁保护）
	sessionCacheLock.RLock()
	defer sessionCacheLock.RUnlock()

	session := sessionCache[sessionID]
	if session == nil || session.Messages == nil {
		return []ChatMessage{}, 0, nil
	}

	allMessages := session.Messages
	total := len(allMessages)

	// 3. 计算分页范围（倒序：最新的消息在最后）
	// offset=0 返回最新的消息
	// offset>0 返回更早的消息
	start := total - offset - limit
	if start < 0 {
		start = 0
	}
	end := total - offset
	if end > total {
		end = total
	}
	if end < 0 {
		end = 0
	}

	// 4. 切片获取指定范围的消息
	var messages []ChatMessage
	if start < end {
		messages = allMessages[start:end]
	} else {
		messages = []ChatMessage{}
	}

	// 5. 返回副本，避免外部修改
	result := make([]ChatMessage, len(messages))
	copy(result, messages)

	return result, total, nil
}

// ClearMessages 清空会话消息（直接操作缓存）
func ClearMessages(sessionID string) error {
	sessionCacheLock.Lock()
	defer sessionCacheLock.Unlock()

	// 从缓存获取或加载
	session, ok := sessionCache[sessionID]
	if !ok {
		sessionFile := filepath.Join(sessionsDir, sessionID+".json")
		var loadedSession ChatSession
		if err := readJSON(sessionFile, &loadedSession); err != nil {
			return err
		}
		session = &loadedSession
		sessionCache[sessionID] = session
	}

	// 清空消息
	session.Messages = []ChatMessage{}
	session.UpdatedAt = time.Now()

	// 写入文件
	sessionFile := filepath.Join(sessionsDir, sessionID+".json")
	return writeJSON(sessionFile, session)
}

// UpdateSessionModel 更新会话使用的模型（直接操作缓存）
func UpdateSessionModel(sessionID, modelID string) error {
	sessionCacheLock.Lock()
	defer sessionCacheLock.Unlock()

	// 从缓存获取或加载
	session, ok := sessionCache[sessionID]
	if !ok {
		sessionFile := filepath.Join(sessionsDir, sessionID+".json")
		var loadedSession ChatSession
		if err := readJSON(sessionFile, &loadedSession); err != nil {
			return err
		}
		session = &loadedSession
		sessionCache[sessionID] = session
	}

	// 更新模型
	session.ModelID = modelID
	session.UpdatedAt = time.Now()

	// 写入文件
	sessionFile := filepath.Join(sessionsDir, sessionID+".json")
	return writeJSON(sessionFile, session)
}

// UpdateMessageInSession 更新会话中的指定消息
func UpdateMessageInSession(sessionID string, messageIndex int, newContent string) error {
	sessionCacheLock.Lock()
	defer sessionCacheLock.Unlock()

	// 从缓存获取或加载
	session, ok := sessionCache[sessionID]
	if !ok {
		sessionFile := filepath.Join(sessionsDir, sessionID+".json")
		var loadedSession ChatSession
		if err := readJSON(sessionFile, &loadedSession); err != nil {
			return err
		}
		session = &loadedSession
		sessionCache[sessionID] = session
	}

	// 检查索引
	if messageIndex < 0 || messageIndex >= len(session.Messages) {
		return fmt.Errorf("消息索引超出范围")
	}

	// 更新消息内容
	session.Messages[messageIndex].Content = newContent
	session.Messages[messageIndex].Timestamp = time.Now()
	session.UpdatedAt = time.Now()

	// 写入文件
	sessionFile := filepath.Join(sessionsDir, sessionID+".json")
	return writeJSON(sessionFile, session)
}

// RevokeMessagesFromIndex 撤销指定索引及之后的所有消息
func RevokeMessagesFromIndex(sessionID string, messageIndex int) error {
	sessionCacheLock.Lock()
	defer sessionCacheLock.Unlock()

	// 从缓存获取或加载
	session, ok := sessionCache[sessionID]
	if !ok {
		sessionFile := filepath.Join(sessionsDir, sessionID+".json")
		var loadedSession ChatSession
		if err := readJSON(sessionFile, &loadedSession); err != nil {
			return err
		}
		session = &loadedSession
		sessionCache[sessionID] = session
	}

	// 检查索引
	if messageIndex < 0 || messageIndex >= len(session.Messages) {
		return fmt.Errorf("消息索引超出范围")
	}

	// 撤销该消息及之后的所有消息
	session.Messages = session.Messages[:messageIndex]
	session.UpdatedAt = time.Now()

	// 写入文件
	sessionFile := filepath.Join(sessionsDir, sessionID+".json")
	return writeJSON(sessionFile, session)
}
