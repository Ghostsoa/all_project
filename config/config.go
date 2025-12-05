package config

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"os"
)

type Config struct {
	AuthToken  string `json:"auth_token"`
	ServerPort string `json:"server_port"`
}

var AppConfig *Config

// LoadConfig 加载配置文件
func LoadConfig(path string) error {
	// 检查文件是否存在
	if _, err := os.Stat(path); os.IsNotExist(err) {
		log.Println("⚠️ 配置文件不存在，创建默认配置...")
		if err := createDefaultConfig(path); err != nil {
			return err
		}
	}

	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()

	decoder := json.NewDecoder(file)
	AppConfig = &Config{}
	if err := decoder.Decode(AppConfig); err != nil {
		return err
	}

	log.Println("✓ 配置文件加载成功")
	log.Printf("✓ Auth Token: %s...%s", AppConfig.AuthToken[:8], AppConfig.AuthToken[len(AppConfig.AuthToken)-4:])
	return nil
}

// createDefaultConfig 创建默认配置文件
func createDefaultConfig(path string) error {
	defaultConfig := &Config{
		AuthToken:  generateRandomToken(),
		ServerPort: "8080",
	}

	data, err := json.MarshalIndent(defaultConfig, "", "  ")
	if err != nil {
		return err
	}

	if err := os.WriteFile(path, data, 0644); err != nil {
		return err
	}

	log.Println("✓ 默认配置文件已创建: " + path)
	log.Printf("✓ 默认Token: %s", defaultConfig.AuthToken)
	return nil
}

// generateRandomToken 生成随机Token
func generateRandomToken() string {
	b := make([]byte, 32)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// GetToken 获取认证Token
func GetToken() string {
	if AppConfig != nil {
		return AppConfig.AuthToken
	}
	return ""
}

// GetPort 获取服务器端口
func GetPort() string {
	if AppConfig != nil && AppConfig.ServerPort != "" {
		return AppConfig.ServerPort
	}
	return "8080"
}
