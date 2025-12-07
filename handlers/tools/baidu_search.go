package tools

import (
	"all_project/storage"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// ========== 百度搜索工具定义 ==========

// GetBaiduSearchDefinition 百度搜索工具定义
func GetBaiduSearchDefinition() map[string]interface{} {
	return map[string]interface{}{
		"type": "function",
		"function": map[string]interface{}{
			"name":        "baidu_search",
			"description": "使用百度搜索获取实时信息。可以搜索网页、新闻、文章等内容。适合查询最新信息、事实核查、获取参考资料等场景。",
			"parameters": map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"query": map[string]interface{}{
						"type":        "string",
						"description": "搜索查询词，描述要搜索的内容",
					},
					"top_k": map[string]interface{}{
						"type":        "integer",
						"description": "返回结果数量，默认10，最大50",
					},
					"search_recency": map[string]interface{}{
						"type":        "string",
						"enum":        []string{"week", "month", "semiyear", "year"},
						"description": "时效性过滤：week(最近7天), month(最近30天), semiyear(最近180天), year(最近365天)",
					},
				},
				"required": []string{"query"},
			},
		},
	}
}

// ========== 百度搜索数据结构 ==========

type BaiduSearchParams struct {
	Query         string `json:"query"`
	TopK          int    `json:"top_k,omitempty"`
	SearchRecency string `json:"search_recency,omitempty"`
}

type baiduSearchRequest struct {
	Messages            []baiduMessage       `json:"messages"`
	SearchSource        string               `json:"search_source"`
	ResourceTypeFilter  []resourceTypeFilter `json:"resource_type_filter,omitempty"`
	SearchRecencyFilter string               `json:"search_recency_filter,omitempty"`
}

type baiduMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type resourceTypeFilter struct {
	Type string `json:"type"`
	TopK int    `json:"top_k"`
}

type baiduSearchResponse struct {
	RequestID  string      `json:"request_id"`
	References []reference `json:"references"`
	Code       string      `json:"code,omitempty"`
	Message    string      `json:"message,omitempty"`
}

type reference struct {
	ID             int     `json:"id"`
	Title          string  `json:"title"`
	URL            string  `json:"url"`
	Content        string  `json:"content"`
	Date           string  `json:"date,omitempty"`
	Type           string  `json:"type"`
	RerankScore    float64 `json:"rerank_score,omitempty"`
	AuthorityScore float64 `json:"authority_score,omitempty"`
}

// ========== 百度搜索执行 ==========

// ExecuteBaiduSearch 执行百度搜索
func ExecuteBaiduSearch(argsJSON string) (string, error) {
	// 解析参数
	var params BaiduSearchParams
	if err := json.Unmarshal([]byte(argsJSON), &params); err != nil {
		return "", fmt.Errorf("解析参数失败: %v", err)
	}

	// 验证参数
	if params.Query == "" {
		return "", fmt.Errorf("查询词不能为空")
	}

	// 获取百度搜索 API Key
	config, err := storage.GetAIConfig()
	if err != nil {
		return "", fmt.Errorf("获取AI配置失败: %v", err)
	}

	if config.BaiduSearchAPIKey == "" {
		return "⚠️ 百度搜索功能未配置：请在AI配置中添加 Baidu Search API Key", nil
	}

	// 调用百度搜索API
	result, err := callBaiduSearchAPI(config.BaiduSearchAPIKey, params)
	if err != nil {
		return "", fmt.Errorf("百度搜索失败: %v", err)
	}

	// 格式化结果
	return formatBaiduSearchResult(result), nil
}

// callBaiduSearchAPI 调用百度搜索API
func callBaiduSearchAPI(apiKey string, params BaiduSearchParams) (*baiduSearchResponse, error) {
	// 构建请求
	req := baiduSearchRequest{
		Messages: []baiduMessage{
			{
				Role:    "user",
				Content: params.Query,
			},
		},
		SearchSource: "baidu_search_v2",
	}

	// 设置返回数量
	topK := params.TopK
	if topK == 0 {
		topK = 10
	}
	if topK > 50 {
		topK = 50
	}

	req.ResourceTypeFilter = []resourceTypeFilter{
		{Type: "web", TopK: topK},
	}

	// 设置时效性
	if params.SearchRecency != "" {
		req.SearchRecencyFilter = params.SearchRecency
	}

	// 序列化请求
	reqBody, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("序列化请求失败: %v", err)
	}

	// 创建 HTTP 请求
	httpReq, err := http.NewRequest(
		"POST",
		"https://qianfan.baidubce.com/v2/ai_search/web_search",
		bytes.NewBuffer(reqBody),
	)
	if err != nil {
		return nil, fmt.Errorf("创建请求失败: %v", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("X-Appbuilder-Authorization", "Bearer "+apiKey)

	// 发送请求
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("请求失败: %v", err)
	}
	defer resp.Body.Close()

	// 读取响应
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取响应失败: %v", err)
	}

	// 解析响应
	var result baiduSearchResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("解析响应失败: %v, body: %s", err, string(body))
	}

	// 检查错误
	if result.Code != "" {
		return nil, fmt.Errorf("百度搜索API错误: %s - %s", result.Code, result.Message)
	}

	return &result, nil
}

// formatBaiduSearchResult 格式化搜索结果为文本
func formatBaiduSearchResult(result *baiduSearchResponse) string {
	if len(result.References) == 0 {
		return "未找到相关搜索结果"
	}

	var output bytes.Buffer
	output.WriteString(fmt.Sprintf("🔍 找到 %d 条搜索结果：\n\n", len(result.References)))

	for _, ref := range result.References {
		output.WriteString(fmt.Sprintf("[%d] %s\n", ref.ID, ref.Title))
		output.WriteString(fmt.Sprintf("🔗 %s\n", ref.URL))

		if ref.Date != "" {
			output.WriteString(fmt.Sprintf("📅 %s\n", ref.Date))
		}

		if ref.Content != "" {
			// 限制内容长度
			content := ref.Content
			if len(content) > 200 {
				content = content[:200] + "..."
			}
			output.WriteString(fmt.Sprintf("📄 %s\n", content))
		}

		output.WriteString("\n")
	}

	return output.String()
}
