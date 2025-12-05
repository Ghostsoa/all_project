package storage

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"os"
	"path/filepath"
	"sync"
)

var (
	dataDir     = "./data"
	sessionsDir = "./data/sessions"

	serversFile   = filepath.Join(dataDir, "servers.json")
	providersFile = filepath.Join(dataDir, "providers.json")
	commandsFile  = filepath.Join(dataDir, "commands.json")

	mu sync.RWMutex // 全局锁保护文件读写
)

// Init 初始化存储目录
func Init() error {
	// 创建目录
	dirs := []string{dataDir, sessionsDir}
	for _, dir := range dirs {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return fmt.Errorf("创建目录失败 %s: %w", dir, err)
		}
	}

	// 初始化默认文件
	if err := initDefaultFiles(); err != nil {
		return err
	}

	return nil
}

// initDefaultFiles 初始化默认配置文件
func initDefaultFiles() error {
	// servers.json
	if _, err := os.Stat(serversFile); os.IsNotExist(err) {
		if err := writeJSON(serversFile, []Server{}); err != nil {
			return err
		}
	}

	// providers.json
	if _, err := os.Stat(providersFile); os.IsNotExist(err) {
		defaultProviders := []Provider{
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
		}
		if err := writeJSON(providersFile, defaultProviders); err != nil {
			return err
		}
	}

	// ai_config.json - 全局AI配置
	if _, err := os.Stat(aiConfigFile); os.IsNotExist(err) {
		defaultConfig := &AIConfig{
			SystemPrompt:     "你是一个有帮助的AI助手",
			Temperature:      0.7,
			MaxTokens:        4096,
			TopP:             1.0,
			FrequencyPenalty: 0.0,
			PresencePenalty:  0.0,
		}
		if err := writeJSON(aiConfigFile, defaultConfig); err != nil {
			return err
		}
	}

	// commands.json
	if _, err := os.Stat(commandsFile); os.IsNotExist(err) {
		if err := writeJSON(commandsFile, &CommandHistoryStore{Commands: make(map[string][]CommandHistory)}); err != nil {
			return err
		}
	}

	return nil
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
