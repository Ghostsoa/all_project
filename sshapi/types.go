package sshapi

import "time"

// SessionConfig 会话配置
type SessionConfig struct {
	Shell   string            `json:"shell"`   // bash, zsh, sh
	Env     map[string]string `json:"env"`     // 环境变量
	WorkDir string            `json:"workdir"` // 工作目录
}

// SessionInfo 会话信息
type SessionInfo struct {
	SessionID  string    `json:"session_id"`
	Shell      string    `json:"shell"`
	ProcessID  int       `json:"process_id"`
	Active     bool      `json:"active"`
	CreatedAt  time.Time `json:"created_at"`
	LastActive time.Time `json:"last_active"`
}

// ScreenResponse 屏幕响应
type ScreenResponse struct {
	Lines          []string `json:"lines"`           // 终端内容（每行）
	CursorRow      int      `json:"cursor_row"`      // 光标行
	CursorCol      int      `json:"cursor_col"`      // 光标列
	Width          int      `json:"width"`           // 终端宽度
	Height         int      `json:"height"`          // 终端高度
	LastOutput     string   `json:"last_output"`     // 最后的输出
	IdleSeconds    int      `json:"idle_seconds"`    // 空闲秒数
	SuggestInput   bool     `json:"suggest_input"`   // 建议需要输入
	ProcessRunning bool     `json:"process_running"` // 进程是否在运行
	ProcessState   string   `json:"process_state"`   // running/waiting_input/completed
}

// InputRequest 输入请求
type InputRequest struct {
	Command string `json:"command"` // 要执行的命令
}

// ErrorResponse 错误响应
type ErrorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message"`
}
