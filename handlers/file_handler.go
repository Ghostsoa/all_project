package handlers

import (
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

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

// UploadFile 上传文件（支持FormData二进制上传，无需Base64编码）
func (h *FileHandler) UploadFile(c *gin.Context) {
	sessionID := c.PostForm("session_id")
	path := c.PostForm("path")

	if sessionID == "" || path == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少参数"})
		return
	}

	session := GetSessionManager().GetSession(sessionID)
	if session == nil || session.SFTPClient == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "SSH会话不存在或已断开"})
		return
	}

	sftpClient := session.SFTPClient

	// 获取上传的文件
	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "获取文件失败: " + err.Error()})
		return
	}

	// 打开上传的文件
	uploadedFile, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "打开文件失败: " + err.Error()})
		return
	}
	defer uploadedFile.Close()

	// 记录开始时间
	startTime := time.Now()

	// 创建远程文件
	remoteFile, err := sftpClient.Create(path)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建文件失败: " + err.Error()})
		return
	}
	defer remoteFile.Close()

	// 使用带缓冲的复制提升性能
	buf := make([]byte, 1024*1024) // 1MB缓冲区
	written, err := io.CopyBuffer(remoteFile, uploadedFile, buf)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "写入文件失败: " + err.Error()})
		return
	}

	// 记录上传耗时
	elapsed := time.Since(startTime)
	sizeMB := float64(written) / (1024 * 1024)
	speedMBs := sizeMB / elapsed.Seconds()
	fmt.Printf("✅ 上传完成: %s (%.2f MB) 耗时: %v 速度: %.2f MB/s\n",
		filepath.Base(path), sizeMB, elapsed, speedMBs)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "文件上传成功",
	})
}

// UploadChunk 分片上传接口
func (h *FileHandler) UploadChunk(c *gin.Context) {
	var req struct {
		SessionID   string `json:"session_id"`
		Path        string `json:"path"`
		UploadID    string `json:"upload_id"`
		ChunkIndex  int    `json:"chunk_index"`
		TotalChunks int    `json:"total_chunks"`
		Content     string `json:"content"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}

	// 从会话管理器获取SFTP客户端
	session := GetSessionManager().GetSession(req.SessionID)
	if session == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "会话不存在"})
		return
	}

	sftpClient := session.SFTPClient
	if sftpClient == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "SFTP客户端未初始化"})
		return
	}

	// 解码Base64内容
	content, err := base64.StdEncoding.DecodeString(req.Content)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Base64解码失败"})
		return
	}

	// 创建临时目录存储分片
	tmpDir := fmt.Sprintf("/tmp/upload_%s", req.UploadID)
	chunkPath := fmt.Sprintf("%s/chunk_%d", tmpDir, req.ChunkIndex)

	// 创建临时目录（本地）
	if err := os.MkdirAll(tmpDir, 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建临时目录失败"})
		return
	}

	// 写入分片到本地临时文件
	if err := os.WriteFile(chunkPath, content, 0644); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "写入分片失败"})
		return
	}

	// 如果是最后一个分片，进行合并
	if req.ChunkIndex == req.TotalChunks-1 {
		// 合并所有分片
		mergedFile, err := os.Create(tmpDir + "/merged")
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "创建合并文件失败"})
			return
		}
		defer mergedFile.Close()

		// 按顺序读取所有分片并合并
		for i := 0; i < req.TotalChunks; i++ {
			chunkFile := fmt.Sprintf("%s/chunk_%d", tmpDir, i)
			chunkData, err := os.ReadFile(chunkFile)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("读取分片%d失败", i)})
				return
			}
			if _, err := mergedFile.Write(chunkData); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "写入合并文件失败"})
				return
			}
		}

		// 重新打开合并后的文件用于上传
		mergedFile, err = os.Open(tmpDir + "/merged")
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "打开合并文件失败"})
			return
		}
		defer mergedFile.Close()

		// 上传到远程服务器
		remoteFile, err := sftpClient.Create(req.Path)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "创建远程文件失败"})
			return
		}
		defer remoteFile.Close()

		// 复制数据
		if _, err := io.Copy(remoteFile, mergedFile); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "上传文件失败"})
			return
		}

		// 清理临时文件
		os.RemoveAll(tmpDir)

		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"message": "分片上传完成",
		})
	} else {
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"message": fmt.Sprintf("分片%d上传成功", req.ChunkIndex),
		})
	}
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

	// 获取文件名并处理中文编码
	fileName := filepath.Base(path)

	// 设置响应头（支持中文文件名）
	c.Header("Content-Description", "File Transfer")
	c.Header("Content-Transfer-Encoding", "binary")
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"; filename*=UTF-8''%s`,
		fileName,
		strings.ReplaceAll(fileName, " ", "%20")))
	c.Header("Content-Type", "application/octet-stream")
	c.Header("Content-Length", strconv.FormatInt(stat.Size(), 10))
	c.Header("Accept-Ranges", "bytes") // 支持断点续传
	c.Header("Cache-Control", "public, max-age=0")
	c.Header("X-Content-Type-Options", "nosniff")

	// 流式传输文件内容（高效，不占用内存）
	io.Copy(c.Writer, file)
}
