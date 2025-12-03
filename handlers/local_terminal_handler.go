package handlers

import (
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"runtime"

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
		cmd = exec.Command("/bin/bash")
	default:
		ws.WriteMessage(websocket.TextMessage, []byte("不支持的操作系统"))
		return
	}

	// 设置环境变量
	cmd.Env = append(os.Environ(),
		"TERM=xterm-256color",
		"COLORTERM=truecolor",
	)

	// 创建管道
	stdin, err := cmd.StdinPipe()
	if err != nil {
		log.Println("创建 stdin 管道失败:", err)
		return
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		log.Println("创建 stdout 管道失败:", err)
		return
	}

	stderr, err := cmd.StderrPipe()
	if err != nil {
		log.Println("创建 stderr 管道失败:", err)
		return
	}

	// 启动进程
	if err := cmd.Start(); err != nil {
		log.Println("启动本地Shell失败:", err)
		ws.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("启动Shell失败: %v", err)))
		return
	}
	defer cmd.Process.Kill()

	log.Printf("本地终端启动成功: %s on %s", cmd.Path, runtime.GOOS)

	// 发送欢迎消息
	welcomeMsg := fmt.Sprintf("\r\n🖥️  本地终端 (%s)\r\n", runtime.GOOS)
	ws.WriteMessage(websocket.TextMessage, []byte(welcomeMsg))

	done := make(chan bool)

	// stdout → WebSocket
	go func() {
		buffer := make([]byte, 1024)
		for {
			n, err := stdout.Read(buffer)
			if err != nil {
				if err != io.EOF {
					log.Println("读取 stdout 失败:", err)
				}
				done <- true
				return
			}
			if err := ws.WriteMessage(websocket.BinaryMessage, buffer[:n]); err != nil {
				log.Println("写入 WebSocket 失败:", err)
				done <- true
				return
			}
		}
	}()

	// stderr → WebSocket
	go func() {
		buffer := make([]byte, 1024)
		for {
			n, err := stderr.Read(buffer)
			if err != nil {
				if err != io.EOF {
					log.Println("读取 stderr 失败:", err)
				}
				return
			}
			ws.WriteMessage(websocket.BinaryMessage, buffer[:n])
		}
	}()

	// WebSocket → stdin
	go func() {
		for {
			msgType, data, err := ws.ReadMessage()
			if err != nil {
				log.Println("读取 WebSocket 失败:", err)
				done <- true
				return
			}

			if msgType == websocket.TextMessage || msgType == websocket.BinaryMessage {
				if _, err := stdin.Write(data); err != nil {
					log.Println("写入 stdin 失败:", err)
					done <- true
					return
				}
			}
		}
	}()

	// 等待连接结束
	<-done
	log.Println("本地终端会话结束")
}
