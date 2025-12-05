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

	// 如果没有指定模型，自动选择默认模型
	modelID := req.ModelID
	if modelID == "" {
		// 1. 优先继承最新会话的模型
		sessions, err := storage.GetAllSessions()
		if err == nil && len(sessions) > 0 {
			// 按更新时间排序，取最新的
			latestSession := sessions[0]
			for _, s := range sessions {
				if s.UpdatedAt.After(latestSession.UpdatedAt) {
					latestSession = s
				}
			}
			if latestSession.ModelID != "" {
				modelID = latestSession.ModelID
			}
		}

		// 2. 如果没有历史会话或历史会话没有模型，使用第一个模型
		if modelID == "" {
			providers, err := storage.GetProviders()
			if err == nil && len(providers) > 0 {
				for _, provider := range providers {
					if len(provider.Models) > 0 {
						modelID = provider.Models[0].ID
						break
					}
				}
			}
		}
	}

	session := &storage.ChatSession{
		ID:      generateSessionID(),
		Title:   req.Title,
		ModelID: modelID,
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

// GetMessages 获取会话消息（支持分页）
func (h *AISessionsHandler) GetMessages(c *gin.Context) {
	sessionID := c.Query("session_id")
	if sessionID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "缺少session_id参数"})
		return
	}

	limitStr := c.DefaultQuery("limit", "20")
	offsetStr := c.DefaultQuery("offset", "0")

	limit, _ := strconv.Atoi(limitStr)
	offset, _ := strconv.Atoi(offsetStr)

	messages, total, err := storage.GetMessagesWithPagination(sessionID, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success":  true,
		"data":     messages,
		"total":    total,
		"offset":   offset,
		"limit":    limit,
		"has_more": offset+len(messages) < total,
	})
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

// UpdateMessage 更新会话中的消息
func (h *AISessionsHandler) UpdateMessage(c *gin.Context) {
	var req struct {
		SessionID    string `json:"session_id"`
		MessageIndex int    `json:"message_index"`
		NewContent   string `json:"new_content"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "参数错误"})
		return
	}

	if err := storage.UpdateMessageInSession(req.SessionID, req.MessageIndex, req.NewContent); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "message": "更新成功"})
}

// DeleteMessage 删除会话中的消息
func (h *AISessionsHandler) DeleteMessage(c *gin.Context) {
	var req struct {
		SessionID    string `json:"session_id"`
		MessageIndex int    `json:"message_index"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "参数错误"})
		return
	}

	if err := storage.DeleteMessageFromSession(req.SessionID, req.MessageIndex); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "message": "删除成功"})
}

func generateSessionID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}
