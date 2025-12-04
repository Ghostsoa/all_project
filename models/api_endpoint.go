package models

import (
	"gorm.io/gorm"
)

// APIEndpoint API接口配置
type APIEndpoint struct {
	gorm.Model
	Name        string `gorm:"size:100;not null;uniqueIndex" json:"name"` // 接口名称
	BaseURL     string `gorm:"size:500;not null" json:"base_url"`         // API端点URL
	APIKey      string `gorm:"size:500;not null" json:"api_key"`          // API密钥
	Provider    string `gorm:"size:50" json:"provider"`                   // 提供商
	Description string `gorm:"type:text" json:"description"`              // 描述
	IsActive    bool   `gorm:"default:true" json:"is_active"`             // 是否启用
}

// TableName 指定表名
func (APIEndpoint) TableName() string {
	return "api_endpoints"
}

// APIEndpointRepository 接口仓储
type APIEndpointRepository struct {
	db *gorm.DB
}

// NewAPIEndpointRepository 创建接口仓储
func NewAPIEndpointRepository(db *gorm.DB) *APIEndpointRepository {
	return &APIEndpointRepository{db: db}
}

// Create 创建接口
func (r *APIEndpointRepository) Create(endpoint *APIEndpoint) error {
	return r.db.Create(endpoint).Error
}

// GetByID 根据ID获取接口
func (r *APIEndpointRepository) GetByID(id uint) (*APIEndpoint, error) {
	var endpoint APIEndpoint
	err := r.db.First(&endpoint, id).Error
	if err != nil {
		return nil, err
	}
	return &endpoint, nil
}

// GetByName 根据名称获取接口
func (r *APIEndpointRepository) GetByName(name string) (*APIEndpoint, error) {
	var endpoint APIEndpoint
	err := r.db.Where("name = ?", name).First(&endpoint).Error
	if err != nil {
		return nil, err
	}
	return &endpoint, nil
}

// GetAll 获取所有接口
func (r *APIEndpointRepository) GetAll() ([]*APIEndpoint, error) {
	var endpoints []*APIEndpoint
	err := r.db.Where("is_active = ?", true).Order("created_at DESC").Find(&endpoints).Error
	return endpoints, err
}

// Update 更新接口
func (r *APIEndpointRepository) Update(endpoint *APIEndpoint) error {
	return r.db.Save(endpoint).Error
}

// Delete 删除接口
func (r *APIEndpointRepository) Delete(id uint) error {
	return r.db.Delete(&APIEndpoint{}, id).Error
}
