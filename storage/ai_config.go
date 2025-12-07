package storage

import (
	"fmt"
)

// LoadAIConfigCache 加载AI配置到内存（服务器启动时调用一次）
// 现在直接使用统一配置，保留此函数以兼容
func LoadAIConfigCache() error {
	// 无需操作，配置已在Init中加载
	return nil
}

// GetAIConfig 获取全局AI配置（从内存读取）
func GetAIConfig() (*AIConfig, error) {
	config := GetConfig()
	if config == nil {
		// 未加载，返回默认配置
		return &AIConfig{
			SystemPrompt:     "你是一个有帮助的AI助手",
			Temperature:      0.7,
			MaxTokens:        4096,
			TopP:             1.0,
			FrequencyPenalty: 0.0,
			PresencePenalty:  0.0,
			CodeSearchModel:  "",
		}, nil
	}

	return &config.AIConfig, nil
}

// UpdateAIConfig 更新全局AI配置（更新内存+写文件）
func UpdateAIConfig(aiConfig *AIConfig) error {
	globalConfigLock.Lock()
	defer globalConfigLock.Unlock()

	if globalConfig == nil {
		return fmt.Errorf("配置未加载")
	}

	globalConfig.AIConfig = *aiConfig
	return writeJSON(configFile, globalConfig)
}
