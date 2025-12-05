package handlers

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
)

// AIEditHandler 处理AI编辑的确认/拒绝
type AIEditHandler struct {
	toolExecutor *ToolExecutor
}

// NewAIEditHandler 创建编辑处理器
func NewAIEditHandler(toolExecutor *ToolExecutor) *AIEditHandler {
	return &AIEditHandler{
		toolExecutor: toolExecutor,
	}
}

// ApplyEditRequest 应用编辑请求
type ApplyEditRequest struct {
	PreviewID string `json:"preview_id"`
}

// ApplyEdit 应用编辑（用户确认）
func (h *AIEditHandler) ApplyEdit(c *gin.Context) {
	var req ApplyEditRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Invalid request",
		})
		return
	}

	// 应用编辑
	if err := h.toolExecutor.ApplyEdit(req.PreviewID); err != nil {
		log.Printf("❌ 应用编辑失败: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   err.Error(),
		})
		return
	}

	log.Printf("✅ 已应用编辑: %s", req.PreviewID)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "编辑已应用",
	})
}

// RejectEdit 拒绝编辑
func (h *AIEditHandler) RejectEdit(c *gin.Context) {
	var req ApplyEditRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Invalid request",
		})
		return
	}

	// 拒绝编辑
	h.toolExecutor.RejectEdit(req.PreviewID)

	log.Printf("🚫 已拒绝编辑: %s", req.PreviewID)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "编辑已拒绝",
	})
}
