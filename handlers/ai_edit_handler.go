package handlers

import (
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
	PreviewID string `json:"preview_id"`
}

// ApplyEdit 应用编辑（用户确认） - 只返回成功，前端负责文件写入
func (h *AIEditHandler) ApplyEdit(c *gin.Context) {
	var req ApplyEditRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Invalid request",
		})
		return
	}

	// 只返回成功，前端会自己调用文件API执行写入
	log.Printf("✅ 用户确认编辑: %s", req.PreviewID)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "已确认，前端执行写入",
	})
}

// RejectEdit 拒绝编辑 - 只返回成功，前端负责清理UI
func (h *AIEditHandler) RejectEdit(c *gin.Context) {
	var req ApplyEditRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Invalid request",
		})
		return
	}

	// 只返回成功，前端会自己清理UI
	log.Printf("🚫 用户拒绝编辑: %s", req.PreviewID)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "已拒绝",
	})
}
