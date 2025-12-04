package models

import (
	"database/sql/driver"
	"encoding/json"

	"github.com/sashabaranov/go-openai"
	"gorm.io/gorm"
)

// ToolCallsJSON 工具调用的JSON类型
type ToolCallsJSON []openai.ToolCall

// Scan 实现 sql.Scanner 接口
func (t *ToolCallsJSON) Scan(value interface{}) error {
	if value == nil {
		*t = nil
		return nil
	}
	bytes, ok := value.([]byte)
	if !ok {
		return nil
	}
	return json.Unmarshal(bytes, t)
}

// Value 实现 driver.Valuer 接口
func (t ToolCallsJSON) Value() (driver.Value, error) {
	if t == nil {
		return nil, nil
	}
	return json.Marshal(t)
}

// ChatMessage 对话消息
type ChatMessage struct {
	gorm.Model
	SessionID        uint          `gorm:"not null;index" json:"session_id"`             // 会话ID
	Role             string        `gorm:"size:20;not null" json:"role"`                 // 角色：user, assistant, system, tool
	Content          string        `gorm:"type:text" json:"content"`                     // 消息内容
	ToolCalls        ToolCallsJSON `gorm:"type:jsonb" json:"tool_calls,omitempty"`       // 工具调用（assistant消息）
	ToolCallID       string        `gorm:"size:100" json:"tool_call_id,omitempty"`       // 工具调用ID（tool消息）
	ReasoningContent string        `gorm:"type:text" json:"reasoning_content,omitempty"` // 思维链内容
}

// TableName 指定表名
func (ChatMessage) TableName() string {
	return "chat_messages"
}

// ToHistoryMessage 转换为历史消息格式（兼容参考项目）
func (m *ChatMessage) ToHistoryMessage() map[string]interface{} {
	msg := map[string]interface{}{
		"role": m.Role,
	}

	if m.Content != "" {
		msg["content"] = m.Content
	}

	if len(m.ToolCalls) > 0 {
		msg["tool_calls"] = m.ToolCalls
	}

	if m.ToolCallID != "" {
		msg["tool_call_id"] = m.ToolCallID
	}

	if m.ReasoningContent != "" {
		msg["reasoning_content"] = m.ReasoningContent
	}

	return msg
}

// ToOpenAIMessage 转换为OpenAI消息格式
func (m *ChatMessage) ToOpenAIMessage() openai.ChatCompletionMessage {
	return openai.ChatCompletionMessage{
		Role:             m.Role,
		Content:          m.Content,
		ToolCalls:        m.ToolCalls,
		ToolCallID:       m.ToolCallID,
		ReasoningContent: m.ReasoningContent,
	}
}

// ChatMessageRepository 消息仓储
type ChatMessageRepository struct {
	db *gorm.DB
}

// NewChatMessageRepository 创建消息仓储
func NewChatMessageRepository(db *gorm.DB) *ChatMessageRepository {
	return &ChatMessageRepository{db: db}
}

// Create 创建消息
func (r *ChatMessageRepository) Create(message *ChatMessage) error {
	return r.db.Create(message).Error
}

// BatchCreate 批量创建消息
func (r *ChatMessageRepository) BatchCreate(messages []*ChatMessage) error {
	return r.db.Create(messages).Error
}

// GetBySessionID 获取会话的所有消息
func (r *ChatMessageRepository) GetBySessionID(sessionID uint, limit int) ([]*ChatMessage, error) {
	var messages []*ChatMessage
	query := r.db.Where("session_id = ?", sessionID).Order("created_at ASC")

	if limit > 0 {
		query = query.Limit(limit)
	}

	err := query.Find(&messages).Error
	return messages, err
}

// GetRecentMessages 获取会话的最近N轮消息
func (r *ChatMessageRepository) GetRecentMessages(sessionID uint, rounds int) ([]*ChatMessage, error) {
	var messages []*ChatMessage

	// 获取所有消息
	allMessages, err := r.GetBySessionID(sessionID, 0)
	if err != nil {
		return nil, err
	}

	if rounds <= 0 || len(allMessages) == 0 {
		return allMessages, nil
	}

	// 从后向前统计用户消息轮数
	userCount := 0
	cutIndex := 0 // 默认保留所有消息

	for i := len(allMessages) - 1; i >= 0; i-- {
		if allMessages[i].Role == "user" {
			userCount++
			if userCount > rounds {
				// 超过轮数限制，从i+1开始保留（丢弃更早的消息）
				cutIndex = i + 1
				break
			}
		}
	}

	messages = allMessages[cutIndex:]
	return messages, nil
}

// GetByID 根据ID获取消息
func (r *ChatMessageRepository) GetByID(messageID uint) (*ChatMessage, error) {
	var message ChatMessage
	err := r.db.First(&message, messageID).Error
	if err != nil {
		return nil, err
	}
	return &message, nil
}

// Update 更新消息
func (r *ChatMessageRepository) Update(message *ChatMessage) error {
	return r.db.Save(message).Error
}

// Delete 删除单条消息
func (r *ChatMessageRepository) Delete(messageID uint) error {
	return r.db.Delete(&ChatMessage{}, messageID).Error
}

// DeleteBySessionID 删除会话的所有消息
func (r *ChatMessageRepository) DeleteBySessionID(sessionID uint) error {
	return r.db.Where("session_id = ?", sessionID).Delete(&ChatMessage{}).Error
}

// DeleteFromMessage 删除指定消息及其后的所有消息
func (r *ChatMessageRepository) DeleteFromMessage(sessionID, messageID uint) error {
	// 首先获取该消息的创建时间
	var message ChatMessage
	if err := r.db.First(&message, messageID).Error; err != nil {
		return err
	}

	// 删除该消息及其后创建的所有消息
	return r.db.Where("session_id = ? AND created_at >= ?", sessionID, message.CreatedAt).
		Delete(&ChatMessage{}).Error
}

// ConvertToOpenAIMessages 批量转换为OpenAI消息格式
func ConvertToOpenAIMessages(messages []*ChatMessage) []openai.ChatCompletionMessage {
	result := make([]openai.ChatCompletionMessage, len(messages))
	for i, msg := range messages {
		result[i] = msg.ToOpenAIMessage()
	}
	return result
}
