package storage

import (
	"io/ioutil"
	"os"
	"path/filepath"
	"sort"
	"time"
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

// GetSession 获取会话（包含完整消息）
func GetSession(id string) (*ChatSession, error) {
	sessionFile := filepath.Join(sessionsDir, id+".json")

	var session ChatSession
	if err := readJSON(sessionFile, &session); err != nil {
		return nil, err
	}

	return &session, nil
}

// CreateSession 创建会话
func CreateSession(session *ChatSession) error {
	session.CreatedAt = time.Now()
	session.UpdatedAt = time.Now()

	if session.Messages == nil {
		session.Messages = []ChatMessage{}
	}

	sessionFile := filepath.Join(sessionsDir, session.ID+".json")
	return writeJSON(sessionFile, session)
}

// UpdateSession 更新会话
func UpdateSession(session *ChatSession) error {
	// 保留原创建时间
	oldSession, err := GetSession(session.ID)
	if err == nil {
		session.CreatedAt = oldSession.CreatedAt
	}

	session.UpdatedAt = time.Now()

	sessionFile := filepath.Join(sessionsDir, session.ID+".json")
	return writeJSON(sessionFile, session)
}

// DeleteSession 删除会话
func DeleteSession(id string) error {
	sessionFile := filepath.Join(sessionsDir, id+".json")
	return os.Remove(sessionFile)
}

// AddMessage 向会话添加消息
func AddMessage(sessionID string, message ChatMessage) error {
	session, err := GetSession(sessionID)
	if err != nil {
		return err
	}

	message.Timestamp = time.Now()
	session.Messages = append(session.Messages, message)
	session.UpdatedAt = time.Now()

	return UpdateSession(session)
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

// ClearMessages 清空会话消息
func ClearMessages(sessionID string) error {
	session, err := GetSession(sessionID)
	if err != nil {
		return err
	}

	session.Messages = []ChatMessage{}
	session.UpdatedAt = time.Now()

	return UpdateSession(session)
}

// UpdateSessionModel 更新会话使用的模型
func UpdateSessionModel(sessionID, modelID string) error {
	session, err := GetSession(sessionID)
	if err != nil {
		return err
	}

	session.ModelID = modelID
	session.UpdatedAt = time.Now()

	return UpdateSession(session)
}
