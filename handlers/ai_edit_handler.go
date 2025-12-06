package handlers

import (
	"all_project/storage"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
)

// AIEditHandler 处理AI编辑的确认/拒绝
type AIEditHandler struct {
	// 不需要存储任何状态，只是返回成功/失败
}

// NewAIEditHandler 创建编辑处理器
func NewAIEditHandler() *AIEditHandler {
	return &AIEditHandler{}
}

// ApplyEditRequest 应用编辑请求
type ApplyEditRequest struct {
	ToolCallID string `json:"tool_call_id"`
	Status     string `json:"status"` // "accepted" or "rejected"
}

// ApplyEdit 应用编辑（用户确认） - 更新数据库中tool消息的状态
func (h *AIEditHandler) ApplyEdit(c *gin.Context) {
	var req ApplyEditRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Invalid request",
		})
		return
	}

	// 更新数据库中对应的tool消息状态
	if err := storage.UpdateToolMessageStatus(req.ToolCallID, req.Status); err != nil {
		log.Printf("❌ 更新tool消息状态失败: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "更新状态失败",
		})
		return
	}

	log.Printf("✅ 用户确认编辑: %s -> %s", req.ToolCallID, req.Status)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "状态已更新",
	})
}
