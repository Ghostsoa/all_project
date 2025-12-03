package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"all_project/sshapi"
)

func main() {
	// 启动API服务器
	server := sshapi.NewServer(":8080")
	go func() {
		if err := server.Start(); err != nil {
			log.Fatalf("服务器启动失败: %v", err)
		}
	}()

	time.Sleep(500 * time.Millisecond)
	fmt.Println("╔══════════════════════════════════════════╗")
	fmt.Println("║    本地终端API服务 - 交互式测试工具      ║")
	fmt.Println("║    API Server: http://localhost:8080     ║")
	fmt.Println("╚══════════════════════════════════════════╝")
	fmt.Println()

	// 启动交互式终端
	runInteractiveTerminal()
}

func runInteractiveTerminal() {
	baseURL := "http://localhost:8080"

	// 创建本地Shell会话
	fmt.Println("正在创建本地Shell会话...")
	sessionID, err := createSession(baseURL, sshapi.SessionConfig{
		Shell: "bash",
	})
	if err != nil {
		log.Fatalf("创建会话失败: %v", err)
	}

	fmt.Printf("✓ 会话已创建: %s\n\n", sessionID)
	time.Sleep(500 * time.Millisecond)

	// 显示初始屏幕
	displayScreen(baseURL, sessionID)

	// 交互循环
	reader := bufio.NewReader(os.Stdin)
	for {
		fmt.Print("\n命令 > ")
		command, _ := reader.ReadString('\n')
		command = strings.TrimSpace(command)

		if command == "" {
			continue
		}

		// 特殊命令
		if command == "exit" || command == "quit" {
			fmt.Println("退出...")
			break
		}

		if command == "clear" {
			clearScreen()
			displayScreen(baseURL, sessionID)
			continue
		}

		// 发送命令
		fmt.Println("─────────────────────────────────────────")
		fmt.Printf("执行: %s\n", command)
		err := sendInput(baseURL, sessionID, command)
		if err != nil {
			fmt.Printf("错误: %v\n", err)
			continue
		}

		// 智能等待并显示结果
		waitAndDisplay(baseURL, sessionID)
	}
}

func waitAndDisplay(baseURL, sessionID string) {
	maxWait := 30 * time.Second
	checkInterval := 300 * time.Millisecond
	elapsed := time.Duration(0)

	lastState := ""
	stableCount := 0

	for elapsed < maxWait {
		time.Sleep(checkInterval)
		elapsed += checkInterval

		screen, err := getScreen(baseURL, sessionID)
		if err != nil {
			fmt.Printf("获取屏幕失败: %v\n", err)
			return
		}

		// 检查状态变化
		if screen.ProcessState != lastState {
			lastState = screen.ProcessState
			stableCount = 0
		} else {
			stableCount++
		}

		// 状态稳定3次（约1秒）才判断
		if stableCount >= 3 {
			switch screen.ProcessState {
			case "completed":
				// 命令执行完成
				fmt.Println("─────────────────────────────────────────")
				displayScreenContent(screen)
				fmt.Printf("✓ 命令完成 (耗时: %.1fs)\n", elapsed.Seconds())
				return

			case "waiting_input":
				// 需要输入
				fmt.Println("─────────────────────────────────────────")
				displayScreenContent(screen)
				fmt.Printf("⚠ 等待输入 (检测到交互式提示)\n")

				// 读取用户输入
				reader := bufio.NewReader(os.Stdin)
				fmt.Print("输入 > ")
				input, _ := reader.ReadString('\n')

				// 发送输入并继续等待
				sendInput(baseURL, sessionID, strings.TrimSpace(input))
				stableCount = 0
				lastState = ""
				continue
			}
		}

		// 显示进度（每3秒）
		if int(elapsed.Seconds())%3 == 0 && stableCount == 0 {
			fmt.Printf("  ... 执行中 (%.0fs)\n", elapsed.Seconds())
		}
	}

	// 超时
	fmt.Println("─────────────────────────────────────────")
	screen, _ := getScreen(baseURL, sessionID)
	displayScreenContent(screen)
	fmt.Printf("⏱ 超时 (%.0fs)，命令可能还在后台运行\n", maxWait.Seconds())
}

func displayScreen(baseURL, sessionID string) {
	screen, err := getScreen(baseURL, sessionID)
	if err != nil {
		fmt.Printf("获取屏幕失败: %v\n", err)
		return
	}

	displayScreenContent(screen)
}

func displayScreenContent(screen *sshapi.ScreenResponse) {
	fmt.Println("┌─────────────────── 终端屏幕 ───────────────────┐")

	// 只显示有内容的行
	lineCount := 0
	for _, line := range screen.Lines {
		trimmed := strings.TrimRight(line, " ")
		if trimmed != "" || lineCount > 0 {
			fmt.Printf("│ %s\n", line)
			lineCount++
		}
	}

	if lineCount == 0 {
		fmt.Println("│ (空)")
	}

	fmt.Println("└────────────────────────────────────────────────┘")
	fmt.Printf("状态: %s | 光标: (%d,%d) | 空闲: %ds\n",
		screen.ProcessState, screen.CursorRow, screen.CursorCol, screen.IdleSeconds)
}

func clearScreen() {
	fmt.Print("\033[H\033[2J")
}

// API客户端函数

func createSession(baseURL string, config sshapi.SessionConfig) (string, error) {
	data, _ := json.Marshal(config)
	resp, err := http.Post(baseURL+"/session/create", "application/json", bytes.NewBuffer(data))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("HTTP %d: %s", resp.StatusCode, body)
	}

	var result map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&result)
	return result["session_id"].(string), nil
}

func getScreen(baseURL, sessionID string) (*sshapi.ScreenResponse, error) {
	resp, err := http.Get(fmt.Sprintf("%s/session/%s/screen", baseURL, sessionID))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var screen sshapi.ScreenResponse
	if err := json.NewDecoder(resp.Body).Decode(&screen); err != nil {
		return nil, err
	}
	return &screen, nil
}

func sendInput(baseURL, sessionID, command string) error {
	data, _ := json.Marshal(sshapi.InputRequest{Command: command})
	resp, err := http.Post(
		fmt.Sprintf("%s/session/%s/input", baseURL, sessionID),
		"application/json",
		bytes.NewBuffer(data),
	)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, body)
	}

	return nil
}
