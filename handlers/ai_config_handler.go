package handlers

import (
	"net/http"
	"strconv"

	"all_project/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// AIConfigHandler AI配置处理器
type AIConfigHandler struct {
	db           *gorm.DB
	modelRepo    *models.AIModelRepository
	endpointRepo *models.APIEndpointRepository
	configRepo   *models.ModelConfigRepository
}

// NewAIConfigHandler 创建配置处理器
func NewAIConfigHandler(db *gorm.DB) *AIConfigHandler {
	return &AIConfigHandler{
		db:           db,
		modelRepo:    models.NewAIModelRepository(db),
		endpointRepo: models.NewAPIEndpointRepository(db),
		configRepo:   models.NewModelConfigRepository(db),
	}
}

// ========== AI模型管理 ==========

// GetModels 获取所有模型
func (h *AIConfigHandler) GetModels(c *gin.Context) {
	models, err := h.modelRepo.GetAll()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": models})
}

// CreateModel 创建模型
func (h *AIConfigHandler) CreateModel(c *gin.Context) {
	var model models.AIModel
	if err := c.ShouldBindJSON(&model); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	if err := h.modelRepo.Create(&model); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": model})
}

// UpdateModel 更新模型
func (h *AIConfigHandler) UpdateModel(c *gin.Context) {
	var model models.AIModel
	if err := c.ShouldBindJSON(&model); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	if err := h.modelRepo.Update(&model); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": model})
}

// DeleteModel 删除模型
func (h *AIConfigHandler) DeleteModel(c *gin.Context) {
	idStr := c.Query("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "无效的模型ID"})
		return
	}

	if err := h.modelRepo.Delete(uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// ========== API接口管理 ==========

// GetEndpoints 获取所有接口
func (h *AIConfigHandler) GetEndpoints(c *gin.Context) {
	endpoints, err := h.endpointRepo.GetAll()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": endpoints})
}

// CreateEndpoint 创建接口
func (h *AIConfigHandler) CreateEndpoint(c *gin.Context) {
	var endpoint models.APIEndpoint
	if err := c.ShouldBindJSON(&endpoint); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	if err := h.endpointRepo.Create(&endpoint); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": endpoint})
}

// UpdateEndpoint 更新接口
func (h *AIConfigHandler) UpdateEndpoint(c *gin.Context) {
	var endpoint models.APIEndpoint
	if err := c.ShouldBindJSON(&endpoint); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	if err := h.endpointRepo.Update(&endpoint); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": endpoint})
}

// DeleteEndpoint 删除接口
func (h *AIConfigHandler) DeleteEndpoint(c *gin.Context) {
	idStr := c.Query("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "无效的接口ID"})
		return
	}

	if err := h.endpointRepo.Delete(uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// ========== 模型配置管理 ==========

// GetConfigs 获取所有配置
func (h *AIConfigHandler) GetConfigs(c *gin.Context) {
	configs, err := h.configRepo.GetAll()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": configs})
}

// GetDefaultConfig 获取默认配置
func (h *AIConfigHandler) GetDefaultConfig(c *gin.Context) {
	config, err := h.configRepo.GetDefault()
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": config})
}

// CreateConfig 创建配置
func (h *AIConfigHandler) CreateConfig(c *gin.Context) {
	var config models.ModelConfig
	if err := c.ShouldBindJSON(&config); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	if err := h.configRepo.Create(&config); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": config})
}

// UpdateConfig 更新配置
func (h *AIConfigHandler) UpdateConfig(c *gin.Context) {
	var config models.ModelConfig
	if err := c.ShouldBindJSON(&config); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	if err := h.configRepo.Update(&config); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": config})
}

// SetDefaultConfig 设置默认配置
func (h *AIConfigHandler) SetDefaultConfig(c *gin.Context) {
	idStr := c.Query("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "无效的配置ID"})
		return
	}

	if err := h.configRepo.SetDefault(uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// DeleteConfig 删除配置
func (h *AIConfigHandler) DeleteConfig(c *gin.Context) {
	idStr := c.Query("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "无效的配置ID"})
		return
	}

	if err := h.configRepo.Delete(uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}
