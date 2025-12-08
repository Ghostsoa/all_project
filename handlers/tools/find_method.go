package tools

import (
	"encoding/json"
	"fmt"
	"strings"

	"golang.org/x/crypto/ssh"
)

// FindMethodRequest 查找方法定义的请求
type FindMethodRequest struct {
	MethodName string `json:"method_name"` // 方法名
	Directory  string `json:"directory"`   // 搜索目录
	ServerID   string `json:"server_id"`   // 服务器ID
}

// MethodDefinition 方法定义结果
type MethodDefinition struct {
	MethodName string `json:"method_name"` // 方法名
	FilePath   string `json:"file_path"`   // 文件路径
	StartLine  int    `json:"start_line"`  // 起始行号
	EndLine    int    `json:"end_line"`    // 结束行号
	Language   string `json:"language"`    // 语言类型
	Signature  string `json:"signature"`   // 方法签名
	Body       string `json:"body"`        // 完整方法体
}

// FindMethodResponse 查找方法定义的响应
type FindMethodResponse struct {
	Success bool               `json:"success"`
	Results []MethodDefinition `json:"results,omitempty"`
	Count   int                `json:"count"`
	Error   string             `json:"error,omitempty"`
}

// FindMethod 查找方法定义（纯 Bash 实现，通用性最强）
func FindMethod(sshClient *ssh.Client, req FindMethodRequest) FindMethodResponse {
	// 构建纯 Bash 脚本（不依赖 Python，通用性最强）
	script := buildBashFindMethodScript(req.MethodName, req.Directory)

	// 执行脚本
	output, err := executeSSHCommand(sshClient, script)
	if err != nil {
		return FindMethodResponse{
			Success: false,
			Error:   fmt.Sprintf("执行搜索失败: %v", err),
		}
	}

	// 解析结果
	results, err := parseFindMethodResults(output)
	if err != nil {
		return FindMethodResponse{
			Success: false,
			Error:   fmt.Sprintf("解析结果失败: %v", err),
		}
	}

	return FindMethodResponse{
		Success: true,
		Results: results,
		Count:   len(results),
	}
}

// buildBashFindMethodScript 构建纯 Bash 搜索脚本（通用性最强）
func buildBashFindMethodScript(methodName, directory string) string {
	// 转义特殊字符
	escapedMethod := strings.ReplaceAll(methodName, "'", "'\\''")
	escapedDir := strings.ReplaceAll(directory, "'", "'\\''")

	// 纯 Bash 脚本（支持 Go/Python/Java/JavaScript）
	script := fmt.Sprintf(`
set -e

METHOD='%s'
DIR='%s'

# 定义语言关键字模式
declare -A PATTERNS
PATTERNS["go"]="func $METHOD"
PATTERNS["py"]="def $METHOD"
PATTERNS["java"]="$METHOD("
PATTERNS["js"]="function $METHOD"

# 输出 JSON 数组开始
echo "["

first=true

# 遍历支持的文件类型
for ext in go py java js; do
    pattern="${PATTERNS[$ext]}"
    
    # Grep 搜索方法定义
    grep -rn "$pattern" "$DIR" --include="*.$ext" 2>/dev/null | while IFS=: read -r file line content; do
        
        # 检查是否是顶层函数（缩进 <= 4 个空格/1个tab）
        actual_line=$(sed -n "${line}p" "$file" 2>/dev/null || echo "")
        [ -z "$actual_line" ] && continue
        
        # 计算缩进
        indent=$(echo "$actual_line" | sed 's/[^ \t].*//' | wc -c)
        
        # 只处理顶层函数
        if [ "$indent" -le 5 ]; then
            
            # 提取方法签名（去除首尾空白）
            signature=$(echo "$actual_line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
            
            # 括号匹配找到方法结束位置
            end_line=$(awk -v start="$line" '
                BEGIN { count = 0; in_method = 0 }
                NR >= start {
                    for (i = 1; i <= length($0); i++) {
                        c = substr($0, i, 1)
                        if (c == "{") {
                            count++
                            in_method = 1
                        }
                        else if (c == "}") {
                            count--
                            if (count == 0 && in_method == 1) {
                                print NR
                                exit
                            }
                        }
                    }
                }
            ' "$file" 2>/dev/null || echo "$line")
            
            # 如果没找到结束，设置为起始行+50（避免读取整个文件）
            [ -z "$end_line" ] && end_line=$((line + 50))
            
            # 提取方法体（限制最大行数避免过大）
            max_lines=200
            actual_end=$((line + max_lines))
            [ "$end_line" -gt "$actual_end" ] && end_line=$actual_end
            
            # 读取方法体内容
            body=$(sed -n "${line},${end_line}p" "$file" 2>/dev/null | sed 's/"/\\"/g' | awk '{printf "%s\\n", $0}')
            
            # 检测语言
            case "$ext" in
                go) lang="go" ;;
                py) lang="python" ;;
                java) lang="java" ;;
                js) lang="javascript" ;;
                *) lang="unknown" ;;
            esac
            
            # 输出 JSON 对象
            if [ "$first" = true ]; then
                first=false
            else
                echo ","
            fi
            
            cat <<JSON
{
  "method_name": "$METHOD",
  "file_path": "$file",
  "start_line": $line,
  "end_line": $end_line,
  "language": "$lang",
  "signature": "$signature",
  "body": "$body"
}
JSON
        fi
    done
done

# 输出 JSON 数组结束
echo "]"
`, escapedMethod, escapedDir)

	return script
}

// parseFindMethodResults 解析搜索结果
func parseFindMethodResults(output string) ([]MethodDefinition, error) {
	output = strings.TrimSpace(output)
	if output == "" || output == "[]" {
		return []MethodDefinition{}, nil
	}

	var results []MethodDefinition
	err := json.Unmarshal([]byte(output), &results)
	if err != nil {
		return nil, fmt.Errorf("JSON 解析失败: %v, 原始输出: %s", err, output)
	}

	return results, nil
}

// ExecuteFindMethod 执行find_method工具（入口函数）
func ExecuteFindMethod(argsJSON string) (string, error) {
	var req FindMethodRequest
	if err := json.Unmarshal([]byte(argsJSON), &req); err != nil {
		return "", fmt.Errorf("解析参数失败: %v", err)
	}

	// 获取SSH客户端
	sshClientInterface, err := getSSHClient(req.ServerID)
	if err != nil {
		return "", fmt.Errorf("获取SSH客户端失败: %v", err)
	}

	// 类型断言为SSH客户端
	sshClient, ok := sshClientInterface.(*ssh.Client)
	if !ok {
		return "", fmt.Errorf("SSH客户端类型断言失败")
	}

	// 执行搜索
	response := FindMethod(sshClient, req)

	// 返回JSON结果
	resultJSON, err := json.Marshal(response)
	if err != nil {
		return "", fmt.Errorf("序列化结果失败: %v", err)
	}

	return string(resultJSON), nil
}

// executeSSHCommand 执行 SSH 命令
func executeSSHCommand(client *ssh.Client, command string) (string, error) {
	session, err := client.NewSession()
	if err != nil {
		return "", err
	}
	defer session.Close()

	output, err := session.CombinedOutput(command)
	if err != nil {
		return "", fmt.Errorf("命令执行失败: %v, 输出: %s", err, string(output))
	}

	return string(output), nil
}
