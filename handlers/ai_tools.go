package handlers

import (
	"all_project/models"
	"all_project/storage"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
)

// ToolExecutor 统一的工具执行器
type ToolExecutor struct {
	// 不需要保存任何状态，所有确认逻辑由前端处理
}

// NewToolExecutor 创建工具执行器
func NewToolExecutor() *ToolExecutor {
	return &ToolExecutor{}
}

// Operation 编辑操作
type Operation struct {
	Type      string `json:"type"`       // "replace", "insert", "delete"
	StartLine int    `json:"start_line"` // 1-indexed
	EndLine   int    `json:"end_line"`
	OldText   string `json:"old_text"`
	NewText   string `json:"new_text"`
}

// FileOperationArgs 文件操作参数（统一）
type FileOperationArgs struct {
	Type     string `json:"type"`      // "read", "write", "edit", "list"
	ServerID string `json:"server_id"` // 服务器ID（必需）
	FilePath string `json:"file_path"` // 文件/目录路径（必需）

	// write 专用
	Content string `json:"content,omitempty"`

	// edit 专用
	OldString string `json:"old_string,omitempty"`
	NewString string `json:"new_string,omitempty"`
}

// Execute 执行工具调用
func (te *ToolExecutor) Execute(toolName string, argsJSON string, conversationID string, messageID string) (string, error) {
	if toolName != "file_operation" {
		return "", fmt.Errorf("未知工具: %s", toolName)
	}

	return te.fileOperation(argsJSON, conversationID, messageID)
}

// fileOperation 统一的文件操作入口
func (te *ToolExecutor) fileOperation(argsJSON string, conversationID string, messageID string) (string, error) {
	var args FileOperationArgs
	if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
		return "", fmt.Errorf("解析参数失败: %v", err)
	}

	// 根据操作类型分发
	switch args.Type {
	case "read":
		return te.readFile(args, conversationID)
	case "write":
		return te.writeFile(args)
	case "edit":
		return te.editFile(args, conversationID, messageID)
	case "list":
		return te.listDir(args)
	default:
		return "", fmt.Errorf("未知操作类型: %s", args.Type)
	}
}

// readFile 读取文件内容
func (te *ToolExecutor) readFile(args FileOperationArgs, conversationID string) (string, error) {
	manager := models.GetPendingStateManager()

	log.Printf("📖 readFile调用: conversationID=%s, filePath=%s", conversationID, args.FilePath)

	// 读取磁盘文件
	fileContent, err := os.ReadFile(args.FilePath)
	if err != nil {
		return "", fmt.Errorf("读取文件失败: %v", err)
	}
	diskContent := string(fileContent)

	// 获取pending内容（应用所有edits）
	content := manager.GetCurrentContent(conversationID, args.FilePath, diskContent)
	isPending := (content != diskContent)

	if isPending {
		log.Printf("✅ 返回pending内容，内容前50字符: %s", truncate(content, 50))
	} else {
		log.Printf("📁 返回磁盘内容，内容前50字符: %s", truncate(content, 50))
	}

	// 返回结果（JSON格式）
	result := map[string]interface{}{
		"success":    true,
		"type":       "read",
		"server_id":  args.ServerID,
		"file_path":  args.FilePath,
		"content":    content,
		"size":       len(content),
		"is_pending": isPending,
	}

	resultJSON, _ := json.Marshal(result)
	return string(resultJSON), nil
}

// writeFile 写入文件（创建或覆盖） - 只返回pending状态，不执行写入
func (te *ToolExecutor) writeFile(args FileOperationArgs) (string, error) {
	// 检查文件是否已存在
	fileExists := false
	if _, err := os.Stat(args.FilePath); err == nil {
		fileExists = true
	}

	// 计算写入的行数
	lines := strings.Split(args.Content, "\n")
	totalLines := len(lines)

	// 只返回pending状态，不执行实际操作
	result := map[string]interface{}{
		"success":     true,
		"status":      "pending",
		"action":      "write",
		"type":        "write",
		"server_id":   args.ServerID,
		"file_path":   args.FilePath,
		"file_exists": fileExists,
		"total_lines": totalLines, // 写入的总行数
		"message":     fmt.Sprintf("等待用户确认: %s (%d行)", args.FilePath, totalLines),
	}

	resultJSON, _ := json.Marshal(result)
	return string(resultJSON), nil
}

// editFile 精确编辑文件（搜索替换）
func (te *ToolExecutor) editFile(args FileOperationArgs, conversationID string, messageID string) (string, error) {
	manager := models.GetPendingStateManager()

	// 0. 获取当前用户消息数量作为messageIndex（Turn从0开始）
	var messageIndex int
	session, err := storage.GetSession(conversationID)
	if err != nil {
		log.Printf("⚠️ 获取会话失败: %v，使用默认messageIndex=0", err)
		messageIndex = 0
	} else {
		// 统计用户消息数量（只计算role="user"的消息）
		userMessageCount := 0
		for _, msg := range session.Messages {
			if msg.Role == "user" {
				userMessageCount++
			}
		}

		// messageIndex = 用户消息数 - 1（Turn从0开始）
		messageIndex = userMessageCount - 1
		if messageIndex < 0 {
			messageIndex = 0
		}
		log.Printf("📊 当前会话共%d个用户消息，messageIndex(Turn)=%d", userMessageCount, messageIndex)
	}

	// 1. 读取磁盘原始内容（用于计算累计diff）
	diskContent, err := os.ReadFile(args.FilePath)
	if err != nil {
		return "", fmt.Errorf("读取文件失败: %v", err)
	}
	diskContentStr := string(diskContent)

	// 2. 读取当前编辑基础内容（应用所有pending edits）
	baseContent := manager.GetCurrentContent(conversationID, args.FilePath, diskContentStr)

	// 3. 检查 old_string 是否存在（在baseContent中）
	if !strings.Contains(baseContent, args.OldString) {
		return "", fmt.Errorf(
			"找不到要替换的内容。请确保 old_string 完全匹配（包括空格、缩进、换行）。\n" +
				"提示: 使用 read_file 先查看文件内容，然后复制确切的内容作为 old_string。",
		)
	}

	// 4. 检查是否有多个匹配
	count := strings.Count(baseContent, args.OldString)
	if count > 1 {
		return "", fmt.Errorf(
			"找到 %d 个匹配项，无法确定要替换哪一个。\n"+
				"请提供更长的 old_string（包含更多上下文）以确保唯一匹配。",
			count,
		)
	}

	// 5. 执行替换（基于baseContent）
	newContent := strings.Replace(baseContent, args.OldString, args.NewString, 1)

	// 6. 计算本次编辑的差异统计（baseContent → newContent）
	linesDeleted, linesAdded := te.calculateLineDiff(baseContent, newContent)

	// 7. 添加edit操作到pending
	edit := models.EditOperation{
		ToolCallID: messageID,
		MessageID:  messageID,
		OldString:  args.OldString,
		NewString:  args.NewString,
	}
	if err := manager.AddEdit(conversationID, args.FilePath, messageIndex, edit); err != nil {
		return "", fmt.Errorf("保存pending失败: %v", err)
	}

	// 8. 计算差异操作（从磁盘到最终pending的累计变化）
	operations := te.computeFullDiff(diskContentStr, newContent)

	log.Printf("📦 已添加edit到Turn%d: %s (删除%d行, 新增%d行)", messageIndex, args.FilePath, linesDeleted, linesAdded)

	// 9. 返回pending状态（前端负责显示和确认）
	result := map[string]interface{}{
		"success":       true,
		"status":        "pending",
		"action":        "edit",
		"type":          "edit",
		"server_id":     args.ServerID,
		"file_path":     args.FilePath,
		"operations":    operations,
		"tool_call_id":  messageID,
		"lines_deleted": linesDeleted, // 本次编辑删除的行数
		"lines_added":   linesAdded,   // 本次编辑新增的行数
		"summary": fmt.Sprintf(
			"等待用户确认: %s (-%d行, +%d行)",
			filepath.Base(args.FilePath),
			linesDeleted,
			linesAdded,
		),
		// 注意：new_content已存储在pending state中，不需要在响应中包含
		// 这样可以减少消息历史大小，避免AI看到完整文件内容
	}

	resultJSON, _ := json.Marshal(result)
	return string(resultJSON), nil
}

// listDir 列出目录内容
func (te *ToolExecutor) listDir(args FileOperationArgs) (string, error) {
	// 读取目录
	entries, err := os.ReadDir(args.FilePath)
	if err != nil {
		return "", fmt.Errorf("读取目录失败: %v", err)
	}

	// 构建文件列表
	files := []map[string]interface{}{}
	for _, entry := range entries {
		info, _ := entry.Info()
		fileInfo := map[string]interface{}{
			"name":  entry.Name(),
			"isDir": entry.IsDir(),
			"size":  info.Size(),
			"mtime": info.ModTime().Format("2006-01-02 15:04:05"),
		}
		files = append(files, fileInfo)
	}

	result := map[string]interface{}{
		"success":   true,
		"type":      "list",
		"server_id": args.ServerID,
		"path":      args.FilePath,
		"count":     len(files),
		"files":     files,
	}

	resultJSON, _ := json.Marshal(result)
	return string(resultJSON), nil
}

// computeFullDiff 计算完整文件的差异（显示累计变化）
func (te *ToolExecutor) computeFullDiff(oldContent, newContent string) []Operation {
	oldLines := strings.Split(oldContent, "\n")
	newLines := strings.Split(newContent, "\n")

	operations := []Operation{}

	// 简单的逐行对比，找出所有不同的行
	maxLines := len(oldLines)
	if len(newLines) > maxLines {
		maxLines = len(newLines)
	}

	// 找出连续的变化块
	i := 0
	for i < maxLines {
		// 跳过相同的行
		for i < len(oldLines) && i < len(newLines) && oldLines[i] == newLines[i] {
			i++
		}

		if i >= maxLines {
			break
		}

		// 找到变化的起始
		startLine := i + 1 // 1-indexed
		oldBlock := []string{}
		newBlock := []string{}

		// 收集连续变化的行
		for i < len(oldLines) && i < len(newLines) && oldLines[i] != newLines[i] {
			oldBlock = append(oldBlock, oldLines[i])
			newBlock = append(newBlock, newLines[i])
			i++
		}

		// 只在到达文件末尾时处理剩余的行（纯删除或纯添加）
		if i >= len(oldLines) || i >= len(newLines) {
			// 文件长度不同，处理剩余行
			for i < len(oldLines) {
				oldBlock = append(oldBlock, oldLines[i])
				i++
			}
			for i < len(newLines) {
				newBlock = append(newBlock, newLines[i])
				i++
			}
		}

		if len(oldBlock) > 0 || len(newBlock) > 0 {
			operations = append(operations, Operation{
				Type:      "replace",
				StartLine: startLine,
				EndLine:   startLine + len(oldBlock) - 1,
				OldText:   strings.Join(oldBlock, "\n"),
				NewText:   strings.Join(newBlock, "\n"),
			})
		}
	}

	return operations
}

// calculateLineDiff 计算本次编辑的行数差异（oldString → newString）
func (te *ToolExecutor) calculateLineDiff(oldContent, newContent string) (linesDeleted, linesAdded int) {
	// 计算被替换部分（oldString）的行数
	oldLines := strings.Split(oldContent, "\n")
	newLines := strings.Split(newContent, "\n")

	// 找出差异部分
	oldLen := len(oldLines)
	newLen := len(newLines)

	// 找到第一个不同的行
	firstDiff := 0
	for firstDiff < oldLen && firstDiff < newLen && oldLines[firstDiff] == newLines[firstDiff] {
		firstDiff++
	}

	// 找到最后一个不同的行（从后往前）
	lastDiffOld := oldLen - 1
	lastDiffNew := newLen - 1
	for lastDiffOld >= firstDiff && lastDiffNew >= firstDiff && oldLines[lastDiffOld] == newLines[lastDiffNew] {
		lastDiffOld--
		lastDiffNew--
	}

	// 计算删除和新增的行数
	if firstDiff <= lastDiffOld {
		linesDeleted = lastDiffOld - firstDiff + 1
	}
	if firstDiff <= lastDiffNew {
		linesAdded = lastDiffNew - firstDiff + 1
	}

	return linesDeleted, linesAdded
}

// 前端确认后，直接调用文件API执行写入，不需要后端保存预览

// GetToolsDefinition 获取工具定义（发送给AI）
func GetToolsDefinition() []map[string]interface{} {
	return []map[string]interface{}{
		// 统一的文件操作工具
		{
			"type": "function",
			"function": map[string]interface{}{
				"name": "file_operation",
				"description": "统一的文件操作工具，支持读取、写入、编辑、列出目录。通过 type 参数指定操作类型。" +
					"支持多服务器操作。所有操作都需要 server_id 和 file_path。",
				"parameters": map[string]interface{}{
					"type": "object",
					"properties": map[string]interface{}{
						"type": map[string]interface{}{
							"type": "string",
							"enum": []string{"read", "write", "edit", "list"},
							"description": "操作类型：\n" +
								"- read: 读取文件内容\n" +
								"- write: 创建或完全覆盖文件\n" +
								"- edit: 精确编辑文件（搜索替换）\n" +
								"- list: 列出目录内容",
						},
						"server_id": map[string]interface{}{
							"type":        "string",
							"description": "服务器ID（local=本地，其他为远程服务器ID）",
						},
						"file_path": map[string]interface{}{
							"type": "string",
							"description": "文件或目录的绝对路径。\n" +
								"- read/write/edit: 文件路径\n" +
								"- list: 目录路径",
						},
						"content": map[string]interface{}{
							"type":        "string",
							"description": "【仅 type=write 时需要】完整的文件内容",
						},
						"old_string": map[string]interface{}{
							"type": "string",
							"description": "【仅 type=edit 时需要】要替换的旧内容。\n" +
								"必须完全匹配（包括缩进、空格、换行）。\n" +
								"建议包含足够的上下文以确保唯一匹配。\n" +
								"如果有多个匹配会报错，需要提供更长的 old_string。",
						},
						"new_string": map[string]interface{}{
							"type": "string",
							"description": "【仅 type=edit 时需要】新内容。\n" +
								"必须保持正确的缩进和格式。",
						},
					},
					"required": []string{"type", "server_id", "file_path"},
				},
			},
		},
	}
}

// truncate 截断字符串
func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}
