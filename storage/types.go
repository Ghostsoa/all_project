package storage

import "time"

// Server SSH服务器配置
type Server struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Host        string    `json:"host"`
	Port        int       `json:"port"`
	Username    string    `json:"username"`
	Password    string    `json:"password"`
	Description string    `json:"description"`
	Tags        []string  `json:"tags"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// Provider AI供应商配置
type Provider struct {
	ID      string  `json:"id"`
	Name    string  `json:"name"`
	BaseURL string  `json:"base_url"`
	APIKey  string  `json:"api_key"`
	Models  []Model `json:"models"`
}

// Model AI模型
type Model struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// AIConfig 全局AI配置（唯一，提示词+参数）
type AIConfig struct {
	SystemPrompt     string  `json:"system_prompt"`
	Temperature      float64 `json:"temperature"`
	MaxTokens        int     `json:"max_tokens"`
	TopP             float64 `json:"top_p"`
	FrequencyPenalty float64 `json:"frequency_penalty"`
	PresencePenalty  float64 `json:"presence_penalty"`
}

// ChatSession 对话会话
type ChatSession struct {
	ID        string        `json:"id"`
	Title     string        `json:"title"`
	ModelID   string        `json:"model_id"` // 使用的模型ID
	CreatedAt time.Time     `json:"created_at"`
	UpdatedAt time.Time     `json:"updated_at"`
	Messages  []ChatMessage `json:"messages"`
}

// ChatMessage 对话消息
type ChatMessage struct {
	Role             string                   `json:"role"` // user/assistant/system/tool
	Content          string                   `json:"content"`
	ReasoningContent string                   `json:"reasoning_content,omitempty"` // o1模型的推理内容
	ToolCalls        []map[string]interface{} `json:"tool_calls,omitempty"`        // 工具调用（assistant role）
	ToolCallID       string                   `json:"tool_call_id,omitempty"`      // 工具调用ID（tool role）
	ToolName         string                   `json:"tool_name,omitempty"`         // 工具名称（tool role）
	Timestamp        time.Time                `json:"timestamp"`
}

// CommandHistory 命令历史（统一时间线）
type CommandHistory struct {
	ID         int       `json:"id"`          // 唯一ID
	ServerID   string    `json:"server_id"`   // 服务器ID（0表示本地）
	ServerName string    `json:"server_name"` // 服务器名称（用于显示）
	Command    string    `json:"command"`     // 命令内容
	Timestamp  time.Time `json:"timestamp"`   // 执行时间
}

// CommandHistoryStore 命令历史存储（统一列表）
type CommandHistoryStore struct {
	Commands []CommandHistory `json:"commands"` // 所有命令的统一列表
	NextID   int              `json:"next_id"`  // 下一个ID
}
