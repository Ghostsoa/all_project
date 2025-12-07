package handlers

import (
	"all_project/models"
	"all_project/storage"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
)

// AIEditHandler 处理AI编辑的确认/拒绝
type AIEditHandler struct{}

// NewAIEditHandler 创建编辑处理器
func NewAIEditHandler() *AIEditHandler {
	return &AIEditHandler{}
}

// ApplyEditRequest 应用编辑请求
type ApplyEditRequest struct {
	ToolCallID     string `json:"tool_call_id"` // 兼容旧API，实际不使用
	Status         string `json:"status"`       // "accepted" or "rejected"
	FilePath       string `json:"file_path"`    // 兼容旧API，实际不使用
	ConversationID string `json:"conversation_id"`
}

// ApplyEdit Accept All 或 Reject All
func (h *AIEditHandler) ApplyEdit(c *gin.Context) {
	var req ApplyEditRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Invalid request",
		})
		return
	}

	pendingManager := models.GetPendingStateManager()
	historyManager := models.GetFileHistoryManager()

	if req.Status == "accepted" {
		// Accept All: 应用所有pending，保存快照，写入磁盘
		if err := h.acceptAll(req.ConversationID, pendingManager, historyManager); err != nil {
			log.Printf("❌ Accept All失败: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{
				"success": false,
				"error":   fmt.Sprintf("Accept失败: %v", err),
			})
			return
		}

		log.Printf("✅ Accept All成功: %s", req.ConversationID)
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"message": "已确认所有修改",
		})

	} else if req.Status == "rejected" {
		// Reject All: 清空pending，删除未确认的快照
		if err := h.rejectAll(req.ConversationID, pendingManager, historyManager); err != nil {
			log.Printf("❌ Reject All失败: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{
				"success": false,
				"error":   fmt.Sprintf("Reject失败: %v", err),
			})
			return
		}

		log.Printf("✅ Reject All成功: %s", req.ConversationID)
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"message": "已取消所有修改",
		})

	} else {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Invalid status",
		})
	}
}

// acceptAll 确认所有pending修改
func (h *AIEditHandler) acceptAll(conversationID string, pendingManager *models.PendingStateManager, historyManager *models.FileHistoryManager) error {
	// 1. 获取所有轮次
	turns := pendingManager.GetTurns(conversationID)
	if len(turns) == 0 {
		log.Printf("⚠️ 没有pending修改")
		return nil
	}

	// 2. 获取所有涉及的文件
	allFiles := pendingManager.GetAllPendingFiles(conversationID)

	log.Printf("📊 Accept All: %d轮对话，%d个文件", len(turns), len(allFiles))

	// 3. 收集所有tool_call_id（用于更新消息status）
	allToolCallIDs := make([]string, 0)
	for _, turn := range turns {
		for _, edits := range turn.FileEdits {
			for _, edit := range edits {
				allToolCallIDs = append(allToolCallIDs, edit.ToolCallID)
			}
		}
	}
	log.Printf("📋 收集到%d个tool_call_id", len(allToolCallIDs))

	// 4. 对每个文件：应用edits，生成快照，写入磁盘
	finalTurnContents := make(map[string]string) // 保存每个文件的最终内容
	for filePath := range allFiles {
		finalContent, err := h.acceptFileEdits(conversationID, filePath, turns, historyManager)
		if err != nil {
			return fmt.Errorf("处理文件失败 %s: %v", filePath, err)
		}
		finalTurnContents[filePath] = finalContent
	}

	// 5. 保存最终Turn的快照（Turn N+1）
	if len(turns) > 0 {
		lastTurnIndex := turns[len(turns)-1].UserMessageIndex
		finalTurnIndex := lastTurnIndex + 1

		for filePath, finalContent := range finalTurnContents {
			if err := historyManager.AddSnapshot(conversationID, filePath, finalTurnIndex, finalContent); err != nil {
				log.Printf("⚠️ 保存Turn%d快照失败: %v", finalTurnIndex, err)
			} else {
				log.Printf("✅ 保存Turn%d快照（Accept All最终状态）: %s (%d字节)", finalTurnIndex, filePath, len(finalContent))
			}
		}
	}

	// 6. 更新所有tool消息的status为accepted
	for _, toolCallID := range allToolCallIDs {
		if err := storage.UpdateToolMessageStatus(toolCallID, "accepted"); err != nil {
			log.Printf("⚠️ 更新tool消息状态失败 (%s): %v", toolCallID, err)
		}
	}
	log.Printf("✅ 已更新%d个tool消息状态为accepted", len(allToolCallIDs))

	// 7. 清空pending
	if err := pendingManager.ClearAll(conversationID); err != nil {
		return fmt.Errorf("清空pending失败: %v", err)
	}

	return nil
}

// acceptFileEdits 应用单个文件的所有edits并返回最终内容
func (h *AIEditHandler) acceptFileEdits(conversationID, filePath string, turns []models.TurnEdits, historyManager *models.FileHistoryManager) (string, error) {
	// 读取磁盘内容（如果文件不存在，初始为空字符串）
	state := ""
	diskContent, err := os.ReadFile(filePath)
	if err == nil {
		state = string(diskContent)
		log.Printf("📝 处理文件: %s (初始: %d字节)", filePath, len(state))
	} else {
		log.Printf("📝 处理新文件: %s (文件不存在，将创建)", filePath)
	}

	// 逐轮应用edits并保存快照
	for _, turn := range turns {
		edits, hasEdits := turn.FileEdits[filePath]
		if !hasEdits {
			continue
		}

		// 保存该轮开始前的快照
		if err := historyManager.AddSnapshot(conversationID, filePath, turn.UserMessageIndex, state); err != nil {
			return "", fmt.Errorf("保存快照失败: %v", err)
		}
		log.Printf("📸 Turn%d快照: %d字节", turn.UserMessageIndex, len(state))

		// 应用该轮的所有edits
		for _, edit := range edits {
			state = strings.Replace(state, edit.OldString, edit.NewString, 1)
		}
		log.Printf("✏️ Turn%d应用%d个edit: %d字节", turn.UserMessageIndex, len(edits), len(state))
	}

	// 写入最终状态到磁盘
	// 🔧 确保父目录存在
	dir := filepath.Dir(filePath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", fmt.Errorf("创建目录失败: %v", err)
	}

	if err := os.WriteFile(filePath, []byte(state), 0644); err != nil {
		return "", fmt.Errorf("写入文件失败: %v", err)
	}

	log.Printf("💾 写入磁盘: %s (%d字节)", filePath, len(state))
	return state, nil
}

// rejectAll 取消所有pending修改
func (h *AIEditHandler) rejectAll(conversationID string, pendingManager *models.PendingStateManager, historyManager *models.FileHistoryManager) error {
	// 1. 获取所有轮次
	turns := pendingManager.GetTurns(conversationID)
	if len(turns) == 0 {
		log.Printf("⚠️ 没有pending修改")
		return nil
	}

	log.Printf("🗑️ Reject All: 删除%d个pending轮次的临时快照", len(turns))

	// 2. 收集所有tool_call_id（用于更新消息status）
	allToolCallIDs := make([]string, 0)
	for _, turn := range turns {
		for _, edits := range turn.FileEdits {
			for _, edit := range edits {
				allToolCallIDs = append(allToolCallIDs, edit.ToolCallID)
			}
		}
	}

	// 3. 删除每个pending Turn的临时快照（Turn N+1）
	// 注意：不删除已Accept的快照（Turn N）
	for _, turn := range turns {
		turnIndex := turn.UserMessageIndex
		// 只删除Turn N+1的快照（这是pending的最终状态，还没Accept）
		if err := historyManager.RemoveSnapshot(conversationID, turnIndex+1); err != nil {
			log.Printf("⚠️ 删除Turn%d快照失败: %v", turnIndex+1, err)
		} else {
			log.Printf("🗑️ 删除Turn%d的临时快照", turnIndex+1)
		}
	}

	// 5. 更新所有tool消息的status为rejected
	for _, toolCallID := range allToolCallIDs {
		if err := storage.UpdateToolMessageStatus(toolCallID, "rejected"); err != nil {
			log.Printf("⚠️ 更新tool消息状态失败 (%s): %v", toolCallID, err)
		}
	}
	log.Printf("✅ 已更新%d个tool消息状态为rejected", len(allToolCallIDs))

	// 6. 清空pending
	if err := pendingManager.ClearAll(conversationID); err != nil {
		return fmt.Errorf("清空pending失败: %v", err)
	}

	// 注意：磁盘内容不变，因为pending从未写入磁盘
	log.Printf("✅ Reject完成，磁盘保持不变")

	return nil
}
