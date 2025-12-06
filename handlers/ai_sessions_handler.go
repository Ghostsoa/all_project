package handlers

import (
	"all_project/models"
	"all_project/storage"
	"crypto/rand"
	"encoding/hex"
	"log"
	"net/http"
	"os"
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

	// 1. 清理file_history
	historyManager := models.GetFileHistoryManager()
	if err := historyManager.ClearConversation(id); err != nil {
		log.Printf("⚠️ 清理文件历史失败: %v", err)
	}

	// 2. 清理pending_state
	pendingManager := models.GetPendingStateManager()
	if err := pendingManager.ClearAll(id); err != nil {
		log.Printf("⚠️ 清理pending状态失败: %v", err)
	}

	// 3. 删除会话
	if err := storage.DeleteSession(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	log.Printf("✅ 已删除会话及关联数据: %s", id)
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "删除成功"})
}

// ClearSession 清空会话消息
func (h *AISessionsHandler) ClearSession(c *gin.Context) {
	id := c.Query("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "缺少id参数"})
		return
	}

	// 1. 清理file_history
	historyManager := models.GetFileHistoryManager()
	if err := historyManager.ClearConversation(id); err != nil {
		log.Printf("⚠️ 清理文件历史失败: %v", err)
	}

	// 2. 清理pending_state
	pendingManager := models.GetPendingStateManager()
	if err := pendingManager.ClearAll(id); err != nil {
		log.Printf("⚠️ 清理pending状态失败: %v", err)
	}

	// 3. 清空消息
	if err := storage.ClearMessages(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	log.Printf("✅ 已清空会话及关联数据: %s", id)
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

// RevokeMessage 撤销会话中指定消息及之后的所有消息
func (h *AISessionsHandler) RevokeMessage(c *gin.Context) {
	var req struct {
		SessionID    string `json:"session_id"`
		MessageIndex int    `json:"message_index"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "参数错误"})
		return
	}

	pendingManager := models.GetPendingStateManager()
	historyManager := models.GetFileHistoryManager()

	log.Printf("========================================")
	log.Printf("🔄 撤销会话 %s 从索引 %d 开始的消息", req.SessionID, req.MessageIndex)

	// 0. 将消息索引转换为Turn索引
	session, err := storage.GetSession(req.SessionID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "获取会话失败"})
		return
	}

	// 统计从0到messageIndex之间的用户消息数量，这就是要删除的Turn索引
	userMessageCount := 0
	for i := 0; i < len(session.Messages) && i < req.MessageIndex; i++ {
		if session.Messages[i].Role == "user" {
			userMessageCount++
		}
	}
	turnIndex := userMessageCount

	log.Printf("📊 消息索引%d对应Turn%d（共%d个用户消息）", req.MessageIndex, turnIndex, userMessageCount)

	// 1. 删除从turnIndex开始的pending轮次
	if err := pendingManager.RemoveTurnsFrom(req.SessionID, turnIndex); err != nil {
		log.Printf("⚠️ 删除pending失败: %v", err)
	}

	// 2. 删除从turnIndex开始的快照，并获取需要恢复的文件
	restoredFiles, err := historyManager.RemoveSnapshotsFrom(req.SessionID, turnIndex)
	if err != nil {
		log.Printf("⚠️ 删除快照失败: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	// 3. 恢复文件到上一个快照状态
	for filePath, content := range restoredFiles {
		if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
			log.Printf("⚠️ 恢复文件失败 %s: %v", filePath, err)
		} else {
			log.Printf("✅ 恢复文件: %s (%d字节)", filePath, len(content))
		}
	}

	// 4. 执行消息撤销
	if err := storage.RevokeMessagesFromIndex(req.SessionID, req.MessageIndex); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	log.Printf("========================================")
	log.Printf("✅ 撤销成功: 恢复了 %d 个文件", len(restoredFiles))

	c.JSON(http.StatusOK, gin.H{"success": true, "message": "撤销成功"})
}

func generateSessionID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}
