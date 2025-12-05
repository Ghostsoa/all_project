package storage

import "path/filepath"

var aiConfigFile = filepath.Join(dataDir, "ai_config.json")

// GetAIConfig 获取全局AI配置
func GetAIConfig() (*AIConfig, error) {
	var config AIConfig
	if err := readJSON(aiConfigFile, &config); err != nil {
		// 返回默认配置
		return &AIConfig{
			SystemPrompt:     "你是一个有帮助的AI助手",
			Temperature:      0.7,
			MaxTokens:        4096,
			TopP:             1.0,
			FrequencyPenalty: 0.0,
			PresencePenalty:  0.0,
		}, nil
	}
	return &config, nil
}

// UpdateAIConfig 更新全局AI配置
func UpdateAIConfig(config *AIConfig) error {
	return writeJSON(aiConfigFile, config)
}
