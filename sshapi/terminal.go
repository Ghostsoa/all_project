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

	// 保存原始输出
	t.lastOutput.Write(p)
	t.lastUpdate = time.Now()

	// 简化版本：直接处理可打印字符
	for _, b := range p {
		switch b {
		case '\n':
			t.cursorRow++
			t.cursorCol = 0
			if t.cursorRow >= t.height {
				// 滚动屏幕
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
		default:
			if b >= 32 && b < 127 { // 可打印字符
				if t.cursorRow >= t.height {
					t.scroll()
				}
				if t.cursorCol < t.width {
					t.buffer[t.cursorRow][t.cursorCol] = rune(b)
					t.cursorCol++
				}
			}
		}
	}

	return len(p), nil
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
