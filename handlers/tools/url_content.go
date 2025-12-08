package tools

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	readability "github.com/go-shiori/go-readability"
)

// ========== URL 内容读取工具定义 ==========

// GetReadURLContentDefinition URL内容读取工具
func GetReadURLContentDefinition() map[string]interface{} {
	return map[string]interface{}{
		"type": "function",
		"function": map[string]interface{}{
			"name":        "read_url_content",
			"description": "智能读取URL内容。对于GitHub仓库自动获取README、仓库信息和目录结构；对于普通网页智能提取正文内容，去除广告和导航等噪音。",
			"parameters": map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"url": map[string]interface{}{
						"type":        "string",
						"description": "要读取的URL地址",
					},
					"max_length": map[string]interface{}{
						"type":        "integer",
						"description": "返回内容的最大字符数（可选，默认10000）",
					},
					"include_tree": map[string]interface{}{
						"type":        "boolean",
						"description": "对于GitHub仓库，是否包含完整目录结构（可选，默认true）",
					},
				},
				"required": []string{"url"},
			},
		},
	}
}

// ========== 数据结构 ==========

// URLContentParams 参数
type URLContentParams struct {
	URL         string `json:"url"`
	MaxLength   int    `json:"max_length,omitempty"`
	IncludeTree bool   `json:"include_tree,omitempty"`
}

// URLContentResult 返回结果
type URLContentResult struct {
	Type    string      `json:"type"` // "github_repo", "github_file", "web"
	URL     string      `json:"url"`
	Title   string      `json:"title"`
	Content string      `json:"content"`
	Meta    interface{} `json:"meta,omitempty"` // 额外的元数据
}

// GitHubRepoMeta GitHub仓库元数据
type GitHubRepoMeta struct {
	Owner       string   `json:"owner"`
	Repo        string   `json:"repo"`
	Description string   `json:"description,omitempty"`
	Stars       int      `json:"stars,omitempty"`
	Forks       int      `json:"forks,omitempty"`
	Language    string   `json:"language,omitempty"`
	Topics      []string `json:"topics,omitempty"`
	License     string   `json:"license,omitempty"`
	Tree        []string `json:"tree,omitempty"`
}

// GitHubFileMeta GitHub文件元数据
type GitHubFileMeta struct {
	Owner    string `json:"owner"`
	Repo     string `json:"repo"`
	Path     string `json:"path"`
	Size     int    `json:"size,omitempty"`
	Language string `json:"language,omitempty"`
}

// WebPageMeta 普通网页元数据
type WebPageMeta struct {
	Author   string `json:"author,omitempty"`
	Excerpt  string `json:"excerpt,omitempty"`
	SiteName string `json:"site_name,omitempty"`
}

// GitHub API 响应结构
type githubRepo struct {
	Name        string   `json:"name"`
	FullName    string   `json:"full_name"`
	Description string   `json:"description"`
	StarCount   int      `json:"stargazers_count"`
	ForkCount   int      `json:"forks_count"`
	Language    string   `json:"language"`
	Topics      []string `json:"topics"`
	License     *struct {
		Name string `json:"name"`
	} `json:"license"`
}

type githubContent struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	Type    string `json:"type"` // "file" or "dir"
	Size    int    `json:"size"`
	Content string `json:"content,omitempty"`
}

type githubReadme struct {
	Content string `json:"content"`
}

// ========== 工具执行 ==========

// ExecuteReadURLContent 执行URL内容读取
func ExecuteReadURLContent(argsJSON string) (string, error) {
	var params URLContentParams
	if err := json.Unmarshal([]byte(argsJSON), &params); err != nil {
		return "", fmt.Errorf("解析参数失败: %v", err)
	}

	if params.URL == "" {
		return "", fmt.Errorf("URL不能为空")
	}

	// 设置默认值
	if params.MaxLength == 0 {
		params.MaxLength = 10000
	}

	// 检测URL类型并处理
	urlType := detectURLType(params.URL)

	var result *URLContentResult
	var err error

	switch urlType {
	case "github_repo":
		result, err = fetchGitHubRepo(params)
	case "github_file":
		result, err = fetchGitHubFile(params)
	default:
		result, err = fetchWebPage(params)
	}

	if err != nil {
		return "", err
	}

	// 限制内容长度
	if len(result.Content) > params.MaxLength {
		result.Content = result.Content[:params.MaxLength] + "\n\n...(内容过长已截断)"
	}

	// 返回JSON结果
	jsonData, err := json.Marshal(result)
	if err != nil {
		return "", fmt.Errorf("序列化结果失败: %v", err)
	}

	return string(jsonData), nil
}

// ========== URL 类型检测 ==========

func detectURLType(url string) string {
	// GitHub 仓库主页: https://github.com/owner/repo
	repoPattern := regexp.MustCompile(`^https?://github\.com/([^/]+)/([^/]+)/?$`)
	if repoPattern.MatchString(url) {
		return "github_repo"
	}

	// GitHub 文件页面: https://github.com/owner/repo/blob/...
	filePattern := regexp.MustCompile(`^https?://github\.com/([^/]+)/([^/]+)/blob/`)
	if filePattern.MatchString(url) {
		return "github_file"
	}

	return "web"
}

// ========== GitHub 处理 ==========

func fetchGitHubRepo(params URLContentParams) (*URLContentResult, error) {
	owner, repo, err := parseGitHubURL(params.URL)
	if err != nil {
		return nil, err
	}

	client := &http.Client{Timeout: 30 * time.Second}

	// 1. 获取仓库信息
	repoInfo, err := getGitHubRepoInfo(client, owner, repo)
	if err != nil {
		return nil, fmt.Errorf("获取仓库信息失败: %v", err)
	}

	// 2. 获取 README
	readme, _ := getGitHubReadme(client, owner, repo)

	// 3. 获取目录结构（可选）
	var tree []string
	if params.IncludeTree {
		tree, _ = getGitHubTree(client, owner, repo)
	}

	// 构建元数据
	meta := GitHubRepoMeta{
		Owner:       owner,
		Repo:        repo,
		Description: repoInfo.Description,
		Stars:       repoInfo.StarCount,
		Forks:       repoInfo.ForkCount,
		Language:    repoInfo.Language,
		Topics:      repoInfo.Topics,
		Tree:        tree,
	}
	if repoInfo.License != nil {
		meta.License = repoInfo.License.Name
	}

	// 构建内容
	var content strings.Builder
	content.WriteString(fmt.Sprintf("# %s/%s\n\n", owner, repo))

	if repoInfo.Description != "" {
		content.WriteString(fmt.Sprintf("**描述**: %s\n\n", repoInfo.Description))
	}

	content.WriteString(fmt.Sprintf("**Stars**: %d | **Forks**: %d", repoInfo.StarCount, repoInfo.ForkCount))
	if repoInfo.Language != "" {
		content.WriteString(fmt.Sprintf(" | **语言**: %s", repoInfo.Language))
	}
	content.WriteString("\n\n")

	if len(repoInfo.Topics) > 0 {
		content.WriteString(fmt.Sprintf("**主题**: %s\n\n", strings.Join(repoInfo.Topics, ", ")))
	}

	if readme != "" {
		content.WriteString("---\n\n## README\n\n")
		content.WriteString(readme)
	}

	if len(tree) > 0 {
		content.WriteString("\n\n---\n\n## 目录结构\n\n```\n")
		for _, path := range tree {
			content.WriteString(path + "\n")
		}
		content.WriteString("```\n")
	}

	return &URLContentResult{
		Type:    "github_repo",
		URL:     params.URL,
		Title:   fmt.Sprintf("%s/%s", owner, repo),
		Content: content.String(),
		Meta:    meta,
	}, nil
}

func fetchGitHubFile(params URLContentParams) (*URLContentResult, error) {
	// 解析文件URL: https://github.com/owner/repo/blob/branch/path
	re := regexp.MustCompile(`github\.com/([^/]+)/([^/]+)/blob/([^/]+)/(.+)`)
	matches := re.FindStringSubmatch(params.URL)
	if len(matches) < 5 {
		return nil, fmt.Errorf("无效的GitHub文件URL")
	}

	owner := matches[1]
	repo := matches[2]
	// branch := matches[3]
	path := matches[4]

	client := &http.Client{Timeout: 30 * time.Second}

	// 获取文件内容
	apiURL := fmt.Sprintf("https://api.github.com/repos/%s/%s/contents/%s", owner, repo, path)
	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github.v3+json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub API 返回错误: %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var fileContent githubContent
	if err := json.Unmarshal(body, &fileContent); err != nil {
		return nil, err
	}

	// Base64解码内容
	decodedContent := decodeBase64(fileContent.Content)

	meta := GitHubFileMeta{
		Owner: owner,
		Repo:  repo,
		Path:  path,
		Size:  fileContent.Size,
	}

	return &URLContentResult{
		Type:    "github_file",
		URL:     params.URL,
		Title:   path,
		Content: decodedContent,
		Meta:    meta,
	}, nil
}

// ========== GitHub API 辅助函数 ==========

func parseGitHubURL(url string) (string, string, error) {
	re := regexp.MustCompile(`github\.com/([^/]+)/([^/]+)`)
	matches := re.FindStringSubmatch(url)
	if len(matches) < 3 {
		return "", "", fmt.Errorf("无效的GitHub URL")
	}
	return matches[1], matches[2], nil
}

func getGitHubRepoInfo(client *http.Client, owner, repo string) (*githubRepo, error) {
	apiURL := fmt.Sprintf("https://api.github.com/repos/%s/%s", owner, repo)
	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github.v3+json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub API 返回错误: %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var repoInfo githubRepo
	if err := json.Unmarshal(body, &repoInfo); err != nil {
		return nil, err
	}

	return &repoInfo, nil
}

func getGitHubReadme(client *http.Client, owner, repo string) (string, error) {
	apiURL := fmt.Sprintf("https://api.github.com/repos/%s/%s/readme", owner, repo)
	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/vnd.github.v3.raw")

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("README不存在")
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	return string(body), nil
}

func getGitHubTree(client *http.Client, owner, repo string) ([]string, error) {
	apiURL := fmt.Sprintf("https://api.github.com/repos/%s/%s/contents", owner, repo)
	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github.v3+json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("获取目录失败")
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var contents []githubContent
	if err := json.Unmarshal(body, &contents); err != nil {
		return nil, err
	}

	var tree []string
	for _, item := range contents {
		if item.Type == "dir" {
			tree = append(tree, item.Name+"/")
		} else {
			tree = append(tree, item.Name)
		}
	}

	return tree, nil
}

func decodeBase64(encoded string) string {
	// 移除换行符
	encoded = strings.ReplaceAll(encoded, "\n", "")
	encoded = strings.ReplaceAll(encoded, "\r", "")

	// Base64 解码
	decoded, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return encoded
	}
	return string(decoded)
}

// ========== 普通网页处理 ==========

func fetchWebPage(params URLContentParams) (*URLContentResult, error) {
	article, err := readability.FromURL(params.URL, 30*time.Second)
	if err != nil {
		return nil, fmt.Errorf("网页解析失败: %v", err)
	}

	// 清理文本
	cleanText := cleanInvalidChars(article.TextContent)

	meta := WebPageMeta{
		Author:   cleanInvalidChars(article.Byline),
		Excerpt:  cleanInvalidChars(article.Excerpt),
		SiteName: cleanInvalidChars(article.SiteName),
	}

	return &URLContentResult{
		Type:    "web",
		URL:     params.URL,
		Title:   cleanInvalidChars(article.Title),
		Content: cleanText,
		Meta:    meta,
	}, nil
}

func cleanInvalidChars(text string) string {
	// 移除 Unicode 替换字符
	text = strings.ReplaceAll(text, "\ufffd", "")

	// 移除控制字符（保留换行、制表符）
	var cleaned strings.Builder
	for _, r := range text {
		if r >= 32 || r == '\n' || r == '\t' || r == '\r' {
			if r < 0xE000 || r > 0xF8FF {
				cleaned.WriteRune(r)
			}
		}
	}

	return strings.TrimSpace(cleaned.String())
}
