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
			// 创建副本，只保留元数据（不修改缓存）
			sessionCopy := ChatSession{
				ID:        session.ID,
				Title:     session.Title,
				ModelID:   session.ModelID,
				CreatedAt: session.CreatedAt,
				UpdatedAt: session.UpdatedAt,
				Messages:  nil, // 列表中不包含消息
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

// GetMessages 获取会话的所有消息（返回副本）
func GetMessages(sessionID string, limit int) ([]ChatMessage, error) {
	// 先尝试从缓存获取
	sessionCacheLock.RLock()
	session, ok := sessionCache[sessionID]
	sessionCacheLock.RUnlock()

	println("🔍 GetMessages:", sessionID, "缓存命中:", ok)

	// 缓存未命中，加载会话
	if !ok {
		println("📂 从文件加载会话...")
		loadedSession, err := GetSession(sessionID)
		if err != nil {
			println("❌ 加载失败:", err.Error())
			return nil, err
		}
		session = loadedSession
	}

	// 再次加锁读取消息
	sessionCacheLock.RLock()
	defer sessionCacheLock.RUnlock()

	if session.Messages == nil {
		println("⚠️  session.Messages 是 nil")
		return []ChatMessage{}, nil
	}

	println("✅ 找到", len(session.Messages), "条消息")
	messages := session.Messages

	// 限制返回数量
	if limit > 0 && len(messages) > limit {
		messages = messages[len(messages)-limit:]
	}

	// 返回副本
	result := make([]ChatMessage, len(messages))
	copy(result, messages)

	return result, nil
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
