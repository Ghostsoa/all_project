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

// GetAIConfig 获取全局AI配置（从内存读取，自动解密敏感信息）
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

	// 复制配置并解密敏感信息
	aiConfig := config.AIConfig

	// 解密百度搜索 API Key
	if aiConfig.BaiduSearchAPIKeyEncrypted != "" && aiConfig.BaiduSearchAPIKey == "" {
		decrypted, err := Decrypt(aiConfig.BaiduSearchAPIKeyEncrypted)
		if err == nil {
			aiConfig.BaiduSearchAPIKey = decrypted
		}
	}

	return &aiConfig, nil
}

// UpdateAIConfig 更新全局AI配置（更新内存+写文件，自动加密敏感信息）
func UpdateAIConfig(aiConfig *AIConfig) error {
	globalConfigLock.Lock()
	defer globalConfigLock.Unlock()

	if globalConfig == nil {
		return fmt.Errorf("配置未加载")
	}

	// 如果提供了明文百度搜索 API Key，则加密
	if aiConfig.BaiduSearchAPIKey != "" {
		encrypted, err := Encrypt(aiConfig.BaiduSearchAPIKey)
		if err != nil {
			return fmt.Errorf("加密百度搜索 API Key失败: %v", err)
		}
		aiConfig.BaiduSearchAPIKeyEncrypted = encrypted
		aiConfig.BaiduSearchAPIKey = "" // 清空明文
	}

	globalConfig.AIConfig = *aiConfig
	return writeJSON(configFile, globalConfig)
}
