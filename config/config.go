package config

import (
	"all_project/storage"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"os"
)

type Config struct {
	AuthToken          string `json:"auth_token"`           // 明文token（启动后自动加密并清空）
	AuthTokenEncrypted string `json:"auth_token_encrypted"` // 加密后的token（持久化存储）
	ServerPort         string `json:"server_port"`
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

	// 🔐 检查是否有明文token需要加密
	if AppConfig.AuthToken != "" {
		log.Println("🔒 发现明文token，正在加密...")

		// 加密明文token
		encrypted, err := storage.Encrypt(AppConfig.AuthToken)
		if err != nil {
			return err
		}

		// 保存加密后的token
		AppConfig.AuthTokenEncrypted = encrypted

		// 清空明文token
		AppConfig.AuthToken = ""

		// 保存配置文件
		if err := saveConfig(path); err != nil {
			return err
		}

		log.Println("✅ Token已加密并保存")
	}

	// 验证加密token是否可用
	if AppConfig.AuthTokenEncrypted != "" {
		token, err := storage.Decrypt(AppConfig.AuthTokenEncrypted)
		if err != nil {
			log.Printf("⚠️ Token解密失败: %v", err)
		} else {
			log.Printf("✓ Auth Token: %s...%s", token[:8], token[len(token)-4:])
		}
	}

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

// saveConfig 保存配置文件
func saveConfig(path string) error {
	data, err := json.MarshalIndent(AppConfig, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}

// GetToken 获取认证Token（自动解密）
func GetToken() string {
	if AppConfig == nil {
		return ""
	}

	// 如果有明文token，直接返回（兼容旧配置）
	if AppConfig.AuthToken != "" {
		return AppConfig.AuthToken
	}

	// 解密加密的token
	if AppConfig.AuthTokenEncrypted != "" {
		token, err := storage.Decrypt(AppConfig.AuthTokenEncrypted)
		if err != nil {
			log.Printf("❌ Token解密失败: %v", err)
			return ""
		}
		return token
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
