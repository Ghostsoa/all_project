package tools

import "all_project/storage"

// ========== 文件操作工具定义（拆分后的独立工具） ==========

// GetReadFileDefinition 读取文件工具
func GetReadFileDefinition() map[string]interface{} {
	return map[string]interface{}{
		"type": "function",
		"function": map[string]interface{}{
			"name":        "read_file",
			"description": "读取文件内容。支持读取整个文件或指定行范围。",
			"parameters": map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"file_path": map[string]interface{}{
						"type":        "string",
						"description": "文件的绝对路径",
					},
					"server_id": map[string]interface{}{
						"type":        "string",
						"description": "服务器ID（local=本地）",
					},
					"offset": map[string]interface{}{
						"type":        "integer",
						"description": "起始行号（1-indexed，可选）",
					},
					"limit": map[string]interface{}{
						"type":        "integer",
						"description": "读取行数（可选，最大1000行）",
					},
				},
				"required": []string{"file_path", "server_id"},
			},
		},
	}
}

// GetWriteFileDefinition 写入文件工具
func GetWriteFileDefinition() map[string]interface{} {
	return map[string]interface{}{
		"type": "function",
		"function": map[string]interface{}{
			"name":        "write_file",
			"description": "写入或创建文件。会覆盖已存在的文件。",
			"parameters": map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"file_path": map[string]interface{}{
						"type":        "string",
						"description": "文件的绝对路径",
					},
					"content": map[string]interface{}{
						"type":        "string",
						"description": "要写入的文件内容",
					},
					"server_id": map[string]interface{}{
						"type":        "string",
						"description": "服务器ID（local=本地）",
					},
				},
				"required": []string{"file_path", "content", "server_id"},
			},
		},
	}
}

// GetEditFileDefinition 编辑文件工具
func GetEditFileDefinition() map[string]interface{} {
	return map[string]interface{}{
		"type": "function",
		"function": map[string]interface{}{
			"name":        "edit_file",
			"description": "精确替换文件中的内容。使用字符串匹配替换（需要完全匹配）。",
			"parameters": map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"file_path": map[string]interface{}{
						"type":        "string",
						"description": "文件的绝对路径",
					},
					"old_string": map[string]interface{}{
						"type":        "string",
						"description": "要替换的旧内容（必须完全匹配，包括空格和换行）",
					},
					"new_string": map[string]interface{}{
						"type":        "string",
						"description": "新内容",
					},
					"server_id": map[string]interface{}{
						"type":        "string",
						"description": "服务器ID（local=本地）",
					},
				},
				"required": []string{"file_path", "old_string", "new_string", "server_id"},
			},
		},
	}
}

// GetListDirectoryDefinition 列出目录工具
func GetListDirectoryDefinition() map[string]interface{} {
	return map[string]interface{}{
		"type": "function",
		"function": map[string]interface{}{
			"name":        "list_directory",
			"description": "列出目录中的文件和子目录。",
			"parameters": map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"directory_path": map[string]interface{}{
						"type":        "string",
						"description": "目录的绝对路径",
					},
					"server_id": map[string]interface{}{
						"type":        "string",
						"description": "服务器ID（local=本地）",
					},
				},
				"required": []string{"directory_path", "server_id"},
			},
		},
	}
}

// GetGrepSearchDefinition grep搜索工具
func GetGrepSearchDefinition() map[string]interface{} {
	return map[string]interface{}{
		"type": "function",
		"function": map[string]interface{}{
			"name":        "grep_search",
			"description": "在文件中搜索文本内容。支持正则表达式和文件类型过滤。",
			"parameters": map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"query": map[string]interface{}{
						"type":        "string",
						"description": "搜索内容或正则表达式",
					},
					"search_path": map[string]interface{}{
						"type":        "string",
						"description": "搜索目录的绝对路径",
					},
					"server_id": map[string]interface{}{
						"type":        "string",
						"description": "服务器ID（local=本地）",
					},
					"is_regex": map[string]interface{}{
						"type":        "boolean",
						"description": "是否将query作为正则表达式（默认false）",
					},
					"includes": map[string]interface{}{
						"type": "array",
						"items": map[string]interface{}{
							"type": "string",
						},
						"description": "文件类型过滤（如 [\"*.go\", \"*.js\"]）",
					},
				},
				"required": []string{"query", "search_path", "server_id"},
			},
		},
	}
}

// GetFindFilesDefinition 查找文件工具
func GetFindFilesDefinition() map[string]interface{} {
	return map[string]interface{}{
		"type": "function",
		"function": map[string]interface{}{
			"name":        "find_files",
			"description": "按文件名模式查找文件。支持glob模式匹配。",
			"parameters": map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"pattern": map[string]interface{}{
						"type":        "string",
						"description": "文件名匹配模式（glob格式，如 *.go 或 test_*.js）",
					},
					"search_path": map[string]interface{}{
						"type":        "string",
						"description": "搜索目录的绝对路径",
					},
					"server_id": map[string]interface{}{
						"type":        "string",
						"description": "服务器ID（local=本地）",
					},
					"max_depth": map[string]interface{}{
						"type":        "integer",
						"description": "最大搜索深度（可选）",
					},
					"excludes": map[string]interface{}{
						"type": "array",
						"items": map[string]interface{}{
							"type": "string",
						},
						"description": "排除的目录模式（如 [\"node_modules\", \".git\"]）",
					},
				},
				"required": []string{"pattern", "search_path", "server_id"},
			},
		},
	}
}

// GetCodeSearchToolsForSubAgent 获取code_search子代理使用的工具定义
func GetCodeSearchToolsForSubAgent() []map[string]interface{} {
	return []map[string]interface{}{
		// search_files: 并行搜索工具
		{
			"type": "function",
			"function": map[string]interface{}{
				"name": "search_files",
				"description": "并行执行多个文件搜索操作。支持grep搜索和read读取。\n" +
					"每次调用可以同时执行多个操作，提高搜索效率。",
				"parameters": map[string]interface{}{
					"type": "object",
					"properties": map[string]interface{}{
						"operations": map[string]interface{}{
							"type":        "array",
							"description": "并行执行的操作列表。可以混合grep和read操作。",
							"items": map[string]interface{}{
								"type": "object",
								"properties": map[string]interface{}{
									"type": map[string]interface{}{
										"type":        "string",
										"enum":        []string{"grep", "read"},
										"description": "操作类型：grep搜索 或 read读取文件",
									},
									"query": map[string]interface{}{
										"type":        "string",
										"description": "【仅grep】搜索内容或正则表达式",
									},
									"search_path": map[string]interface{}{
										"type":        "string",
										"description": "【仅grep】搜索目录路径",
									},
									"is_regex": map[string]interface{}{
										"type":        "boolean",
										"description": "【仅grep】是否作为正则表达式",
									},
									"includes": map[string]interface{}{
										"type": "array",
										"items": map[string]interface{}{
											"type": "string",
										},
										"description": "【仅grep】文件类型过滤，如 [\"*.go\", \"*.js\"]",
									},
									"file_path": map[string]interface{}{
										"type":        "string",
										"description": "【仅read】要读取的文件路径",
									},
									"offset": map[string]interface{}{
										"type":        "integer",
										"description": "【仅read】起始行号（1-indexed），与limit配合使用",
									},
									"limit": map[string]interface{}{
										"type":        "integer",
										"description": "【仅read】读取行数（最大1000行），与offset配合使用",
									},
								},
								"required": []string{"type"},
							},
						},
						"server_id": map[string]interface{}{
							"type":        "string",
							"description": "服务器ID（通常为local）",
						},
					},
					"required": []string{"operations"},
				},
			},
		},
		// submit_results: 提交最终结果并退出
		{
			"type": "function",
			"function": map[string]interface{}{
				"name":        "submit_results",
				"description": "提交搜索结果并结束code_search。提交5-10个最相关的代码片段（文件路径+行号范围）。",
				"parameters": map[string]interface{}{
					"type": "object",
					"properties": map[string]interface{}{
						"snippets": map[string]interface{}{
							"type":        "array",
							"description": "最相关的代码片段列表（5-10个，按相关性排序）",
							"items": map[string]interface{}{
								"type": "object",
								"properties": map[string]interface{}{
									"file_path": map[string]interface{}{
										"type":        "string",
										"description": "文件的绝对路径",
									},
									"start_line": map[string]interface{}{
										"type":        "integer",
										"description": "起始行号（1-indexed）。如果为0表示整个文件。",
									},
									"end_line": map[string]interface{}{
										"type":        "integer",
										"description": "结束行号（包含）。如果为0表示整个文件。",
									},
								},
								"required": []string{"file_path", "start_line", "end_line"},
							},
						},
					},
					"required": []string{"snippets"},
				},
			},
		},
	}
}

// GetCodeSearchDefinition 获取code_search工具定义（给主模型使用）
func GetCodeSearchDefinition(config *storage.AIConfig) map[string]interface{} {
	return map[string]interface{}{
		"type": "function",
		"function": map[string]interface{}{
			"name":        "code_search",
			"description": "智能代码搜索。使用AI子代理进行多轮语义搜索，返回最相关的代码片段。",
			"parameters": map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"search_folder": map[string]interface{}{
						"type":        "string",
						"description": "搜索目录的绝对路径",
					},
					"search_query": map[string]interface{}{
						"type":        "string",
						"description": "自然语言查询（描述要查找的功能或代码）",
					},
					"server_id": map[string]interface{}{
						"type":        "string",
						"description": "服务器ID（local=本地）",
					},
				},
				"required": []string{"search_folder", "search_query", "server_id"},
			},
		},
	}
}
