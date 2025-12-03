package config

import (
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
