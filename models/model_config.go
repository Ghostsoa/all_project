package models

import (
	"gorm.io/gorm"
)

// ModelConfig 模型配置
type ModelConfig struct {
	gorm.Model
	Name             string      `gorm:"size:100;not null;uniqueIndex" json:"name"` // 配置名称
	ModelID          uint        `gorm:"not null" json:"model_id"`                  // 关联的模型ID
	AIModel          AIModel     `gorm:"foreignKey:ModelID" json:"ai_model"`        // 关联的模型
	EndpointID       uint        `gorm:"not null" json:"endpoint_id"`               // 关联的API接口ID
	Endpoint         APIEndpoint `gorm:"foreignKey:EndpointID" json:"endpoint"`     // 关联的接口
	Temperature      float32     `gorm:"default:0.7" json:"temperature"`            // 温度参数
	MaxTokens        int         `gorm:"default:4096" json:"max_tokens"`            // 最大tokens
	TopP             float32     `gorm:"default:1.0" json:"top_p"`                  // Top P参数
	FrequencyPenalty float32     `gorm:"default:0.0" json:"frequency_penalty"`      // 频率惩罚
	PresencePenalty  float32     `gorm:"default:0.0" json:"presence_penalty"`       // 存在惩罚
	SystemPrompt     string      `gorm:"type:text" json:"system_prompt"`            // 系统提示词
	MaxHistoryRounds int         `gorm:"default:10" json:"max_history_rounds"`      // 最大历史轮数
	IsDefault        bool        `gorm:"default:false" json:"is_default"`           // 是否为默认配置
	IsActive         bool        `gorm:"default:true" json:"is_active"`             // 是否启用
}

// TableName 指定表名
func (ModelConfig) TableName() string {
	return "model_configs"
}

// ModelConfigRepository 配置仓储
type ModelConfigRepository struct {
	db *gorm.DB
}

// NewModelConfigRepository 创建配置仓储
func NewModelConfigRepository(db *gorm.DB) *ModelConfigRepository {
	return &ModelConfigRepository{db: db}
}

// Create 创建配置
func (r *ModelConfigRepository) Create(config *ModelConfig) error {
	return r.db.Create(config).Error
}

// GetByID 根据ID获取配置
func (r *ModelConfigRepository) GetByID(id uint) (*ModelConfig, error) {
	var config ModelConfig
	err := r.db.Preload("AIModel").Preload("Endpoint").First(&config, id).Error
	if err != nil {
		return nil, err
	}
	return &config, nil
}

// GetDefault 获取默认配置
func (r *ModelConfigRepository) GetDefault() (*ModelConfig, error) {
	var config ModelConfig
	err := r.db.Preload("AIModel").Preload("Endpoint").Where("is_default = ? AND is_active = ?", true, true).First(&config).Error
	if err != nil {
		return nil, err
	}
	return &config, nil
}

// GetAll 获取所有配置
func (r *ModelConfigRepository) GetAll() ([]*ModelConfig, error) {
	var configs []*ModelConfig
	err := r.db.Preload("AIModel").Preload("Endpoint").Where("is_active = ?", true).Order("is_default DESC, created_at DESC").Find(&configs).Error
	return configs, err
}

// Update 更新配置
func (r *ModelConfigRepository) Update(config *ModelConfig) error {
	return r.db.Save(config).Error
}

// SetDefault 设置为默认配置
func (r *ModelConfigRepository) SetDefault(id uint) error {
	// 先取消所有默认配置
	if err := r.db.Model(&ModelConfig{}).Where("is_default = ?", true).Update("is_default", false).Error; err != nil {
		return err
	}
	// 设置新的默认配置
	return r.db.Model(&ModelConfig{}).Where("id = ?", id).Update("is_default", true).Error
}

// Delete 删除配置
func (r *ModelConfigRepository) Delete(id uint) error {
	return r.db.Delete(&ModelConfig{}, id).Error
}
