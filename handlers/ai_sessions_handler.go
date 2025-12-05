package handlers

import (
	"all_project/storage"
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

type AISessionsHandler struct{}

func NewAISessionsHandler() *AISessionsHandler {
	return &AISessionsHandler{}
}

// GetSessions 获取所有会话列表
func (h *AISessionsHandler) GetSessions(c *gin.Context) {
	sessions, err := storage.GetAllSessions()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": sessions})
}

// GetSession 获取单个会话（含消息）
func (h *AISessionsHandler) GetSession(c *gin.Context) {
	id := c.Query("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "缺少id参数"})
		return
	}

	session, err := storage.GetSession(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": err.Error()})
		return
	}

	// 返回完整的会话配置（包括模型和模板信息）
	c.JSON(http.StatusOK, gin.H{"success": true, "data": map[string]interface{}{
		"id":         session.ID,
		"title":      session.Title,
		"model_id":   session.ModelID,
		"created_at": session.CreatedAt,
		"updated_at": session.UpdatedAt,
		"messages":   session.Messages,
	}})
}

// CreateSession 创建会话
func (h *AISessionsHandler) CreateSession(c *gin.Context) {
	var req struct {
		Title   string `json:"title"`
		ModelID string `json:"model_id"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "参数错误"})
		return
	}

	session := &storage.ChatSession{
		ID:      generateSessionID(),
		Title:   req.Title,
		ModelID: req.ModelID,
	}

	if err := storage.CreateSession(session); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": session})
}

// DeleteSession 删除会话
func (h *AISessionsHandler) DeleteSession(c *gin.Context) {
	id := c.Query("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "缺少id参数"})
		return
	}

	if err := storage.DeleteSession(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "message": "删除成功"})
}

// ClearSession 清空会话消息
func (h *AISessionsHandler) ClearSession(c *gin.Context) {
	id := c.Query("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "缺少id参数"})
		return
	}

	if err := storage.ClearMessages(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "message": "清空成功"})
}

// GetMessages 获取会话消息
func (h *AISessionsHandler) GetMessages(c *gin.Context) {
	sessionID := c.Query("session_id")
	if sessionID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "缺少session_id参数"})
		return
	}

	limitStr := c.DefaultQuery("limit", "50")
	limit, _ := strconv.Atoi(limitStr)

	messages, err := storage.GetMessages(sessionID, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": messages})
}

// UpdateSessionModel 更新会话使用的模型
func (h *AISessionsHandler) UpdateSessionModel(c *gin.Context) {
	var req struct {
		SessionID string `json:"session_id"`
		ModelID   string `json:"model_id"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "参数错误"})
		return
	}

	if err := storage.UpdateSessionModel(req.SessionID, req.ModelID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "message": "更新成功"})
}

func generateSessionID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}
