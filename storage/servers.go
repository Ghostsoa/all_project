package storage

import (
	"fmt"
	"time"
)

// GetServers 获取所有服务器
func GetServers() ([]Server, error) {
	config := GetConfig()
	if config == nil {
		return []Server{}, nil
	}
	return config.Servers, nil
}

// GetServer 根据ID获取服务器
func GetServer(id string) (*Server, error) {
	servers, err := GetServers()
	if err != nil {
		return nil, err
	}

	for _, s := range servers {
		if s.ID == id {
			return &s, nil
		}
	}
	return nil, fmt.Errorf("服务器不存在: %s", id)
}

// CreateServer 创建服务器
func CreateServer(server *Server) error {
	globalConfigLock.Lock()
	defer globalConfigLock.Unlock()

	if globalConfig == nil {
		return fmt.Errorf("配置未加载")
	}

	server.CreatedAt = time.Now()
	server.UpdatedAt = time.Now()
	globalConfig.Servers = append(globalConfig.Servers, *server)

	return writeJSON(configFile, globalConfig)
}

// UpdateServer 更新服务器
func UpdateServer(server *Server) error {
	globalConfigLock.Lock()
	defer globalConfigLock.Unlock()

	if globalConfig == nil {
		return fmt.Errorf("配置未加载")
	}

	found := false
	for i, s := range globalConfig.Servers {
		if s.ID == server.ID {
			server.UpdatedAt = time.Now()
			server.CreatedAt = s.CreatedAt // 保留创建时间
			globalConfig.Servers[i] = *server
			found = true
			break
		}
	}

	if !found {
		return fmt.Errorf("服务器不存在: %s", server.ID)
	}

	return writeJSON(configFile, globalConfig)
}

// DeleteServer 删除服务器
func DeleteServer(id string) error {
	globalConfigLock.Lock()
	defer globalConfigLock.Unlock()

	if globalConfig == nil {
		return fmt.Errorf("配置未加载")
	}

	found := false
	newServers := make([]Server, 0)
	for _, s := range globalConfig.Servers {
		if s.ID != id {
			newServers = append(newServers, s)
		} else {
			found = true
		}
	}

	if !found {
		return fmt.Errorf("服务器不存在: %s", id)
	}

	globalConfig.Servers = newServers
	return writeJSON(configFile, globalConfig)
}

// SearchServers 搜索服务器
func SearchServers(keyword string) ([]Server, error) {
	config := GetConfig()
	if config == nil {
		return []Server{}, nil
	}
	servers := config.Servers

	if keyword == "" {
		return servers, nil
	}

	result := []Server{}
	for _, s := range servers {
		if contains(s.Name, keyword) || contains(s.Host, keyword) ||
			contains(s.Description, keyword) || containsTag(s.Tags, keyword) {
			result = append(result, s)
		}
	}

	return result, nil
}

func contains(s, substr string) bool {
	return len(s) > 0 && len(substr) > 0 && (s == substr || len(s) >= len(substr) && findSubstring(s, substr))
}

func findSubstring(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

func containsTag(tags []string, keyword string) bool {
	for _, tag := range tags {
		if contains(tag, keyword) {
			return true
		}
	}
	return false
}
