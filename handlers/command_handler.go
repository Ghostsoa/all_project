package handlers

import (
	"all_project/models"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

type CommandHandler struct {
	repo *models.CommandHistoryRepository
}

func NewCommandHandler(repo *models.CommandHistoryRepository) *CommandHandler {
	return &CommandHandler{repo: repo}
}

// GinSaveCommand 保存命令记录
func (h *CommandHandler) GinSaveCommand(c *gin.Context) {
	var history models.CommandHistory
	if err := c.ShouldBindJSON(&history); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "无效的请求数据",
		})
		return
	}

	if err := h.repo.Create(&history); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "保存命令失败",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "命令保存成功",
	})
}

// GinGetServerCommands 获取指定服务器的命令历史
func (h *CommandHandler) GinGetServerCommands(c *gin.Context) {
	serverIDStr := c.Query("server_id")
	serverID, err := strconv.ParseUint(serverIDStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "无效的服务器ID",
		})
		return
	}

	limitStr := c.Query("limit")
	limit := 100
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil {
			limit = l
		}
	}

	histories, err := h.repo.GetByServerID(uint(serverID), limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "获取命令历史失败",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    histories,
		"count":   len(histories),
	})
}

// GinGetRecentCommands 获取最近的命令
func (h *CommandHandler) GinGetRecentCommands(c *gin.Context) {
	limitStr := c.Query("limit")
	limit := 50
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil {
			limit = l
		}
	}

	histories, err := h.repo.GetRecent(limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "获取最近命令失败",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    histories,
		"count":   len(histories),
	})
}

// GinClearServerCommands 清除指定服务器的命令历史
func (h *CommandHandler) GinClearServerCommands(c *gin.Context) {
	serverIDStr := c.Query("server_id")
	serverID, err := strconv.ParseUint(serverIDStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "无效的服务器ID",
		})
		return
	}

	if err := h.repo.DeleteByServerID(uint(serverID)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "清除命令历史失败",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "命令历史已清除",
	})
}
