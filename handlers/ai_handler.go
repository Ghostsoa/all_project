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

	for {
		var req struct {
			SessionID uint   `json:"session_id"`
			Message   string `json:"message"`
		}

		if err := conn.ReadJSON(&req); err != nil {
			log.Printf("读取消息失败: %v", err)
			break
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
			h.sendError(conn, fmt.Sprintf("保存消息失败: %v", err))
			continue
		}

		// 处理对话
		if err := h.processChat(conn, session); err != nil {
			h.sendError(conn, fmt.Sprintf("处理对话失败: %v", err))
			continue
		}

		// 更新会话活跃时间
		h.sessionRepo.UpdateLastActive(req.SessionID)
	}
}

// processChat 处理对话逻辑（支持工具调用循环）
func (h *AIHandler) processChat(conn *websocket.Conn, session *models.ChatSession) error {
	config := session.Config

	// 配置OpenAI客户端
	clientConfig := openai.DefaultConfig(config.Endpoint.APIKey)
	clientConfig.BaseURL = config.Endpoint.BaseURL
	client := openai.NewClientWithConfig(clientConfig)

	// 获取历史消息
	messages, err := h.messageRepo.GetRecentMessages(session.ID, config.MaxHistoryRounds)
	if err != nil {
		return err
	}

	// 工具调用循环
	for {
		// 构建API消息列表
		apiMessages := []openai.ChatCompletionMessage{}

		// 添加系统提示词
		if config.SystemPrompt != "" {
			apiMessages = append(apiMessages, openai.ChatCompletionMessage{
				Role:    "system",
				Content: config.SystemPrompt,
			})
		}

		// 添加历史消息
		apiMessages = append(apiMessages, models.ConvertToOpenAIMessages(messages)...)

		// 创建流式请求
		stream, err := client.CreateChatCompletionStream(context.Background(), openai.ChatCompletionRequest{
			Model:            config.AIModel.Name,
			Messages:         apiMessages,
			Temperature:      config.Temperature,
			MaxTokens:        config.MaxTokens,
			TopP:             config.TopP,
			FrequencyPenalty: config.FrequencyPenalty,
			PresencePenalty:  config.PresencePenalty,
		})

		if err != nil {
			return fmt.Errorf("创建流式请求失败: %w", err)
		}
		defer stream.Close()

		// 处理流式响应
		var fullContent strings.Builder
		var fullReasoning strings.Builder
		var toolCalls []openai.ToolCall

		for {
			response, err := stream.Recv()
			if err == io.EOF {
				break
			}
			if err != nil {
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

		// 保存助手消息
		assistantMsg := &models.ChatMessage{
			SessionID:        session.ID,
			Role:             "assistant",
			Content:          fullContent.String(),
			ToolCalls:        toolCalls,
			ReasoningContent: fullReasoning.String(),
		}
		if err := h.messageRepo.Create(assistantMsg); err != nil {
			return err
		}
		messages = append(messages, assistantMsg)

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

	if err := h.sessionRepo.Clear(uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}
