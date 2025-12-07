package handlers

import (
	"all_project/storage"
	"net/http"

	"github.com/gin-gonic/gin"
)

type AIConfigHandler struct{}

func NewAIConfigHandler() *AIConfigHandler {
	return &AIConfigHandler{}
}

// GetConfig 获取全局AI配置
func (h *AIConfigHandler) GetConfig(c *gin.Context) {
	config, err := storage.GetAIConfig()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	// 创建响应对象，不包含加密字段
	response := map[string]interface{}{
		"system_prompt":        config.SystemPrompt,
		"temperature":          config.Temperature,
		"max_tokens":           config.MaxTokens,
		"top_p":                config.TopP,
		"frequency_penalty":    config.FrequencyPenalty,
		"presence_penalty":     config.PresencePenalty,
		"code_search_model":    config.CodeSearchModel,
		"baidu_search_api_key": config.BaiduSearchAPIKey, // 解密后的明文（仅用于展示）
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": response})
}

// UpdateConfig 更新全局AI配置
func (h *AIConfigHandler) UpdateConfig(c *gin.Context) {
	var config storage.AIConfig
	if err := c.ShouldBindJSON(&config); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "参数错误: " + err.Error()})
		return
	}

	if err := storage.UpdateAIConfig(&config); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": config})
}
