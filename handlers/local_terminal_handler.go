package handlers

import (
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"runtime"
	"sync"

	"github.com/creack/pty"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

// 全局本地终端实例
var (
	globalLocalTerminal *LocalTerminalSession
	localTerminalMutex  sync.RWMutex
)

// LocalTerminalSession 本地终端会话
type LocalTerminalSession struct {
	cmd       *exec.Cmd
	ptmx      *os.File
	clients   map[*websocket.Conn]*clientInfo
	clientsMu sync.RWMutex
	input     chan []byte
}

// clientInfo 客户端信息
type clientInfo struct {
	ws     *websocket.Conn
	output chan []byte
	closed bool
}

// InitGlobalLocalTerminal 初始化全局本地终端（服务启动时调用）
func InitGlobalLocalTerminal() error {
	localTerminalMutex.Lock()
	defer localTerminalMutex.Unlock()

	if globalLocalTerminal != nil {
		return nil // 已初始化
	}

	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("powershell.exe")
	case "linux", "darwin":
		shell := os.Getenv("SHELL")
		if shell == "" {
			shell = "/bin/bash"
		}
		cmd = exec.Command(shell)
	default:
		return fmt.Errorf("不支持的操作系统: %s", runtime.GOOS)
	}

	cmd.Env = append(os.Environ(),
		"TERM=xterm-256color",
		"COLORTERM=truecolor",
	)

	session := &LocalTerminalSession{
		cmd:     cmd,
		clients: make(map[*websocket.Conn]*clientInfo),
		input:   make(chan []byte, 100),
	}

	// Windows使用管道，Linux/Mac使用PTY
	if runtime.GOOS == "windows" {
		return fmt.Errorf("Windows本地终端暂不支持全局模式")
	}

	// 启动PTY
	ptmx, err := pty.Start(cmd)
	if err != nil {
		return fmt.Errorf("启动PTY失败: %v", err)
	}

	session.ptmx = ptmx

	// 设置终端大小
	pty.Setsize(ptmx, &pty.Winsize{
		Rows: 40,
		Cols: 120,
	})

	// 从PTY读取并广播给所有客户端
	go session.broadcastOutput()

	// 从input channel写入PTY
	go session.handleInput()

	globalLocalTerminal = session
	log.Println("✅ 全局本地终端已启动")

	return nil
}

// broadcastOutput 从PTY读取并广播给所有客户端
func (s *LocalTerminalSession) broadcastOutput() {
	buffer := make([]byte, 32768)
	for {
		n, err := s.ptmx.Read(buffer)
		if err != nil {
			if err != io.EOF {
				log.Println("读取PTY失败:", err)
			}
			break
		}
		if n > 0 {
			data := make([]byte, n)
			copy(data, buffer[:n])

			// 通过channel发送，每个客户端有独立的writer goroutine处理
			s.clientsMu.RLock()
			for _, client := range s.clients {
				if !client.closed {
					select {
					case client.output <- data:
					default:
						// 缓冲区满，跳过此帧
						log.Println("客户端输出缓冲区满，跳过数据")
					}
				}
			}
			s.clientsMu.RUnlock()
		}
	}
}

// handleInput 处理输入
func (s *LocalTerminalSession) handleInput() {
	for data := range s.input {
		if _, err := s.ptmx.Write(data); err != nil {
			log.Println("写入PTY失败:", err)
		}
	}
}

// addClient 添加客户端
func (s *LocalTerminalSession) addClient(ws *websocket.Conn) {
	client := &clientInfo{
		ws:     ws,
		output: make(chan []byte, 100), // 100帧缓冲
		closed: false,
	}

	s.clientsMu.Lock()
	s.clients[ws] = client
	s.clientsMu.Unlock()

	// 启动独立的writer goroutine（避免并发写入WebSocket）
	go func() {
		for data := range client.output {
			if err := ws.WriteMessage(websocket.BinaryMessage, data); err != nil {
				log.Println("写入WebSocket失败:", err)
				client.closed = true
				return
			}
		}
	}()

	log.Printf("本地终端客户端已连接，当前客户端数: %d", len(s.clients))
}

// removeClient 移除客户端
func (s *LocalTerminalSession) removeClient(ws *websocket.Conn) {
	s.clientsMu.Lock()
	if client, ok := s.clients[ws]; ok {
		client.closed = true
		close(client.output) // 关闭channel，终止writer goroutine
		delete(s.clients, ws)
	}
	s.clientsMu.Unlock()
	log.Printf("本地终端客户端已断开，当前客户端数: %d", len(s.clients))
}

// sendInput 发送输入
func (s *LocalTerminalSession) sendInput(data []byte) {
	select {
	case s.input <- data:
	default:
		log.Println("输入缓冲区已满")
	}
}

// GinHandleLocalTerminal 处理本地终端 WebSocket 连接（使用全局实例）
func GinHandleLocalTerminal(c *gin.Context) {
	localTerminalMutex.RLock()
	session := globalLocalTerminal
	localTerminalMutex.RUnlock()

	if session == nil {
		c.JSON(500, gin.H{"error": "本地终端未初始化"})
		return
	}

	// 升级到 WebSocket
	ws, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Println("WebSocket 升级失败:", err)
		return
	}
	defer func() {
		session.removeClient(ws)
		ws.Close()
	}()

	// 添加到客户端列表
	session.addClient(ws)

	// 持续读取客户端输入并发送到终端
	for {
		_, data, err := ws.ReadMessage()
		if err != nil {
			if err != io.EOF {
				log.Println("读取WebSocket失败:", err)
			}
			break
		}
		session.sendInput(data)
	}
}
