package tools

import "all_project/storage"

// GetFileOperationDefinition 获取file_operation工具定义
func GetFileOperationDefinition() map[string]interface{} {
	return map[string]interface{}{
		"type": "function",
		"function": map[string]interface{}{
			"name":        "file_operation",
			"description": "文件操作工具。支持read/write/edit/list/grep/find操作。",
			"parameters": map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"type": map[string]interface{}{
						"type":        "string",
						"enum":        []string{"read", "write", "edit", "list", "grep", "find"},
						"description": "操作类型",
					},
					"server_id": map[string]interface{}{
						"type":        "string",
						"description": "服务器ID（local=本地）",
					},
					"file_path": map[string]interface{}{
						"type":        "string",
						"description": "文件或目录的绝对路径",
					},
					"content": map[string]interface{}{
						"type":        "string",
						"description": "【write】文件内容",
					},
					"old_string": map[string]interface{}{
						"type":        "string",
						"description": "【edit】要替换的旧内容（需完全匹配）",
					},
					"new_string": map[string]interface{}{
						"type":        "string",
						"description": "【edit】新内容",
					},
					"query": map[string]interface{}{
						"type":        "string",
						"description": "【grep】搜索内容",
					},
					"search_path": map[string]interface{}{
						"type":        "string",
						"description": "【grep/find】搜索目录路径",
					},
					"is_regex": map[string]interface{}{
						"type":        "boolean",
						"description": "【grep】是否使用正则表达式",
					},
					"includes": map[string]interface{}{
						"type": "array",
						"items": map[string]interface{}{
							"type": "string",
						},
						"description": "【grep】文件类型过滤",
					},
					"pattern": map[string]interface{}{
						"type":        "string",
						"description": "【find】文件名匹配模式",
					},
					"max_depth": map[string]interface{}{
						"type":        "integer",
						"description": "【find】最大搜索深度",
					},
					"excludes": map[string]interface{}{
						"type": "array",
						"items": map[string]interface{}{
							"type": "string",
						},
						"description": "【find】排除的目录",
					},
					"offset": map[string]interface{}{
						"type":        "integer",
						"description": "【read】起始行号（1-indexed）",
					},
					"limit": map[string]interface{}{
						"type":        "integer",
						"description": "【read】读取行数",
					},
				},
				"required": []string{"type", "server_id"},
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
