package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"all_project/models"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/sashabaranov/go-openai"
	"gorm.io/gorm"
)

// AIHandler AI对话处理器
type AIHandler struct {
	db          *gorm.DB
	sessionRepo *models.ChatSessionRepository
	messageRepo *models.ChatMessageRepository
	configRepo  *models.ModelConfigRepository
}

// NewAIHandler 创建AI处理器
func NewAIHandler(db *gorm.DB) *AIHandler {
	return &AIHandler{
		db:          db,
		sessionRepo: models.NewChatSessionRepository(db),
		messageRepo: models.NewChatMessageRepository(db),
		configRepo:  models.NewModelConfigRepository(db),
	}
}

// CreateSession 创建新会话
func (h *AIHandler) CreateSession(c *gin.Context) {
	var req struct {
		Title    string `json:"title"`
		ConfigID *uint  `json:"config_id,omitempty"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	// 获取配置（如果未指定则使用默认配置）
	var configID uint
	if req.ConfigID != nil {
		configID = *req.ConfigID
	} else {
		config, err := h.configRepo.GetDefault()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "未找到默认配置"})
			return
		}
		configID = config.ID
	}

	session := &models.ChatSession{
		Title:        req.Title,
		ConfigID:     configID,
		LastActiveAt: time.Now(),
	}

	if err := h.sessionRepo.Create(session); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": session})
}

// GetSessions 获取会话列表
func (h *AIHandler) GetSessions(c *gin.Context) {
	sessions, err := h.sessionRepo.GetAll()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": sessions})
}

// GetSession 获取单个会话详情
func (h *AIHandler) GetSession(c *gin.Context) {
	idStr := c.Query("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "无效的会话ID"})
		return
	}

	session, err := h.sessionRepo.GetByID(uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": session})
}

// GetMessages 获取会话消息
func (h *AIHandler) GetMessages(c *gin.Context) {
	idStr := c.Query("session_id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "无效的会话ID"})
		return
	}

	limitStr := c.Query("limit")
	limit := 0
	if limitStr != "" {
		limit, _ = strconv.Atoi(limitStr)
	}

	messages, err := h.messageRepo.GetBySessionID(uint(id), limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": messages})
}

// ChatStream WebSocket流式对话
func (h *AIHandler) ChatStream(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket升级失败: %v", err)
		return
	}
	defer conn.Close()

	// 用于停止生成的channel（在每次对话中创建新的）
	var currentStopChan chan bool

	for {
		var req struct {
			Type         string `json:"type"`
			SessionID    uint   `json:"session_id"`
			Message      string `json:"message"`
			RealTimeInfo string `json:"real_time_info,omitempty"` // 实时信息（如终端缓冲区）
			CursorInfo   string `json:"cursor_info,omitempty"`    // 指针信息（如光标位置、文件上下文）
			SourceInfo   string `json:"source_info,omitempty"`    // 来源信息（如SSH服务器名称、文件路径等）
		}

		if err := conn.ReadJSON(&req); err != nil {
			log.Printf("读取消息失败: %v", err)
			break
		}

		// 处理心跳
		if req.Type == "ping" {
			conn.WriteJSON(map[string]string{"type": "pong"})
			continue
		}

		// 处理停止信号
		if req.Type == "stop" {
			log.Printf("⏹️ [AI] 收到停止信号 - SessionID: %d", req.SessionID)
			if currentStopChan != nil {
				select {
				case currentStopChan <- true:
					log.Println("✅ 停止信号已发送到处理通道")
				default:
					log.Println("⚠️ 停止信号通道已满或已关闭")
				}
			}
			continue
		}

		log.Printf("📥 [AI] 收到消息 - SessionID: %d, Message: %s", req.SessionID, req.Message)
		if req.SourceInfo != "" {
			log.Printf("   📍 来源信息: %s", req.SourceInfo)
		}
		if req.RealTimeInfo != "" {
			log.Printf("   📌 实时信息长度: %d 字符", len(req.RealTimeInfo))
		}
		if req.CursorInfo != "" {
			log.Printf("   📌 指针信息长度: %d 字符", len(req.CursorInfo))
		}

		// 获取会话和配置
		session, err := h.sessionRepo.GetByID(req.SessionID)
		if err != nil {
			h.sendError(conn, fmt.Sprintf("获取会话失败: %v", err))
			continue
		}

		// 保存用户消息
		userMsg := &models.ChatMessage{
			SessionID: req.SessionID,
			Role:      "user",
			Content:   req.Message,
		}
		if err := h.messageRepo.Create(userMsg); err != nil {
			log.Printf("❌ 保存用户消息失败: %v", err)
			h.sendError(conn, fmt.Sprintf("保存消息失败: %v", err))
			continue
		}
		log.Printf("✅ 用户消息已保存 - ID: %d, Content: %s", userMsg.ID, userMsg.Content)

		// 为本次对话创建新的停止channel
		currentStopChan = make(chan bool, 1)

		// 处理对话（传递上下文信息和停止channel）
		if err := h.processChat(conn, session, req.RealTimeInfo, req.CursorInfo, req.SourceInfo, currentStopChan); err != nil {
			h.sendError(conn, fmt.Sprintf("处理对话失败: %v", err))
			close(currentStopChan)
			currentStopChan = nil
			continue
		}

		// 关闭本次对话的停止channel
		close(currentStopChan)
		currentStopChan = nil

		// 更新会话活跃时间
		h.sessionRepo.UpdateLastActive(req.SessionID)
	}
}

// processChat 处理对话逻辑（支持工具调用循环）
func (h *AIHandler) processChat(conn *websocket.Conn, session *models.ChatSession, realTimeInfo, cursorInfo, sourceInfo string, stopChan <-chan bool) error {
	config := session.Config

	// 创建可取消的context
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// 监听停止信号
	go func() {
		select {
		case <-stopChan:
			log.Println("⏹️ 收到停止信号，取消生成")
			cancel()
		case <-ctx.Done():
		}
	}()

	// 配置OpenAI客户端
	clientConfig := openai.DefaultConfig(config.Endpoint.APIKey)
	clientConfig.BaseURL = config.Endpoint.BaseURL
	client := openai.NewClientWithConfig(clientConfig)

	// 获取历史消息
	messages, err := h.messageRepo.GetRecentMessages(session.ID, config.MaxHistoryRounds)
	if err != nil {
		return err
	}

	log.Printf("📚 获取历史消息 - SessionID: %d, 消息数量: %d", session.ID, len(messages))
	for i, msg := range messages {
		preview := msg.Content
		if len(preview) > 50 {
			preview = preview[:50] + "..."
		}
		log.Printf("   [历史%d] Role: %s, Content: %s", i, msg.Role, preview)
	}

	// 工具调用循环
	for {
		// 构建API消息列表
		apiMessages := []openai.ChatCompletionMessage{}

		// 构建动态系统提示词（注入实时信息）
		systemPrompt := config.SystemPrompt

		// 如果有实时信息，动态注入到系统提示词
		if realTimeInfo != "" {
			var parts []string

			if systemPrompt != "" {
				parts = append(parts, systemPrompt)
			}

			// 注入实时信息（带来源标记）
			parts = append(parts, "\n\n---\n## 用户当前操作环境快照\n")
			if sourceInfo != "" {
				parts = append(parts, "**来源**: "+sourceInfo+"\n\n")
			}
			parts = append(parts, "**说明**: 以下是用户当前正在查看的终端界面的最近输出（终端缓冲区快照），包含最近执行的命令和输出结果。你可以根据这些信息理解用户的操作上下文。\n\n")
			parts = append(parts, "```\n"+realTimeInfo+"\n```")

			systemPrompt = strings.Join(parts, "")
			log.Printf("📝 终端快照已注入系统提示词")
			log.Printf("=" + strings.Repeat("=", 80))
			log.Printf("完整系统提示词:\n%s", systemPrompt)
			log.Printf("=" + strings.Repeat("=", 80))
		}

		// 添加系统提示词
		if systemPrompt != "" {
			apiMessages = append(apiMessages, openai.ChatCompletionMessage{
				Role:    "system",
				Content: systemPrompt,
			})
		}

		// 添加历史消息（转换为OpenAI格式）
		historyMessages := models.ConvertToOpenAIMessages(messages)

		// 如果有指针信息，注入到最后一条用户消息（即当前发送的消息）
		if cursorInfo != "" && len(historyMessages) > 0 {
			// 找到最后一条用户消息
			for i := len(historyMessages) - 1; i >= 0; i-- {
				if historyMessages[i].Role == "user" {
					// 拼接指针信息到用户消息（带来源标记）
					var cursorParts []string
					cursorParts = append(cursorParts, historyMessages[i].Content)
					cursorParts = append(cursorParts, "\n\n---\n## 用户当前编辑器上下文\n")
					if sourceInfo != "" {
						cursorParts = append(cursorParts, "**来源**: "+sourceInfo+"\n\n")
					}
					cursorParts = append(cursorParts, "**说明**: 以下是用户当前正在查看/编辑的文件的光标位置和周围代码上下文。箭头(→)标记的是光标所在行。\n\n")
					cursorParts = append(cursorParts, "```\n"+cursorInfo+"\n```")

					historyMessages[i].Content = strings.Join(cursorParts, "")
					log.Printf("📝 编辑器上下文已注入用户消息")
					break
				}
			}
		}

		apiMessages = append(apiMessages, historyMessages...)

		// 构建请求参数
		apiRequest := openai.ChatCompletionRequest{
			Model:            config.AIModel.Name,
			Messages:         apiMessages,
			Temperature:      config.Temperature,
			MaxTokens:        config.MaxTokens,
			TopP:             config.TopP,
			FrequencyPenalty: config.FrequencyPenalty,
			PresencePenalty:  config.PresencePenalty,
		}

		// 打印完整的API请求信息（调试用）
		log.Printf("🚀 [AI API请求] ========================================")
		log.Printf("📌 模型: %s", config.AIModel.Name)
		log.Printf("📌 API端点: %s", config.Endpoint.BaseURL)
		log.Printf("📌 温度: %.2f, MaxTokens: %d, TopP: %.2f", config.Temperature, config.MaxTokens, config.TopP)
		log.Printf("📌 消息数量: %d", len(apiMessages))
		for i, msg := range apiMessages {
			contentPreview := msg.Content
			if len(contentPreview) > 100 {
				contentPreview = contentPreview[:100] + "..."
			}
			log.Printf("   [%d] Role: %s, Content: %s", i, msg.Role, contentPreview)
		}
		log.Printf("====================================================")

		// 创建流式请求（使用可取消的context）
		stream, err := client.CreateChatCompletionStream(ctx, apiRequest)

		if err != nil {
			return fmt.Errorf("创建流式请求失败: %w", err)
		}
		defer stream.Close()

		// 处理流式响应
		var fullContent strings.Builder
		var fullReasoning strings.Builder
		var toolCalls []openai.ToolCall
		stopped := false

		for {
			// 检查是否被取消
			select {
			case <-ctx.Done():
				log.Println("⏹️ 生成已被取消")
				stopped = true
				goto SaveAndExit
			default:
			}

			response, err := stream.Recv()
			if err == io.EOF {
				break
			}
			if err != nil {
				// 如果是context取消导致的错误，不视为失败
				if ctx.Err() != nil {
					stopped = true
					goto SaveAndExit
				}
				return fmt.Errorf("接收流式响应失败: %w", err)
			}

			delta := response.Choices[0].Delta

			// 处理思维链内容
			if reasoningContent := getReasoningContent(response); reasoningContent != "" {
				fullReasoning.WriteString(reasoningContent)
				h.sendChunk(conn, "reasoning", reasoningContent)
			}

			// 处理常规内容
			if delta.Content != "" {
				fullContent.WriteString(delta.Content)
				h.sendChunk(conn, "content", delta.Content)
			}

			// 收集工具调用
			if len(delta.ToolCalls) > 0 {
				for _, tc := range delta.ToolCalls {
					if tc.Index != nil && *tc.Index >= len(toolCalls) {
						toolCalls = append(toolCalls, openai.ToolCall{
							ID:   tc.ID,
							Type: tc.Type,
							Function: openai.FunctionCall{
								Name:      tc.Function.Name,
								Arguments: tc.Function.Arguments,
							},
						})
					} else if tc.Index != nil {
						idx := *tc.Index
						toolCalls[idx].Function.Arguments += tc.Function.Arguments
					}
				}
			}
		}

	SaveAndExit:
		// 保存助手消息
		content := fullContent.String()

		// 如果被停止且有工具调用，不保存此消息（避免不配对的tool_calls）
		if stopped && len(toolCalls) > 0 {
			log.Println("⚠️ 生成被停止且有未完成的工具调用，不保存此消息避免不配对")
			h.sendChunk(conn, "stopped", "生成已停止（未完成的工具调用已丢弃）")
			break
		}

		if stopped {
			// 如果被停止但没有工具调用，先推送停止标记文本
			stopText := "\n\n[生成已停止]"
			if content == "" {
				stopText = "[生成已停止]"
			}

			// 推送停止标记到前端
			h.sendChunk(conn, "content", stopText)

			// 添加到保存内容
			content += stopText
		}

		// 只有在正常完成或被停止但无工具调用时才保存
		assistantMsg := &models.ChatMessage{
			SessionID:        session.ID,
			Role:             "assistant",
			Content:          content,
			ToolCalls:        toolCalls,
			ReasoningContent: fullReasoning.String(),
		}
		if err := h.messageRepo.Create(assistantMsg); err != nil {
			return err
		}
		messages = append(messages, assistantMsg)

		// 如果被停止，发送stopped消息
		if stopped {
			h.sendChunk(conn, "stopped", "生成已停止")
			break
		}

		// 如果没有工具调用，结束循环
		if len(toolCalls) == 0 {
			h.sendChunk(conn, "done", "")
			break
		}

		// TODO: 处理工具调用（需要实现工具执行逻辑）
		// 现在先简单返回工具调用信息并结束（后续可扩展为实际执行工具）
		h.sendChunk(conn, "tool_calls", fmt.Sprintf("%v", toolCalls))
		h.sendChunk(conn, "done", "")
		break
	}

	return nil
}

// getReasoningContent 提取思维链内容
func getReasoningContent(response openai.ChatCompletionStreamResponse) string {
	if len(response.Choices) == 0 {
		return ""
	}

	data, err := json.Marshal(response.Choices[0].Delta)
	if err != nil {
		return ""
	}

	var deltaMap map[string]interface{}
	if err := json.Unmarshal(data, &deltaMap); err != nil {
		return ""
	}

	if reasoning, ok := deltaMap["reasoning_content"].(string); ok {
		return reasoning
	}

	return ""
}

// sendChunk 发送流式数据块
func (h *AIHandler) sendChunk(conn *websocket.Conn, chunkType, content string) {
	conn.WriteJSON(map[string]string{
		"type":    chunkType,
		"content": content,
	})
}

// sendError 发送错误消息
func (h *AIHandler) sendError(conn *websocket.Conn, message string) {
	conn.WriteJSON(map[string]string{
		"type":    "error",
		"content": message,
	})
}

// DeleteSession 删除会话
func (h *AIHandler) DeleteSession(c *gin.Context) {
	idStr := c.Query("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "无效的会话ID"})
		return
	}

	if err := h.sessionRepo.Delete(uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// ClearSession 清空会话消息
func (h *AIHandler) ClearSession(c *gin.Context) {
	idStr := c.Query("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "无效的会话ID"})
		return
	}

	if err := h.messageRepo.DeleteBySessionID(uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// EditMessage 编辑消息（仅用户消息）
func (h *AIHandler) EditMessage(c *gin.Context) {
	var req struct {
		MessageID uint   `json:"message_id"`
		Content   string `json:"content"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	// 获取消息
	message, err := h.messageRepo.GetByID(req.MessageID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "消息不存在"})
		return
	}

	// 只能编辑用户消息
	if message.Role != "user" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "只能编辑用户消息"})
		return
	}

	// 更新内容
	message.Content = req.Content
	if err := h.messageRepo.Update(message); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": message})
}

// DeleteMessage 删除单条消息
func (h *AIHandler) DeleteMessage(c *gin.Context) {
	idStr := c.Query("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "无效的消息ID"})
		return
	}

	if err := h.messageRepo.Delete(uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

// RevokeMessage 撤回消息（删除该消息及其后所有消息）
func (h *AIHandler) RevokeMessage(c *gin.Context) {
	idStr := c.Query("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "无效的消息ID"})
		return
	}

	// 获取消息
	message, err := h.messageRepo.GetByID(uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "消息不存在"})
		return
	}

	// 删除该消息及其后的所有消息
	if err := h.messageRepo.DeleteFromMessage(message.SessionID, uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}
