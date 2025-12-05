package storage

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"path/filepath"
	"time"
)

// UpdateToolMessageStatus 更新tool消息的状态
func UpdateToolMessageStatus(toolCallID, status string) error {
	// 遍历所有session，查找包含该tool_call_id的消息
	files, err := ioutil.ReadDir(sessionsDir)
	if err != nil {
		return err
	}

	for _, file := range files {
		if filepath.Ext(file.Name()) == ".json" {
			sessionID := file.Name()[:len(file.Name())-5]
			sessionFile := filepath.Join(sessionsDir, file.Name())

			// 先尝试从缓存获取
			sessionCacheLock.RLock()
			cachedSession, inCache := sessionCache[sessionID]
			sessionCacheLock.RUnlock()

			var session *ChatSession
			if inCache {
				// 使用缓存中的数据
				session = cachedSession
			} else {
				// 从文件读取
				var loadedSession ChatSession
				if err := readJSON(sessionFile, &loadedSession); err != nil {
					continue
				}
				session = &loadedSession
			}

			// 查找并更新tool消息
			updated := false
			for i, msg := range session.Messages {
				if msg.Role == "tool" && msg.ToolCallID == toolCallID {
					fmt.Printf("🔍 找到tool消息: session=%s, index=%d, tool_call_id=%s\n", sessionID, i, toolCallID)

					// 解析content（JSON）
					var content map[string]interface{}
					if err := json.Unmarshal([]byte(msg.Content), &content); err != nil {
						fmt.Printf("❌ 解析content失败: %v\n", err)
						continue
					}

					fmt.Printf("📝 原始status: %v\n", content["status"])

					// 更新status
					now := time.Now()
					content["status"] = status
					content["updated_at"] = now.Format(time.RFC3339)

					fmt.Printf("✅ 新status: %v, updated_at: %s\n", status, now.Format(time.RFC3339))

					// 重新序列化
					newContent, err := json.Marshal(content)
					if err != nil {
						fmt.Printf("❌ 序列化失败: %v\n", err)
						continue
					}

					session.Messages[i].Content = string(newContent)
					session.UpdatedAt = now
					updated = true
					fmt.Printf("✅ 消息已更新\n")
					break
				}
			}

			// 如果更新了，写回文件和缓存
			if updated {
				fmt.Printf("💾 写入文件: %s\n", sessionFile)
				// 写入文件
				if err := writeJSON(sessionFile, session); err != nil {
					fmt.Printf("❌ 写入文件失败: %v\n", err)
					return err
				}
				fmt.Printf("✅ 文件写入成功\n")

				// 更新缓存
				fmt.Printf("🔄 更新缓存: session=%s\n", sessionID)
				sessionCacheLock.Lock()
				sessionCache[sessionID] = session
				sessionCacheLock.Unlock()
				fmt.Printf("✅ 缓存更新完成\n")

				return nil
			}
		}
	}

	return fmt.Errorf("未找到tool_call_id: %s", toolCallID)
}
