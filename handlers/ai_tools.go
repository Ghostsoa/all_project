package handlers

import (
	"all_project/handlers/tools"
	"all_project/storage"
	"fmt"
)

// ToolExecutor 统一的工具执行器
type ToolExecutor struct {
	// 不需要保存任何状态，所有确认逻辑由前端处理
}

// NewToolExecutor 创建工具执行器
func NewToolExecutor() *ToolExecutor {
	return &ToolExecutor{}
}

// Execute 执行工具调用
func (te *ToolExecutor) Execute(toolName string, argsJSON string, conversationID string, messageID string) (string, error) {
	switch toolName {
	// 新的独立文件操作工具
	case "read_file":
		return tools.ExecuteReadFile(argsJSON, conversationID)
	case "write_file":
		return tools.ExecuteWriteFile(argsJSON, conversationID, messageID)
	case "edit_file":
		return tools.ExecuteEditFile(argsJSON, conversationID, messageID)
	case "list_directory":
		return tools.ExecuteListDirectory(argsJSON)
	case "grep_search":
		return tools.ExecuteGrepSearch(argsJSON)
	case "find_files":
		return tools.ExecuteFindFiles(argsJSON)

	// 高级搜索工具
	case "code_search":
		// 获取AI配置
		config, err := storage.GetAIConfig()
		if err != nil {
			return "", fmt.Errorf("获取AI配置失败: %v", err)
		}
		return tools.ExecuteCodeSearch(argsJSON, config, conversationID)

	// 百度搜索
	case "baidu_search":
		return tools.ExecuteBaiduSearch(argsJSON)

	// URL内容读取
	case "read_url_content":
		return tools.ExecuteReadURLContent(argsJSON)

	// 方法定义查找
	case "find_method":
		return tools.ExecuteFindMethod(argsJSON)

	default:
		return "", fmt.Errorf("未知工具: %s", toolName)
	}
}

// GetToolsDefinition 获取工具定义（发送给AI）
// 根据config.CodeSearchModel动态决定是否包含code_search工具
func GetToolsDefinition(config *storage.AIConfig) []map[string]interface{} {
	toolDefs := []map[string]interface{}{}

	// 添加文件操作工具（拆分为6个独立工具）
	toolDefs = append(toolDefs, tools.GetReadFileDefinition())
	toolDefs = append(toolDefs, tools.GetWriteFileDefinition())
	toolDefs = append(toolDefs, tools.GetEditFileDefinition())
	toolDefs = append(toolDefs, tools.GetListDirectoryDefinition())
	toolDefs = append(toolDefs, tools.GetGrepSearchDefinition())
	toolDefs = append(toolDefs, tools.GetFindFilesDefinition())

	// 如果配置了CodeSearchModel，添加code_search工具
	// 暂时禁用 code_search 工具（用于测试上下文管理）
	// if config != nil && config.CodeSearchModel != "" {
	// 	toolDefs = append(toolDefs, tools.GetCodeSearchDefinition(config))
	// }

	// 如果配置了BaiduSearchAPIKey，添加baidu_search工具
	if config != nil && config.BaiduSearchAPIKey != "" {
		toolDefs = append(toolDefs, tools.GetBaiduSearchDefinition())
	}

	// 添加URL内容读取工具
	toolDefs = append(toolDefs, tools.GetReadURLContentDefinition())

	// 添加方法定义查找工具
	toolDefs = append(toolDefs, tools.GetFindMethodDefinition())

	return toolDefs
}
