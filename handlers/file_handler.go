package handlers

import (
	"encoding/base64"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/pkg/sftp"
)

// FileHandler 文件操作处理器
type FileHandler struct {
}

// NewFileHandler 创建文件处理器
func NewFileHandler() *FileHandler {
	return &FileHandler{}
}

// ListFiles 列出目录
func (h *FileHandler) ListFiles(c *gin.Context) {
	sessionID := c.Query("session_id")
	path := c.Query("path")
	showHidden := c.Query("show_hidden") == "true"

	if sessionID == "" || path == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少参数"})
		return
	}

	// 从会话管理器获取SFTP客户端（复用现有连接）
	session := GetSessionManager().GetSession(sessionID)
	if session == nil || session.SFTPClient == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "SSH会话不存在或已断开，请重新连接"})
		return
	}

	sftpClient := session.SFTPClient

	files, err := sftpClient.ReadDir(path)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "读取目录失败: " + err.Error()})
		return
	}

	fileList := make([]gin.H, 0)
	for _, file := range files {
		// 根据设置过滤隐藏文件
		if !showHidden && strings.HasPrefix(file.Name(), ".") {
			continue
		}

		fileList = append(fileList, gin.H{
			"name":     file.Name(),
			"path":     filepath.Join(path, file.Name()),
			"is_dir":   file.IsDir(),
			"size":     file.Size(),
			"mod_time": file.ModTime(),
			"mode":     file.Mode().String(),
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"files":   fileList,
	})
}

// ReadFile 读取文件内容
func (h *FileHandler) ReadFile(c *gin.Context) {
	sessionID := c.Query("session_id")
	path := c.Query("path")

	if sessionID == "" || path == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少参数"})
		return
	}

	// 从会话管理器获取SFTP客户端
	session := GetSessionManager().GetSession(sessionID)
	if session == nil || session.SFTPClient == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "SSH会话不存在或已断开"})
		return
	}

	sftpClient := session.SFTPClient

	file, err := sftpClient.Open(path)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "打开文件失败: " + err.Error()})
		return
	}
	defer file.Close()

	content, err := io.ReadAll(file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "读取文件失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"content": string(content),
	})
}

// SaveFile 保存文件
func (h *FileHandler) SaveFile(c *gin.Context) {
	var req struct {
		SessionID string `json:"session_id"`
		Path      string `json:"path"`
		Content   string `json:"content"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}

	session := GetSessionManager().GetSession(req.SessionID)
	if session == nil || session.SFTPClient == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "SSH会话不存在或已断开"})
		return
	}

	sftpClient := session.SFTPClient

	file, err := sftpClient.Create(req.Path)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建文件失败"})
		return
	}
	defer file.Close()

	_, err = file.Write([]byte(req.Content))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "写入文件失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "文件保存成功",
	})
}

// CreateFile 创建文件或目录
func (h *FileHandler) CreateFile(c *gin.Context) {
	var req struct {
		SessionID string `json:"session_id"`
		Path      string `json:"path"`
		IsDir     bool   `json:"is_dir"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}

	session := GetSessionManager().GetSession(req.SessionID)
	if session == nil || session.SFTPClient == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "SSH会话不存在或已断开"})
		return
	}

	sftpClient := session.SFTPClient
	var err error

	if req.IsDir {
		err = sftpClient.Mkdir(req.Path)
	} else {
		file, err := sftpClient.Create(req.Path)
		if err == nil {
			file.Close()
		}
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建失败: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "创建成功",
	})
}

// DeleteFile 删除文件或目录
func (h *FileHandler) DeleteFile(c *gin.Context) {
	var req struct {
		SessionID string `json:"session_id"`
		Path      string `json:"path"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}

	session := GetSessionManager().GetSession(req.SessionID)
	if session == nil || session.SFTPClient == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "SSH会话不存在或已断开"})
		return
	}

	sftpClient := session.SFTPClient

	stat, err := sftpClient.Stat(req.Path)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取文件信息失败"})
		return
	}

	if stat.IsDir() {
		err = h.removeDir(sftpClient, req.Path)
	} else {
		err = sftpClient.Remove(req.Path)
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除失败: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "删除成功",
	})
}

// RenameFile 重命名文件或目录
func (h *FileHandler) RenameFile(c *gin.Context) {
	var req struct {
		SessionID string `json:"session_id"`
		OldPath   string `json:"old_path"`
		NewPath   string `json:"new_path"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}

	session := GetSessionManager().GetSession(req.SessionID)
	if session == nil || session.SFTPClient == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "SSH会话不存在或已断开"})
		return
	}

	sftpClient := session.SFTPClient

	err := sftpClient.Rename(req.OldPath, req.NewPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "重命名失败: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "重命名成功",
	})
}

// removeDir 递归删除目录
func (h *FileHandler) removeDir(client *sftp.Client, path string) error {
	files, err := client.ReadDir(path)
	if err != nil {
		return err
	}

	for _, file := range files {
		fullPath := filepath.Join(path, file.Name())
		if file.IsDir() {
			if err := h.removeDir(client, fullPath); err != nil {
				return err
			}
		} else {
			if err := client.Remove(fullPath); err != nil {
				return err
			}
		}
	}

	return client.RemoveDirectory(path)
}

// UploadFile 上传文件
func (h *FileHandler) UploadFile(c *gin.Context) {
	var req struct {
		SessionID string `json:"session_id"`
		Path      string `json:"path"`
		Content   string `json:"content"`
		Encoding  string `json:"encoding"` // "base64" 或 "text"
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}

	session := GetSessionManager().GetSession(req.SessionID)
	if session == nil || session.SFTPClient == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "SSH会话不存在或已断开"})
		return
	}

	sftpClient := session.SFTPClient

	// 创建文件
	file, err := sftpClient.Create(req.Path)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建文件失败: " + err.Error()})
		return
	}
	defer file.Close()

	// 解码并写入内容
	var content []byte
	if req.Encoding == "base64" {
		// Base64解码（用于二进制文件）
		content, err = base64.StdEncoding.DecodeString(req.Content)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Base64解码失败: " + err.Error()})
			return
		}
	} else {
		// 文本内容
		content = []byte(req.Content)
	}

	_, err = file.Write(content)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "写入文件失败: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "文件上传成功",
	})
}

// DownloadFile 下载文件（返回原始文件流）
func (h *FileHandler) DownloadFile(c *gin.Context) {
	sessionID := c.Query("session_id")
	path := c.Query("path")

	if sessionID == "" || path == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少参数"})
		return
	}

	// 从会话管理器获取SFTP客户端
	session := GetSessionManager().GetSession(sessionID)
	if session == nil || session.SFTPClient == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "SSH会话不存在或已断开"})
		return
	}

	sftpClient := session.SFTPClient

	// 打开文件
	file, err := sftpClient.Open(path)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "打开文件失败: " + err.Error()})
		return
	}
	defer file.Close()

	// 获取文件信息
	stat, err := file.Stat()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取文件信息失败"})
		return
	}

	// 获取文件名
	fileName := filepath.Base(path)

	// 设置响应头
	c.Header("Content-Description", "File Transfer")
	c.Header("Content-Transfer-Encoding", "binary")
	c.Header("Content-Disposition", "attachment; filename="+fileName)
	c.Header("Content-Type", "application/octet-stream")
	c.Header("Content-Length", strconv.FormatInt(stat.Size(), 10))

	// 流式传输文件内容
	io.Copy(c.Writer, file)
}
