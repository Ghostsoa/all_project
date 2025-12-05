package middleware

import (
	"all_project/config"
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// SessionStore 内存会话存储（服务重启后失效）
type SessionStore struct {
	sessions map[string]time.Time // token -> 过期时间
	mu       sync.RWMutex
}

var sessionStore = &SessionStore{
	sessions: make(map[string]time.Time),
}

// addSession 添加会话
func (s *SessionStore) addSession(token string, duration time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessions[token] = time.Now().Add(duration)
}

// isValid 检查token是否有效
func (s *SessionStore) isValid(token string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()

	expireTime, exists := s.sessions[token]
	if !exists {
		return false
	}

	// 检查是否过期
	if time.Now().After(expireTime) {
		// 过期了，异步清理
		go s.removeSession(token)
		return false
	}

	return true
}

// removeSession 移除会话
func (s *SessionStore) removeSession(token string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.sessions, token)
}

// generateSessionToken 生成随机会话token
func generateSessionToken() string {
	b := make([]byte, 32)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// cleanExpiredSessions 定期清理过期的session
func (s *SessionStore) cleanExpiredSessions() {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := time.Now()
	for token, expireTime := range s.sessions {
		if now.After(expireTime) {
			delete(s.sessions, token)
		}
	}
}

// StartCleanupTask 启动清理任务（每小时清理一次）
func StartCleanupTask() {
	go func() {
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()

		for range ticker.C {
			sessionStore.cleanExpiredSessions()
		}
	}()
}

// GinAuthMiddleware Gin认证中间件（用于API，返回JSON）
func GinAuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// 获取 Token
		token := c.GetHeader("Authorization")
		if token == "" {
			// 尝试从 Cookie 获取
			token, _ = c.Cookie("auth_token")
		} else {
			// 移除 "Bearer " 前缀
			token = strings.TrimPrefix(token, "Bearer ")
		}

		// 验证 Token（检查内存中的session）
		if token == "" || !sessionStore.isValid(token) {
			c.JSON(http.StatusUnauthorized, gin.H{
				"success": false,
				"error":   "未授权访问或会话已过期",
			})
			c.Abort()
			return
		}

		// Token 有效，继续处理
		c.Next()
	}
}

// GinPageAuthMiddleware Gin页面认证中间件（用于页面，重定向到登录）
func GinPageAuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// 获取 Token
		token := c.GetHeader("Authorization")
		if token == "" {
			// 尝试从 Cookie 获取
			token, _ = c.Cookie("auth_token")
		} else {
			// 移除 "Bearer " 前缀
			token = strings.TrimPrefix(token, "Bearer ")
		}

		// 验证 Token（检查内存中的session）
		if token == "" || !sessionStore.isValid(token) {
			// 页面访问：重定向到登录页
			c.Redirect(http.StatusFound, "/login")
			c.Abort()
			return
		}

		// Token 有效，继续处理
		c.Next()
	}
}

// GinLoginHandler Gin登录处理
func GinLoginHandler(c *gin.Context) {
	var data map[string]string
	if err := c.ShouldBindJSON(&data); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "无效的请求数据",
		})
		return
	}

	inputToken := data["token"]
	if inputToken == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Token不能为空",
		})
		return
	}

	// 验证输入的Token是否等于配置文件中的密码
	if inputToken != config.GetToken() {
		c.JSON(http.StatusUnauthorized, gin.H{
			"success": false,
			"error":   "Token 错误",
		})
		return
	}

	// 登录成功，生成随机session token
	sessionToken := generateSessionToken()

	// 存入内存（30天有效期）
	sessionStore.addSession(sessionToken, 30*24*time.Hour)

	// 设置 Cookie（使用生成的session token）
	c.SetCookie(
		"auth_token",
		sessionToken,
		86400*30, // 30天
		"/",
		"",
		false,
		true, // HttpOnly
	)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "登录成功",
	})
}

// GinLogoutHandler Gin登出处理
func GinLogoutHandler(c *gin.Context) {
	// 获取当前token
	token, _ := c.Cookie("auth_token")

	// 从内存中移除session
	if token != "" {
		sessionStore.removeSession(token)
	}

	// 清除 Cookie
	c.SetCookie(
		"auth_token",
		"",
		-1,
		"/",
		"",
		false,
		true,
	)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "登出成功",
	})
}
