package middleware

import (
	"all_project/config"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// GinAuthMiddleware Gin认证中间件
func GinAuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// 获取 Token
		token := c.GetHeader("Authorization")
		if token == "" {
			// 尝试从 Cookie 获取
			token, _ = c.Cookie("auth_token")
		} else {
			// 移除 "Bearer " 前缀
			token = strings.TrimPrefix(token, "Bearer ")
		}

		// 验证 Token
		if token != config.GetToken() {
			c.JSON(http.StatusUnauthorized, gin.H{
				"success": false,
				"error":   "未授权访问",
			})
			c.Abort()
			return
		}

		// Token 正确，继续处理
		c.Next()
	}
}

// GinLoginHandler Gin登录处理
func GinLoginHandler(c *gin.Context) {
	var data map[string]string
	if err := c.ShouldBindJSON(&data); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "无效的请求数据",
		})
		return
	}

	token := data["token"]
	if token == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"error":   "Token不能为空",
		})
		return
	}

	// 验证 Token
	if token != config.GetToken() {
		c.JSON(http.StatusUnauthorized, gin.H{
			"success": false,
			"error":   "Token 错误",
		})
		return
	}

	// Token 正确，设置 Cookie
	c.SetCookie(
		"auth_token",
		token,
		86400*30, // 30天
		"/",
		"",
		false,
		true, // HttpOnly
	)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "登录成功",
	})
}

// GinLogoutHandler Gin登出处理
func GinLogoutHandler(c *gin.Context) {
	// 清除 Cookie
	c.SetCookie(
		"auth_token",
		"",
		-1,
		"/",
		"",
		false,
		true,
	)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "登出成功",
	})
}
