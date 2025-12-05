package handlers

import (
	"all_project/storage"
	"crypto/rand"
	"encoding/hex"
	"net/http"

	"github.com/gin-gonic/gin"
)

type ServerHandler struct{}

func NewServerHandler() *ServerHandler {
	return &ServerHandler{}
}

// GinGetServers 获取所有服务器
func (h *ServerHandler) GinGetServers(c *gin.Context) {
	servers, err := storage.GetServers()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": servers})
}

// GinGetServer 获取单个服务器
func (h *ServerHandler) GinGetServer(c *gin.Context) {
	id := c.Query("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "缺少id参数"})
		return
	}

	server, err := storage.GetServer(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": server})
}

// GinCreateServer 创建服务器
func (h *ServerHandler) GinCreateServer(c *gin.Context) {
	var server storage.Server
	if err := c.ShouldBindJSON(&server); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "参数错误: " + err.Error()})
		return
	}

	// 生成随机ID
	server.ID = generateID()

	if err := storage.CreateServer(&server); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": server})
}

// GinUpdateServer 更新服务器
func (h *ServerHandler) GinUpdateServer(c *gin.Context) {
	var server storage.Server
	if err := c.ShouldBindJSON(&server); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "参数错误: " + err.Error()})
		return
	}

	if server.ID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "缺少id"})
		return
	}

	if err := storage.UpdateServer(&server); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": server})
}

// GinDeleteServer 删除服务器
func (h *ServerHandler) GinDeleteServer(c *gin.Context) {
	id := c.Query("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "缺少id参数"})
		return
	}

	if err := storage.DeleteServer(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "message": "删除成功"})
}

// GinSearchServers 搜索服务器
func (h *ServerHandler) GinSearchServers(c *gin.Context) {
	keyword := c.Query("keyword")

	servers, err := storage.SearchServers(keyword)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": servers})
}

// GetServerByID 根据ID获取服务器（内部使用）
func (h *ServerHandler) GetServerByID(id string) (*storage.Server, error) {
	return storage.GetServer(id)
}

// generateID 生成随机ID
func generateID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}
