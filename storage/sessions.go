package storage

import (
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
			// 只保留元数据，清空消息（减少内存）
			session.Messages = nil
			sessions = append(sessions, *session)
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
		// 返回副本，避免外部修改影响缓存
		sessionCopy := *cached
		return &sessionCopy, nil
	}
	sessionCacheLock.RUnlock()

	// 2. 缓存未命中，从文件读取
	sessionFile := filepath.Join(sessionsDir, id+".json")
	var session ChatSession
	if err := readJSON(sessionFile, &session); err != nil {
		return nil, err
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

// GetMessages 获取会话的所有消息
func GetMessages(sessionID string, limit int) ([]ChatMessage, error) {
	session, err := GetSession(sessionID)
	if err != nil {
		return nil, err
	}

	messages := session.Messages

	// 限制返回数量
	if limit > 0 && len(messages) > limit {
		messages = messages[len(messages)-limit:]
	}

	return messages, nil
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
