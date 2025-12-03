package handlers

import (
	"all_project/models"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
)

type ServerHandler struct {
	repo *models.ServerRepository
}

func NewServerHandler(repo *models.ServerRepository) *ServerHandler {
	return &ServerHandler{repo: repo}
}

// GetServers 获取所有服务器列表
func (h *ServerHandler) GetServers(w http.ResponseWriter, r *http.Request) {
	servers, err := h.repo.GetAll()
	if err != nil {
		log.Println("获取服务器列表失败:", err)
		respondError(w, "获取服务器列表失败", http.StatusInternalServerError)
		return
	}

	respondJSON(w, map[string]interface{}{
		"success": true,
		"data":    servers,
		"count":   len(servers),
	})
}

// GetServer 获取单个服务器详情
func (h *ServerHandler) GetServer(w http.ResponseWriter, r *http.Request) {
	idStr := r.URL.Query().Get("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		respondError(w, "无效的服务器ID", http.StatusBadRequest)
		return
	}

	server, err := h.repo.GetByID(uint(id))
	if err != nil {
		log.Println("获取服务器失败:", err)
		respondError(w, "服务器不存在", http.StatusNotFound)
		return
	}

	respondJSON(w, map[string]interface{}{
		"success": true,
		"data":    server,
	})
}

// CreateServer 创建服务器配置
func (h *ServerHandler) CreateServer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondError(w, "方法不允许", http.StatusMethodNotAllowed)
		return
	}

	var server models.Server
	if err := json.NewDecoder(r.Body).Decode(&server); err != nil {
		respondError(w, "无效的请求数据", http.StatusBadRequest)
		return
	}

	// 设置默认值
	if server.Port == 0 {
		server.Port = 22
	}
	if server.AuthType == "" {
		server.AuthType = "password"
	}

	if err := h.repo.Create(&server); err != nil {
		log.Println("创建服务器失败:", err)
		respondError(w, "创建服务器失败", http.StatusInternalServerError)
		return
	}

	// 清除敏感信息
	server.Password = ""
	server.PrivateKey = ""

	respondJSON(w, map[string]interface{}{
		"success": true,
		"message": "服务器创建成功",
		"data":    server,
	})
}

// UpdateServer 更新服务器配置
func (h *ServerHandler) UpdateServer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut && r.Method != http.MethodPost {
		respondError(w, "方法不允许", http.StatusMethodNotAllowed)
		return
	}

	var server models.Server
	if err := json.NewDecoder(r.Body).Decode(&server); err != nil {
		respondError(w, "无效的请求数据", http.StatusBadRequest)
		return
	}

	if err := h.repo.Update(&server); err != nil {
		log.Println("更新服务器失败:", err)
		respondError(w, "更新服务器失败", http.StatusInternalServerError)
		return
	}

	respondJSON(w, map[string]interface{}{
		"success": true,
		"message": "服务器更新成功",
	})
}

// DeleteServer 删除服务器
func (h *ServerHandler) DeleteServer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete && r.Method != http.MethodPost {
		respondError(w, "方法不允许", http.StatusMethodNotAllowed)
		return
	}

	idStr := r.URL.Query().Get("id")
	id, err := strconv.ParseUint(idStr, 10, 32)
	if err != nil {
		respondError(w, "无效的服务器ID", http.StatusBadRequest)
		return
	}

	if err := h.repo.Delete(uint(id)); err != nil {
		log.Println("删除服务器失败:", err)
		respondError(w, "删除服务器失败", http.StatusInternalServerError)
		return
	}

	respondJSON(w, map[string]interface{}{
		"success": true,
		"message": "服务器删除成功",
	})
}

// SearchServers 搜索服务器
func (h *ServerHandler) SearchServers(w http.ResponseWriter, r *http.Request) {
	keyword := r.URL.Query().Get("q")
	if keyword == "" {
		h.GetServers(w, r)
		return
	}

	servers, err := h.repo.Search(keyword)
	if err != nil {
		log.Println("搜索服务器失败:", err)
		respondError(w, "搜索失败", http.StatusInternalServerError)
		return
	}

	respondJSON(w, map[string]interface{}{
		"success": true,
		"data":    servers,
		"count":   len(servers),
	})
}

// 辅助函数
func respondJSON(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}

func respondError(w http.ResponseWriter, message string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": false,
		"error":   message,
	})
}
