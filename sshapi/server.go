package sshapi

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
)

// Server HTTP API服务器
type Server struct {
	manager *SessionManager
	addr    string
}

// NewServer 创建API服务器
func NewServer(addr string) *Server {
	return &Server{
		manager: NewSessionManager(),
		addr:    addr,
	}
}

// Start 启动服务器
func (s *Server) Start() error {
	http.HandleFunc("/session/create", s.handleCreateSession)
	http.HandleFunc("/session/", s.handleSession)
	http.HandleFunc("/sessions", s.handleListSessions)

	log.Printf("SSH API服务器启动在 %s", s.addr)
	return http.ListenAndServe(s.addr, nil)
}

// handleCreateSession 处理创建会话
func (s *Server) handleCreateSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		s.sendError(w, http.StatusMethodNotAllowed, "只支持POST方法")
		return
	}

	var config SessionConfig
	if err := json.NewDecoder(r.Body).Decode(&config); err != nil {
		s.sendError(w, http.StatusBadRequest, "请求参数错误: "+err.Error())
		return
	}

	// 使用默认配置
	if config.Shell == "" {
		config.Shell = "bash"
	}

	sess, err := s.manager.CreateSession(&config)
	if err != nil {
		s.sendError(w, http.StatusInternalServerError, err.Error())
		return
	}

	s.sendJSON(w, map[string]interface{}{
		"session_id": sess.ID,
		"info":       sess.GetInfo(),
	})
}

// handleSession 处理会话相关请求
func (s *Server) handleSession(w http.ResponseWriter, r *http.Request) {
	// 解析路径: /session/{id}/{action}
	path := strings.TrimPrefix(r.URL.Path, "/session/")
	parts := strings.Split(path, "/")
	if len(parts) < 1 {
		s.sendError(w, http.StatusBadRequest, "无效的请求路径")
		return
	}

	sessionID := parts[0]
	action := ""
	if len(parts) > 1 {
		action = parts[1]
	}

	// 获取会话
	sess, err := s.manager.GetSession(sessionID)
	if err != nil {
		s.sendError(w, http.StatusNotFound, err.Error())
		return
	}

	switch action {
	case "screen":
		s.handleGetScreen(w, r, sess)
	case "input":
		s.handleSendInput(w, r, sess)
	case "info":
		s.handleGetInfo(w, r, sess)
	case "close":
		s.handleCloseSession(w, r, sessionID)
	default:
		s.sendError(w, http.StatusNotFound, "未知的操作: "+action)
	}
}

// handleGetScreen 获取屏幕内容
func (s *Server) handleGetScreen(w http.ResponseWriter, r *http.Request, sess *Session) {
	if r.Method != http.MethodGet {
		s.sendError(w, http.StatusMethodNotAllowed, "只支持GET方法")
		return
	}

	screen := sess.GetScreen()
	s.sendJSON(w, screen)
}

// handleSendInput 发送输入
func (s *Server) handleSendInput(w http.ResponseWriter, r *http.Request, sess *Session) {
	if r.Method != http.MethodPost {
		s.sendError(w, http.StatusMethodNotAllowed, "只支持POST方法")
		return
	}

	var req InputRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		s.sendError(w, http.StatusBadRequest, "请求参数错误: "+err.Error())
		return
	}

	if err := sess.SendInput(req.Command); err != nil {
		s.sendError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// 等待一下让输出稳定
	// time.Sleep(500 * time.Millisecond)

	// 返回最新的屏幕内容
	screen := sess.GetScreen()
	s.sendJSON(w, screen)
}

// handleGetInfo 获取会话信息
func (s *Server) handleGetInfo(w http.ResponseWriter, r *http.Request, sess *Session) {
	if r.Method != http.MethodGet {
		s.sendError(w, http.StatusMethodNotAllowed, "只支持GET方法")
		return
	}

	info := sess.GetInfo()
	s.sendJSON(w, info)
}

// handleCloseSession 关闭会话
func (s *Server) handleCloseSession(w http.ResponseWriter, r *http.Request, sessionID string) {
	if r.Method != http.MethodDelete && r.Method != http.MethodPost {
		s.sendError(w, http.StatusMethodNotAllowed, "只支持DELETE或POST方法")
		return
	}

	if err := s.manager.CloseSession(sessionID); err != nil {
		s.sendError(w, http.StatusInternalServerError, err.Error())
		return
	}

	s.sendJSON(w, map[string]string{
		"message": "会话已关闭",
	})
}

// handleListSessions 列出所有会话
func (s *Server) handleListSessions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		s.sendError(w, http.StatusMethodNotAllowed, "只支持GET方法")
		return
	}

	sessions := s.manager.ListSessions()
	s.sendJSON(w, map[string]interface{}{
		"sessions": sessions,
		"count":    len(sessions),
	})
}

// sendJSON 发送JSON响应
func (s *Server) sendJSON(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}

// sendError 发送错误响应
func (s *Server) sendError(w http.ResponseWriter, code int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(ErrorResponse{
		Error:   http.StatusText(code),
		Message: message,
	})
}

// GetManager 获取会话管理器（用于测试）
func (s *Server) GetManager() *SessionManager {
	return s.manager
}
