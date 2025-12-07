package handlers

import (
	"all_project/models"
	"all_project/storage"
	"fmt"
	"io"
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

// getAllServerIDs 获取所有有pending或history的server_id
func getAllServerIDs() []string {
	serverIDs := []string{"local"} // 总是包含local

	// 扫描.ssh_web_data目录下的所有子目录
	baseDir, _ := os.UserHomeDir()
	if baseDir == "" {
		baseDir = "."
	}
	sshDataDir := filepath.Join(baseDir, ".ssh_web_data")

	entries, err := os.ReadDir(sshDataDir)
	if err != nil {
		return serverIDs
	}

	for _, entry := range entries {
		if entry.IsDir() {
			name := entry.Name()
			// 排除特殊目录
			if name != "local" && name != "sessions" && name != "config.json" {
				serverIDs = append(serverIDs, name)
			}
		}
	}

	return serverIDs
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

// acceptAll 确认所有pending修改（支持多服务器）
func (h *AIEditHandler) acceptAll(conversationID string, pendingManager *models.PendingStateManager, historyManager *models.FileHistoryManager) error {
	// 获取所有服务器ID
	serverIDs := getAllServerIDs()

	// 统计总数
	totalTurns := 0
	totalFiles := 0
	allToolCallIDs := make([]string, 0)

	// 对每个server_id处理
	for _, serverID := range serverIDs {
		// 1. 获取该服务器的所有轮次
		turns := pendingManager.GetTurns(serverID, conversationID)
		if len(turns) == 0 {
			continue
		}

		totalTurns += len(turns)

		// 2. 获取所有涉及的文件
		allFiles := pendingManager.GetAllPendingFiles(serverID, conversationID)
		totalFiles += len(allFiles)

		log.Printf("📊 [%s] Accept: %d轮对话，%d个文件", serverID, len(turns), len(allFiles))

		// 3. 收集tool_call_id
		for _, turn := range turns {
			for _, edits := range turn.FileEdits {
				for _, edit := range edits {
					allToolCallIDs = append(allToolCallIDs, edit.ToolCallID)
				}
			}
		}

		// 4. 对每个文件：应用edits，生成快照，写入磁盘
		finalTurnContents := make(map[string]string)
		for filePath := range allFiles {
			finalContent, err := h.acceptFileEdits(serverID, conversationID, filePath, turns, historyManager)
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
				if err := historyManager.AddSnapshot(serverID, conversationID, filePath, finalTurnIndex, finalContent); err != nil {
					log.Printf("⚠️ [%s] 保存Turn%d快照失败: %v", serverID, finalTurnIndex, err)
				} else {
					log.Printf("✅ [%s] 保存Turn%d快照: %s (%d字节)", serverID, finalTurnIndex, filePath, len(finalContent))
				}
			}
		}

		// 6. 清空该服务器的pending
		if err := pendingManager.ClearAll(serverID, conversationID); err != nil {
			return fmt.Errorf("[%s] 清空pending失败: %v", serverID, err)
		}
	}

	log.Printf("📊 Accept All总计: %d个server, %d轮对话, %d个文件", len(serverIDs), totalTurns, totalFiles)

	// 7. 更新所有tool消息的status为accepted
	for _, toolCallID := range allToolCallIDs {
		if err := storage.UpdateToolMessageStatus(toolCallID, "accepted"); err != nil {
			log.Printf("⚠️ 更新tool消息状态失败 (%s): %v", toolCallID, err)
		}
	}
	log.Printf("✅ 已更新%d个tool消息状态为accepted", len(allToolCallIDs))

	return nil
}

// acceptFileEdits 应用单个文件的所有edits并返回最终内容（支持本地和远程）
func (h *AIEditHandler) acceptFileEdits(serverID, conversationID, filePath string, turns []models.TurnEdits, historyManager *models.FileHistoryManager) (string, error) {
	// 读取文件内容（支持本地和远程）
	state := ""
	var diskContent []byte
	var err error

	if serverID == "" || serverID == "local" {
		// 本地文件
		diskContent, err = os.ReadFile(filePath)
		if err == nil {
			state = string(diskContent)
			log.Printf("📝 [本地] 处理文件: %s (初始: %d字节)", filePath, len(state))
		} else {
			log.Printf("📝 [本地] 新文件: %s", filePath)
		}
	} else {
		// 远程文件（SFTP）
		session := GetSessionManager().GetSessionByServerID(serverID)
		if session == nil || session.SFTPClient == nil {
			return "", fmt.Errorf("远程服务器未连接: %s", serverID)
		}

		remoteFile, err := session.SFTPClient.Open(filePath)
		if err == nil {
			defer remoteFile.Close()
			diskContent, err = io.ReadAll(remoteFile)
			if err == nil {
				state = string(diskContent)
				log.Printf("📝 [%s] 处理远程文件: %s (初始: %d字节)", serverID, filePath, len(state))
			}
		} else {
			log.Printf("📝 [%s] 新远程文件: %s", serverID, filePath)
		}
	}

	// 逐轮应用edits并保存快照
	for _, turn := range turns {
		edits, hasEdits := turn.FileEdits[filePath]
		if !hasEdits {
			continue
		}

		// 保存该轮开始前的快照
		if err := historyManager.AddSnapshot(serverID, conversationID, filePath, turn.UserMessageIndex, state); err != nil {
			return "", fmt.Errorf("保存快照失败: %v", err)
		}
		log.Printf("📸 Turn%d快照: %d字节", turn.UserMessageIndex, len(state))

		// 应用该轮的所有edits
		for _, edit := range edits {
			state = strings.Replace(state, edit.OldString, edit.NewString, 1)
		}
		log.Printf("✏️ Turn%d应用%d个edit: %d字节", turn.UserMessageIndex, len(edits), len(state))
	}

	// 写入最终状态到磁盘（支持本地和远程）
	if serverID == "" || serverID == "local" {
		// 本地文件
		dir := filepath.Dir(filePath)
		if err := os.MkdirAll(dir, 0755); err != nil {
			return "", fmt.Errorf("创建目录失败: %v", err)
		}

		if err := os.WriteFile(filePath, []byte(state), 0644); err != nil {
			return "", fmt.Errorf("写入本地文件失败: %v", err)
		}

		log.Printf("💾 [本地] 写入磁盘: %s (%d字节)", filePath, len(state))
	} else {
		// 远程文件（SFTP）
		session := GetSessionManager().GetSessionByServerID(serverID)
		if session == nil || session.SFTPClient == nil {
			return "", fmt.Errorf("远程服务器未连接: %s", serverID)
		}

		// 确保远程父目录存在
		dir := filepath.Dir(filePath)
		if err := session.SFTPClient.MkdirAll(dir); err != nil {
			log.Printf("⚠️ [%s] 创建远程目录失败 %s: %v", serverID, dir, err)
			// 继续尝试写入，目录可能已存在
		}

		// 写入远程文件
		remoteFile, err := session.SFTPClient.Create(filePath)
		if err != nil {
			return "", fmt.Errorf("创建远程文件失败: %v", err)
		}
		defer remoteFile.Close()

		if _, err := remoteFile.Write([]byte(state)); err != nil {
			return "", fmt.Errorf("写入远程文件失败: %v", err)
		}

		log.Printf("💾 [%s] 写入远程文件: %s (%d字节)", serverID, filePath, len(state))
	}

	return state, nil
}

// rejectAll 取消所有pending修改（支持多服务器）
func (h *AIEditHandler) rejectAll(conversationID string, pendingManager *models.PendingStateManager, historyManager *models.FileHistoryManager) error {
	// 获取所有服务器ID
	serverIDs := getAllServerIDs()

	// 统计总数
	totalTurns := 0
	allToolCallIDs := make([]string, 0)

	// 对每个server_id处理
	for _, serverID := range serverIDs {
		// 1. 获取该服务器的所有轮次
		turns := pendingManager.GetTurns(serverID, conversationID)
		if len(turns) == 0 {
			continue
		}

		totalTurns += len(turns)
		log.Printf("🗑️ [%s] Reject: 删除%d个pending轮次", serverID, len(turns))

		// 2. 收集tool_call_id
		for _, turn := range turns {
			for _, edits := range turn.FileEdits {
				for _, edit := range edits {
					allToolCallIDs = append(allToolCallIDs, edit.ToolCallID)
				}
			}
		}

		// 3. 删除该服务器的所有轮次快照
		if len(turns) > 0 {
			initialTurnIndex := turns[0].UserMessageIndex
			if err := historyManager.RemoveSnapshotsAfter(serverID, conversationID, initialTurnIndex); err != nil {
				return fmt.Errorf("[%s] 删除快照失败: %v", serverID, err)
			}
		}

		// 4. 清空该服务器的pending
		if err := pendingManager.ClearAll(serverID, conversationID); err != nil {
			return fmt.Errorf("[%s] 清空pending失败: %v", serverID, err)
		}
	}

	log.Printf("🗑️ Reject All总计: %d个server, %d轮对话", len(serverIDs), totalTurns)

	// 5. 更新所有tool消息的status为rejected
	for _, toolCallID := range allToolCallIDs {
		if err := storage.UpdateToolMessageStatus(toolCallID, "rejected"); err != nil {
			log.Printf("⚠️ 更新tool消息状态失败 (%s): %v", toolCallID, err)
		}
	}
	log.Printf("✅ 已更新%d个tool消息状态为rejected", len(allToolCallIDs))

	// 注意：磁盘内容不变，因为pending从未写入磁盘
	log.Printf("✅ Reject完成，磁盘保持不变")

	return nil
}
