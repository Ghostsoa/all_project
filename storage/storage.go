package storage

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"os"
	"path/filepath"
	"sync"
)

var (
	// 获取用户主目录下的.ssh_web_data
	baseDir = getDataDir()

	// 统一配置文件
	configFile = filepath.Join(baseDir, "config.json")

	// 会话目录（全局，不分server_id）
	sessionsDir = filepath.Join(baseDir, "sessions")

	// 配置缓存
	globalConfig     *Config
	globalConfigLock sync.RWMutex

	mu sync.RWMutex // 全局锁保护文件读写
)

// getDataDir 获取数据目录路径
func getDataDir() string {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		// 降级到当前目录
		return ".ssh_web_data"
	}
	return filepath.Join(homeDir, ".ssh_web_data")
}

// GetServerDataDir 获取指定服务器的数据目录
func GetServerDataDir(serverID string) string {
	if serverID == "" {
		serverID = "local"
	}
	return filepath.Join(baseDir, serverID)
}

// GetPendingStateDir 获取pending_state目录
func GetPendingStateDir(serverID string) string {
	return filepath.Join(GetServerDataDir(serverID), "pending_state")
}

// GetFileHistoryDir 获取file_history目录
func GetFileHistoryDir(serverID string) string {
	return filepath.Join(GetServerDataDir(serverID), "file_history")
}

// GetSessionsDir 获取全局会话目录
func GetSessionsDir() string {
	return sessionsDir
}

// Init 初始化存储目录
func Init() error {
	// 创建目录
	dirs := []string{baseDir, sessionsDir}
	for _, dir := range dirs {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return fmt.Errorf("创建目录失败 %s: %w", dir, err)
		}
	}

	// 初始化统一配置文件
	if err := initConfigFile(); err != nil {
		return err
	}

	// 加载配置到内存
	if err := LoadConfig(); err != nil {
		return err
	}

	log.Printf("✅ 数据目录初始化完成: %s", baseDir)
	return nil
}

// initConfigFile 初始化统一配置文件
func initConfigFile() error {
	if _, err := os.Stat(configFile); os.IsNotExist(err) {
		// 创建默认配置
		defaultConfig := &Config{
			AuthToken:  "your-secret-token-here-change-me",
			ServerPort: "8080",
			AIConfig: AIConfig{
				SystemPrompt:     "你是一个有帮助的AI助手",
				Temperature:      0.7,
				MaxTokens:        4096,
				TopP:             1.0,
				FrequencyPenalty: 0.0,
				PresencePenalty:  0.0,
				CodeSearchModel:  "",
			},
			Servers: []Server{},
			Providers: []Provider{
				{
					ID:      "openai",
					Name:    "OpenAI",
					BaseURL: "https://api.openai.com/v1",
					APIKey:  "your-api-key-here",
					Models: []Model{
						{ID: "gpt-4", Name: "GPT-4"},
						{ID: "gpt-3.5-turbo", Name: "GPT-3.5 Turbo"},
					},
				},
			},
			Commands: []CommandHistory{},
		}

		if err := writeJSON(configFile, defaultConfig); err != nil {
			return fmt.Errorf("创建默认配置文件失败: %w", err)
		}
		log.Printf("✅ 创建默认配置文件: %s", configFile)
	}
	return nil
}

// LoadConfig 加载配置到内存
func LoadConfig() error {
	globalConfigLock.Lock()
	defer globalConfigLock.Unlock()

	var config Config
	if err := readJSON(configFile, &config); err != nil {
		return fmt.Errorf("读取配置文件失败: %w", err)
	}

	globalConfig = &config
	log.Printf("✅ 配置加载完成: %d servers, %d providers", len(config.Servers), len(config.Providers))
	return nil
}

// SaveConfig 保存配置到文件
func SaveConfig() error {
	globalConfigLock.RLock()
	defer globalConfigLock.RUnlock()

	if globalConfig == nil {
		return fmt.Errorf("配置未加载")
	}

	return writeJSON(configFile, globalConfig)
}

// GetConfig 获取配置引用（用于读取）
func GetConfig() *Config {
	globalConfigLock.RLock()
	defer globalConfigLock.RUnlock()
	return globalConfig
}

// 通用JSON读写函数
func readJSON(path string, v interface{}) error {
	mu.RLock()
	defer mu.RUnlock()

	data, err := ioutil.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, v)
}

func writeJSON(path string, v interface{}) error {
	mu.Lock()
	defer mu.Unlock()

	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return ioutil.WriteFile(path, data, 0644)
}
