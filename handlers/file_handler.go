package handlers

import (
	"all_project/models"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

// FileHandler 文件操作处理器
type FileHandler struct {
	serverRepo *models.ServerRepository
}

// NewFileHandler 创建文件处理器
func NewFileHandler(serverRepo *models.ServerRepository) *FileHandler {
	return &FileHandler{
		serverRepo: serverRepo,
	}
}

// ListFiles 列出目录
func (h *FileHandler) ListFiles(c *gin.Context) {
	serverIDStr := c.Query("server_id")
	path := c.Query("path")

	if serverIDStr == "" || path == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少参数"})
		return
	}

	serverID, _ := strconv.ParseUint(serverIDStr, 10, 64)
	server, err := h.serverRepo.GetByID(uint(serverID))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "服务器不存在"})
		return
	}

	sshClient, err := h.connectSSH(server)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "SSH连接失败: " + err.Error()})
		return
	}
	defer sshClient.Close()

	sftpClient, err := sftp.NewClient(sshClient)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "SFTP初始化失败: " + err.Error()})
		return
	}
	defer sftpClient.Close()

	files, err := sftpClient.ReadDir(path)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "读取目录失败: " + err.Error()})
		return
	}

	fileList := make([]gin.H, 0)
	for _, file := range files {
		if strings.HasPrefix(file.Name(), ".") {
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
	serverIDStr := c.Query("server_id")
	path := c.Query("path")

	if serverIDStr == "" || path == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少参数"})
		return
	}

	serverID, _ := strconv.ParseUint(serverIDStr, 10, 64)
	server, err := h.serverRepo.GetByID(uint(serverID))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "服务器不存在"})
		return
	}

	sshClient, err := h.connectSSH(server)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "SSH连接失败"})
		return
	}
	defer sshClient.Close()

	sftpClient, err := sftp.NewClient(sshClient)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "SFTP初始化失败"})
		return
	}
	defer sftpClient.Close()

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
		ServerID string `json:"server_id"`
		Path     string `json:"path"`
		Content  string `json:"content"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}

	serverID, _ := strconv.ParseUint(req.ServerID, 10, 64)
	server, err := h.serverRepo.GetByID(uint(serverID))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "服务器不存在"})
		return
	}

	sshClient, err := h.connectSSH(server)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "SSH连接失败"})
		return
	}
	defer sshClient.Close()

	sftpClient, err := sftp.NewClient(sshClient)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "SFTP初始化失败"})
		return
	}
	defer sftpClient.Close()

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
		ServerID string `json:"server_id"`
		Path     string `json:"path"`
		IsDir    bool   `json:"is_dir"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}

	serverID, _ := strconv.ParseUint(req.ServerID, 10, 64)
	server, err := h.serverRepo.GetByID(uint(serverID))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "服务器不存在"})
		return
	}

	sshClient, err := h.connectSSH(server)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "SSH连接失败"})
		return
	}
	defer sshClient.Close()

	sftpClient, err := sftp.NewClient(sshClient)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "SFTP初始化失败"})
		return
	}
	defer sftpClient.Close()

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
		ServerID string `json:"server_id"`
		Path     string `json:"path"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}

	serverID, _ := strconv.ParseUint(req.ServerID, 10, 64)
	server, err := h.serverRepo.GetByID(uint(serverID))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "服务器不存在"})
		return
	}

	sshClient, err := h.connectSSH(server)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "SSH连接失败"})
		return
	}
	defer sshClient.Close()

	sftpClient, err := sftp.NewClient(sshClient)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "SFTP初始化失败"})
		return
	}
	defer sftpClient.Close()

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
		ServerID string `json:"server_id"`
		OldPath  string `json:"old_path"`
		NewPath  string `json:"new_path"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}

	serverID, _ := strconv.ParseUint(req.ServerID, 10, 64)
	server, err := h.serverRepo.GetByID(uint(serverID))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "服务器不存在"})
		return
	}

	sshClient, err := h.connectSSH(server)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "SSH连接失败"})
		return
	}
	defer sshClient.Close()

	sftpClient, err := sftp.NewClient(sshClient)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "SFTP初始化失败"})
		return
	}
	defer sftpClient.Close()

	err = sftpClient.Rename(req.OldPath, req.NewPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "重命名失败: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "重命名成功",
	})
}

// connectSSH 连接SSH服务器
func (h *FileHandler) connectSSH(server *models.Server) (*ssh.Client, error) {
	config := &ssh.ClientConfig{
		User: server.Username,
		Auth: []ssh.AuthMethod{
			ssh.Password(server.Password),
		},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         10 * time.Second,
	}

	address := fmt.Sprintf("%s:%d", server.Host, server.Port)
	client, err := ssh.Dial("tcp", address, config)
	if err != nil {
		return nil, err
	}

	return client, nil
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
