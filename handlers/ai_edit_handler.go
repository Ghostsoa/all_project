package handlers

import (
	"all_project/models"
	"all_project/storage"
	"log"
	"net/http"
	"os"

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
	ToolCallID     string `json:"tool_call_id"`
	Status         string `json:"status"` // "accepted" or "rejected"
	FilePath       string `json:"file_path"`
	ConversationID string `json:"conversation_id"`
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

	manager := models.GetPendingStateManager()

	// 处理Accept/Reject
	if req.Status == "accepted" {
		// Accept: 写入这个版本，删除它及之前的，保留后续的
		var acceptedToolCallIDs []string
		if req.FilePath != "" {
			conversationID := req.ConversationID
			if conversationID == "" {
				conversationID = "default_current" // fallback
			}

			// 使用AcceptVersion获取要写入的内容、后续版本和被Accept的toolCallIDs
			acceptedContent, remainingVersions, acceptedIDs, err := manager.AcceptVersion(conversationID, req.FilePath, req.ToolCallID)
			if err != nil {
				log.Printf("❌ Accept版本失败: %v", err)
				c.JSON(http.StatusInternalServerError, gin.H{
					"success": false,
					"error":   "Accept失败",
				})
				return
			}

			acceptedToolCallIDs = acceptedIDs

			if acceptedContent != "" {
				// 1. 先备份当前磁盘文件到历史
				historyManager := models.GetFileHistoryManager()
				if err := historyManager.BackupAndAddVersion(req.FilePath, "Accept前备份"); err != nil {
					log.Printf("⚠️ 备份文件失败: %v（继续写入）", err)
				} else {
					log.Printf("📦 已备份文件到历史")
				}

				// 2. 写入Accept的版本到磁盘
				if err := os.WriteFile(req.FilePath, []byte(acceptedContent), 0644); err != nil {
					log.Printf("❌ 写入文件失败: %v", err)
					c.JSON(http.StatusInternalServerError, gin.H{
						"success": false,
						"error":   "写入文件失败",
					})
					return
				}

				// 3. 如果有后续版本，恢复它们
				if len(remainingVersions) > 0 {
					if err := manager.RestoreVersions(conversationID, req.FilePath, remainingVersions); err != nil {
						log.Printf("⚠️ 恢复后续版本失败: %v", err)
					}
					log.Printf("✅ Accept并写入文件: %s，保留 %d 个后续版本，连带Accept %d 个", req.FilePath, len(remainingVersions), len(acceptedToolCallIDs))
				} else {
					log.Printf("✅ Accept并写入文件: %s，无后续版本，连带Accept %d 个", req.FilePath, len(acceptedToolCallIDs))
				}
			}
		}

		// 更新所有被连带Accept的消息状态
		allToolCallIDs := acceptedToolCallIDs
		if len(allToolCallIDs) == 0 {
			allToolCallIDs = []string{req.ToolCallID}
		}

		for _, tcID := range allToolCallIDs {
			if err := storage.UpdateToolMessageStatus(tcID, req.Status); err != nil {
				log.Printf("❌ 更新tool消息状态失败 (%s): %v", tcID, err)
			} else {
				log.Printf("✅ 已更新消息状态: %s -> accepted", tcID)
			}
		}

		c.JSON(http.StatusOK, gin.H{
			"success":           true,
			"message":           "状态已更新",
			"accepted_tool_ids": allToolCallIDs, // 返回所有被Accept的IDs给前端
		})
		return
	} else if req.Status == "rejected" {
		// Reject: 清除pending（链式取消）
		var rejectedToolCallIDs []string
		if req.FilePath != "" && req.ConversationID != "" {
			// 调用RejectVersion返回被删除的所有版本的toolCallIDs
			deletedIDs, err := manager.RejectVersion(req.ConversationID, req.FilePath, req.ToolCallID)
			if err != nil {
				log.Printf("⚠️ 清除pending状态失败: %v", err)
			} else {
				rejectedToolCallIDs = deletedIDs
				log.Printf("❌ Reject并清除pending: %s, 链式删除了 %d 个版本", req.FilePath, len(rejectedToolCallIDs))
			}
		}

		// 更新所有被链式Reject的消息状态
		allToolCallIDs := rejectedToolCallIDs
		if len(allToolCallIDs) == 0 {
			allToolCallIDs = []string{req.ToolCallID}
		}

		for _, tcID := range allToolCallIDs {
			if err := storage.UpdateToolMessageStatus(tcID, req.Status); err != nil {
				log.Printf("❌ 更新tool消息状态失败 (%s): %v", tcID, err)
			} else {
				log.Printf("✅ 已更新消息状态: %s -> rejected", tcID)
			}
		}

		c.JSON(http.StatusOK, gin.H{
			"success":           true,
			"message":           "状态已更新",
			"rejected_tool_ids": allToolCallIDs, // 返回所有被Reject的IDs给前端
		})
		return
	}

	// Accept情况：只更新当前消息状态
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

// 注：文件历史自动备份（Accept时），回退通过消息撤销自动实现
