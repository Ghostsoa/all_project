package storage

import (
	"bytes"
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

// GetBaseDataDir 获取根数据目录（用于存放全局配置和密钥）
func GetBaseDataDir() string {
	return baseDir
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

	log.Printf("✅ 数据目录初始化完成: %s", baseDir)
	// 注意：LoadConfig() 需要在 InitEncryption() 之后调用，因此不在这里调用
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

	// 🔐 自动加密敏感信息（异步执行，不阻塞启动）
	go func() {
		if err := encryptSensitiveData(); err != nil {
			log.Printf("⚠️  加密敏感信息失败: %v", err)
		}
	}()

	return nil
}

// encryptSensitiveData 加密所有明文敏感信息
func encryptSensitiveData() error {
	globalConfigLock.Lock()
	defer globalConfigLock.Unlock()

	if globalConfig == nil {
		return nil
	}

	needSave := false

	// 🔐 加密Auth Token
	if globalConfig.AuthToken != "" {
		log.Println("🔒 加密Auth Token...")

		encrypted, err := Encrypt(globalConfig.AuthToken)
		if err != nil {
			log.Printf("❌ 加密失败: %v", err)
		} else {
			globalConfig.AuthTokenEncrypted = encrypted
			globalConfig.AuthToken = "" // 清空明文
			needSave = true
			log.Println("✅ Auth Token已加密")
		}
	}

	// 🔐 加密服务器密码
	for i := range globalConfig.Servers {
		server := &globalConfig.Servers[i]
		if server.Password != "" {
			log.Printf("🔒 加密服务器密码: [%s] %s", server.ID, server.Name)

			encrypted, err := Encrypt(server.Password)
			if err != nil {
				log.Printf("❌ 加密失败: %v", err)
				continue
			}

			server.PasswordEncrypted = encrypted
			server.Password = "" // 清空明文
			needSave = true
		}
	}

	// 🔐 加密Provider API Key
	for i := range globalConfig.Providers {
		provider := &globalConfig.Providers[i]
		if provider.APIKey != "" {
			log.Printf("🔒 加密Provider API Key: %s", provider.Name)

			encrypted, err := Encrypt(provider.APIKey)
			if err != nil {
				log.Printf("❌ 加密失败: %v", err)
				continue
			}

			provider.APIKeyEncrypted = encrypted
			provider.APIKey = "" // 清空明文
			needSave = true
		}
	}

	// 🔐 加密百度搜索 API Key
	if globalConfig.AIConfig.BaiduSearchAPIKey != "" {
		log.Println("🔒 加密百度搜索 API Key...")

		encrypted, err := Encrypt(globalConfig.AIConfig.BaiduSearchAPIKey)
		if err != nil {
			log.Printf("❌ 加密失败: %v", err)
		} else {
			globalConfig.AIConfig.BaiduSearchAPIKeyEncrypted = encrypted
			globalConfig.AIConfig.BaiduSearchAPIKey = "" // 清空明文
			needSave = true
			log.Println("✅ 百度搜索 API Key已加密")
		}
	}

	// 保存配置
	if needSave {
		if err := writeJSON(configFile, globalConfig); err != nil {
			return err
		}
		log.Println("✅ 敏感信息已加密并保存")
	}

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

// GetAuthToken 获取认证Token（自动解密）
func GetAuthToken() string {
	config := GetConfig()
	if config == nil {
		return ""
	}

	// 如果有明文token，直接返回（兼容旧配置）
	if config.AuthToken != "" {
		return config.AuthToken
	}

	// 解密加密的token
	if config.AuthTokenEncrypted != "" {
		token, err := Decrypt(config.AuthTokenEncrypted)
		if err != nil {
			log.Printf("⚠️ Token解密失败（密钥可能已更换）: %v", err)
			log.Printf("💡 建议：请在 ~/.ssh_web_data/config.json 中重新设置 auth_token 明文，系统将自动重新加密")
			return ""
		}
		return token
	}

	return ""
}

// GetServerPort 获取服务器端口
func GetServerPort() string {
	config := GetConfig()
	if config != nil && config.ServerPort != "" {
		return config.ServerPort
	}
	return "8080"
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

	// 使用自定义编码器，禁用 HTML 转义
	buf := new(bytes.Buffer)
	encoder := json.NewEncoder(buf)
	encoder.SetEscapeHTML(false) // 关键：不转义 HTML
	encoder.SetIndent("", "  ")  // 保持格式化
	if err := encoder.Encode(v); err != nil {
		return err
	}
	return ioutil.WriteFile(path, buf.Bytes(), 0644)
}
