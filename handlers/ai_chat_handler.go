package handlers

import (
	"all_project/storage"
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
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
		if req.SessionID == "ping" {
			ws.WriteJSON(map[string]string{"type": "pong"})
			continue
		}

		// TODO: 处理停止信号
		// if req.Type == "stop" {
		// 	// 停止当前生成
		// 	continue
		// }

		// 获取会话
		session, err := storage.GetSession(req.SessionID)
		if err != nil {
			ws.WriteJSON(map[string]interface{}{
				"type":  "error",
				"error": "会话不存在",
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

		// 构建消息历史
		messages := buildMessagesForAPI(session.Messages, aiConfig.SystemPrompt)

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

		// 工具调用循环（最多10轮）
		maxIterations := 10
		for iteration := 0; iteration < maxIterations; iteration++ {
			// 调用OpenAI API (流式，支持工具调用)
			toolCalls, assistantContent, reasoningContent, err := h.streamChatWithTools(
				provider.BaseURL,
				provider.APIKey,
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

			// 保存助手回复
			assistantMsg := storage.ChatMessage{
				Role:             "assistant",
				Content:          assistantContent,
				ReasoningContent: reasoningContent,
				Timestamp:        time.Now(),
			}
			if err := storage.AddMessage(req.SessionID, assistantMsg); err != nil {
				log.Println("保存助手消息失败:", err)
			}

			// 检查是否有工具调用
			if len(toolCalls) == 0 {
				// 没有工具调用，结束循环
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

			// 执行工具并收集结果
			for _, toolCall := range toolCalls {
				tcMap, ok := toolCall.(map[string]interface{})
				if !ok {
					continue
				}

				toolCallID := getString(tcMap, "id")
				functionData := getMap(tcMap, "function")
				functionName := getString(functionData, "name")

				// 执行工具
				result := h.executeToolCall(functionName, getString(functionData, "arguments"))

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

				// 添加工具结果到消息历史
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
			}

			// 继续下一轮对话（带着工具结果）
		}

		// 如果达到最大迭代次数
		if maxIterations >= 10 {
			ws.WriteJSON(map[string]interface{}{
				"type":    "warning",
				"message": "工具调用达到最大次数限制",
			})
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
		messages = append(messages, map[string]interface{}{
			"role":    msg.Role,
			"content": msg.Content,
		})
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
		"tools":       GetToolsDefinition(), // 添加工具定义
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
func (h *AIChatHandler) executeToolCall(toolName, argsJSON string) string {
	log.Printf("🔧 执行工具: %s, 参数: %s", toolName, argsJSON)

	// 使用统一工具执行器
	result, err := h.toolExecutor.Execute(toolName, argsJSON)
	if err != nil {
		log.Printf("❌ 工具执行失败: %v", err)
		// 返回错误信息给AI
		return fmt.Sprintf(`{"success": false, "error": "%s"}`, err.Error())
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
