package main

import (
	"all_project/config"
	"all_project/handlers"
	"all_project/middleware"
	"all_project/storage"
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

	// 初始化存储
	if err := storage.Init(); err != nil {
		log.Fatalf("❌ 存储初始化失败: %v", err)
	}
	log.Println("✓ 存储系统初始化成功")

	// 加载命令历史到内存（启动时只读取一次）
	if err := storage.LoadCommandsCache(); err != nil {
		log.Printf("⚠️  命令历史加载失败: %v", err)
	} else {
		log.Println("✓ 命令历史已加载到内存")
	}

	// 加载AI供应商配置到内存
	if err := storage.LoadProvidersCache(); err != nil {
		log.Printf("⚠️  AI供应商加载失败: %v", err)
	} else {
		log.Println("✓ AI供应商配置已加载到内存")
	}

	// 加载AI全局配置到内存
	if err := storage.LoadAIConfigCache(); err != nil {
		log.Printf("⚠️  AI配置加载失败: %v", err)
	} else {
		log.Println("✓ AI全局配置已加载到内存")
	}

	// 创建处理器（使用新的storage系统）
	serverHandler := handlers.NewServerHandler()
	commandHandler := handlers.NewCommandHandler()
	wsHandler := handlers.NewWebSocketHandler()
	fileHandler := handlers.NewFileHandler()
	localFileHandler := handlers.NewLocalFileHandler()

	// AI相关handlers
	aiProvidersHandler := handlers.NewAIProvidersHandler()
	aiConfigHandler := handlers.NewAIConfigHandler()
	aiSessionsHandler := handlers.NewAISessionsHandler()
	aiChatHandler := handlers.NewAIChatHandler()
	aiEditHandler := handlers.NewAIEditHandler()

	// 初始化全局本地终端
	if err := handlers.InitGlobalLocalTerminal(); err != nil {
		log.Printf("⚠️ 本地终端初始化失败: %v", err)
	}

	// 启动session清理任务
	middleware.StartCleanupTask()
	log.Println("✓ Session清理任务已启动")

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
		api.GET("/commands/search", commandHandler.GinSearchCommands)
		api.POST("/command/delete", commandHandler.GinDeleteCommand)
		api.POST("/commands/clear", commandHandler.GinClearServerCommands)
		api.POST("/commands/clear-all", commandHandler.GinClearAllCommands)

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

		// AI供应商和模型管理
		api.GET("/ai/providers", aiProvidersHandler.GetProviders)
		api.GET("/ai/provider", aiProvidersHandler.GetProvider)
		api.POST("/ai/provider/create", aiProvidersHandler.CreateProvider)
		api.POST("/ai/provider/update", aiProvidersHandler.UpdateProvider)
		api.POST("/ai/provider/delete", aiProvidersHandler.DeleteProvider)
		api.GET("/ai/models", aiProvidersHandler.GetAllModels) // 获取所有模型（扁平化列表）

		// 全局AI配置管理
		api.GET("/ai/config", aiConfigHandler.GetConfig)
		api.POST("/ai/config/update", aiConfigHandler.UpdateConfig)

		// AI会话管理
		api.GET("/ai/sessions", aiSessionsHandler.GetSessions)
		api.GET("/ai/session", aiSessionsHandler.GetSession)
		api.POST("/ai/session/create", aiSessionsHandler.CreateSession)
		api.POST("/ai/session/delete", aiSessionsHandler.DeleteSession)
		api.POST("/ai/session/clear", aiSessionsHandler.ClearSession)
		api.POST("/ai/session/update-model", aiSessionsHandler.UpdateSessionModel)
		api.GET("/ai/messages", aiSessionsHandler.GetMessages)
		api.POST("/ai/message/update", aiSessionsHandler.UpdateMessage)
		api.POST("/ai/message/revoke", aiSessionsHandler.RevokeMessage)

		// AI工具确认/拒绝（更新状态，实际文件操作由前端调用文件API）
		api.POST("/ai/edit/apply", aiEditHandler.ApplyEdit)
	}

	// WebSocket 路由（需要认证，未登录则重定向）
	r.GET("/ws", middleware.GinPageAuthMiddleware(), wsHandler.GinHandleWebSocket)
	r.GET("/ws/local", middleware.GinPageAuthMiddleware(), handlers.GinHandleLocalTerminal)
	r.GET("/ws/ai", middleware.GinPageAuthMiddleware(), func(c *gin.Context) {
		aiChatHandler.ChatStream(c.Writer, c.Request)
	})

	// 启动服务器
	port := config.GetPort()
	fmt.Println("╔═══════════════════════════════════════════════════╗")
	fmt.Println("║   🚀 Web SSH 客户端管理系统                       ║")
	fmt.Printf("║   📡 服务地址: http://localhost:%s              ║\n", port)
	fmt.Println("║   💾 存储方式: JSON 文件 (./data/)                ║")
	fmt.Println("║   🔐 Token 认证已启用                             ║")
	fmt.Println("╚═══════════════════════════════════════════════════╝")

	if err := r.Run(":" + port); err != nil {
		log.Fatalf("❌ 服务器启动失败: %v", err)
	}
}
