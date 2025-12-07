package handlers

import (
	"all_project/storage"
	"crypto/rand"
	"encoding/hex"
	"fmt"
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

	// 生成ID：优先使用用户提供的ID，否则自动生成
	if server.ID == "" {
		server.ID = generateShortID()
	} else {
		// 验证自定义ID
		if err := validateServerID(server.ID); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
			return
		}
		// 检查ID是否已存在
		if _, err := storage.GetServer(server.ID); err == nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "服务器ID已存在: " + server.ID})
			return
		}
	}

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

// generateShortID 生成简短的服务器ID（自增序号）
func generateShortID() string {
	servers, _ := storage.GetServers()

	// 找到最大的数字ID
	maxNum := 0
	for _, s := range servers {
		var num int
		// 尝试解析"server1"、"1"等格式
		if _, err := fmt.Sscanf(s.ID, "server%d", &num); err == nil {
			if num > maxNum {
				maxNum = num
			}
		} else if _, err := fmt.Sscanf(s.ID, "%d", &num); err == nil {
			if num > maxNum {
				maxNum = num
			}
		}
	}

	return fmt.Sprintf("server%d", maxNum+1)
}

// validateServerID 验证服务器ID格式
func validateServerID(id string) error {
	if id == "" {
		return fmt.Errorf("服务器ID不能为空")
	}
	if id == "local" {
		return fmt.Errorf("服务器ID不能使用保留字: local")
	}
	if len(id) > 32 {
		return fmt.Errorf("服务器ID过长（最多32字符）")
	}
	// 只允许字母、数字、下划线、短横线
	for _, c := range id {
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
			(c >= '0' && c <= '9') || c == '_' || c == '-') {
			return fmt.Errorf("服务器ID只能包含字母、数字、下划线、短横线")
		}
	}
	return nil
}

// generateID 生成随机ID（保留用于其他用途）
func generateID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}
