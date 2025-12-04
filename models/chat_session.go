package models

import (
	"time"

	"gorm.io/gorm"
)

// ChatSession 对话会话
type ChatSession struct {
	gorm.Model
	Title        string        `gorm:"size:200;not null" json:"title"`                 // 会话标题
	ConfigID     uint          `gorm:"not null" json:"config_id"`                      // 使用的模型配置ID
	Config       ModelConfig   `gorm:"foreignKey:ConfigID" json:"config"`              // 关联的配置
	Messages     []ChatMessage `gorm:"foreignKey:SessionID" json:"messages,omitempty"` // 会话消息
	LastActiveAt time.Time     `gorm:"not null" json:"last_active_at"`                 // 最后活跃时间
	IsActive     bool          `gorm:"default:true" json:"is_active"`                  // 是否启用
}

// TableName 指定表名
func (ChatSession) TableName() string {
	return "chat_sessions"
}

// ChatSessionRepository 会话仓储
type ChatSessionRepository struct {
	db *gorm.DB
}

// NewChatSessionRepository 创建会话仓储
func NewChatSessionRepository(db *gorm.DB) *ChatSessionRepository {
	return &ChatSessionRepository{db: db}
}

// Create 创建会话
func (r *ChatSessionRepository) Create(session *ChatSession) error {
	session.LastActiveAt = time.Now()
	return r.db.Create(session).Error
}

// GetByID 根据ID获取会话
func (r *ChatSessionRepository) GetByID(id uint) (*ChatSession, error) {
	var session ChatSession
	err := r.db.Preload("Config").Preload("Config.AIModel").Preload("Config.Endpoint").First(&session, id).Error
	if err != nil {
		return nil, err
	}
	return &session, nil
}

// GetWithMessages 获取会话及其消息
func (r *ChatSessionRepository) GetWithMessages(id uint, limit int) (*ChatSession, error) {
	var session ChatSession
	query := r.db.Preload("Config").Preload("Config.AIModel").Preload("Config.Endpoint")

	if limit > 0 {
		// 获取最近N条消息
		query = query.Preload("Messages", func(db *gorm.DB) *gorm.DB {
			return db.Order("created_at DESC").Limit(limit)
		})
	} else {
		query = query.Preload("Messages")
	}

	err := query.First(&session, id).Error
	if err != nil {
		return nil, err
	}
	return &session, nil
}

// GetAll 获取所有会话
func (r *ChatSessionRepository) GetAll() ([]*ChatSession, error) {
	var sessions []*ChatSession
	err := r.db.Preload("Config").Preload("Config.AIModel").Order("last_active_at DESC").Find(&sessions).Error
	return sessions, err
}

// Update 更新会话
func (r *ChatSessionRepository) Update(session *ChatSession) error {
	return r.db.Save(session).Error
}

// UpdateLastActive 更新最后活跃时间
func (r *ChatSessionRepository) UpdateLastActive(id uint) error {
	return r.db.Model(&ChatSession{}).Where("id = ?", id).Update("last_active_at", time.Now()).Error
}

// Delete 删除会话（软删除）
func (r *ChatSessionRepository) Delete(id uint) error {
	return r.db.Delete(&ChatSession{}, id).Error
}

// Clear 清空会话消息
func (r *ChatSessionRepository) Clear(id uint) error {
	return r.db.Where("session_id = ?", id).Delete(&ChatMessage{}).Error
}
