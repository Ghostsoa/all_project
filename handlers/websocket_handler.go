package handlers

import (
	"all_project/models"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

// WebSocket 升级器
var upgrader = websocket.Upgrader{
	ReadBufferSize:  32768, // 32KB 读缓冲
	WriteBufferSize: 32768, // 32KB 写缓冲
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

// WebSocketHandler WebSocket处理器
type WebSocketHandler struct {
	repo *models.ServerRepository
}

// NewWebSocketHandler 创建WebSocket处理器
func NewWebSocketHandler(repo *models.ServerRepository) *WebSocketHandler {
	return &WebSocketHandler{repo: repo}
}

// GinHandleWebSocket 处理 WebSocket 连接 (Gin版本)
func (h *WebSocketHandler) GinHandleWebSocket(c *gin.Context) {
	// 获取服务器ID
	idStr := c.Query("server_id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		c.JSON(400, gin.H{"error": "无效的服务器ID"})
		return
	}

	// 从数据库获取服务器配置
	server, err := h.repo.GetByID(uint(id))
	if err != nil {
		c.JSON(404, gin.H{"error": "服务器不存在"})
		return
	}

	// 升级到 WebSocket
	ws, err := upgrader.Upgrade(c.Writer, c.Request, nil)
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

	// 创建 SFTP 客户端（复用SSH连接）
	sftpClient, err := sftp.NewClient(sshClient)
	if err != nil {
		log.Println("创建 SFTP 客户端失败:", err)
		// SFTP失败不影响终端使用，继续
		sftpClient = nil
	} else {
		defer sftpClient.Close()
		log.Println("SFTP 客户端创建成功")
	}

	// 从URL获取sessionID（前端需要传递）
	sessionID := c.Query("session_id")
	if sessionID != "" && sftpClient != nil {
		// 保存到会话管理器
		GetSessionManager().AddSession(sessionID, sshClient, sftpClient)
		defer GetSessionManager().RemoveSession(sessionID)
		log.Printf("会话已保存: %s", sessionID)
	}

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

	// 设置WebSocket为二进制模式，禁用压缩提高性能
	ws.SetReadDeadline(time.Time{})  // 不设置读超时
	ws.SetWriteDeadline(time.Time{}) // 不设置写超时

	// 双向数据转发
	done := make(chan bool, 2)

	// SSH 输出 → WebSocket (优化：使用32KB缓冲)
	go func() {
		defer func() { done <- true }()
		buffer := make([]byte, 32768) // 32KB缓冲
		for {
			n, err := stdout.Read(buffer)
			if err != nil {
				if err != io.EOF {
					log.Println("读取 stdout 失败:", err)
				}
				return
			}
			if n > 0 {
				if err := ws.WriteMessage(websocket.BinaryMessage, buffer[:n]); err != nil {
					log.Println("写入 WebSocket 失败:", err)
					return
				}
			}
		}
	}()

	// SSH 错误输出 → WebSocket (合并到stdout处理)
	go func() {
		buffer := make([]byte, 8192) // 8KB缓冲
		for {
			n, err := stderr.Read(buffer)
			if err != nil {
				if err != io.EOF {
					log.Println("读取 stderr 失败:", err)
				}
				return
			}
			if n > 0 {
				ws.WriteMessage(websocket.BinaryMessage, buffer[:n])
			}
		}
	}()

	// WebSocket → SSH 输入 (优化：批量写入)
	go func() {
		defer func() { done <- true }()
		for {
			msgType, data, err := ws.ReadMessage()
			if err != nil {
				log.Println("读取 WebSocket 失败:", err)
				return
			}

			if msgType == websocket.TextMessage || msgType == websocket.BinaryMessage {
				if len(data) > 0 {
					if _, err := stdin.Write(data); err != nil {
						log.Println("写入 stdin 失败:", err)
						return
					}
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
		Timeout:         10 * time.Second,        // 连接超时10秒
		ClientVersion:   "SSH-2.0-WebSSH_Client", // 客户端版本标识
	}

	address := fmt.Sprintf("%s:%d", server.Host, server.Port)
	client, err := ssh.Dial("tcp", address, config)
	if err != nil {
		return nil, err
	}

	// 启动keepalive保持连接活跃
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			_, _, err := client.SendRequest("keepalive@openssh.com", true, nil)
			if err != nil {
				return
			}
		}
	}()

	return client, nil
}
