package handlers

import (
	"all_project/models"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"

	"github.com/gorilla/websocket"
	"golang.org/x/crypto/ssh"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

type WebSocketHandler struct {
	repo *models.ServerRepository
}

func NewWebSocketHandler(repo *models.ServerRepository) *WebSocketHandler {
	return &WebSocketHandler{repo: repo}
}

// HandleWebSocket 处理 WebSocket 连接
func (h *WebSocketHandler) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	// 获取服务器ID
	idStr := r.URL.Query().Get("server_id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		http.Error(w, "无效的服务器ID", http.StatusBadRequest)
		return
	}

	// 从数据库获取服务器配置
	server, err := h.repo.GetByID(uint(id))
	if err != nil {
		http.Error(w, "服务器不存在", http.StatusNotFound)
		return
	}

	// 升级到 WebSocket
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("WebSocket 升级失败:", err)
		return
	}
	defer ws.Close()

	// 建立 SSH 连接
	sshClient, err := connectSSH(server)
	if err != nil {
		log.Println("SSH 连接失败:", err)
		ws.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("SSH 连接失败: %v", err)))
		return
	}
	defer sshClient.Close()

	// 创建 SSH 会话
	session, err := sshClient.NewSession()
	if err != nil {
		log.Println("创建 SSH 会话失败:", err)
		ws.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("创建会话失败: %v", err)))
		return
	}
	defer session.Close()

	// 请求 PTY（伪终端）
	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}
	if err := session.RequestPty("xterm-256color", 40, 120, modes); err != nil {
		log.Println("请求 PTY 失败:", err)
		return
	}

	// 获取输入输出管道
	stdin, _ := session.StdinPipe()
	stdout, _ := session.StdoutPipe()
	stderr, _ := session.StderrPipe()

	// 启动 Shell
	if err := session.Shell(); err != nil {
		log.Println("启动 Shell 失败:", err)
		return
	}

	log.Printf("SSH 连接成功: %s@%s:%d", server.Username, server.Host, server.Port)

	// 双向数据转发
	done := make(chan bool)

	// SSH 输出 → WebSocket
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

	// SSH 错误输出 → WebSocket
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

	// WebSocket → SSH 输入
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
	log.Println("SSH 会话结束")
}

// connectSSH 连接 SSH 服务器
func connectSSH(server *models.Server) (*ssh.Client, error) {
	config := &ssh.ClientConfig{
		User: server.Username,
		Auth: []ssh.AuthMethod{
			ssh.Password(server.Password),
		},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
	}

	address := fmt.Sprintf("%s:%d", server.Host, server.Port)
	client, err := ssh.Dial("tcp", address, config)
	if err != nil {
		return nil, err
	}

	return client, nil
}
