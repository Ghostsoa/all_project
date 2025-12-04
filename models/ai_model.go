package models

import (
	"gorm.io/gorm"
)

// AIModel AI模型定义
type AIModel struct {
	gorm.Model
	Name        string `gorm:"size:100;not null;uniqueIndex" json:"name"` // 模型名称，如 gpt-4, deepseek-chat
	DisplayName string `gorm:"size:200" json:"display_name"`              // 显示名称
	Provider    string `gorm:"size:50" json:"provider"`                   // 提供商，如 openai, deepseek
	Description string `gorm:"type:text" json:"description"`              // 描述
	IsActive    bool   `gorm:"default:true" json:"is_active"`             // 是否启用
}

// TableName 指定表名
func (AIModel) TableName() string {
	return "ai_models"
}

// AIModelRepository 模型仓储
type AIModelRepository struct {
	db *gorm.DB
}

// NewAIModelRepository 创建模型仓储
func NewAIModelRepository(db *gorm.DB) *AIModelRepository {
	return &AIModelRepository{db: db}
}

// Create 创建模型
func (r *AIModelRepository) Create(model *AIModel) error {
	return r.db.Create(model).Error
}

// GetByID 根据ID获取模型
func (r *AIModelRepository) GetByID(id uint) (*AIModel, error) {
	var model AIModel
	err := r.db.First(&model, id).Error
	if err != nil {
		return nil, err
	}
	return &model, nil
}

// GetByName 根据名称获取模型
func (r *AIModelRepository) GetByName(name string) (*AIModel, error) {
	var model AIModel
	err := r.db.Where("name = ?", name).First(&model).Error
	if err != nil {
		return nil, err
	}
	return &model, nil
}

// GetAll 获取所有模型
func (r *AIModelRepository) GetAll() ([]*AIModel, error) {
	var models []*AIModel
	err := r.db.Where("is_active = ?", true).Order("created_at DESC").Find(&models).Error
	return models, err
}

// Update 更新模型
func (r *AIModelRepository) Update(model *AIModel) error {
	return r.db.Save(model).Error
}

// Delete 删除模型
func (r *AIModelRepository) Delete(id uint) error {
	return r.db.Delete(&AIModel{}, id).Error
}
