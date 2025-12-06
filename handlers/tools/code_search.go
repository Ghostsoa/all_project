package tools

import (
	"all_project/storage"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// CodeSearchArgs 智能代码搜索参数
type CodeSearchArgs struct {
	SearchFolder string `json:"search_folder"` // 搜索目录
	SearchQuery  string `json:"search_query"`  // 自然语言查询
	ServerID     string `json:"server_id"`     // 服务器ID
}

// SearchOperation 单个搜索操作
type SearchOperation struct {
	Type       string   `json:"type"`        // "grep" 或 "read"
	Query      string   `json:"query"`       // grep的搜索内容
	SearchPath string   `json:"search_path"` // 搜索路径
	FilePath   string   `json:"file_path"`   // read的文件路径
	IsRegex    bool     `json:"is_regex"`    // 是否正则
	Includes   []string `json:"includes"`    // 文件过滤
	Offset     int      `json:"offset"`      // read的起始行号（1-indexed）
	Limit      int      `json:"limit"`       // read的读取行数
}

// SearchFilesArgs 批量搜索参数
type SearchFilesArgs struct {
	Operations []SearchOperation `json:"operations"` // 并行执行的操作列表
	ServerID   string            `json:"server_id"`  // 服务器ID
}

// CodeSnippet 代码片段定义
type CodeSnippet struct {
	FilePath  string `json:"file_path"`  // 文件路径
	StartLine int    `json:"start_line"` // 起始行号（1-indexed，0表示整个文件）
	EndLine   int    `json:"end_line"`   // 结束行号（0表示整个文件）
}

// SubmitResultsArgs 提交结果参数
type SubmitResultsArgs struct {
	Snippets []CodeSnippet `json:"snippets"` // 相关代码片段列表（5-10个）
}

// ExecuteCodeSearch 执行智能代码搜索
func ExecuteCodeSearch(argsJSON string, config *storage.AIConfig, conversationID string) (string, error) {
	var args CodeSearchArgs
	if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
		return "", fmt.Errorf("解析参数失败: %v", err)
	}

	log.Printf("🔍 开始智能代码搜索: folder=%s, query=%s", args.SearchFolder, args.SearchQuery)

	// 验证配置
	if config == nil || config.CodeSearchModel == "" {
		return "", fmt.Errorf("code_search功能未配置模型")
	}

	return executeCodeSearchSubAgent(args, config, conversationID)
}

// executeCodeSearchSubAgent 执行子代理搜索
func executeCodeSearchSubAgent(args CodeSearchArgs, config *storage.AIConfig, parentConversationID string) (string, error) {
	// 生成目录结构树，帮助模型了解代码库布局
	directoryTree := generateDirectoryTree(args.SearchFolder, 3) // 最多3层深度

	// 系统提示词：强调工具调用，不输出文本
	systemPrompt := buildCodeSearchSystemPrompt(args.SearchFolder, args.SearchQuery)

	// 初始化消息历史（包含目录结构）
	messages := []map[string]interface{}{
		{
			"role":    "system",
			"content": systemPrompt,
		},
		{
			"role": "user",
			"content": fmt.Sprintf("开始搜索：%s\n\n**目录结构：**\n```\n%s\n```\n\n请基于上述目录结构，制定搜索策略并开始搜索。",
				args.SearchQuery, directoryTree),
		},
	}

	// 多轮迭代（最多5轮）
	maxIterations := 5
	var finalResult string

	for iteration := 0; iteration < maxIterations; iteration++ {
		log.Printf("🔄 code_search 第%d轮搜索", iteration+1)

		// 调用LLM（使用CodeSearchModel）
		toolCalls, content, err := callCodeSearchLLM(config, messages)
		if err != nil {
			return "", fmt.Errorf("LLM调用失败: %v", err)
		}

		// 如果有内容输出，记录但不使用
		if content != "" {
			log.Printf("⚠️ code_search LLM输出了文本（应该只调用工具）: %s", content)
		}

		// 没有工具调用，说明LLM认为完成了（但应该调用submit_results）
		if len(toolCalls) == 0 {
			return "", fmt.Errorf("code_search未正确调用工具结束")
		}

		// 添加assistant消息
		assistantMsg := map[string]interface{}{
			"role":       "assistant",
			"tool_calls": toolCalls,
		}
		if content != "" {
			assistantMsg["content"] = content
		}
		messages = append(messages, assistantMsg)

		// 执行工具调用
		hasSubmit := false
		for _, toolCall := range toolCalls {
			tcMap, ok := toolCall.(map[string]interface{})
			if !ok {
				continue
			}

			toolCallID := getString(tcMap, "id")
			functionData := getMap(tcMap, "function")
			functionName := getString(functionData, "name")
			functionArgs := getString(functionData, "arguments")

			log.Printf("🔧 执行工具: %s", functionName)

			var result string
			var execErr error

			switch functionName {
			case "search_files":
				result, execErr = executeSearchFiles(functionArgs, args.SearchFolder, args.ServerID, parentConversationID)
			case "submit_results":
				result, execErr = executeSubmitResults(functionArgs)
				if execErr == nil {
					hasSubmit = true
					finalResult = result
				}
			default:
				execErr = fmt.Errorf("未知工具: %s", functionName)
			}

			// 构建工具结果消息
			toolResultMsg := map[string]interface{}{
				"role":         "tool",
				"tool_call_id": toolCallID,
				"content":      result,
			}
			if execErr != nil {
				toolResultMsg["content"] = fmt.Sprintf(`{"error": "%s"}`, execErr.Error())
			}
			messages = append(messages, toolResultMsg)
		}

		// 如果调用了submit_results，结束循环
		if hasSubmit {
			log.Printf("✅ code_search完成，返回结果")
			return finalResult, nil
		}

		// 🔧 如果已经是第5轮且没有提交，强制要求模型提交
		if iteration >= maxIterations-1 {
			log.Printf("⚠️ 已达到第%d轮搜索上限，要求模型提交结果", iteration+1)
			messages = append(messages, map[string]interface{}{
				"role":    "user",
				"content": "⚠️ 已达到搜索轮数上限（5轮）。请立即使用 submit_results 工具提交你已经筛选出来的最相关的代码信息。即使信息不完整也必须提交。",
			})
		}
	}

	return "", fmt.Errorf("code_search超过最大迭代次数（%d轮）且未提交结果", maxIterations)
}

// buildCodeSearchSystemPrompt 构建系统提示词
func buildCodeSearchSystemPrompt(searchFolder, searchQuery string) string {
	return fmt.Sprintf(`You are a specialized code search assistant.

**CRITICAL: YOU MUST ONLY USE TOOL CALLS. DO NOT OUTPUT ANY TEXT OR MARKDOWN.**

Your task:
1. Use the "search_files" tool to search code across multiple rounds
2. Use the "submit_results" tool to submit your final findings

Search target:
Directory: %s
Query: %s

Search strategy (5 rounds max):
Round 1: Broad exploration - grep for keywords, identify key files
Round 2-3: Focused search - read key files, search specific functions
Round 4: Verification - confirm relevance, check dependencies  
Round 5: MUST submit results using "submit_results" tool

**RULES (CRITICAL):**
- ⛔ DO NOT output any text, markdown, or JSON. ONLY use tool calls.
- ✅ Use "search_files" tool with parallel operations
- ✅ Use "submit_results" tool to finish (required)
- ✅ Submit format: {"file_path": "/path/file.go", "start_line": 45, "end_line": 120}
- ✅ If whole file is relevant: start_line=0, end_line=0
- ⚠️ Round 5: MANDATORY submission

BEGIN SEARCH NOW.`, searchFolder, searchQuery)
}

// executeSearchFiles 执行并行搜索
func executeSearchFiles(argsJSON string, baseFolder string, serverID string, conversationID string) (string, error) {
	var args SearchFilesArgs
	if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
		return "", fmt.Errorf("解析参数失败: %v", err)
	}

	// 设置默认serverID
	if args.ServerID == "" {
		args.ServerID = serverID
	}

	// 并行执行所有操作
	results := make([]map[string]interface{}, len(args.Operations))
	var wg sync.WaitGroup
	var mu sync.Mutex

	for i, op := range args.Operations {
		wg.Add(1)
		go func(idx int, operation SearchOperation) {
			defer wg.Done()

			var result string
			var err error

			// 构建file_operation参数
			fileOpArgs := map[string]interface{}{
				"server_id": args.ServerID,
			}

			switch operation.Type {
			case "grep":
				fileOpArgs["type"] = "grep"
				fileOpArgs["query"] = operation.Query
				fileOpArgs["search_path"] = operation.SearchPath
				fileOpArgs["is_regex"] = operation.IsRegex
				if len(operation.Includes) > 0 {
					fileOpArgs["includes"] = operation.Includes
				}

			case "read":
				fileOpArgs["type"] = "read"
				fileOpArgs["file_path"] = operation.FilePath
				// 支持按行号读取
				if operation.Offset > 0 {
					fileOpArgs["offset"] = operation.Offset
				}
				if operation.Limit > 0 {
					fileOpArgs["limit"] = operation.Limit
				}

			default:
				err = fmt.Errorf("未知操作类型: %s", operation.Type)
			}

			if err == nil {
				argsBytes, _ := json.Marshal(fileOpArgs)
				result, err = ExecuteFileOperation(string(argsBytes), conversationID, "code_search_internal")
			}

			mu.Lock()
			results[idx] = map[string]interface{}{
				"operation": operation,
				"success":   err == nil,
				"result":    result,
			}
			if err != nil {
				results[idx]["error"] = err.Error()
			}
			mu.Unlock()
		}(i, op)
	}

	wg.Wait()

	// 返回所有结果
	response := map[string]interface{}{
		"success": true,
		"results": results,
		"count":   len(results),
	}

	resultJSON, _ := json.Marshal(response)
	return string(resultJSON), nil
}

// executeSubmitResults 处理结果提交并自动读取代码
func executeSubmitResults(argsJSON string) (string, error) {
	var args SubmitResultsArgs
	if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
		return "", fmt.Errorf("解析参数失败: %v", err)
	}

	if len(args.Snippets) == 0 {
		return "", fmt.Errorf("未提交任何代码片段")
	}

	// 构建最终输出（类似Cascade的格式）
	var output strings.Builder
	output.WriteString("After analyzing the codebase, the subagent believes that the following snippets are relevant:\n\n")

	for _, snippet := range args.Snippets {
		// 读取文件内容
		fileContent, err := os.ReadFile(snippet.FilePath)
		if err != nil {
			log.Printf("⚠️ 无法读取文件 %s: %v", snippet.FilePath, err)
			continue
		}

		lines := strings.Split(string(fileContent), "\n")
		totalLines := len(lines)

		// 确定读取范围
		startLine := snippet.StartLine
		endLine := snippet.EndLine

		// 如果为0，表示读取整个文件
		if startLine == 0 && endLine == 0 {
			startLine = 1
			endLine = totalLines
		}

		// 边界检查
		if startLine < 1 {
			startLine = 1
		}
		if endLine > totalLines || endLine == 0 {
			endLine = totalLines
		}
		if startLine > endLine {
			startLine = endLine
		}

		// 构建代码片段输出
		output.WriteString(fmt.Sprintf(`<file name="%s" start_line="%d" end_line="%d" full_length="%d">`,
			snippet.FilePath, startLine, endLine, totalLines))
		output.WriteString("\n")

		// 输出带行号的代码（类似read工具）
		for i := startLine - 1; i < endLine && i < len(lines); i++ {
			lineNum := i + 1
			lineContent := lines[i]

			// 截断过长行（限制2000字符）
			if len(lineContent) > 2000 {
				lineContent = lineContent[:2000] + "... [截断]"
			}

			output.WriteString(fmt.Sprintf("%6d→%s\n", lineNum, lineContent))
		}

		output.WriteString("</file>\n\n")
	}

	return output.String(), nil
}

// callCodeSearchLLM 调用LLM（使用CodeSearchModel）
func callCodeSearchLLM(config *storage.AIConfig, messages []map[string]interface{}) ([]interface{}, string, error) {
	// 获取所有Provider
	providers, err := storage.GetProviders()
	if err != nil {
		return nil, "", fmt.Errorf("获取Providers失败: %v", err)
	}

	if len(providers) == 0 {
		return nil, "", fmt.Errorf("没有配置任何Provider")
	}

	// 查找包含该模型的Provider
	var provider *storage.Provider
	for _, p := range providers {
		for _, model := range p.Models {
			if model.ID == config.CodeSearchModel {
				provider = &p
				break
			}
		}
		if provider != nil {
			break
		}
	}

	// 如果没找到，使用第一个Provider
	if provider == nil {
		log.Printf("⚠️ 未找到包含模型 %s 的Provider，使用第一个Provider", config.CodeSearchModel)
		provider = &providers[0]
	}

	// 构建请求体（非流式）
	requestBody := map[string]interface{}{
		"model":       config.CodeSearchModel,
		"messages":    messages,
		"stream":      false, // 非流式
		"tools":       GetCodeSearchToolsForSubAgent(),
		"tool_choice": "required", // 强制必须调用工具
	}

	// 添加可选参数
	if config.Temperature != 0 {
		requestBody["temperature"] = config.Temperature
	}
	if config.MaxTokens != 0 {
		requestBody["max_tokens"] = config.MaxTokens
	}

	jsonData, err := json.Marshal(requestBody)
	if err != nil {
		return nil, "", fmt.Errorf("序列化请求失败: %v", err)
	}

	// 创建HTTP请求
	url := strings.TrimSuffix(provider.BaseURL, "/") + "/chat/completions"
	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, "", fmt.Errorf("创建请求失败: %v", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+provider.APIKey)

	// 发送请求
	client := &http.Client{Timeout: 2 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("API请求失败: %v", err)
	}
	defer resp.Body.Close()

	// 读取响应
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, "", fmt.Errorf("读取响应失败: %v", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("API返回错误: %d, %s", resp.StatusCode, string(body))
	}

	// 解析响应
	var apiResp map[string]interface{}
	if err := json.Unmarshal(body, &apiResp); err != nil {
		return nil, "", fmt.Errorf("解析响应失败: %v", err)
	}

	// 🔍 调试：打印API响应
	log.Printf("🔍 API响应: %s", string(body))

	// 提取choices
	choices, ok := apiResp["choices"].([]interface{})
	if !ok || len(choices) == 0 {
		return nil, "", fmt.Errorf("API响应无效：缺少choices")
	}

	choice := choices[0].(map[string]interface{})
	message, ok := choice["message"].(map[string]interface{})
	if !ok {
		return nil, "", fmt.Errorf("API响应无效：缺少message")
	}

	// 提取content和tool_calls
	content := ""
	if c, ok := message["content"].(string); ok {
		content = c
	}

	var toolCalls []interface{}
	if tc, ok := message["tool_calls"].([]interface{}); ok {
		toolCalls = tc
	}

	// 🔍 调试：打印提取结果
	log.Printf("🔍 提取结果: content=%s, toolCalls数量=%d", content, len(toolCalls))

	return toolCalls, content, nil
}

// generateDirectoryTree 生成目录结构树
func generateDirectoryTree(rootPath string, maxDepth int) string {
	var builder strings.Builder
	builder.WriteString(filepath.Base(rootPath) + "/\n")

	// 忽略列表
	ignoreSet := map[string]bool{
		".git":         true,
		"node_modules": true,
		"__pycache__":  true,
		".idea":        true,
		".vscode":      true,
		"vendor":       true,
		"dist":         true,
		"build":        true,
		".next":        true,
	}

	var walkTree func(path string, prefix string, depth int) error
	walkTree = func(path string, prefix string, depth int) error {
		if depth > maxDepth {
			return nil
		}

		entries, err := os.ReadDir(path)
		if err != nil {
			return nil // 忽略读取错误
		}

		// 过滤并排序
		var validEntries []os.DirEntry
		for _, entry := range entries {
			// 跳过隐藏文件和忽略目录
			name := entry.Name()
			if strings.HasPrefix(name, ".") && name != "." && name != ".." {
				continue
			}
			if ignoreSet[name] {
				continue
			}
			validEntries = append(validEntries, entry)
		}

		// 限制显示数量（避免过多）
		if len(validEntries) > 50 {
			validEntries = validEntries[:50]
		}

		for i, entry := range validEntries {
			isLast := i == len(validEntries)-1
			var branch string
			var newPrefix string

			if isLast {
				branch = "└── "
				newPrefix = prefix + "    "
			} else {
				branch = "├── "
				newPrefix = prefix + "│   "
			}

			name := entry.Name()
			if entry.IsDir() {
				name += "/"
			}

			builder.WriteString(prefix + branch + name + "\n")

			// 递归子目录
			if entry.IsDir() && depth < maxDepth {
				walkTree(filepath.Join(path, entry.Name()), newPrefix, depth+1)
			}
		}

		return nil
	}

	walkTree(rootPath, "", 1)

	result := builder.String()
	// 限制总长度（避免上下文溢出）
	if len(result) > 3000 {
		result = result[:3000] + "\n... (已截断，目录结构过长)"
	}

	return result
}

// 辅助函数
func getString(m map[string]interface{}, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

func getMap(m map[string]interface{}, key string) map[string]interface{} {
	if v, ok := m[key].(map[string]interface{}); ok {
		return v
	}
	return make(map[string]interface{})
}
