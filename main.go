package main

import (
	"all_project/config"
	"all_project/database"
	"all_project/handlers"
	"all_project/middleware"
	"all_project/models"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

func main() {
	// 加载配置文件
	if err := config.LoadConfig("./config.json"); err != nil {
		log.Fatalf("❌ 配置文件加载失败: %v", err)
	}

	// 初始化数据库
	if err := database.InitDB(); err != nil {
		log.Fatalf("❌ 数据库初始化失败: %v", err)
	}
	defer database.Close()

	// 自动迁移模型
	if err := database.AutoMigrate(
		&models.Server{},
		&models.CommandHistory{},
		&models.AIModel{},
		&models.APIEndpoint{},
		&models.ModelConfig{},
		&models.ChatSession{},
		&models.ChatMessage{},
	); err != nil {
		log.Fatalf("❌ 数据库迁移失败: %v", err)
	}

	// 创建仓储和处理器
	serverRepo := models.NewServerRepository(database.DB)
	commandRepo := models.NewCommandHistoryRepository(database.DB)
	serverHandler := handlers.NewServerHandler(serverRepo)
	commandHandler := handlers.NewCommandHandler(commandRepo)
	wsHandler := handlers.NewWebSocketHandler(serverRepo)
	fileHandler := handlers.NewFileHandler()
	localFileHandler := handlers.NewLocalFileHandler()
	aiHandler := handlers.NewAIHandler(database.DB)
	aiConfigHandler := handlers.NewAIConfigHandler(database.DB)

	// 初始化全局本地终端
	if err := handlers.InitGlobalLocalTerminal(); err != nil {
		log.Printf("⚠️ 本地终端初始化失败: %v", err)
	}

	// 设置Gin为发布模式（生产环境）
	gin.SetMode(gin.ReleaseMode)

	// 创建Gin路由
	r := gin.Default()

	// 静态文件服务（不需要认证，添加缓存支持）
	staticGroup := r.Group("/static")
	staticGroup.Use(func(c *gin.Context) {
		path := c.Request.URL.Path

		// 根据文件类型设置不同的缓存策略
		if strings.HasSuffix(path, ".css") || strings.HasSuffix(path, ".js") {
			// CSS/JS文件：缓存7天
			c.Header("Cache-Control", "public, max-age=604800")
		} else if strings.HasSuffix(path, ".woff") || strings.HasSuffix(path, ".woff2") ||
			strings.HasSuffix(path, ".ttf") || strings.HasSuffix(path, ".eot") ||
			strings.HasSuffix(path, ".svg") || strings.HasSuffix(path, ".png") ||
			strings.HasSuffix(path, ".jpg") || strings.HasSuffix(path, ".gif") ||
			strings.HasSuffix(path, ".ico") {
			// 字体文件和图片：缓存30天
			c.Header("Cache-Control", "public, max-age=2592000")
		} else {
			// 其他文件：缓存1天
			c.Header("Cache-Control", "public, max-age=86400")
		}

		c.Next()
	})
	staticGroup.StaticFS("/", http.Dir("./static"))

	// 登录页面（不需要认证）
	r.GET("/login", func(c *gin.Context) {
		c.File("./static/login.html")
	})

	// 登录/登出 API（不需要认证）
	auth := r.Group("/api")
	{
		auth.POST("/login", middleware.GinLoginHandler)
		auth.POST("/logout", middleware.GinLogoutHandler)
	}

	// 主页（需要认证，未登录则重定向）
	r.GET("/", middleware.GinPageAuthMiddleware(), func(c *gin.Context) {
		c.File("./static/index.html")
	})

	// API 路由（需要认证）
	api := r.Group("/api")
	api.Use(middleware.GinAuthMiddleware())
	{
		// 服务器管理
		api.GET("/servers", serverHandler.GinGetServers)
		api.GET("/server", serverHandler.GinGetServer)
		api.POST("/server/create", serverHandler.GinCreateServer)
		api.POST("/server/update", serverHandler.GinUpdateServer)
		api.POST("/server/delete", serverHandler.GinDeleteServer)
		api.GET("/servers/search", serverHandler.GinSearchServers)

		// 命令历史
		api.POST("/command/save", commandHandler.GinSaveCommand)
		api.GET("/commands", commandHandler.GinGetServerCommands)
		api.GET("/commands/recent", commandHandler.GinGetRecentCommands)
		api.POST("/commands/clear", commandHandler.GinClearServerCommands)

		// 文件管理
		api.GET("/files/list", fileHandler.ListFiles)
		api.GET("/files/read", fileHandler.ReadFile)
		api.GET("/files/download", fileHandler.DownloadFile)
		api.POST("/files/save", fileHandler.SaveFile)
		api.POST("/files/upload", fileHandler.UploadFile)
		api.POST("/files/upload-chunk", fileHandler.UploadChunk) // 分片上传
		api.POST("/files/create", fileHandler.CreateFile)
		api.POST("/files/delete", fileHandler.DeleteFile)
		api.POST("/files/rename", fileHandler.RenameFile)
		api.POST("/files/copy", fileHandler.CopyFile) // 复制文件

		// 本地文件管理
		api.GET("/local/files/list", localFileHandler.ListLocalFiles)
		api.GET("/local/files/read", localFileHandler.ReadLocalFile)
		api.GET("/local/files/download", localFileHandler.DownloadLocalFile)
		api.POST("/local/files/save", localFileHandler.SaveLocalFile)
		api.POST("/local/files/upload", localFileHandler.UploadLocalFile)
		api.POST("/local/files/create", localFileHandler.CreateLocalFile)
		api.POST("/local/files/delete", localFileHandler.DeleteLocalFile)
		api.POST("/local/files/rename", localFileHandler.RenameLocalFile)
		api.POST("/local/files/copy", localFileHandler.CopyLocalFile)

		// AI模型管理
		api.GET("/ai/models", aiConfigHandler.GetModels)
		api.POST("/ai/models/create", aiConfigHandler.CreateModel)
		api.POST("/ai/models/update", aiConfigHandler.UpdateModel)
		api.POST("/ai/models/delete", aiConfigHandler.DeleteModel)

		// API接口管理
		api.GET("/ai/endpoints", aiConfigHandler.GetEndpoints)
		api.POST("/ai/endpoints/create", aiConfigHandler.CreateEndpoint)
		api.POST("/ai/endpoints/update", aiConfigHandler.UpdateEndpoint)
		api.POST("/ai/endpoints/delete", aiConfigHandler.DeleteEndpoint)

		// 模型配置管理
		api.GET("/ai/configs", aiConfigHandler.GetConfigs)
		api.GET("/ai/configs/default", aiConfigHandler.GetDefaultConfig)
		api.POST("/ai/configs/create", aiConfigHandler.CreateConfig)
		api.POST("/ai/configs/update", aiConfigHandler.UpdateConfig)
		api.POST("/ai/configs/set-default", aiConfigHandler.SetDefaultConfig)
		api.POST("/ai/configs/delete", aiConfigHandler.DeleteConfig)

		// AI会话管理
		api.GET("/ai/sessions", aiHandler.GetSessions)
		api.GET("/ai/session", aiHandler.GetSession)
		api.POST("/ai/session/create", aiHandler.CreateSession)
		api.POST("/ai/session/delete", aiHandler.DeleteSession)
		api.POST("/ai/session/clear", aiHandler.ClearSession)
		api.GET("/ai/messages", aiHandler.GetMessages)

		// AI消息操作
		api.POST("/ai/message/edit", aiHandler.EditMessage)
		api.POST("/ai/message/delete", aiHandler.DeleteMessage)
		api.POST("/ai/message/revoke", aiHandler.RevokeMessage)
	}

	// WebSocket 路由（需要认证，未登录则重定向）
	r.GET("/ws", middleware.GinPageAuthMiddleware(), wsHandler.GinHandleWebSocket)
	r.GET("/ws/local", middleware.GinPageAuthMiddleware(), handlers.GinHandleLocalTerminal)
	r.GET("/ws/ai", middleware.GinPageAuthMiddleware(), func(c *gin.Context) {
		aiHandler.ChatStream(c.Writer, c.Request)
	})

	// 启动服务器
	port := config.GetPort()
	fmt.Println("╔═══════════════════════════════════════════════════╗")
	fmt.Println("║   🚀 Web SSH 客户端管理系统 (Gin Framework)      ║")
	fmt.Printf("║   📡 服务地址: http://localhost:%s              ║\n", port)
	fmt.Println("║   💾 数据库: PostgreSQL (my)                      ║")
	fmt.Println("║   🔐 Token 认证已启用 (30天自动登录)             ║")
	fmt.Println("╚═══════════════════════════════════════════════════╝")

	if err := r.Run(":" + port); err != nil {
		log.Fatalf("❌ 服务器启动失败: %v", err)
	}
}
