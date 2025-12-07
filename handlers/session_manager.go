package handlers

import (
	"sync"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

// SSHSession SSH会话（包含SSH客户端和SFTP客户端）
type SSHSession struct {
	SSHClient  *ssh.Client
	SFTPClient *sftp.Client
	ServerID   string // 服务器ID
	LastActive time.Time
	mu         sync.Mutex
}

// SessionManager 全局会话管理器
type SessionManager struct {
	sessionsByID     map[string]*SSHSession // session_id → Session
	sessionsByServer map[string]*SSHSession // server_id → Session（最新）
	mu               sync.RWMutex
}

var globalSessionManager = &SessionManager{
	sessionsByID:     make(map[string]*SSHSession),
	sessionsByServer: make(map[string]*SSHSession),
}

// GetSessionManager 获取全局会话管理器
func GetSessionManager() *SessionManager {
	return globalSessionManager
}

// AddSession 添加会话
func (sm *SessionManager) AddSession(sessionID string, serverID string, sshClient *ssh.Client, sftpClient *sftp.Client) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	session := &SSHSession{
		SSHClient:  sshClient,
		SFTPClient: sftpClient,
		ServerID:   serverID,
		LastActive: time.Now(),
	}

	sm.sessionsByID[sessionID] = session
	sm.sessionsByServer[serverID] = session // 保存最新会话
}

// GetSession 获取会话（通过session_id）
func (sm *SessionManager) GetSession(sessionID string) *SSHSession {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	session := sm.sessionsByID[sessionID]
	if session != nil {
		session.mu.Lock()
		session.LastActive = time.Now()
		session.mu.Unlock()
	}
	return session
}

// GetSessionByServerID 获取会话（通过server_id）
func (sm *SessionManager) GetSessionByServerID(serverID string) *SSHSession {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	session := sm.sessionsByServer[serverID]
	if session != nil {
		session.mu.Lock()
		session.LastActive = time.Now()
		session.mu.Unlock()
	}
	return session
}

// RemoveSession 移除会话
func (sm *SessionManager) RemoveSession(sessionID string) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	if session, ok := sm.sessionsByID[sessionID]; ok {
		// 关闭SFTP客户端
		if session.SFTPClient != nil {
			session.SFTPClient.Close()
		}
		// 从两个映射中删除
		delete(sm.sessionsByID, sessionID)
		if session.ServerID != "" {
			delete(sm.sessionsByServer, session.ServerID)
		}
	}
}

// CleanupInactiveSessions 清理不活跃的会话（可选，定期调用）
func (sm *SessionManager) CleanupInactiveSessions(timeout time.Duration) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	now := time.Now()
	for sessionID, session := range sm.sessionsByID {
		session.mu.Lock()
		if now.Sub(session.LastActive) > timeout {
			if session.SFTPClient != nil {
				session.SFTPClient.Close()
			}
			delete(sm.sessionsByID, sessionID)
			if session.ServerID != "" {
				delete(sm.sessionsByServer, session.ServerID)
			}
		}
		session.mu.Unlock()
	}
}
