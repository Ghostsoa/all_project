package storage

import (
	"fmt"
	"sync"
)

// 供应商内存缓存（启动时全量加载）
var (
	providersCache     []Provider
	providersCacheLock sync.RWMutex
	providersLoaded    bool
)

// LoadProvidersCache 加载供应商到内存（服务器启动时调用一次）
func LoadProvidersCache() error {
	providersCacheLock.Lock()
	defer providersCacheLock.Unlock()

	if err := readJSON(providersFile, &providersCache); err != nil {
		// 文件不存在，初始化空列表
		providersCache = []Provider{}
	}

	providersLoaded = true
	return nil
}

// GetProviders 获取所有供应商（从内存读取）
func GetProviders() ([]Provider, error) {
	providersCacheLock.RLock()
	defer providersCacheLock.RUnlock()

	if !providersLoaded {
		return []Provider{}, nil
	}

	// 返回副本，避免外部修改
	result := make([]Provider, len(providersCache))
	copy(result, providersCache)
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
	providersCacheLock.Lock()
	defer providersCacheLock.Unlock()

	if !providersLoaded {
		return fmt.Errorf("供应商缓存未初始化")
	}

	// 检查ID是否已存在
	for _, p := range providersCache {
		if p.ID == provider.ID {
			return fmt.Errorf("供应商ID已存在: %s", provider.ID)
		}
	}

	// 添加到内存
	providersCache = append(providersCache, *provider)

	// 写入文件
	return writeJSON(providersFile, providersCache)
}

// UpdateProvider 更新供应商（操作内存+写文件）
func UpdateProvider(provider *Provider) error {
	providersCacheLock.Lock()
	defer providersCacheLock.Unlock()

	if !providersLoaded {
		return fmt.Errorf("供应商缓存未初始化")
	}

	found := false
	for i, p := range providersCache {
		if p.ID == provider.ID {
			providersCache[i] = *provider
			found = true
			break
		}
	}

	if !found {
		return fmt.Errorf("供应商不存在: %s", provider.ID)
	}

	// 写入文件
	return writeJSON(providersFile, providersCache)
}

// DeleteProvider 删除供应商（操作内存+写文件）
func DeleteProvider(id string) error {
	providersCacheLock.Lock()
	defer providersCacheLock.Unlock()

	if !providersLoaded {
		return fmt.Errorf("供应商缓存未初始化")
	}

	newProviders := []Provider{}
	found := false
	for _, p := range providersCache {
		if p.ID != id {
			newProviders = append(newProviders, p)
		} else {
			found = true
		}
	}

	if !found {
		return fmt.Errorf("供应商不存在: %s", id)
	}

	// 更新内存
	providersCache = newProviders

	// 写入文件
	return writeJSON(providersFile, providersCache)
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
