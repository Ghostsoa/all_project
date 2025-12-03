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
	LastActive time.Time
	mu         sync.Mutex
}

// SessionManager 全局会话管理器
type SessionManager struct {
	sessions map[string]*SSHSession
	mu       sync.RWMutex
}

var globalSessionManager = &SessionManager{
	sessions: make(map[string]*SSHSession),
}

// GetSessionManager 获取全局会话管理器
func GetSessionManager() *SessionManager {
	return globalSessionManager
}

// AddSession 添加会话
func (sm *SessionManager) AddSession(sessionID string, sshClient *ssh.Client, sftpClient *sftp.Client) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	sm.sessions[sessionID] = &SSHSession{
		SSHClient:  sshClient,
		SFTPClient: sftpClient,
		LastActive: time.Now(),
	}
}

// GetSession 获取会话
func (sm *SessionManager) GetSession(sessionID string) *SSHSession {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	session := sm.sessions[sessionID]
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

	if session, ok := sm.sessions[sessionID]; ok {
		// 关闭SFTP客户端
		if session.SFTPClient != nil {
			session.SFTPClient.Close()
		}
		// SSH客户端由WebSocket handler管理，不在这里关闭
		delete(sm.sessions, sessionID)
	}
}

// CleanupInactiveSessions 清理不活跃的会话（可选，定期调用）
func (sm *SessionManager) CleanupInactiveSessions(timeout time.Duration) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	now := time.Now()
	for sessionID, session := range sm.sessions {
		session.mu.Lock()
		if now.Sub(session.LastActive) > timeout {
			if session.SFTPClient != nil {
				session.SFTPClient.Close()
			}
			delete(sm.sessions, sessionID)
		}
		session.mu.Unlock()
	}
}
