package handlers

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// LocalFileHandler 本地文件操作处理器
type LocalFileHandler struct{}

func NewLocalFileHandler() *LocalFileHandler {
	return &LocalFileHandler{}
}

// 获取用户主目录
func getHomeDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		if runtime.GOOS == "windows" {
			return "C:\\"
		}
		return "/"
	}
	return home
}

// ListLocalFiles 列出本地文件
func (h *LocalFileHandler) ListLocalFiles(c *gin.Context) {
	path := c.Query("path")
	if path == "" {
		path = getHomeDir()
	}

	// 读取目录
	entries, err := os.ReadDir(path)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "读取目录失败: " + err.Error()})
		return
	}

	var files []gin.H
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			continue
		}

		fullPath := filepath.Join(path, entry.Name())
		files = append(files, gin.H{
			"name":  entry.Name(),
			"path":  fullPath,
			"size":  info.Size(),
			"mtime": info.ModTime().Unix(),
			"isDir": entry.IsDir(),
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"files":   files,
	})
}

// ReadLocalFile 读取本地文件
func (h *LocalFileHandler) ReadLocalFile(c *gin.Context) {
	path := c.Query("path")
	if path == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少参数"})
		return
	}

	content, err := os.ReadFile(path)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "读取文件失败: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"content": string(content),
	})
}

// SaveLocalFile 保存本地文件
func (h *LocalFileHandler) SaveLocalFile(c *gin.Context) {
	var req struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}

	err := os.WriteFile(req.Path, []byte(req.Content), 0644)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存文件失败: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "保存成功",
	})
}

// CreateLocalFile 创建本地文件或目录
func (h *LocalFileHandler) CreateLocalFile(c *gin.Context) {
	var req struct {
		Path  string `json:"path"`
		IsDir bool   `json:"is_dir"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}

	var err error
	if req.IsDir {
		err = os.MkdirAll(req.Path, 0755)
	} else {
		file, e := os.Create(req.Path)
		if e == nil {
			file.Close()
		}
		err = e
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

// DeleteLocalFile 删除本地文件或目录
func (h *LocalFileHandler) DeleteLocalFile(c *gin.Context) {
	var req struct {
		Path string `json:"path"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}

	err := os.RemoveAll(req.Path)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除失败: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "删除成功",
	})
}

// RenameLocalFile 重命名本地文件
func (h *LocalFileHandler) RenameLocalFile(c *gin.Context) {
	var req struct {
		OldPath string `json:"old_path"`
		NewPath string `json:"new_path"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}

	err := os.Rename(req.OldPath, req.NewPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "重命名失败: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "重命名成功",
	})
}

// CopyLocalFile 复制本地文件
func (h *LocalFileHandler) CopyLocalFile(c *gin.Context) {
	var req struct {
		SourcePath string `json:"source_path"`
		TargetPath string `json:"target_path"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}

	// 使用系统命令复制
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		// Windows: xcopy或robocopy
		cmd = exec.Command("xcopy", req.SourcePath, req.TargetPath, "/E", "/I", "/Y")
	} else {
		// Unix: cp -r
		cmd = exec.Command("cp", "-r", req.SourcePath, req.TargetPath)
	}

	output, err := cmd.CombinedOutput()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "复制失败: " + err.Error() + " | " + string(output),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "复制成功",
	})
}

// UploadLocalFile 上传文件到本地
func (h *LocalFileHandler) UploadLocalFile(c *gin.Context) {
	path := c.PostForm("path")
	if path == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少参数"})
		return
	}

	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "获取文件失败: " + err.Error()})
		return
	}

	uploadedFile, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "打开文件失败: " + err.Error()})
		return
	}
	defer uploadedFile.Close()

	startTime := time.Now()

	localFile, err := os.Create(path)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建文件失败: " + err.Error()})
		return
	}
	defer localFile.Close()

	written, err := io.Copy(localFile, uploadedFile)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "写入文件失败: " + err.Error()})
		return
	}

	elapsed := time.Since(startTime)
	sizeMB := float64(written) / (1024 * 1024)
	speedMBs := sizeMB / elapsed.Seconds()
	fmt.Printf("✅ 本地上传完成: %s (%.2f MB) 耗时: %v 速度: %.2f MB/s\n",
		filepath.Base(path), sizeMB, elapsed, speedMBs)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "文件上传成功",
	})
}

// DownloadLocalFile 下载本地文件
func (h *LocalFileHandler) DownloadLocalFile(c *gin.Context) {
	path := c.Query("path")
	if path == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少参数"})
		return
	}

	file, err := os.Open(path)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "打开文件失败: " + err.Error()})
		return
	}
	defer file.Close()

	stat, err := file.Stat()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取文件信息失败"})
		return
	}

	fileSize := stat.Size()
	fileName := filepath.Base(path)

	// 获取MIME类型
	ext := strings.ToLower(filepath.Ext(path))
	contentType := "application/octet-stream"
	disposition := "attachment"

	mimeTypes := map[string]string{
		".mp4":  "video/mp4",
		".webm": "video/webm",
		".ogg":  "video/ogg",
		".mp3":  "audio/mpeg",
		".wav":  "audio/wav",
		".m4a":  "audio/mp4",
		".jpg":  "image/jpeg",
		".jpeg": "image/jpeg",
		".png":  "image/png",
		".gif":  "image/gif",
		".webp": "image/webp",
	}

	if mime, ok := mimeTypes[ext]; ok {
		contentType = mime
		disposition = "inline"
	}

	// 处理Range请求
	rangeHeader := c.GetHeader("Range")
	if rangeHeader != "" {
		var start, end int64
		if _, err := fmt.Sscanf(rangeHeader, "bytes=%d-%d", &start, &end); err != nil {
			fmt.Sscanf(rangeHeader, "bytes=%d-", &start)
			end = fileSize - 1
		}

		if end >= fileSize {
			end = fileSize - 1
		}

		contentLength := end - start + 1

		c.Header("Content-Type", contentType)
		c.Header("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, fileSize))
		c.Header("Content-Length", strconv.FormatInt(contentLength, 10))
		c.Header("Accept-Ranges", "bytes")
		c.Header("Cache-Control", "public, max-age=3600")
		c.Status(http.StatusPartialContent)

		file.Seek(start, 0)
		io.CopyN(c.Writer, file, contentLength)
	} else {
		c.Header("Content-Type", contentType)
		c.Header("Content-Disposition", fmt.Sprintf(`%s; filename="%s"`, disposition, fileName))
		c.Header("Content-Length", strconv.FormatInt(fileSize, 10))
		c.Header("Accept-Ranges", "bytes")
		c.Header("Cache-Control", "public, max-age=3600")

		io.Copy(c.Writer, file)
	}
}
