package storage

import "fmt"

// GetProviders 获取所有供应商
func GetProviders() ([]Provider, error) {
	var providers []Provider
	if err := readJSON(providersFile, &providers); err != nil {
		return nil, err
	}
	return providers, nil
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

// CreateProvider 创建供应商
func CreateProvider(provider *Provider) error {
	providers, err := GetProviders()
	if err != nil {
		return err
	}

	// 检查ID是否已存在
	for _, p := range providers {
		if p.ID == provider.ID {
			return fmt.Errorf("供应商ID已存在: %s", provider.ID)
		}
	}

	providers = append(providers, *provider)
	return writeJSON(providersFile, providers)
}

// UpdateProvider 更新供应商
func UpdateProvider(provider *Provider) error {
	providers, err := GetProviders()
	if err != nil {
		return err
	}

	found := false
	for i, p := range providers {
		if p.ID == provider.ID {
			providers[i] = *provider
			found = true
			break
		}
	}

	if !found {
		return fmt.Errorf("供应商不存在: %s", provider.ID)
	}

	return writeJSON(providersFile, providers)
}

// DeleteProvider 删除供应商
func DeleteProvider(id string) error {
	providers, err := GetProviders()
	if err != nil {
		return err
	}

	newProviders := []Provider{}
	found := false
	for _, p := range providers {
		if p.ID != id {
			newProviders = append(newProviders, p)
		} else {
			found = true
		}
	}

	if !found {
		return fmt.Errorf("供应商不存在: %s", id)
	}

	return writeJSON(providersFile, newProviders)
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
