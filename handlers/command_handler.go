package handlers

import (
	"all_project/models"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
)

type CommandHandler struct {
	repo *models.CommandHistoryRepository
}

func NewCommandHandler(repo *models.CommandHistoryRepository) *CommandHandler {
	return &CommandHandler{repo: repo}
}

// SaveCommand 保存命令记录
func (h *CommandHandler) SaveCommand(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondError(w, "方法不允许", http.StatusMethodNotAllowed)
		return
	}

	var history models.CommandHistory
	if err := json.NewDecoder(r.Body).Decode(&history); err != nil {
		respondError(w, "无效的请求数据", http.StatusBadRequest)
		return
	}

	if err := h.repo.Create(&history); err != nil {
		log.Println("保存命令失败:", err)
		respondError(w, "保存命令失败", http.StatusInternalServerError)
		return
	}

	respondJSON(w, map[string]interface{}{
		"success": true,
		"message": "命令保存成功",
	})
}

// GetServerCommands 获取指定服务器的命令历史
func (h *CommandHandler) GetServerCommands(w http.ResponseWriter, r *http.Request) {
	serverIDStr := r.URL.Query().Get("server_id")
	serverID, err := strconv.ParseUint(serverIDStr, 10, 32)
	if err != nil {
		respondError(w, "无效的服务器ID", http.StatusBadRequest)
		return
	}

	limitStr := r.URL.Query().Get("limit")
	limit := 100 // 默认100条
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil {
			limit = l
		}
	}

	histories, err := h.repo.GetByServerID(uint(serverID), limit)
	if err != nil {
		log.Println("获取命令历史失败:", err)
		respondError(w, "获取命令历史失败", http.StatusInternalServerError)
		return
	}

	respondJSON(w, map[string]interface{}{
		"success": true,
		"data":    histories,
		"count":   len(histories),
	})
}

// GetRecentCommands 获取最近的命令
func (h *CommandHandler) GetRecentCommands(w http.ResponseWriter, r *http.Request) {
	limitStr := r.URL.Query().Get("limit")
	limit := 50
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil {
			limit = l
		}
	}

	histories, err := h.repo.GetRecent(limit)
	if err != nil {
		log.Println("获取最近命令失败:", err)
		respondError(w, "获取最近命令失败", http.StatusInternalServerError)
		return
	}

	respondJSON(w, map[string]interface{}{
		"success": true,
		"data":    histories,
		"count":   len(histories),
	})
}

// ClearServerCommands 清除指定服务器的命令历史
func (h *CommandHandler) ClearServerCommands(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodDelete {
		respondError(w, "方法不允许", http.StatusMethodNotAllowed)
		return
	}

	serverIDStr := r.URL.Query().Get("server_id")
	serverID, err := strconv.ParseUint(serverIDStr, 10, 32)
	if err != nil {
		respondError(w, "无效的服务器ID", http.StatusBadRequest)
		return
	}

	if err := h.repo.DeleteByServerID(uint(serverID)); err != nil {
		log.Println("清除命令历史失败:", err)
		respondError(w, "清除命令历史失败", http.StatusInternalServerError)
		return
	}

	respondJSON(w, map[string]interface{}{
		"success": true,
		"message": "命令历史已清除",
	})
}
