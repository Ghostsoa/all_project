package storage

import (
	"fmt"
)

// LoadProvidersCache 加载供应商到内存（服务器启动时调用一次）
// 现在直接使用统一配置，保留此函数以兼容
func LoadProvidersCache() error {
	// 无需操作，配置已在Init中加载
	return nil
}

// GetProviders 获取所有供应商（从内存读取）
func GetProviders() ([]Provider, error) {
	config := GetConfig()
	if config == nil {
		return []Provider{}, nil
	}
	return config.Providers, nil
}

// SearchProviders 搜索供应商
func SearchProviders(keyword string) ([]Provider, error) {
	config := GetConfig()
	if config == nil {
		return []Provider{}, nil
	}
	providers := config.Providers

	var result []Provider
	for _, p := range providers {
		if p.Name == keyword || p.ID == keyword {
			result = append(result, p)
		}
	}
	return result, nil
}

// GetProvider 根据ID获取供应商
func GetProvider(id string) (*Provider, error) {
	providers, err := GetProviders()
	if err != nil {
		return nil, err
	}

	for _, p := range providers {
		if p.ID == id {
			return &p, nil
		}
	}
	return nil, fmt.Errorf("供应商不存在: %s", id)
}

// CreateProvider 创建供应商（操作内存+写文件）
func CreateProvider(provider *Provider) error {
	globalConfigLock.Lock()
	defer globalConfigLock.Unlock()

	if globalConfig == nil {
		return fmt.Errorf("配置未加载")
	}

	// 检查ID是否已存在
	for _, p := range globalConfig.Providers {
		if p.ID == provider.ID {
			return fmt.Errorf("供应商ID已存在: %s", provider.ID)
		}
	}

	globalConfig.Providers = append(globalConfig.Providers, *provider)
	return writeJSON(configFile, globalConfig)
}

// UpdateProvider 更新供应商（操作内存+写文件）
func UpdateProvider(provider *Provider) error {
	globalConfigLock.Lock()
	defer globalConfigLock.Unlock()

	if globalConfig == nil {
		return fmt.Errorf("配置未加载")
	}

	found := false
	for i, p := range globalConfig.Providers {
		if p.ID == provider.ID {
			globalConfig.Providers[i] = *provider
			found = true
			break
		}
	}

	if !found {
		return fmt.Errorf("供应商不存在: %s", provider.ID)
	}

	return writeJSON(configFile, globalConfig)
}

// DeleteProvider 删除供应商
func DeleteProvider(id string) error {
	globalConfigLock.Lock()
	defer globalConfigLock.Unlock()

	if globalConfig == nil {
		return fmt.Errorf("配置未加载")
	}

	found := false
	newProviders := make([]Provider, 0)
	for _, p := range globalConfig.Providers {
		if p.ID != id {
			newProviders = append(newProviders, p)
		} else {
			found = true
		}
	}

	if !found {
		return fmt.Errorf("供应商不存在: %s", id)
	}

	globalConfig.Providers = newProviders
	return writeJSON(configFile, globalConfig)
}

// FindProviderByModel 根据模型ID查找供应商
func FindProviderByModel(modelID string) (*Provider, error) {
	providers, err := GetProviders()
	if err != nil {
		return nil, err
	}

	for _, p := range providers {
		for _, m := range p.Models {
			if m.ID == modelID {
				return &p, nil
			}
		}
	}

	return nil, fmt.Errorf("未找到模型对应的供应商: %s", modelID)
}

// GetAllModels 获取所有模型（扁平化，带供应商信息）
func GetAllModels() ([]map[string]interface{}, error) {
	providers, err := GetProviders()
	if err != nil {
		return nil, err
	}

	var allModels []map[string]interface{}
	for _, p := range providers {
		for _, m := range p.Models {
			allModels = append(allModels, map[string]interface{}{
				"id":            m.ID,
				"name":          m.Name,
				"provider_id":   p.ID,
				"provider_name": p.Name,
			})
		}
	}

	return allModels, nil
}
