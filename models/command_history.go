package models

import (
	"time"

	"gorm.io/gorm"
)

// CommandHistory 命令历史记录
type CommandHistory struct {
	ID        uint           `gorm:"primarykey" json:"id"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"-"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
	ServerID  uint           `gorm:"not null;index" json:"server_id"`
	Command   string         `gorm:"type:text;not null" json:"command"`
}

// TableName 指定表名
func (CommandHistory) TableName() string {
	return "command_histories"
}

// CommandHistoryRepository 命令历史仓储
type CommandHistoryRepository struct {
	db *gorm.DB
}

// NewCommandHistoryRepository 创建命令历史仓储
func NewCommandHistoryRepository(db *gorm.DB) *CommandHistoryRepository {
	return &CommandHistoryRepository{db: db}
}

// Create 创建命令记录
func (r *CommandHistoryRepository) Create(history *CommandHistory) error {
	return r.db.Create(history).Error
}

// GetByServerID 获取指定服务器的命令历史
func (r *CommandHistoryRepository) GetByServerID(serverID uint, limit int) ([]*CommandHistory, error) {
	var histories []*CommandHistory
	query := r.db.Where("server_id = ?", serverID).Order("created_at DESC")

	if limit > 0 {
		query = query.Limit(limit)
	}

	err := query.Find(&histories).Error
	if err != nil {
		return nil, err
	}

	return histories, nil
}

// DeleteByServerID 删除指定服务器的所有命令历史
func (r *CommandHistoryRepository) DeleteByServerID(serverID uint) error {
	return r.db.Where("server_id = ?", serverID).Delete(&CommandHistory{}).Error
}

// GetRecent 获取最近的命令（所有服务器）
func (r *CommandHistoryRepository) GetRecent(limit int) ([]*CommandHistory, error) {
	var histories []*CommandHistory
	err := r.db.Order("created_at DESC").Limit(limit).Find(&histories).Error
	if err != nil {
		return nil, err
	}
	return histories, nil
}
