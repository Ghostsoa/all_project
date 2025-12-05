package handlers

import (
	"all_project/storage"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

type CommandHandler struct{}

func NewCommandHandler() *CommandHandler {
	return &CommandHandler{}
}

// GinSaveCommand 保存命令历史
func (h *CommandHandler) GinSaveCommand(c *gin.Context) {
	var req struct {
		ServerID string `json:"server_id"`
		Command  string `json:"command"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "参数错误"})
		return
	}

	if err := storage.SaveCommand(req.ServerID, req.Command); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// GinGetServerCommands 获取指定服务器的命令历史
func (h *CommandHandler) GinGetServerCommands(c *gin.Context) {
	serverID := c.Query("server_id")
	if serverID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "缺少server_id参数"})
		return
	}

	limitStr := c.DefaultQuery("limit", "100")
	limit, _ := strconv.Atoi(limitStr)

	commands, err := storage.GetCommandsByServer(serverID, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": commands})
}

// GinGetRecentCommands 获取最近的命令
func (h *CommandHandler) GinGetRecentCommands(c *gin.Context) {
	limitStr := c.DefaultQuery("limit", "50")
	limit, _ := strconv.Atoi(limitStr)

	commands, err := storage.GetRecentCommands(limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": commands})
}

// GinClearServerCommands 清空指定服务器的命令历史
func (h *CommandHandler) GinClearServerCommands(c *gin.Context) {
	serverID := c.Query("server_id")
	if serverID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "缺少server_id参数"})
		return
	}

	if err := storage.ClearCommandsByServer(serverID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "message": "清空成功"})
}
