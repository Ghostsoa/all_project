package handlers

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// ToolExecutor 统一的工具执行器
type ToolExecutor struct {
	editPreviews map[string]*EditPreview // 编辑预览池
}

// NewToolExecutor 创建工具执行器
func NewToolExecutor() *ToolExecutor {
	return &ToolExecutor{
		editPreviews: make(map[string]*EditPreview),
	}
}

// EditPreview 编辑预览
type EditPreview struct {
	PreviewID  string      `json:"preview_id"`
	ServerID   string      `json:"server_id"`
	FilePath   string      `json:"file_path"`
	OldContent string      `json:"old_content"`
	NewContent string      `json:"new_content"`
	Operations []Operation `json:"operations"`
	Timestamp  time.Time   `json:"timestamp"`
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
func (te *ToolExecutor) Execute(toolName string, argsJSON string) (string, error) {
	if toolName != "file_operation" {
		return "", fmt.Errorf("未知工具: %s", toolName)
	}

	return te.fileOperation(argsJSON)
}

// fileOperation 统一的文件操作入口
func (te *ToolExecutor) fileOperation(argsJSON string) (string, error) {
	var args FileOperationArgs
	if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
		return "", fmt.Errorf("解析参数失败: %v", err)
	}

	// 根据操作类型分发
	switch args.Type {
	case "read":
		return te.readFile(args)
	case "write":
		return te.writeFile(args)
	case "edit":
		return te.editFile(args)
	case "list":
		return te.listDir(args)
	default:
		return "", fmt.Errorf("未知操作类型: %s", args.Type)
	}
}

// readFile 读取文件内容
func (te *ToolExecutor) readFile(args FileOperationArgs) (string, error) {
	// 读取文件
	content, err := os.ReadFile(args.FilePath)
	if err != nil {
		return "", fmt.Errorf("读取文件失败: %v", err)
	}

	// 返回结果（JSON格式）
	result := map[string]interface{}{
		"success":   true,
		"type":      "read",
		"server_id": args.ServerID,
		"file_path": args.FilePath,
		"content":   string(content),
		"size":      len(content),
	}

	resultJSON, _ := json.Marshal(result)
	return string(resultJSON), nil
}

// writeFile 写入文件（创建或覆盖）
func (te *ToolExecutor) writeFile(args FileOperationArgs) (string, error) {

	// 确保目录存在
	dir := filepath.Dir(args.FilePath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", fmt.Errorf("创建目录失败: %v", err)
	}

	// 写入文件
	if err := os.WriteFile(args.FilePath, []byte(args.Content), 0644); err != nil {
		return "", fmt.Errorf("写入文件失败: %v", err)
	}

	result := map[string]interface{}{
		"success":   true,
		"type":      "write",
		"server_id": args.ServerID,
		"file_path": args.FilePath,
		"size":      len(args.Content),
		"message":   fmt.Sprintf("已创建/更新文件: %s", args.FilePath),
	}

	resultJSON, _ := json.Marshal(result)
	return string(resultJSON), nil
}

// editFile 精确编辑文件（搜索替换）
func (te *ToolExecutor) editFile(args FileOperationArgs) (string, error) {

	// 1. 读取当前文件内容
	currentContent, err := os.ReadFile(args.FilePath)
	if err != nil {
		return "", fmt.Errorf("读取文件失败: %v", err)
	}

	content := string(currentContent)

	// 2. 检查 old_string 是否存在
	if !strings.Contains(content, args.OldString) {
		return "", fmt.Errorf(
			"找不到要替换的内容。请确保 old_string 完全匹配（包括空格、缩进、换行）。\n" +
				"提示: 使用 read_file 先查看文件内容，然后复制确切的内容作为 old_string。",
		)
	}

	// 3. 检查是否有多个匹配
	count := strings.Count(content, args.OldString)
	if count > 1 {
		return "", fmt.Errorf(
			"找到 %d 个匹配项，无法确定要替换哪一个。\n"+
				"请提供更长的 old_string（包含更多上下文）以确保唯一匹配。",
			count,
		)
	}

	// 4. 执行替换
	newContent := strings.Replace(content, args.OldString, args.NewString, 1)

	// 5. 计算差异操作
	operations := te.computeOperations(content, newContent, args.OldString, args.NewString)

	// 6. 保存到预览池
	previewID := generateID()
	te.editPreviews[previewID] = &EditPreview{
		PreviewID:  previewID,
		ServerID:   args.ServerID,
		FilePath:   args.FilePath,
		OldContent: content,
		NewContent: newContent,
		Operations: operations,
		Timestamp:  time.Now(),
	}

	// 7. 返回预览结果（不直接写文件）
	result := map[string]interface{}{
		"success":    true,
		"type":       "edit",
		"preview_id": previewID,
		"server_id":  args.ServerID,
		"file_path":  args.FilePath,
		"operations": operations,
		"summary": fmt.Sprintf(
			"准备编辑 %s: %d 行修改",
			filepath.Base(args.FilePath),
			len(operations),
		),
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

// computeOperations 计算编辑操作（找出修改的具体行）
func (te *ToolExecutor) computeOperations(oldContent, newContent, oldStr, newStr string) []Operation {
	oldLines := strings.Split(oldContent, "\n")
	oldStrLines := strings.Split(oldStr, "\n")

	operations := []Operation{}

	// 查找 oldStr 在原文件中的起始行
	for i := 0; i <= len(oldLines)-len(oldStrLines); i++ {
		match := true
		for j := 0; j < len(oldStrLines); j++ {
			if i+j >= len(oldLines) || oldLines[i+j] != oldStrLines[j] {
				match = false
				break
			}
		}

		if match {
			// 找到匹配位置
			startLine := i + 1 // 1-indexed
			endLine := i + len(oldStrLines)

			operations = append(operations, Operation{
				Type:      "replace",
				StartLine: startLine,
				EndLine:   endLine,
				OldText:   oldStr,
				NewText:   newStr,
			})
			break
		}
	}

	return operations
}

// ApplyEdit 应用编辑（用户确认后调用）
func (te *ToolExecutor) ApplyEdit(previewID string) error {
	preview, exists := te.editPreviews[previewID]
	if !exists {
		return fmt.Errorf("预览不存在: %s", previewID)
	}

	// 写入新内容
	if err := os.WriteFile(preview.FilePath, []byte(preview.NewContent), 0644); err != nil {
		return fmt.Errorf("写入文件失败: %v", err)
	}

	// 清理预览
	delete(te.editPreviews, previewID)
	return nil
}

// RejectEdit 拒绝编辑
func (te *ToolExecutor) RejectEdit(previewID string) {
	delete(te.editPreviews, previewID)
}

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
