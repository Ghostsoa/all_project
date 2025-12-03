package sshapi

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
)

// Session PTY会话
type Session struct {
	ID         string
	config     *SessionConfig
	cmd        *exec.Cmd
	ptmx       *os.File
	terminal   *Terminal
	createdAt  time.Time
	lastActive time.Time
	mu         sync.RWMutex
	closed     bool
}

// SessionManager 会话管理器
type SessionManager struct {
	sessions map[string]*Session
	mu       sync.RWMutex
}

// NewSessionManager 创建会话管理器
func NewSessionManager() *SessionManager {
	return &SessionManager{
		sessions: make(map[string]*Session),
	}
}

// CreateSession 创建新会话
func (sm *SessionManager) CreateSession(config *SessionConfig) (*Session, error) {
	// 设置默认值
	if config.Shell == "" {
		config.Shell = "bash"
	}

	// 创建命令
	cmd := exec.Command(config.Shell)

	// 设置环境变量
	cmd.Env = os.Environ()
	if config.Env != nil {
		for k, v := range config.Env {
			cmd.Env = append(cmd.Env, fmt.Sprintf("%s=%s", k, v))
		}
	}

	// 设置工作目录
	if config.WorkDir != "" {
		cmd.Dir = config.WorkDir
	}

	// 创建PTY
	ptmx, err := pty.Start(cmd)
	if err != nil {
		return nil, fmt.Errorf("启动PTY失败: %w", err)
	}

	// 设置PTY大小
	if err := pty.Setsize(ptmx, &pty.Winsize{
		Rows: 24,
		Cols: 80,
	}); err != nil {
		ptmx.Close()
		return nil, fmt.Errorf("设置PTY大小失败: %w", err)
	}

	// 创建虚拟终端
	terminal := NewTerminal(80, 24)

	// 输出复制到虚拟终端
	terminal.CopyOutput(ptmx)

	// 创建会话对象
	sess := &Session{
		ID:         generateSessionID(),
		config:     config,
		cmd:        cmd,
		ptmx:       ptmx,
		terminal:   terminal,
		createdAt:  time.Now(),
		lastActive: time.Now(),
	}

	// 等待Shell启动
	time.Sleep(300 * time.Millisecond)

	// 保存会话
	sm.mu.Lock()
	sm.sessions[sess.ID] = sess
	sm.mu.Unlock()

	return sess, nil
}

// GetSession 获取会话
func (sm *SessionManager) GetSession(id string) (*Session, error) {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	sess, ok := sm.sessions[id]
	if !ok {
		return nil, fmt.Errorf("会话不存在: %s", id)
	}
	if sess.closed {
		return nil, fmt.Errorf("会话已关闭: %s", id)
	}
	return sess, nil
}

// CloseSession 关闭会话
func (sm *SessionManager) CloseSession(id string) error {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	sess, ok := sm.sessions[id]
	if !ok {
		return fmt.Errorf("会话不存在: %s", id)
	}

	sess.Close()
	delete(sm.sessions, id)
	return nil
}

// ListSessions 列出所有会话
func (sm *SessionManager) ListSessions() []SessionInfo {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	infos := make([]SessionInfo, 0, len(sm.sessions))
	for _, sess := range sm.sessions {
		infos = append(infos, sess.GetInfo())
	}
	return infos
}

// SendInput 发送输入
func (s *Session) SendInput(command string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.closed {
		return fmt.Errorf("会话已关闭")
	}

	s.lastActive = time.Now()

	// 确保命令以换行结束
	if !strings.HasSuffix(command, "\n") {
		command += "\n"
	}

	_, err := s.ptmx.Write([]byte(command))
	if err != nil {
		return fmt.Errorf("发送输入失败: %w", err)
	}

	return nil
}

// GetScreen 获取屏幕内容
func (s *Session) GetScreen() *ScreenResponse {
	s.mu.RLock()
	defer s.mu.RUnlock()

	lines := s.terminal.GetScreen()
	row, col := s.terminal.GetCursor()
	lastOutput := s.terminal.GetLastOutput()
	idleTime := s.terminal.IdleTime()

	// 检测进程状态
	processRunning := s.isProcessRunning()
	processState := s.detectProcessState(lastOutput, idleTime, processRunning)
	suggestInput := processState == "waiting_input"

	return &ScreenResponse{
		Lines:          lines,
		CursorRow:      row,
		CursorCol:      col,
		Width:          80,
		Height:         24,
		LastOutput:     lastOutput,
		IdleSeconds:    int(idleTime.Seconds()),
		SuggestInput:   suggestInput,
		ProcessRunning: processRunning,
		ProcessState:   processState,
	}
}

// isProcessRunning 检查进程是否还在运行
func (s *Session) isProcessRunning() bool {
	if s.cmd.Process == nil {
		return false
	}

	// 检查进程状态
	err := s.cmd.Process.Signal(syscall.Signal(0))
	return err == nil
}

// detectProcessState 检测进程状态
func (s *Session) detectProcessState(output string, idleTime time.Duration, running bool) string {
	// 进程已退出
	if !running {
		return "completed"
	}

	// 空闲时间小于1秒，可能还在输出
	if idleTime < 1*time.Second {
		return "running"
	}

	// 检查是否需要输入
	if s.detectInputNeeded(output, idleTime) {
		return "waiting_input"
	}

	// 检查是否有提示符（命令可能已完成）
	if s.detectPrompt(output) {
		return "completed"
	}

	// 默认认为还在运行
	return "running"
}

// detectInputNeeded 检测是否需要输入
func (s *Session) detectInputNeeded(output string, idleTime time.Duration) bool {
	// 空闲时间小于2秒，可能还在执行
	if idleTime < 2*time.Second {
		return false
	}

	// 检查常见的输入提示模式
	patterns := []string{
		"(y/n)",
		"(yes/no)",
		"[Y/n]",
		"[y/N]",
		"password:",
		"Password:",
		"continue?",
		"Continue?",
		"是否",
		"请输入",
		"Enter",
		"Input",
	}

	lowerOutput := strings.ToLower(output)
	for _, pattern := range patterns {
		if strings.Contains(lowerOutput, strings.ToLower(pattern)) {
			return true
		}
	}

	// 检查是否以问号结尾
	trimmed := strings.TrimSpace(output)
	if strings.HasSuffix(trimmed, "?") {
		return true
	}

	return false
}

// detectPrompt 检测命令提示符
func (s *Session) detectPrompt(output string) bool {
	lines := strings.Split(output, "\n")
	if len(lines) == 0 {
		return false
	}

	// 获取最后几行
	lastLines := ""
	start := len(lines) - 3
	if start < 0 {
		start = 0
	}
	for i := start; i < len(lines); i++ {
		lastLines += lines[i] + "\n"
	}

	// 检测常见提示符模式
	patterns := []string{
		"# ",
		"$ ",
		":~#",
		":~$",
		"root@",
	}

	for _, pattern := range patterns {
		if strings.Contains(lastLines, pattern) {
			return true
		}
	}

	return false
}

// GetInfo 获取会话信息
func (s *Session) GetInfo() SessionInfo {
	s.mu.RLock()
	defer s.mu.RUnlock()

	pid := 0
	if s.cmd.Process != nil {
		pid = s.cmd.Process.Pid
	}

	return SessionInfo{
		SessionID:  s.ID,
		Shell:      s.config.Shell,
		ProcessID:  pid,
		Active:     !s.closed && s.isProcessRunning(),
		CreatedAt:  s.createdAt,
		LastActive: s.lastActive,
	}
}

// Close 关闭会话
func (s *Session) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.closed {
		return
	}

	s.closed = true

	// 关闭PTY
	if s.ptmx != nil {
		s.ptmx.Close()
	}

	// 终止进程
	if s.cmd.Process != nil {
		s.cmd.Process.Kill()
	}
}

// generateSessionID 生成会话ID
func generateSessionID() string {
	return fmt.Sprintf("sess_%d", time.Now().UnixNano())
}
