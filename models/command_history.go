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
	ServerID  uint           `gorm:"not null;index:idx_server_command" json:"server_id"`
	Command   string         `gorm:"type:text;not null;index:idx_server_command" json:"command"`
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

// Create 创建命令记录（去重：相同命令只更新时间）
func (r *CommandHistoryRepository) Create(history *CommandHistory) error {
	// 查询是否已存在相同的命令
	var existing CommandHistory
	err := r.db.Where("server_id = ? AND command = ?", history.ServerID, history.Command).First(&existing).Error

	if err == nil {
		// 找到了，更新时间
		return r.db.Model(&existing).Update("created_at", time.Now()).Error
	}

	if err == gorm.ErrRecordNotFound {
		// 没找到，创建新记录
		return r.db.Create(history).Error
	}

	// 其他错误
	return err
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
