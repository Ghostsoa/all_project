package storage

import (
	"path/filepath"
	"sync"
)

var aiConfigFile = filepath.Join(dataDir, "ai_config.json")

// AI配置内存缓存（启动时加载）
var (
	aiConfigCache     *AIConfig
	aiConfigCacheLock sync.RWMutex
	aiConfigLoaded    bool
)

// LoadAIConfigCache 加载AI配置到内存（服务器启动时调用一次）
func LoadAIConfigCache() error {
	aiConfigCacheLock.Lock()
	defer aiConfigCacheLock.Unlock()

	var config AIConfig
	if err := readJSON(aiConfigFile, &config); err != nil {
		// 文件不存在，使用默认配置
		config = AIConfig{
			SystemPrompt:     "你是一个有帮助的AI助手",
			Temperature:      0.7,
			MaxTokens:        4096,
			TopP:             1.0,
			FrequencyPenalty: 0.0,
			PresencePenalty:  0.0,
		}
	}

	aiConfigCache = &config
	aiConfigLoaded = true
	return nil
}

// GetAIConfig 获取全局AI配置（从内存读取）
func GetAIConfig() (*AIConfig, error) {
	aiConfigCacheLock.RLock()
	defer aiConfigCacheLock.RUnlock()

	if !aiConfigLoaded {
		// 未加载，返回默认配置
		return &AIConfig{
			SystemPrompt:     "你是一个有帮助的AI助手",
			Temperature:      0.7,
			MaxTokens:        4096,
			TopP:             1.0,
			FrequencyPenalty: 0.0,
			PresencePenalty:  0.0,
		}, nil
	}

	// 返回副本
	configCopy := *aiConfigCache
	return &configCopy, nil
}

// UpdateAIConfig 更新全局AI配置（更新内存+写文件）
func UpdateAIConfig(config *AIConfig) error {
	aiConfigCacheLock.Lock()
	defer aiConfigCacheLock.Unlock()

	// 更新内存
	aiConfigCache = config
	aiConfigLoaded = true

	// 写入文件
	return writeJSON(aiConfigFile, config)
}
