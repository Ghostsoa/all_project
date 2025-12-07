package tools

import (
	"all_project/models"
	"all_project/storage"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/pkg/sftp"
)

// ========== SFTP客户端获取辅助函数 ==========

// GetSFTPClientFunc 获取SFTP客户端的函数类型
type GetSFTPClientFunc func(serverID string) (*sftp.Client, error)

// 全局的SFTP客户端获取器（由tool_executor设置）
var globalGetSFTPClient GetSFTPClientFunc

// SetSFTPClientGetter 设置SFTP客户端获取器
func SetSFTPClientGetter(getter GetSFTPClientFunc) {
	globalGetSFTPClient = getter
}

// getSFTPClient 获取SFTP客户端
func getSFTPClient(serverID string) (*sftp.Client, error) {
	if globalGetSFTPClient == nil {
		return nil, fmt.Errorf("SFTP客户端获取器未初始化")
	}
	return globalGetSFTPClient(serverID)
}

// ========== 独立工具的参数结构 ==========

// ReadFileArgs read_file工具参数
type ReadFileArgs struct {
	FilePath string `json:"file_path"`
	ServerID string `json:"server_id"`
	Offset   int    `json:"offset,omitempty"`
	Limit    int    `json:"limit,omitempty"`
}

// WriteFileArgs write_file工具参数
type WriteFileArgs struct {
	FilePath string `json:"file_path"`
	Content  string `json:"content"`
	ServerID string `json:"server_id"`
}

// EditFileArgs edit_file工具参数
type EditFileArgs struct {
	FilePath  string `json:"file_path"`
	OldString string `json:"old_string"`
	NewString string `json:"new_string"`
	ServerID  string `json:"server_id"`
}

// ListDirectoryArgs list_directory工具参数
type ListDirectoryArgs struct {
	DirectoryPath string `json:"directory_path"`
	ServerID      string `json:"server_id"`
}

// GrepSearchArgs grep_search工具参数
type GrepSearchArgs struct {
	Query      string   `json:"query"`
	SearchPath string   `json:"search_path"`
	ServerID   string   `json:"server_id"`
	IsRegex    bool     `json:"is_regex,omitempty"`
	Includes   []string `json:"includes,omitempty"`
}

// FindFilesArgs find_files工具参数
type FindFilesArgs struct {
	Pattern    string   `json:"pattern"`
	SearchPath string   `json:"search_path"`
	ServerID   string   `json:"server_id"`
	MaxDepth   int      `json:"max_depth,omitempty"`
	Excludes   []string `json:"excludes,omitempty"`
}

// ========== 独立工具的执行函数 ==========

// ExecuteReadFile 执行read_file工具
func ExecuteReadFile(argsJSON string, conversationID string) (string, error) {
	var args ReadFileArgs
	if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
		return "", fmt.Errorf("解析参数失败: %v", err)
	}
	// 转换为FileOperationArgs复用现有逻辑
	return readFile(FileOperationArgs{
		FilePath: args.FilePath,
		ServerID: args.ServerID,
		Offset:   args.Offset,
		Limit:    args.Limit,
	}, conversationID)
}

// ExecuteWriteFile 执行write_file工具
func ExecuteWriteFile(argsJSON string, conversationID string, messageID string) (string, error) {
	var args WriteFileArgs
	if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
		return "", fmt.Errorf("解析参数失败: %v", err)
	}
	return writeFile(FileOperationArgs{
		FilePath: args.FilePath,
		Content:  args.Content,
		ServerID: args.ServerID,
	}, conversationID, messageID)
}

// ExecuteEditFile 执行edit_file工具
func ExecuteEditFile(argsJSON string, conversationID string, messageID string) (string, error) {
	var args EditFileArgs
	if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
		return "", fmt.Errorf("解析参数失败: %v", err)
	}
	return editFile(FileOperationArgs{
		FilePath:  args.FilePath,
		OldString: args.OldString,
		NewString: args.NewString,
		ServerID:  args.ServerID,
	}, conversationID, messageID)
}

// ExecuteListDirectory 执行list_directory工具
func ExecuteListDirectory(argsJSON string) (string, error) {
	var args ListDirectoryArgs
	if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
		return "", fmt.Errorf("解析参数失败: %v", err)
	}
	return listDir(FileOperationArgs{
		FilePath: args.DirectoryPath,
		ServerID: args.ServerID,
	})
}

// ExecuteGrepSearch 执行grep_search工具
func ExecuteGrepSearch(argsJSON string) (string, error) {
	var args GrepSearchArgs
	if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
		return "", fmt.Errorf("解析参数失败: %v", err)
	}
	return grepSearch(FileOperationArgs{
		Query:      args.Query,
		SearchPath: args.SearchPath,
		ServerID:   args.ServerID,
		IsRegex:    args.IsRegex,
		Includes:   args.Includes,
	})
}

// ExecuteFindFiles 执行find_files工具
func ExecuteFindFiles(argsJSON string) (string, error) {
	var args FindFilesArgs
	if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
		return "", fmt.Errorf("解析参数失败: %v", err)
	}
	return findByName(FileOperationArgs{
		Pattern:    args.Pattern,
		SearchPath: args.SearchPath,
		ServerID:   args.ServerID,
		MaxDepth:   args.MaxDepth,
		Excludes:   args.Excludes,
	})
}

// ========== 内部共享的参数结构（复用底层逻辑） ==========

// FileOperationArgs 内部参数结构（用于复用底层实现函数）
type FileOperationArgs struct {
	Type     string `json:"type"`      // "read", "write", "edit", "list", "grep", "find"`
	ServerID string `json:"server_id"` // 服务器ID（必需）
	FilePath string `json:"file_path"` // 文件/目录路径（必需`)

	// write 专用
	Content string `json:"content,omitempty"`

	// edit 专用
	OldString string `json:"old_string,omitempty"`
	NewString string `json:"new_string,omitempty"`

	// grep 专用
	Query      string   `json:"query,omitempty"`       // 搜索内容
	SearchPath string   `json:"search_path,omitempty"` // 搜索路径
	IsRegex    bool     `json:"is_regex,omitempty"`    // 是否正则表达式
	Includes   []string `json:"includes,omitempty"`    // 文件类型过滤（如 ["*.py", "*.js"]）

	// find 专用
	Pattern  string   `json:"pattern,omitempty"`   // 文件名匹配模式（如 "*.config.js"）
	MaxDepth int      `json:"max_depth,omitempty"` // 最大搜索深度
	Excludes []string `json:"excludes,omitempty"`  // 排除模式（如 ["node_modules", ".git"]）

	// read 专用（行范围读取）
	Offset int `json:"offset,omitempty"` // 起始行号（1-indexed）
	Limit  int `json:"limit,omitempty"`  // 读取行数
}

// Operation 编辑操作
type Operation struct {
	Type      string `json:"type"`       // "replace", "insert", "delete"
	StartLine int    `json:"start_line"` // 1-indexed
	EndLine   int    `json:"end_line"`
	OldText   string `json:"old_text"`
	NewText   string `json:"new_text"`
}

// FileInfo 文件信息
type FileInfo struct {
	Path  string `json:"path"`
	IsDir bool   `json:"is_dir"`
	Size  int64  `json:"size"`
}

// readFile 读取文件内容（支持行范围读取）
func readFile(args FileOperationArgs, conversationID string) (string, error) {
	manager := models.GetPendingStateManager()

	log.Printf("📖 readFile调用: serverID=%s, conversationID=%s, filePath=%s, offset=%d, limit=%d",
		args.ServerID, conversationID, args.FilePath, args.Offset, args.Limit)

	// 读取文件内容（支持本地和远程）
	var diskContent []byte
	var err error

	if args.ServerID == "" || args.ServerID == "local" {
		// 本地文件
		diskContent, err = os.ReadFile(args.FilePath)
		if err != nil {
			return "", fmt.Errorf("读取本地文件失败: %v", err)
		}
	} else {
		// 远程文件（通过SFTP）
		sftpClient, err := getSFTPClient(args.ServerID)
		if err != nil {
			return "", fmt.Errorf("获取远程服务器连接失败: %v", err)
		}

		// 使用SFTP读取远程文件
		remoteFile, err := sftpClient.Open(args.FilePath)
		if err != nil {
			return "", fmt.Errorf("读取远程文件失败: %v", err)
		}
		defer remoteFile.Close()

		diskContent, err = io.ReadAll(remoteFile)
		if err != nil {
			return "", fmt.Errorf("读取远程文件内容失败: %v", err)
		}
		log.Printf("✅ 读取远程文件: [%s] %s (%d字节)", args.ServerID, args.FilePath, len(diskContent))
	}

	// 优先从pending状态读取
	content := manager.GetCurrentContent(args.ServerID, conversationID, args.FilePath, string(diskContent))

	lines := strings.Split(content, "\n")
	totalLines := len(lines)

	// 如果指定了行范围
	if args.Offset > 0 || args.Limit > 0 {
		offset := args.Offset
		if offset < 1 {
			offset = 1
		}
		limit := args.Limit
		if limit <= 0 {
			limit = 1000 // 默认最多1000行
		}
		if limit > 1000 {
			limit = 1000 // 限制最大1000行
		}

		startIdx := offset - 1 // 转为0-indexed
		endIdx := startIdx + limit

		if startIdx >= totalLines {
			return "", fmt.Errorf("offset超出文件范围: offset=%d, total_lines=%d", offset, totalLines)
		}
		if endIdx > totalLines {
			endIdx = totalLines
		}

		// 截取指定范围
		rangeLines := lines[startIdx:endIdx]

		// 🔧 对每一行进行截断（避免单行过长）
		for i, line := range rangeLines {
			if len(line) > 2000 {
				rangeLines[i] = truncateLine(line, 2000)
			}
		}

		rangeContent := strings.Join(rangeLines, "\n")

		result := map[string]interface{}{
			"success":     true,
			"type":        "read",
			"file_path":   args.FilePath,
			"content":     rangeContent,
			"total_lines": totalLines,
			"offset":      offset,
			"limit":       limit,
			"lines_read":  len(rangeLines),
		}

		resultJSON, _ := json.Marshal(result)
		return string(resultJSON), nil
	}

	// 完整读取（无行范围限制）
	// 🔧 对每一行进行截断（避免单行过长）
	for i, line := range lines {
		if len(line) > 2000 {
			lines[i] = truncateLine(line, 2000)
		}
	}
	content = strings.Join(lines, "\n")

	result := map[string]interface{}{
		"success":     true,
		"type":        "read",
		"file_path":   args.FilePath,
		"content":     content,
		"total_lines": totalLines,
	}

	resultJSON, _ := json.Marshal(result)
	return string(resultJSON), nil
}

// writeFile 写入文件（创建或覆盖） - 记录到pending state
func writeFile(args FileOperationArgs, conversationID string, messageID string) (string, error) {
	manager := models.GetPendingStateManager()

	// 0. 获取当前用户消息数量作为messageIndex（Turn从0开始）
	messageIndex := 0
	session, err := storage.GetSession(conversationID)
	if err == nil {
		userMsgCount := 0
		for _, msg := range session.Messages {
			if msg.Role == "user" {
				userMsgCount++
			}
		}
		messageIndex = userMsgCount - 1
	}

	// 1. 获取当前内容（用于pending和history）
	oldContent := ""
	fileExists := false

	// 读取文件内容（支持本地和远程）
	var diskContent []byte
	var readErr error
	if args.ServerID == "" || args.ServerID == "local" {
		// 本地文件
		diskContent, readErr = os.ReadFile(args.FilePath)
	} else {
		// 远程文件
		sftpClient, sftpErr := getSFTPClient(args.ServerID)
		if sftpErr != nil {
			readErr = sftpErr
		} else {
			remoteFile, openErr := sftpClient.Open(args.FilePath)
			if openErr == nil {
				defer remoteFile.Close()
				diskContent, readErr = io.ReadAll(remoteFile)
			} else {
				readErr = openErr
			}
		}
	}

	if readErr == nil {
		// 文件存在，获取当前内容（可能有pending修改）
		oldContent = manager.GetCurrentContent(args.ServerID, conversationID, args.FilePath, string(diskContent))
		fileExists = true
	}

	// 2. 计算行数变化
	linesDeleted := 0
	linesAdded := len(strings.Split(args.Content, "\n"))
	if fileExists {
		linesDeleted = len(strings.Split(oldContent, "\n"))
	}

	// 3. 保存到pending state（OldString=旧内容，NewString=新内容）
	writeOp := models.EditOperation{
		ToolCallID: messageID,
		MessageID:  messageID,
		OldString:  oldContent, // 空字符串（新建）或旧内容（覆盖）
		NewString:  args.Content,
	}
	if err := manager.AddEdit(args.ServerID, conversationID, args.FilePath, messageIndex, writeOp); err != nil {
		return "", fmt.Errorf("保存写入操作失败: %v", err)
	}

	// 4. 返回pending状态
	result := map[string]interface{}{
		"success":       true,
		"type":          "write",
		"status":        "pending",
		"file_path":     args.FilePath,
		"tool_call_id":  messageID,
		"size":          len(args.Content),
		"total_lines":   linesAdded,
		"exists":        fileExists,
		"lines_deleted": linesDeleted,
		"lines_added":   linesAdded,
	}

	resultJSON, _ := json.Marshal(result)
	return string(resultJSON), nil
}

// editFile 精确编辑文件（搜索替换）
func editFile(args FileOperationArgs, conversationID string, messageID string) (string, error) {
	manager := models.GetPendingStateManager()

	// 0. 获取当前用户消息数量作为messageIndex（Turn从0开始）
	messageIndex := 0
	session, err := storage.GetSession(conversationID)
	if err == nil {
		userMsgCount := 0
		for _, msg := range session.Messages {
			if msg.Role == "user" {
				userMsgCount++
			}
		}
		messageIndex = userMsgCount - 1
	}

	// 1. 获取当前内容（优先从pending读取）
	var diskContent []byte

	if args.ServerID == "" || args.ServerID == "local" {
		// 本地文件
		diskContent, err = os.ReadFile(args.FilePath)
	} else {
		// 远程文件
		sftpClient, sftpErr := getSFTPClient(args.ServerID)
		if sftpErr != nil {
			return "", fmt.Errorf("获取远程服务器连接失败: %v", sftpErr)
		}
		remoteFile, openErr := sftpClient.Open(args.FilePath)
		if openErr != nil {
			return "", fmt.Errorf("读取远程文件失败: %v", openErr)
		}
		defer remoteFile.Close()
		diskContent, err = io.ReadAll(remoteFile)
	}

	if err != nil {
		return "", fmt.Errorf("读取文件失败: %v", err)
	}

	currentContent := manager.GetCurrentContent(args.ServerID, conversationID, args.FilePath, string(diskContent))

	// 2. 执行替换
	if !strings.Contains(currentContent, args.OldString) {
		return "", fmt.Errorf("未找到要替换的内容")
	}

	// 检查是否有多个匹配（避免歧义）
	count := strings.Count(currentContent, args.OldString)
	if count > 1 {
		return "", fmt.Errorf("找到%d个匹配，请提供更长的 old_string 以确保唯一性", count)
	}

	// 3. 计算本次编辑的行数差异（oldString → newString）
	linesDeleted, linesAdded := calculateLineDiff(args.OldString, args.NewString)

	// 4. 保存到pending state（传递messageIndex）
	editOp := models.EditOperation{
		ToolCallID: messageID,
		MessageID:  messageID,
		OldString:  args.OldString,
		NewString:  args.NewString,
	}
	if err := manager.AddEdit(args.ServerID, conversationID, args.FilePath, messageIndex, editOp); err != nil {
		return "", fmt.Errorf("保存编辑失败: %v", err)
	}

	// 5. 返回pending状态（前端显示预览）
	result := map[string]interface{}{
		"success":       true,
		"type":          "edit",
		"status":        "pending",
		"server_id":     args.ServerID,
		"file_path":     args.FilePath,
		"tool_call_id":  messageID,
		"lines_deleted": linesDeleted,
		"lines_added":   linesAdded,
	}

	resultJSON, _ := json.Marshal(result)
	return string(resultJSON), nil
}

// listDir 列出目录内容（支持本地和远程）
func listDir(args FileOperationArgs) (string, error) {
	type DirItem struct {
		Name  string `json:"name"`
		IsDir bool   `json:"is_dir"`
		Size  int64  `json:"size"`
	}

	items := []DirItem{}
	truncated := false

	if args.ServerID == "" || args.ServerID == "local" {
		// 本地目录
		entries, err := os.ReadDir(args.FilePath)
		if err != nil {
			return "", fmt.Errorf("读取本地目录失败: %v", err)
		}

		for _, entry := range entries {
			info, _ := entry.Info()
			size := int64(0)
			if info != nil {
				size = info.Size()
			}

			name := entry.Name()
			if len(name) > 200 {
				name = truncateLine(name, 200)
			}

			items = append(items, DirItem{
				Name:  name,
				IsDir: entry.IsDir(),
				Size:  size,
			})

			if len(items) >= 100 {
				break
			}
		}

		truncated = len(entries) > 100
		log.Printf("📁 [本地] 列出目录: %s (%d项)", args.FilePath, len(items))
	} else {
		// 远程目录（SFTP）
		sftpClient, err := getSFTPClient(args.ServerID)
		if err != nil {
			return "", fmt.Errorf("获取远程服务器连接失败: %v", err)
		}

		// 读取远程目录
		entries, err := sftpClient.ReadDir(args.FilePath)
		if err != nil {
			return "", fmt.Errorf("读取远程目录失败: %v", err)
		}

		for _, entry := range entries {
			name := entry.Name()
			if len(name) > 200 {
				name = truncateLine(name, 200)
			}

			items = append(items, DirItem{
				Name:  name,
				IsDir: entry.IsDir(),
				Size:  entry.Size(),
			})

			if len(items) >= 100 {
				break
			}
		}

		truncated = len(entries) > 100
		log.Printf("📁 [%s] 列出远程目录: %s (%d项)", args.ServerID, args.FilePath, len(items))
	}

	result := map[string]interface{}{
		"success":   true,
		"type":      "list",
		"file_path": args.FilePath,
		"items":     items,
		"truncated": truncated,
	}

	resultJSON, _ := json.Marshal(result)
	return string(resultJSON), nil
}

// grepSearch 搜索文件内容（支持正则表达式和文件类型过滤）
func grepSearch(args FileOperationArgs) (string, error) {
	// 检查server_id（目前只支持本地）
	if args.ServerID != "" && args.ServerID != "local" {
		return "", fmt.Errorf("文件搜索操作目前仅支持本地文件系统，不支持远程服务器 [%s]", args.ServerID)
	}

	searchPath := args.SearchPath
	if searchPath == "" {
		searchPath = args.FilePath // 兼容旧参数
	}

	// 编译正则表达式（如果需要）
	var pattern *regexp.Regexp
	var err error
	if args.IsRegex {
		pattern, err = regexp.Compile(args.Query)
		if err != nil {
			return "", fmt.Errorf("正则表达式无效: %v", err)
		}
	}

	type GrepMatch struct {
		FilePath string   `json:"file_path"`
		Line     int      `json:"line"`
		Content  string   `json:"content"`
		Context  []string `json:"context,omitempty"` // 上下文行
	}

	matches := []GrepMatch{}
	matchCount := 0

	// 遍历目录
	err = filepath.WalkDir(searchPath, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // 忽略错误，继续搜索
		}

		// 跳过目录
		if d.IsDir() {
			// 跳过常见的忽略目录
			name := d.Name()
			if name == ".git" || name == "node_modules" || name == ".idea" || name == "__pycache__" {
				return filepath.SkipDir
			}
			return nil
		}

		// 文件类型过滤
		if len(args.Includes) > 0 {
			matched := false
			for _, pattern := range args.Includes {
				m, _ := filepath.Match(pattern, filepath.Base(path))
				if m {
					matched = true
					break
				}
			}
			if !matched {
				return nil
			}
		}

		// 读取文件内容
		content, err := os.ReadFile(path)
		if err != nil {
			return nil // 跳过无法读取的文件
		}

		lines := strings.Split(string(content), "\n")

		// 搜索每一行
		for i, line := range lines {
			var found bool
			if args.IsRegex {
				found = pattern.MatchString(line)
			} else {
				found = strings.Contains(line, args.Query)
			}

			if found {
				matchCount++

				// 🔧 截断匹配行（限制1000字符）
				truncatedLine := line
				if len(line) > 1000 {
					truncatedLine = truncateLine(line, 1000)
				}

				// 获取上下文（前后各2行）
				context := []string{}
				for j := max(0, i-2); j < min(len(lines), i+3); j++ {
					if j != i {
						contextLine := lines[j]
						// 🔧 截断上下文行（限制500字符）
						if len(contextLine) > 500 {
							contextLine = truncateLine(contextLine, 500)
						}
						context = append(context, contextLine)
					}
				}

				matches = append(matches, GrepMatch{
					FilePath: path,
					Line:     i + 1, // 1-indexed
					Content:  truncatedLine,
					Context:  context,
				})

				// 🔧 限制结果数量（避免上下文溢出）
				if len(matches) >= 20 {
					return filepath.SkipAll // 停止搜索
				}
			}
		}

		return nil
	})

	if err != nil && err != filepath.SkipAll {
		return "", fmt.Errorf("搜索失败: %v", err)
	}

	truncated := len(matches) >= 20

	result := map[string]interface{}{
		"success":   true,
		"type":      "grep",
		"query":     args.Query,
		"matches":   matches,
		"truncated": truncated,
	}

	resultJSON, _ := json.Marshal(result)
	return string(resultJSON), nil
}

// findByName 按文件名搜索（支持通配符和深度限制）
func findByName(args FileOperationArgs) (string, error) {
	// 检查server_id（目前只支持本地）
	if args.ServerID != "" && args.ServerID != "local" {
		return "", fmt.Errorf("文件查找操作目前仅支持本地文件系统，不支持远程服务器 [%s]", args.ServerID)
	}

	searchPath := args.SearchPath
	if searchPath == "" {
		searchPath = args.FilePath
	}

	// 构建排除集合
	excludeSet := make(map[string]bool)
	for _, exclude := range args.Excludes {
		excludeSet[exclude] = true
	}
	// 默认排除
	excludeSet[".git"] = true
	excludeSet["node_modules"] = true
	excludeSet["__pycache__"] = true

	results := []FileInfo{}

	err := filepath.WalkDir(searchPath, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}

		// 检查深度限制
		if args.MaxDepth > 0 {
			relPath, _ := filepath.Rel(searchPath, path)
			depth := len(strings.Split(relPath, string(os.PathSeparator)))
			if depth > args.MaxDepth {
				if d.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
		}

		// 检查排除列表
		name := d.Name()
		if excludeSet[name] {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}

		// 匹配文件名
		matched, _ := filepath.Match(args.Pattern, name)
		if matched {
			info, _ := d.Info()
			size := int64(0)
			if info != nil {
				size = info.Size()
			}

			// 🔧 截断路径（避免极长路径）
			truncatedPath := path
			if len(path) > 500 {
				truncatedPath = truncateLine(path, 500)
			}

			results = append(results, FileInfo{
				Path:  truncatedPath,
				IsDir: d.IsDir(),
				Size:  size,
			})
		}

		// 限制结果数量（避免上下文溢出）
		if len(results) >= 50 {
			return filepath.SkipAll
		}

		return nil
	})

	if err != nil {
		return "", fmt.Errorf("查找失败: %v", err)
	}

	truncated := len(results) >= 50

	result := map[string]interface{}{
		"success":   true,
		"type":      "find",
		"pattern":   args.Pattern,
		"results":   results,
		"truncated": truncated,
	}

	resultJSON, _ := json.Marshal(result)
	return string(resultJSON), nil
}

// 辅助函数

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func truncateLine(line string, maxLen int) string {
	if maxLen <= 0 {
		maxLen = 2000
	}
	if len(line) <= maxLen {
		return line
	}
	return line[:maxLen] + "... [截断，原长度: " + fmt.Sprintf("%d", len(line)) + " 字符]"
}

func generateUniqueID() string {
	// 简单的ID生成（实际项目中应使用UUID）
	return fmt.Sprintf("edit_%d", os.Getpid())
}

// calculateLineDiff 计算本次编辑的行数差异（oldString → newString）
func calculateLineDiff(oldContent, newContent string) (linesDeleted, linesAdded int) {
	oldLines := strings.Split(oldContent, "\n")
	newLines := strings.Split(newContent, "\n")

	// 计算差异的起始和结束位置
	minLen := min(len(oldLines), len(newLines))
	firstDiff := -1
	lastDiffOld := -1
	lastDiffNew := -1

	// 找到第一个不同的行
	for i := 0; i < minLen; i++ {
		if oldLines[i] != newLines[i] {
			firstDiff = i
			break
		}
	}

	// 如果所有行都相同但长度不同
	if firstDiff == -1 {
		if len(oldLines) != len(newLines) {
			firstDiff = minLen
		} else {
			return 0, 0
		}
	}

	// 从后往前找到最后一个不同的行
	for i := 0; i < minLen-firstDiff; i++ {
		oldIdx := len(oldLines) - 1 - i
		newIdx := len(newLines) - 1 - i
		if oldLines[oldIdx] != newLines[newIdx] {
			lastDiffOld = oldIdx
			lastDiffNew = newIdx
			break
		}
	}

	if lastDiffOld == -1 {
		lastDiffOld = len(oldLines) - 1
	}
	if lastDiffNew == -1 {
		lastDiffNew = len(newLines) - 1
	}

	// 计算删除和添加的行数
	if firstDiff <= lastDiffOld {
		linesDeleted = lastDiffOld - firstDiff + 1
	}
	if firstDiff <= lastDiffNew {
		linesAdded = lastDiffNew - firstDiff + 1
	}

	return linesDeleted, linesAdded
}
