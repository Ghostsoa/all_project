package models

import (
	"gorm.io/gorm"
)

// Server SSH 服务器配置
type Server struct {
	gorm.Model
	Name        string `gorm:"size:100;not null;index" json:"name"`
	Host        string `gorm:"size:255;not null;index" json:"host"`
	Port        int    `gorm:"default:22;not null" json:"port"`
	Username    string `gorm:"size:100;not null" json:"username"`
	Password    string `gorm:"size:255" json:"password,omitempty"`
	AuthType    string `gorm:"size:20;default:'password';not null" json:"auth_type"` // password, privatekey
	PrivateKey  string `gorm:"type:text" json:"private_key,omitempty"`
	Description string `gorm:"type:text" json:"description"`
	Tags        string `gorm:"size:255" json:"tags"`
}

// TableName 指定表名
func (Server) TableName() string {
	return "servers"
}

// ServerRepository 服务器仓储
type ServerRepository struct {
	db *gorm.DB
}

// NewServerRepository 创建服务器仓储
func NewServerRepository(db *gorm.DB) *ServerRepository {
	return &ServerRepository{db: db}
}

// Create 创建服务器配置
func (r *ServerRepository) Create(server *Server) error {
	return r.db.Create(server).Error
}

// GetByID 根据ID获取服务器
func (r *ServerRepository) GetByID(id uint) (*Server, error) {
	var server Server
	err := r.db.First(&server, id).Error
	if err != nil {
		return nil, err
	}
	return &server, nil
}

// GetAll 获取所有服务器
func (r *ServerRepository) GetAll() ([]*Server, error) {
	var servers []*Server
	err := r.db.Order("created_at DESC").Find(&servers).Error
	if err != nil {
		return nil, err
	}

	// 清除敏感信息
	for _, server := range servers {
		server.Password = ""
		server.PrivateKey = ""
	}

	return servers, nil
}

// Update 更新服务器配置
func (r *ServerRepository) Update(server *Server) error {
	return r.db.Save(server).Error
}

// Delete 删除服务器
func (r *ServerRepository) Delete(id uint) error {
	return r.db.Delete(&Server{}, id).Error
}

// Search 搜索服务器
func (r *ServerRepository) Search(keyword string) ([]*Server, error) {
	var servers []*Server
	keyword = "%" + keyword + "%"

	err := r.db.Where(
		"name ILIKE ? OR host ILIKE ? OR description ILIKE ? OR tags ILIKE ?",
		keyword, keyword, keyword, keyword,
	).Order("created_at DESC").Find(&servers).Error

	if err != nil {
		return nil, err
	}

	// 清除敏感信息
	for _, server := range servers {
		server.Password = ""
		server.PrivateKey = ""
	}

	return servers, nil
}
