package main

import (
	"all_project/database"
	"all_project/handlers"
	"all_project/models"
	"fmt"
	"log"
	"net/http"
)

func main() {
	// 初始化数据库
	if err := database.InitDB(); err != nil {
		log.Fatalf("❌ 数据库初始化失败: %v", err)
	}
	defer database.Close()

	// 自动迁移模型
	if err := database.AutoMigrate(&models.Server{}); err != nil {
		log.Fatalf("❌ 数据库迁移失败: %v", err)
	}

	// 创建仓储和处理器
	serverRepo := models.NewServerRepository(database.DB)
	serverHandler := handlers.NewServerHandler(serverRepo)
	wsHandler := handlers.NewWebSocketHandler(serverRepo)

	// 静态文件服务
	fs := http.FileServer(http.Dir("./static"))
	http.Handle("/static/", http.StripPrefix("/static/", fs))

	// 主页
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			http.ServeFile(w, r, "./static/index.html")
		} else {
			http.NotFound(w, r)
		}
	})

	// API 路由
	http.HandleFunc("/api/servers", serverHandler.GetServers)
	http.HandleFunc("/api/server", serverHandler.GetServer)
	http.HandleFunc("/api/server/create", serverHandler.CreateServer)
	http.HandleFunc("/api/server/update", serverHandler.UpdateServer)
	http.HandleFunc("/api/server/delete", serverHandler.DeleteServer)
	http.HandleFunc("/api/servers/search", serverHandler.SearchServers)

	// WebSocket 路由
	http.HandleFunc("/ws", wsHandler.HandleWebSocket)

	// 启动服务器
	fmt.Println("╔═══════════════════════════════════════════════════╗")
	fmt.Println("║   🚀 Web SSH 客户端管理系统                        ║")
	fmt.Println("║   📡 服务地址: http://localhost:8080              ║")
	fmt.Println("║   💾 数据库: PostgreSQL (my)                      ║")
	fmt.Println("╚═══════════════════════════════════════════════════╝")

	log.Fatal(http.ListenAndServe(":8080", nil))
}
