package models

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// HistoryVersion 文件的一个历史版本
type HistoryVersion struct {
	ID          int       `json:"id"`
	IsSnapshot  bool      `json:"is_snapshot"`
	Content     string    `json:"content,omitempty"`    // 完整内容（仅快照）
	DiffPatch   string    `json:"diff_patch,omitempty"` // diff补丁（仅增量）
	BaseVersion int       `json:"base_version"`         // 基于哪个版本（-1表示无依赖）
	Timestamp   time.Time `json:"timestamp"`
	Description string    `json:"description"` // 描述（如"Accept修改3"）
	Size        int64     `json:"size"`        // 存储大小
}

// FileHistory 单个文件的历史记录
type FileHistory struct {
	FilePath string           `json:"file_path"`
	Versions []HistoryVersion `json:"versions"`
}

// FileHistoryManager 文件历史管理器
type FileHistoryManager struct {
	histories map[string]*FileHistory // file_path -> history
	mutex     sync.RWMutex
	dataDir   string
}

var historyManager *FileHistoryManager
var historyOnce sync.Once

// GetFileHistoryManager 获取全局历史管理器
func GetFileHistoryManager() *FileHistoryManager {
	historyOnce.Do(func() {
		dataDir := ".file_history"
		os.MkdirAll(dataDir, 0755)

		historyManager = &FileHistoryManager{
			histories: make(map[string]*FileHistory),
			dataDir:   dataDir,
		}

		// 启动时加载
		historyManager.Load()
	})
	return historyManager
}

// BackupAndAddVersion 备份当前文件并添加版本
func (m *FileHistoryManager) BackupAndAddVersion(filePath, description string) error {
	// 读取当前磁盘文件
	content, err := os.ReadFile(filePath)
	if err != nil {
		return fmt.Errorf("读取文件失败: %v", err)
	}

	return m.AddVersion(filePath, string(content), description)
}

// AddVersion 添加新版本
func (m *FileHistoryManager) AddVersion(filePath, content, description string) error {
	m.mutex.Lock()
	defer m.mutex.Unlock()

	// 获取或创建文件历史
	history, exists := m.histories[filePath]
	if !exists {
		history = &FileHistory{
			FilePath: filePath,
			Versions: []HistoryVersion{},
		}
		m.histories[filePath] = history
	}

	versionID := len(history.Versions) + 1

	// 每10个版本创建一个快照
	if versionID%10 == 1 {
		// 创建快照
		version := HistoryVersion{
			ID:          versionID,
			IsSnapshot:  true,
			Content:     content,
			BaseVersion: -1,
			Timestamp:   time.Now(),
			Description: description,
			Size:        int64(len(content)),
		}
		history.Versions = append(history.Versions, version)
	} else {
		// 创建增量diff
		if len(history.Versions) == 0 {
			// 第一个版本，创建快照
			version := HistoryVersion{
				ID:          1,
				IsSnapshot:  true,
				Content:     content,
				BaseVersion: -1,
				Timestamp:   time.Now(),
				Description: description,
				Size:        int64(len(content)),
			}
			history.Versions = append(history.Versions, version)
		} else {
			// 获取base内容
			baseVersion := history.Versions[len(history.Versions)-1]
			baseContent := m.reconstructVersionLocked(history, baseVersion.ID)

			// 计算diff
			diffPatch := computeDiff(baseContent, content)

			version := HistoryVersion{
				ID:          versionID,
				IsSnapshot:  false,
				DiffPatch:   diffPatch,
				BaseVersion: baseVersion.ID,
				Timestamp:   time.Now(),
				Description: description,
				Size:        int64(len(diffPatch)),
			}
			history.Versions = append(history.Versions, version)
		}
	}

	// 保存到磁盘
	return m.saveLocked()
}

// ReconstructVersion 重建指定版本的内容
func (m *FileHistoryManager) ReconstructVersion(filePath string, versionID int) (string, error) {
	m.mutex.RLock()
	defer m.mutex.RUnlock()

	history, exists := m.histories[filePath]
	if !exists {
		return "", fmt.Errorf("文件没有历史记录")
	}

	return m.reconstructVersionLocked(history, versionID), nil
}

// reconstructVersionLocked 内部重建版本（已加锁）
func (m *FileHistoryManager) reconstructVersionLocked(history *FileHistory, versionID int) string {
	if versionID < 1 || versionID > len(history.Versions) {
		return ""
	}

	version := history.Versions[versionID-1]

	// 如果是快照，直接返回
	if version.IsSnapshot {
		return version.Content
	}

	// 递归重建base版本
	baseContent := m.reconstructVersionLocked(history, version.BaseVersion)

	// 应用diff补丁
	result := applyPatch(baseContent, version.DiffPatch)
	return result
}

// GetVersionList 获取文件的版本列表
func (m *FileHistoryManager) GetVersionList(filePath string) []HistoryVersion {
	m.mutex.RLock()
	defer m.mutex.RUnlock()

	history, exists := m.histories[filePath]
	if !exists {
		return nil
	}

	return history.Versions
}

// Save 保存到JSON文件
func (m *FileHistoryManager) Save() error {
	m.mutex.Lock()
	defer m.mutex.Unlock()
	return m.saveLocked()
}

func (m *FileHistoryManager) saveLocked() error {
	indexPath := filepath.Join(m.dataDir, "history_index.json")

	data, err := json.MarshalIndent(m.histories, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(indexPath, data, 0644)
}

// Load 从JSON文件加载
func (m *FileHistoryManager) Load() error {
	indexPath := filepath.Join(m.dataDir, "history_index.json")

	data, err := os.ReadFile(indexPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil // 文件不存在是正常的
		}
		return err
	}

	m.mutex.Lock()
	defer m.mutex.Unlock()

	return json.Unmarshal(data, &m.histories)
}

// computeDiff 计算两个文本的diff（简单的逐行diff）
func computeDiff(oldText, newText string) string {
	// 使用简单的unified diff格式
	// 实际项目可以使用更高效的算法

	// 这里使用简单的方式：存储完整的新文本作为diff
	// TODO: 可以优化为真正的diff算法
	return newText
}

// applyPatch 应用diff补丁
func applyPatch(baseText, patch string) string {
	// 由于computeDiff存储的是完整文本，直接返回
	// TODO: 如果使用真正的diff算法，这里需要相应实现
	return patch
}
