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
		ServerID   string `json:"server_id"`
		ServerName string `json:"server_name"`
		Command    string `json:"command"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "参数错误"})
		return
	}

	if err := storage.SaveCommand(req.ServerID, req.ServerName, req.Command); err != nil {
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

// GinDeleteCommand 删除单条命令
func (h *CommandHandler) GinDeleteCommand(c *gin.Context) {
	idStr := c.Query("id")
	if idStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "缺少id参数"})
		return
	}

	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "id参数无效"})
		return
	}

	if err := storage.DeleteCommand(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
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

// GinClearAllCommands 清空所有命令历史
func (h *CommandHandler) GinClearAllCommands(c *gin.Context) {
	if err := storage.ClearAllCommands(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// GinSearchCommands 搜索命令
func (h *CommandHandler) GinSearchCommands(c *gin.Context) {
	keyword := c.Query("keyword")
	if keyword == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "缺少keyword参数"})
		return
	}

	limitStr := c.DefaultQuery("limit", "100")
	limit, _ := strconv.Atoi(limitStr)

	commands, err := storage.SearchCommands(keyword, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": commands})
}
