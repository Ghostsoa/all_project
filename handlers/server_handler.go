package handlers

import (
	"all_project/models"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

type ServerHandler struct {
	repo *models.ServerRepository
}

func NewServerHandler(repo *models.ServerRepository) *ServerHandler {
	return &ServerHandler{repo: repo}
}

// GinGetServers 获取所有服务器列表
func (h *ServerHandler) GinGetServers(c *gin.Context) {
	servers, err := h.repo.GetAll()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "获取服务器列表失败",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    servers,
		"count":   len(servers),
	})
}

// GinGetServer 获取单个服务器详情
func (h *ServerHandler) GinGetServer(c *gin.Context) {
	idStr := c.Query("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "无效的服务器ID",
		})
		return
	}

	server, err := h.repo.GetByID(uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"error":   "服务器不存在",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    server,
	})
}

// GinCreateServer 创建服务器配置
func (h *ServerHandler) GinCreateServer(c *gin.Context) {
	var server models.Server
	if err := c.ShouldBindJSON(&server); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "无效的请求数据",
		})
		return
	}

	// 设置默认值
	if server.Port == 0 {
		server.Port = 22
	}
	if server.AuthType == "" {
		server.AuthType = "password"
	}

	if err := h.repo.Create(&server); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "创建服务器失败",
		})
		return
	}

	// 清除敏感信息
	server.Password = ""
	server.PrivateKey = ""

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "服务器创建成功",
		"data":    server,
	})
}

// GinUpdateServer 更新服务器配置
func (h *ServerHandler) GinUpdateServer(c *gin.Context) {
	var server models.Server
	if err := c.ShouldBindJSON(&server); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "无效的请求数据",
		})
		return
	}

	if err := h.repo.Update(&server); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "更新服务器失败",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "服务器更新成功",
	})
}

// GinDeleteServer 删除服务器
func (h *ServerHandler) GinDeleteServer(c *gin.Context) {
	idStr := c.Query("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "无效的服务器ID",
		})
		return
	}

	if err := h.repo.Delete(uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "删除服务器失败",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "服务器删除成功",
	})
}

// GinSearchServers 搜索服务器
func (h *ServerHandler) GinSearchServers(c *gin.Context) {
	keyword := c.Query("q")
	if keyword == "" {
		h.GinGetServers(c)
		return
	}

	servers, err := h.repo.Search(keyword)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"error":   "搜索失败",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    servers,
		"count":   len(servers),
	})
}
