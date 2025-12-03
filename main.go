package main

import (
	"all_project/config"
	"all_project/database"
	"all_project/handlers"
	"all_project/middleware"
	"all_project/models"
	"fmt"
	"log"

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
	if err := database.AutoMigrate(&models.Server{}, &models.CommandHistory{}); err != nil {
		log.Fatalf("❌ 数据库迁移失败: %v", err)
	}

	// 创建仓储和处理器
	serverRepo := models.NewServerRepository(database.DB)
	commandRepo := models.NewCommandHistoryRepository(database.DB)
	serverHandler := handlers.NewServerHandler(serverRepo)
	commandHandler := handlers.NewCommandHandler(commandRepo)
	wsHandler := handlers.NewWebSocketHandler(serverRepo)
	fileHandler := handlers.NewFileHandler(serverRepo)

	// 设置Gin为发布模式（生产环境）
	gin.SetMode(gin.ReleaseMode)

	// 创建Gin路由
	r := gin.Default()

	// 静态文件服务（不需要认证）
	r.Static("/static", "./static")

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
		api.POST("/files/save", fileHandler.SaveFile)
		api.POST("/files/create", fileHandler.CreateFile)
		api.POST("/files/delete", fileHandler.DeleteFile)
		api.POST("/files/rename", fileHandler.RenameFile)
	}

	// WebSocket 路由（需要认证，未登录则重定向）
	r.GET("/ws", middleware.GinPageAuthMiddleware(), wsHandler.GinHandleWebSocket)
	r.GET("/ws/local", middleware.GinPageAuthMiddleware(), handlers.GinHandleLocalTerminal)

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
