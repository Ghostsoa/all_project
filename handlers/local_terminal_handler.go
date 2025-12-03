package handlers

import (
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"runtime"

	"github.com/creack/pty"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

// GinHandleLocalTerminal 处理本地终端 WebSocket 连接
func GinHandleLocalTerminal(c *gin.Context) {
	// 升级到 WebSocket
	ws, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Println("WebSocket 升级失败:", err)
		return
	}
	defer ws.Close()

	// 根据操作系统选择Shell
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		// Windows: PowerShell
		cmd = exec.Command("powershell.exe")
	case "linux", "darwin":
		// Linux/Mac: Bash
		shell := os.Getenv("SHELL")
		if shell == "" {
			shell = "/bin/bash"
		}
		cmd = exec.Command(shell)
	default:
		ws.WriteMessage(websocket.TextMessage, []byte("不支持的操作系统"))
		return
	}

	// 设置环境变量
	cmd.Env = append(os.Environ(),
		"TERM=xterm-256color",
		"COLORTERM=truecolor",
	)

	// Windows使用管道，Linux/Mac使用PTY
	if runtime.GOOS == "windows" {
		handleWindowsTerminal(ws, cmd)
	} else {
		handleUnixTerminal(ws, cmd)
	}
}

// handleWindowsTerminal Windows终端处理（使用管道）
func handleWindowsTerminal(ws *websocket.Conn, cmd *exec.Cmd) {
	stdin, _ := cmd.StdinPipe()
	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()

	if err := cmd.Start(); err != nil {
		log.Println("启动Shell失败:", err)
		ws.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("启动Shell失败: %v", err)))
		return
	}
	defer cmd.Process.Kill()

	log.Printf("本地终端启动成功: PowerShell on Windows")

	done := make(chan bool)

	// stdout → WebSocket
	go func() {
		io.Copy(&wsWriter{ws: ws}, stdout)
		done <- true
	}()

	// stderr → WebSocket
	go func() {
		io.Copy(&wsWriter{ws: ws}, stderr)
	}()

	// WebSocket → stdin
	go func() {
		for {
			_, data, err := ws.ReadMessage()
			if err != nil {
				done <- true
				return
			}
			stdin.Write(data)
		}
	}()

	<-done
	log.Println("本地终端会话结束")
}

// handleUnixTerminal Unix终端处理（使用PTY）
func handleUnixTerminal(ws *websocket.Conn, cmd *exec.Cmd) {
	// 创建PTY
	ptmx, err := pty.Start(cmd)
	if err != nil {
		log.Println("启动PTY失败:", err)
		ws.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("启动PTY失败: %v", err)))
		return
	}
	defer ptmx.Close()

	log.Printf("本地终端启动成功: %s on %s", cmd.Path, runtime.GOOS)

	// 设置终端大小
	pty.Setsize(ptmx, &pty.Winsize{
		Rows: 40,
		Cols: 120,
	})

	done := make(chan bool)

	// PTY → WebSocket (优化：32KB缓冲)
	go func() {
		buffer := make([]byte, 32768) // 32KB缓冲
		for {
			n, err := ptmx.Read(buffer)
			if err != nil {
				if err != io.EOF {
					log.Println("读取PTY失败:", err)
				}
				done <- true
				return
			}
			if n > 0 {
				if err := ws.WriteMessage(websocket.BinaryMessage, buffer[:n]); err != nil {
					log.Println("写入WebSocket失败:", err)
					done <- true
					return
				}
			}
		}
	}()

	// WebSocket → PTY
	go func() {
		for {
			_, data, err := ws.ReadMessage()
			if err != nil {
				log.Println("读取WebSocket失败:", err)
				done <- true
				return
			}
			if _, err := ptmx.Write(data); err != nil {
				log.Println("写入PTY失败:", err)
				done <- true
				return
			}
		}
	}()

	// 等待进程结束
	<-done
	cmd.Process.Kill()
	log.Println("本地终端会话结束")
}

// wsWriter WebSocket写入器（用于io.Copy）
type wsWriter struct {
	ws *websocket.Conn
}

func (w *wsWriter) Write(p []byte) (n int, err error) {
	err = w.ws.WriteMessage(websocket.BinaryMessage, p)
	if err != nil {
		return 0, err
	}
	return len(p), nil
}
