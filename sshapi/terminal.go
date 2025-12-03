package sshapi

import (
	"bytes"
	"io"
	"sync"
	"time"
)

// Terminal 虚拟终端
type Terminal struct {
	width      int
	height     int
	buffer     [][]rune // 屏幕缓冲区
	cursorRow  int
	cursorCol  int
	lastOutput *bytes.Buffer // 最后的输出
	lastUpdate time.Time
	mu         sync.RWMutex
}

// NewTerminal 创建新的虚拟终端
func NewTerminal(width, height int) *Terminal {
	t := &Terminal{
		width:      width,
		height:     height,
		buffer:     make([][]rune, height),
		lastOutput: &bytes.Buffer{},
		lastUpdate: time.Now(),
	}

	// 初始化缓冲区
	for i := 0; i < height; i++ {
		t.buffer[i] = make([]rune, width)
		for j := 0; j < width; j++ {
			t.buffer[i][j] = ' '
		}
	}

	return t
}

// Write 实现io.Writer接口
func (t *Terminal) Write(p []byte) (n int, err error) {
	t.mu.Lock()
	defer t.mu.Unlock()

	t.lastUpdate = time.Now()

	// 过滤ANSI转义序列后保存到lastOutput
	cleaned := t.stripANSI(p)
	t.lastOutput.Write(cleaned)

	// 处理输出到屏幕缓冲区
	i := 0
	for i < len(p) {
		b := p[i]

		// 检测ANSI转义序列
		if b == 0x1B && i+1 < len(p) { // ESC
			consumed := t.handleANSI(p[i:])
			if consumed > 0 {
				i += consumed
				continue
			}
		}

		// 处理普通字符
		switch b {
		case '\n':
			t.cursorRow++
			t.cursorCol = 0
			if t.cursorRow >= t.height {
				t.scroll()
			}
		case '\r':
			t.cursorCol = 0
		case '\b':
			if t.cursorCol > 0 {
				t.cursorCol--
			}
		case '\t':
			t.cursorCol = (t.cursorCol + 8) &^ 7
			if t.cursorCol >= t.width {
				t.cursorCol = t.width - 1
			}
		case 0x07: // BEL
			// 忽略响铃
		default:
			if b >= 32 && b < 127 { // 可打印ASCII字符
				if t.cursorRow >= t.height {
					t.scroll()
				}
				if t.cursorCol < t.width {
					t.buffer[t.cursorRow][t.cursorCol] = rune(b)
					t.cursorCol++
				}
			}
		}
		i++
	}

	return len(p), nil
}

// handleANSI 处理ANSI转义序列，返回消耗的字节数
func (t *Terminal) handleANSI(p []byte) int {
	if len(p) < 2 {
		return 0
	}

	// ESC [ - CSI序列
	if p[1] == '[' {
		return t.handleCSI(p)
	}

	// ESC ] - OSC序列 (操作系统命令)
	if p[1] == ']' {
		return t.handleOSC(p)
	}

	// 其他ESC序列，跳过2个字节
	return 2
}

// handleCSI 处理CSI (Control Sequence Introducer) 序列
func (t *Terminal) handleCSI(p []byte) int {
	// 查找结束字符 (A-Za-z)
	for i := 2; i < len(p); i++ {
		c := p[i]
		if (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') {
			// 可以在这里解析具体的CSI命令
			// 比如光标移动、清屏等
			return i + 1
		}
		// 参数字符: 0-9 ; ? 等
		if !((c >= '0' && c <= '9') || c == ';' || c == '?') {
			break
		}
	}
	return 2
}

// handleOSC 处理OSC (Operating System Command) 序列
func (t *Terminal) handleOSC(p []byte) int {
	// OSC以 ESC ] 开始，以 BEL (0x07) 或 ST (ESC \) 结束
	for i := 2; i < len(p); i++ {
		if p[i] == 0x07 { // BEL
			return i + 1
		}
		if p[i] == 0x1B && i+1 < len(p) && p[i+1] == '\\' { // ST
			return i + 2
		}
	}
	return 2
}

// stripANSI 去除ANSI转义序列
func (t *Terminal) stripANSI(p []byte) []byte {
	result := make([]byte, 0, len(p))
	i := 0
	for i < len(p) {
		b := p[i]

		// 检测ANSI转义序列
		if b == 0x1B && i+1 < len(p) {
			consumed := t.handleANSI(p[i:])
			if consumed > 0 {
				i += consumed
				continue
			}
		}

		// 保留可打印字符和换行符
		if (b >= 32 && b < 127) || b == '\n' || b == '\r' || b == '\t' {
			result = append(result, b)
		}
		i++
	}
	return result
}

// scroll 滚动屏幕
func (t *Terminal) scroll() {
	// 向上滚动一行
	copy(t.buffer[0:], t.buffer[1:])
	// 清空最后一行
	for j := 0; j < t.width; j++ {
		t.buffer[t.height-1][j] = ' '
	}
	t.cursorRow = t.height - 1
}

// GetScreen 获取屏幕内容
func (t *Terminal) GetScreen() []string {
	t.mu.RLock()
	defer t.mu.RUnlock()

	lines := make([]string, t.height)
	for i := 0; i < t.height; i++ {
		lines[i] = string(t.buffer[i])
	}
	return lines
}

// GetCursor 获取光标位置
func (t *Terminal) GetCursor() (row, col int) {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return t.cursorRow, t.cursorCol
}

// GetLastOutput 获取最后的原始输出
func (t *Terminal) GetLastOutput() string {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return t.lastOutput.String()
}

// ClearLastOutput 清空最后的输出缓存
func (t *Terminal) ClearLastOutput() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.lastOutput.Reset()
}

// IdleTime 获取空闲时间
func (t *Terminal) IdleTime() time.Duration {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return time.Since(t.lastUpdate)
}

// CopyOutput 启动输出复制协程
func (t *Terminal) CopyOutput(reader io.Reader) {
	go func() {
		io.Copy(t, reader)
	}()
}
