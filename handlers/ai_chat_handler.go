package handlers

import (
	"all_project/models"
	"all_project/storage"
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

type AIChatHandler struct {
	toolExecutor *ToolExecutor
}

func NewAIChatHandler() *AIChatHandler {
	return &AIChatHandler{
		toolExecutor: NewToolExecutor(),
	}
}

// GetToolExecutor 获取工具执行器（用于edit handler）
func (h *AIChatHandler) GetToolExecutor() *ToolExecutor {
	return h.toolExecutor
}

// ChatRequest 聊天请求
type ChatRequest struct {
	Type         string `json:"type,omitempty"` // 消息类型：ping/stop/message
	SessionID    string `json:"session_id"`
	Content      string `json:"message"`                  // 改为message与前端一致
	RealTimeInfo string `json:"real_time_info,omitempty"` // 终端缓冲区
	CursorInfo   string `json:"cursor_info,omitempty"`    // 编辑器上下文
	SourceInfo   string `json:"source_info,omitempty"`    // 来源信息
}

// ChatStream 处理AI对话的WebSocket连接
func (h *AIChatHandler) ChatStream(w http.ResponseWriter, r *http.Request) {
	// 升级到WebSocket
	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("WebSocket升级失败:", err)
		return
	}
	defer ws.Close()

	for {
		// 读取客户端消息
		var req ChatRequest
		if err := ws.ReadJSON(&req); err != nil {
			log.Println("读取消息失败:", err)
			break
		}

		// 处理心跳
		if req.Type == "ping" {
			ws.WriteJSON(map[string]string{"type": "pong"})
			continue
		}

		// 处理停止信号
		if req.Type == "stop" {
			log.Println("⏹️ 收到停止生成请求")
			// TODO: 实现停止逻辑
			continue
		}

		// 获取会话
		session, err := storage.GetSession(req.SessionID)
		if err != nil {
			log.Printf("❌ 获取会话失败: %v, SessionID: %s", err, req.SessionID)
			ws.WriteJSON(map[string]interface{}{
				"type":  "error",
				"error": fmt.Sprintf("会话不存在: %v", err),
			})
			continue
		}

		// 从会话配置读取模型ID
		modelID := session.ModelID
		if modelID == "" {
			ws.WriteJSON(map[string]interface{}{
				"type":  "error",
				"error": "会话未配置模型",
			})
			continue
		}

		// 根据模型ID找到供应商
		provider, err := storage.FindProviderByModel(modelID)
		if err != nil {
			ws.WriteJSON(map[string]interface{}{
				"type":  "error",
				"error": "未找到模型对应的供应商: " + modelID,
			})
			continue
		}

		// 获取全局AI配置
		aiConfig, err := storage.GetAIConfig()
		if err != nil {
			ws.WriteJSON(map[string]interface{}{
				"type":  "error",
				"error": "获取AI配置失败",
			})
			continue
		}

		// 保存用户消息
		userMsg := storage.ChatMessage{
			Role:      "user",
			Content:   req.Content,
			Timestamp: time.Now(),
		}
		if err := storage.AddMessage(req.SessionID, userMsg); err != nil {
			ws.WriteJSON(map[string]interface{}{
				"type":  "error",
				"error": "保存消息失败",
			})
			continue
		}

		// 🔧 动态构建系统prompt（注入服务器列表）
		systemPrompt := buildDynamicSystemPrompt(aiConfig.SystemPrompt)

		// 构建消息历史
		messages := buildMessagesForAPI(session.Messages, systemPrompt)

		// 构建用户消息内容（注入上下文信息）
		userContent := req.Content
		if req.RealTimeInfo != "" || req.CursorInfo != "" {
			userContent = injectContextInfo(req.Content, req.RealTimeInfo, req.CursorInfo, req.SourceInfo)
			log.Printf("📝 已注入上下文信息 - RealTimeInfo: %d字符, CursorInfo: %d字符",
				len(req.RealTimeInfo), len(req.CursorInfo))
		}

		messages = append(messages, map[string]interface{}{
			"role":    "user",
			"content": userContent,
		})

		// 🔐 获取解密后的API Key
		apiKey, err := storage.GetProviderAPIKey(provider.ID)
		if err != nil {
			ws.WriteJSON(map[string]interface{}{
				"type":  "error",
				"error": fmt.Sprintf("获取API Key失败: %v", err),
			})
			return
		}

		// 工具调用循环（最多20轮）
		maxIterations := 20
		for iteration := 0; iteration < maxIterations; iteration++ {
			// 调用OpenAI API (流式，支持工具调用)
			toolCalls, assistantContent, reasoningContent, err := h.streamChatWithTools(
				provider.BaseURL,
				apiKey, // ✅ 使用解密后的API Key
				modelID,
				messages,
				aiConfig,
				ws,
			)

			if err != nil {
				ws.WriteJSON(map[string]interface{}{
					"type":  "error",
					"error": err.Error(),
				})
				break
			}

			// 保存助手回复（包含工具调用）
			var toolCallsForSave []map[string]interface{}
			for _, tc := range toolCalls {
				if tcMap, ok := tc.(map[string]interface{}); ok {
					toolCallsForSave = append(toolCallsForSave, tcMap)
				}
			}

			assistantMsg := storage.ChatMessage{
				Role:             "assistant",
				Content:          assistantContent,
				ReasoningContent: reasoningContent,
				ToolCalls:        toolCallsForSave, // 保存工具调用
				Timestamp:        time.Now(),
			}
			if err := storage.AddMessage(req.SessionID, assistantMsg); err != nil {
				log.Println("保存助手消息失败:", err)
			}

			// 检查是否有工具调用
			if len(toolCalls) == 0 {
				// 没有工具调用，结束循环
				// 保存当前轮次的快照
				h.saveCurrentTurnSnapshot(req.SessionID)

				ws.WriteJSON(map[string]interface{}{
					"type": "done",
				})
				break
			}

			// 发送工具调用信息给前端
			ws.WriteJSON(map[string]interface{}{
				"type":       "tool_calls",
				"tool_calls": toolCalls,
			})

			// 添加助手的工具调用消息
			messages = append(messages, map[string]interface{}{
				"role":       "assistant",
				"content":    assistantContent,
				"tool_calls": toolCalls,
			})

			// 🔧 检查是否已达到上限（第20轮，iteration=19）
			reachedLimit := (iteration >= maxIterations-1)

			// 执行工具并收集结果
			for _, toolCall := range toolCalls {
				tcMap, ok := toolCall.(map[string]interface{})
				if !ok {
					continue
				}

				toolCallID := getString(tcMap, "id")
				functionData := getMap(tcMap, "function")
				functionName := getString(functionData, "name")
				functionArgs := getString(functionData, "arguments")

				// 发送工具调用通知（执行前）
				ws.WriteJSON(map[string]interface{}{
					"type":         "tool_call",
					"tool_call_id": toolCallID,
					"name":         functionName,
					"arguments":    functionArgs,
				})

				var result string

				// 🔧 如果已达到上限，不执行工具，直接返回错误
				if reachedLimit {
					log.Printf("⚠️ 已达到工具调用上限（20次），返回错误给模型: %s", functionName)
					errorResult := map[string]interface{}{
						"success": false,
						"error":   "本轮工具调用已达到最大次数限制（20次）。请基于已有的工具执行结果给出最终答案，不要再调用任何工具。",
					}
					errorJSON, _ := json.Marshal(errorResult)
					result = string(errorJSON)
				} else {
					// 正常执行工具（传递sessionID和messageID）
					result = h.executeToolCall(functionName, functionArgs, req.SessionID, toolCallID)
				}

				// 如果是file_operation且类型为edit，解析结果并发送edit_preview
				if functionName == "file_operation" {
					var opResult map[string]interface{}
					if err := json.Unmarshal([]byte(result), &opResult); err == nil {
						if success, ok := opResult["success"].(bool); ok && success {
							if opType, ok := opResult["type"].(string); ok && opType == "edit" {
								// 发送编辑预览给前端
								ws.WriteJSON(map[string]interface{}{
									"type":       "edit_preview",
									"preview_id": opResult["preview_id"],
									"server_id":  opResult["server_id"],
									"file_path":  opResult["file_path"],
									"operations": opResult["operations"],
								})
							}
						}
					}
				}

				// 添加工具结果到消息历史（API）
				messages = append(messages, map[string]interface{}{
					"role":         "tool",
					"tool_call_id": toolCallID,
					"content":      result,
				})

				// 发送工具执行结果给前端
				ws.WriteJSON(map[string]interface{}{
					"type":         "tool_result",
					"tool_call_id": toolCallID,
					"name":         functionName,
					"result":       result,
				})

				// 保存工具结果到数据库
				toolMsg := storage.ChatMessage{
					Role:       "tool",
					Content:    result,
					ToolCallID: toolCallID,
					ToolName:   functionName,
					Timestamp:  time.Now(),
				}
				if err := storage.AddMessage(req.SessionID, toolMsg); err != nil {
					log.Println("保存工具消息失败:", err)
				}
			}

			// 继续下一轮对话（带着工具结果）
		}
	}
}

// saveCurrentTurnSnapshot 保存当前轮次的快照到file_history（支持多服务器）
// Turn N: 保存初始快照（磁盘状态）+ 最终快照（pending状态）
func (h *AIChatHandler) saveCurrentTurnSnapshot(sessionID string) {
	pendingManager := models.GetPendingStateManager()
	historyManager := models.GetFileHistoryManager()

	// 获取所有服务器ID
	serverIDs := getAllServerIDsForCleanup()

	// 统计总文件数
	totalFiles := 0
	for _, serverID := range serverIDs {
		allFiles := pendingManager.GetAllPendingFiles(serverID, sessionID)
		totalFiles += len(allFiles)
	}

	if totalFiles == 0 {
		log.Printf("ℹ️ 没有pending修改，跳过快照保存")
		return
	}

	// 获取当前轮次（统计用户消息数量）
	session, err := storage.GetSession(sessionID)
	if err != nil {
		log.Printf("⚠️ 获取会话失败，无法保存快照: %v", err)
		return
	}

	// 直接使用session.Messages而不是重新读取
	userMessageCount := 0
	for _, msg := range session.Messages {
		if msg.Role == "user" {
			userMessageCount++
		}
	}

	if userMessageCount == 0 {
		log.Printf("⚠️ 没有用户消息，跳过快照保存")
		return
	}

	currentTurn := userMessageCount - 1 // Turn从0开始（0, 1, 2...）

	log.Printf("📸 保存Turn%d快照，涉及%d个文件（共%d个用户消息）", currentTurn, totalFiles, userMessageCount)

	// 对每个server_id处理
	for _, serverID := range serverIDs {
		allFiles := pendingManager.GetAllPendingFiles(serverID, sessionID)
		if len(allFiles) == 0 {
			continue
		}

		log.Printf("📋 [%s] 处理%d个文件", serverID, len(allFiles))

		// 对每个文件保存快照
		for filePath := range allFiles {
			// 读取磁盘内容
			diskContent, err := os.ReadFile(filePath)
			if err != nil {
				log.Printf("⚠️ [%s] 读取文件失败 %s: %v", serverID, filePath, err)
				continue
			}
			diskContentStr := string(diskContent)

			// 1. 保存Turn N快照 = 磁盘初始状态（如果还没保存）
			_, hasSnapshot := historyManager.GetSnapshot(serverID, sessionID, filePath, currentTurn)
			if !hasSnapshot {
				if err := historyManager.AddSnapshot(serverID, sessionID, filePath, currentTurn, diskContentStr); err != nil {
					log.Printf("⚠️ [%s] 保存Turn%d快照失败: %v", serverID, currentTurn, err)
				} else {
					log.Printf("✅ [%s] 保存Turn%d快照（初始）: %s (%d字节)", serverID, currentTurn, filePath, len(diskContentStr))
				}
			} else {
				log.Printf("ℹ️ [%s] Turn%d快照已存在: %s", serverID, currentTurn, filePath)
			}

			// 2. 保存Turn N+1快照 = pending最终状态
			finalContent := pendingManager.GetCurrentContent(serverID, sessionID, filePath, diskContentStr)
			if err := historyManager.AddSnapshot(serverID, sessionID, filePath, currentTurn+1, finalContent); err != nil {
				log.Printf("⚠️ [%s] 保存Turn%d快照失败: %v", serverID, currentTurn+1, err)
			} else {
				log.Printf("✅ [%s] 保存Turn%d快照（最终）: %s (%d字节)", serverID, currentTurn+1, filePath, len(finalContent))
			}
		}
	}
}

// buildMessagesForAPI 构建API消息列表
func buildMessagesForAPI(history []storage.ChatMessage, systemPrompt string) []map[string]interface{} {
	messages := []map[string]interface{}{}

	// 添加系统提示
	if systemPrompt != "" {
		messages = append(messages, map[string]interface{}{
			"role":    "system",
			"content": systemPrompt,
		})
	}

	// 添加历史消息
	for _, msg := range history {
		message := map[string]interface{}{
			"role":    msg.Role,
			"content": msg.Content,
		}

		// 如果是 assistant 消息且有工具调用，添加 tool_calls
		if msg.Role == "assistant" && len(msg.ToolCalls) > 0 {
			message["tool_calls"] = msg.ToolCalls
		}

		// 如果是 tool 消息，添加 tool_call_id
		if msg.Role == "tool" && msg.ToolCallID != "" {
			message["tool_call_id"] = msg.ToolCallID
		}

		messages = append(messages, message)
	}

	return messages
}

// injectContextInfo 注入上下文信息到用户消息
func injectContextInfo(userMessage, realTimeInfo, cursorInfo, sourceInfo string) string {
	var parts []string
	parts = append(parts, userMessage)

	// 注入终端实时信息
	if realTimeInfo != "" {
		parts = append(parts, "\n\n---\n## 【实时环境信息】用户终端当前状态\n")
		if sourceInfo != "" {
			parts = append(parts, "**来源**: "+sourceInfo+"\n\n")
		}
		parts = append(parts, "**说明**: 这是系统自动捕获的用户终端实时快照（最近200行输出），包含用户刚刚执行的命令和最新输出结果。\n\n")
		parts = append(parts, "**终端输出**:\n```\n"+realTimeInfo+"\n```")
	}

	// 注入编辑器上下文
	if cursorInfo != "" {
		parts = append(parts, "\n\n---\n## 【实时环境信息】用户编辑器当前状态\n")
		if sourceInfo != "" && realTimeInfo == "" {
			parts = append(parts, "**来源**: "+sourceInfo+"\n\n")
		}
		parts = append(parts, "**说明**: 这是系统自动捕获的用户编辑器实时状态。内容类型有三种优先级：\n")
		parts = append(parts, "1. **用户选中内容** (最高优先级，标记✓) - 用户明确选中的代码段\n")
		parts = append(parts, "2. **完整文件** - 文件≤200行时发送全部内容\n")
		parts = append(parts, "3. **光标周围上下文** - 文件>200行时发送光标前后100行\n")
		parts = append(parts, "\n箭头(→)标记光标所在行。详细信息见下方代码块。\n\n")
		parts = append(parts, "**代码信息**:\n```\n"+cursorInfo+"\n```")
	}

	return strings.Join(parts, "")
}

// streamChatWithTools 流式调用OpenAI API，收集tool_calls
func (h *AIChatHandler) streamChatWithTools(
	baseURL string,
	apiKey string,
	model string,
	messages []map[string]interface{},
	config *storage.AIConfig,
	ws *websocket.Conn,
) ([]interface{}, string, string, error) {
	// 构建请求体
	requestBody := map[string]interface{}{
		"model":       model,
		"messages":    messages,
		"stream":      true,
		"temperature": config.Temperature,
		"max_tokens":  config.MaxTokens,
		"top_p":       config.TopP,
		"tools":       GetToolsDefinition(config), // 添加工具定义（根据配置动态加载）
	}

	if config.FrequencyPenalty != 0 {
		requestBody["frequency_penalty"] = config.FrequencyPenalty
	}
	if config.PresencePenalty != 0 {
		requestBody["presence_penalty"] = config.PresencePenalty
	}

	jsonData, err := json.Marshal(requestBody)
	if err != nil {
		return nil, "", "", err
	}

	// 创建HTTP请求
	url := strings.TrimSuffix(baseURL, "/") + "/chat/completions"
	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, "", "", err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	// 发送请求
	client := &http.Client{Timeout: 5 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return nil, "", "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, "", "", fmt.Errorf("API错误 %d: %s", resp.StatusCode, string(body))
	}

	// 处理流式响应
	var fullContent strings.Builder
	var reasoningContent string
	var toolCalls []interface{}
	reader := bufio.NewReader(resp.Body)

	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			if err == io.EOF {
				break
			}
			return nil, "", "", err
		}

		line = strings.TrimSpace(line)
		if line == "" || line == "data: [DONE]" {
			continue
		}

		if !strings.HasPrefix(line, "data: ") {
			continue
		}

		jsonStr := strings.TrimPrefix(line, "data: ")
		var streamResp map[string]interface{}
		if err := json.Unmarshal([]byte(jsonStr), &streamResp); err != nil {
			continue
		}

		choices, ok := streamResp["choices"].([]interface{})
		if !ok || len(choices) == 0 {
			continue
		}

		choice := choices[0].(map[string]interface{})
		delta, ok := choice["delta"].(map[string]interface{})
		if !ok {
			continue
		}

		// 处理普通内容
		if content, ok := delta["content"].(string); ok {
			fullContent.WriteString(content)
			// 发送增量内容给前端
			ws.WriteJSON(map[string]interface{}{
				"type":    "content",
				"content": content,
			})
		}

		// 处理reasoning内容（o1模型）
		if reasoning, ok := delta["reasoning_content"].(string); ok {
			reasoningContent += reasoning
			ws.WriteJSON(map[string]interface{}{
				"type":              "reasoning",
				"reasoning_content": reasoning,
			})
		}

		// 收集tool_calls（流式累积）
		if deltaToolCalls, ok := delta["tool_calls"].([]interface{}); ok {
			for _, tc := range deltaToolCalls {
				tcMap, ok := tc.(map[string]interface{})
				if !ok {
					continue
				}

				index, hasIndex := tcMap["index"].(float64)
				if !hasIndex {
					continue
				}

				idx := int(index)

				// 扩展toolCalls数组
				for len(toolCalls) <= idx {
					toolCalls = append(toolCalls, map[string]interface{}{
						"id":   "",
						"type": "function",
						"function": map[string]interface{}{
							"name":      "",
							"arguments": "",
						},
					})
				}

				currentTC := toolCalls[idx].(map[string]interface{})

				// 更新id和type
				if id, ok := tcMap["id"].(string); ok && id != "" {
					currentTC["id"] = id
				}
				if tcType, ok := tcMap["type"].(string); ok && tcType != "" {
					currentTC["type"] = tcType
				}

				// 累积function数据
				if funcData, ok := tcMap["function"].(map[string]interface{}); ok {
					currentFunc := currentTC["function"].(map[string]interface{})
					if name, ok := funcData["name"].(string); ok && name != "" {
						currentFunc["name"] = name
					}
					if args, ok := funcData["arguments"].(string); ok {
						currentFunc["arguments"] = currentFunc["arguments"].(string) + args
					}
				}
			}
		}
	}

	return toolCalls, fullContent.String(), reasoningContent, nil
}

// executeToolCall 执行工具调用
func (h *AIChatHandler) executeToolCall(toolName, argsJSON string, conversationID string, messageID string) string {
	log.Printf("🔧 执行工具: %s, conversationID: %s, messageID: %s", toolName, conversationID, messageID)

	// 使用统一工具执行器
	result, err := h.toolExecutor.Execute(toolName, argsJSON, conversationID, messageID)
	if err != nil {
		log.Printf("❌ 工具执行失败: %v", err)
		// 返回错误信息给AI（使用json.Marshal正确转义）
		errorResult := map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		}
		resultJSON, _ := json.Marshal(errorResult)
		return string(resultJSON)
	}

	log.Printf("✅ 工具执行成功: %s", toolName)
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
	return map[string]interface{}{}
}

// buildDynamicSystemPrompt 构建动态系统prompt（注入服务器列表等上下文信息）
func buildDynamicSystemPrompt(basePrompt string) string {
	// 获取所有服务器列表
	servers, err := storage.GetServers()
	if err != nil {
		log.Printf("⚠️ 获取服务器列表失败: %v", err)
		return basePrompt
	}

	// 如果没有服务器，返回原始prompt
	if len(servers) == 0 {
		return basePrompt
	}

	// 构建服务器列表文本（简洁版：只包含名称和server_id）
	serverListText := "\n\n## 📡 可用服务器列表\n\n"

	for _, server := range servers {
		serverListText += fmt.Sprintf("- %s (server_id: `%s`)\n", server.Name, server.ID)
	}

	// 将服务器列表附加到原始prompt后面
	return basePrompt + serverListText
}
