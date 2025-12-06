package handlers

import (
	"all_project/models"
	"all_project/storage"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
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

	// 1. 先获取要删除的消息列表（用于清理pending状态和恢复文件）
	messages, err := storage.GetMessages(req.SessionID, 0) // limit=0表示获取所有消息
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	// 2. 清理被删除消息的pending状态
	pendingManager := models.GetPendingStateManager()

	// 2. 收集需要恢复的文件（被删除的消息中有accepted的edit）
	var needRestoreFiles = make(map[string]bool) // file_path -> true

	for i := req.MessageIndex; i < len(messages); i++ {
		msg := messages[i]

		// 检查tool消息，找到accepted的edit
		if msg.Role == "tool" && msg.ToolName == "file_operation" {
			// 尝试解析Content字段（可能包含status信息）
			// Content格式可能是JSON或纯文本，需要兼容处理
			if len(msg.Content) > 0 && msg.Content[0] == '{' {
				var toolResult struct {
					Status   string `json:"status"`
					FilePath string `json:"file_path"`
				}
				// 忽略解析错误，因为有些tool响应可能不是JSON
				_ = json.Unmarshal([]byte(msg.Content), &toolResult)
				if toolResult.Status == "accepted" && toolResult.FilePath != "" {
					needRestoreFiles[toolResult.FilePath] = true
					log.Printf("📝 发现被撤销的accepted edit: %s", toolResult.FilePath)
				}
			}
		}

		// 对于assistant消息，从ToolCalls中提取tool_call_id
		if msg.Role == "assistant" && len(msg.ToolCalls) > 0 {
			for _, toolCall := range msg.ToolCalls {
				// 提取tool_call的id
				if toolCallID, ok := toolCall["id"].(string); ok && toolCallID != "" {
					// 使用tool_call_id作为messageID清理pending
					if err := pendingManager.RemoveVersionsByMessageID(req.SessionID, toolCallID); err != nil {
						log.Printf("⚠️ 清理pending失败 (toolCallID: %s): %v", toolCallID, err)
					} else {
						log.Printf("🧹 已清理pending状态 (toolCallID: %s)", toolCallID)
					}
				}
			}
		}
	}

	// 3. 执行消息撤销
	if err := storage.RevokeMessagesFromIndex(req.SessionID, req.MessageIndex); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	// 4. 恢复被影响的文件（如果删除了accepted的edit，需要恢复到前一个状态）
	// 统计每个文件有多少个accepted的edit被删除
	fileAcceptedCount := make(map[string]int)
	for i := req.MessageIndex; i < len(messages); i++ {
		msg := messages[i]
		if msg.Role == "tool" && msg.ToolName == "file_operation" {
			if len(msg.Content) > 0 && msg.Content[0] == '{' {
				var toolResult struct {
					Status   string `json:"status"`
					FilePath string `json:"file_path"`
				}
				_ = json.Unmarshal([]byte(msg.Content), &toolResult)
				if toolResult.Status == "accepted" && toolResult.FilePath != "" {
					fileAcceptedCount[toolResult.FilePath]++
				}
			}
		}
	}

	// 对每个文件，根据被删除的accepted数量，多次恢复历史
	if len(fileAcceptedCount) > 0 {
		historyManager := models.GetFileHistoryManager()
		for filePath, count := range fileAcceptedCount {
			log.Printf("📝 文件 %s 需要恢复 %d 次", filePath, count)
			for i := 0; i < count; i++ {
				if err := historyManager.RestoreLatestVersion(filePath); err != nil {
					log.Printf("⚠️ 恢复文件失败 (第%d次): %s, error: %v", i+1, filePath, err)
					break
				} else {
					log.Printf("✅ 已恢复文件 (第%d/%d次): %s", i+1, count, filePath)
				}
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "message": "撤销成功"})
}

func generateSessionID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}
