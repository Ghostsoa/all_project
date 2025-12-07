package storage

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

const (
	keySize = 32 // AES-256
	keyFile = "encryption.key"
)

var (
	encryptionKey []byte
)

// InitEncryption 初始化加密系统（生成或加载密钥）
func InitEncryption(dataDir string) error {
	// 确保数据目录存在
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return fmt.Errorf("创建数据目录失败: %v", err)
	}

	keyPath := filepath.Join(dataDir, keyFile)

	// 检查密钥文件是否存在
	if _, err := os.Stat(keyPath); os.IsNotExist(err) {
		// 生成新密钥
		key := make([]byte, keySize)
		if _, err := rand.Read(key); err != nil {
			return fmt.Errorf("生成密钥失败: %v", err)
		}

		// 保存密钥文件（权限600，仅所有者可读写）
		if err := os.WriteFile(keyPath, key, 0600); err != nil {
			return fmt.Errorf("保存密钥文件失败: %v", err)
		}

		fmt.Printf("🔑 生成新的加密密钥: %s\n", keyPath)
		encryptionKey = key
	} else {
		// 加载现有密钥
		key, err := os.ReadFile(keyPath)
		if err != nil {
			return fmt.Errorf("读取密钥文件失败: %v", err)
		}

		if len(key) != keySize {
			return fmt.Errorf("密钥文件损坏: 长度错误")
		}

		fmt.Printf("🔑 加载加密密钥: %s\n", keyPath)
		encryptionKey = key
	}

	return nil
}

// Encrypt 加密明文（使用AES-256-GCM）
func Encrypt(plaintext string) (string, error) {
	if encryptionKey == nil {
		return "", fmt.Errorf("加密系统未初始化")
	}

	if plaintext == "" {
		return "", nil
	}

	block, err := aes.NewCipher(encryptionKey)
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	// 生成随机nonce
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}

	// 加密: nonce + ciphertext
	ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)

	// 返回十六进制编码
	return hex.EncodeToString(ciphertext), nil
}

// Decrypt 解密密文（使用AES-256-GCM）
func Decrypt(cipherHex string) (string, error) {
	if encryptionKey == nil {
		return "", fmt.Errorf("加密系统未初始化")
	}

	if cipherHex == "" {
		return "", nil
	}

	// 解码十六进制
	ciphertext, err := hex.DecodeString(cipherHex)
	if err != nil {
		return "", fmt.Errorf("密文格式错误: %v", err)
	}

	block, err := aes.NewCipher(encryptionKey)
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonceSize := gcm.NonceSize()
	if len(ciphertext) < nonceSize {
		return "", fmt.Errorf("密文过短")
	}

	// 分离nonce和密文
	nonce, ciphertext := ciphertext[:nonceSize], ciphertext[nonceSize:]

	// 解密
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", fmt.Errorf("解密失败: %v", err)
	}

	return string(plaintext), nil
}

// EncryptIfPlaintext 如果是明文则加密，返回密文和是否进行了加密
func EncryptIfPlaintext(plaintext string) (encrypted string, wasEncrypted bool, err error) {
	if plaintext == "" {
		return "", false, nil
	}

	encrypted, err = Encrypt(plaintext)
	if err != nil {
		return "", false, err
	}

	return encrypted, true, nil
}
