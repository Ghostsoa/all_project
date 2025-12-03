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

	// 优先检查交互式提示（立即识别，不等待）
	if s.detectInputNeeded(output) {
		return "waiting_input"
	}

	// 检查命令提示符（说明命令完成）
	promptDetected := s.detectPrompt(output)
	if promptDetected {
		// 提示符出现且空闲超过200ms，认为命令完成
		if idleTime >= 200*time.Millisecond {
			return "completed"
		}
	}

	// 输出持续变化，还在执行
	if idleTime < 500*time.Millisecond {
		return "running"
	}

	// 空闲时间较长
	// 如果检测到提示符特征，即使没有强匹配也认为完成
	if idleTime >= 2*time.Second {
		// 获取最后一行
		lines := strings.Split(output, "\n")
		if len(lines) > 0 {
			lastLine := strings.TrimSpace(lines[len(lines)-1])
			// 如果最后一行以# $ >结尾，且空闲2秒以上，认为完成
			if strings.HasSuffix(lastLine, "#") ||
				strings.HasSuffix(lastLine, "$") ||
				strings.HasSuffix(lastLine, ">") {
				return "completed"
			}
		}
	}

	// 空闲时间较长但没有提示符，可能在等待（下载、安装等）
	return "running"
}

// detectInputNeeded 检测是否需要输入（立即检测，不等待）
func (s *Session) detectInputNeeded(output string) bool {
	// 获取最后几行输出
	lines := strings.Split(output, "\n")
	if len(lines) == 0 {
		return false
	}

	// 检查最后3行
	lastLines := ""
	start := len(lines) - 3
	if start < 0 {
		start = 0
	}
	for i := start; i < len(lines); i++ {
		lastLines += lines[i] + " "
	}

	lowerOutput := strings.ToLower(lastLines)

	// 强匹配模式（高优先级）
	strongPatterns := []string{
		"(y/n)",
		"(yes/no)",
		"[y/n]",
		"[y/n]",
		"password:",
		"password:",
		"press enter",
		"press any key",
	}

	for _, pattern := range strongPatterns {
		if strings.Contains(lowerOutput, pattern) {
			return true
		}
	}

	// 弱匹配模式（需要更多验证）
	weakPatterns := []string{
		"continue?",
		"是否",
		"请输入",
	}

	for _, pattern := range weakPatterns {
		if strings.Contains(lowerOutput, pattern) {
			// 检查是否以问号或冒号结尾
			trimmed := strings.TrimSpace(lastLines)
			if strings.HasSuffix(trimmed, "?") || strings.HasSuffix(trimmed, ":") {
				return true
			}
		}
	}

	return false
}

// detectPrompt 通用提示符检测
func (s *Session) detectPrompt(output string) bool {
	lines := strings.Split(output, "\n")
	if len(lines) == 0 {
		return false
	}

	// 只检查最后一行
	lastLine := lines[len(lines)-1]
	trimmed := strings.TrimSpace(lastLine)

	// 空行不是提示符
	if trimmed == "" {
		return false
	}

	// 通用提示符特征检测
	return s.isLikelyPrompt(trimmed)
}

// isLikelyPrompt 判断一行是否像提示符（通用算法，增强版）
func (s *Session) isLikelyPrompt(line string) bool {
	// 特征1: 长度适中（提示符通常不会太长）
	if len(line) > 200 {
		return false
	}

	// 特征2: 以常见提示符结束符结尾
	promptEndings := []string{
		"# ", "$ ", "> ", ">> ", ">>> ",
		"#", "$", ">", ">>", ">>>",
		"% ", "%",
	}

	hasPromptEnding := false
	matchedEnding := ""
	for _, ending := range promptEndings {
		if strings.HasSuffix(line, ending) {
			hasPromptEnding = true
			matchedEnding = ending
			break
		}
	}

	if !hasPromptEnding {
		return false
	}

	// 特征3: 强特征优先（这些是明确的提示符标志）
	strongPatterns := []string{
		"@",  // user@host
		":~", // 路径
		":/", // 绝对路径
		"▶",  // 特殊提示符
		"❯",  // 现代shell
		"λ",  // lambda提示符
		"⚡",  // 快速提示符
	}

	hasStrongPattern := false
	for _, pattern := range strongPatterns {
		if strings.Contains(line, pattern) {
			hasStrongPattern = true
			break
		}
	}

	// 如果有强特征，直接通过（跳过数字检查）
	if hasStrongPattern {
		// 仍需检查基本排除模式，但不检查数字
		if s.shouldExcludeAsPromptBasic(line) {
			return false
		}
		return true
	}

	// 没有强特征，需要更严格的验证
	// 特征4: 弱特征需要满足多个条件
	fields := strings.Fields(line)
	fieldCount := len(fields)

	// 弱特征检查：
	// - 字段数很少（≤3）
	// - 不包含空格太多（紧凑）
	// - 结束符前有内容
	spaceCount := strings.Count(line, " ")
	isCompact := spaceCount <= 5
	isShort := fieldCount <= 3
	hasContentBeforeEnding := len(strings.TrimSuffix(line, matchedEnding)) > 0

	if !isShort || !isCompact || !hasContentBeforeEnding {
		return false
	}

	// 特征5: 排除明显的非提示符（弱特征需要完整检查）
	if s.shouldExcludeAsPrompt(line) {
		return false
	}

	// 通过所有检测
	return true
}

// shouldExcludeAsPromptBasic 基本排除检查（不检查数字）
func (s *Session) shouldExcludeAsPromptBasic(line string) bool {
	// 排除明显的命令输出
	excludePatterns := []string{
		"error:", "Error:", "ERROR:",
		"warning:", "Warning:", "WARNING:",
		"failed", "Failed", "FAILED",
		"total ",                // ls -l 输出
		"drwxr", "drwx", "-rw-", // 文件权限
		"Installing", "Downloading", "Building",
		"Unpacking", "Setting up", "Processing",
		"100%", "50%", "75%", // 进度条
		"KB", "MB", "GB", // 大小单位
	}

	lowerLine := strings.ToLower(line)
	for _, pattern := range excludePatterns {
		if strings.Contains(lowerLine, strings.ToLower(pattern)) {
			return true
		}
	}

	return false
}

// shouldExcludeAsPrompt 完整排除检查（包括数字检查）
func (s *Session) shouldExcludeAsPrompt(line string) bool {
	// 先做基本检查
	if s.shouldExcludeAsPromptBasic(line) {
		return true
	}

	// 额外检查：排除包含过多数字的行（可能是数据输出）
	// 但主机名中的数字是正常的，所以阈值设高一些
	digitCount := 0
	for _, c := range line {
		if c >= '0' && c <= '9' {
			digitCount++
		}
	}
	// 数字超过60%才排除（之前是50%）
	if digitCount > len(line)*6/10 {
		return true
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
