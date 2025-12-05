package handlers

import (
	"all_project/storage"
	"net/http"

	"github.com/gin-gonic/gin"
)

type AIProvidersHandler struct{}

func NewAIProvidersHandler() *AIProvidersHandler {
	return &AIProvidersHandler{}
}

// GetProviders 获取所有供应商
func (h *AIProvidersHandler) GetProviders(c *gin.Context) {
	providers, err := storage.GetProviders()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": providers})
}

// GetProvider 获取单个供应商
func (h *AIProvidersHandler) GetProvider(c *gin.Context) {
	id := c.Query("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "缺少id参数"})
		return
	}

	provider, err := storage.GetProvider(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": provider})
}

// CreateProvider 创建供应商
func (h *AIProvidersHandler) CreateProvider(c *gin.Context) {
	var provider storage.Provider
	if err := c.ShouldBindJSON(&provider); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "参数错误: " + err.Error()})
		return
	}

	if err := storage.CreateProvider(&provider); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": provider})
}

// UpdateProvider 更新供应商
func (h *AIProvidersHandler) UpdateProvider(c *gin.Context) {
	var provider storage.Provider
	if err := c.ShouldBindJSON(&provider); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "参数错误: " + err.Error()})
		return
	}

	if err := storage.UpdateProvider(&provider); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": provider})
}

// DeleteProvider 删除供应商
func (h *AIProvidersHandler) DeleteProvider(c *gin.Context) {
	id := c.Query("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "缺少id参数"})
		return
	}

	if err := storage.DeleteProvider(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "message": "删除成功"})
}

// GetAllModels 获取所有模型（扁平化列表）
func (h *AIProvidersHandler) GetAllModels(c *gin.Context) {
	models, err := storage.GetAllModels()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": models})
}
