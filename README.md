# SSH API 服务

一个提供SSH远程操作API接口的Go服务，支持真实的Shell会话保持和交互式命令执行。

## 功能特性

- ✅ **真实Shell会话** - 使用PTY维护真实的bash/zsh会话
- ✅ **状态保持** - cd、export等操作状态永久保持
- ✅ **虚拟终端** - 实时捕获终端屏幕内容
- ✅ **交互式检测** - 智能识别需要用户输入的场景
- ✅ **REST API** - 简洁的HTTP接口

## 项目结构

```
all_project/
├── main.go              # 测试入口
├── go.mod               # 依赖管理
├── sshapi/             # SSH API功能包
│   ├── session.go      # SSH会话管理
│   ├── terminal.go     # 虚拟终端处理
│   ├── server.go       # HTTP API服务器
│   └── types.go        # 类型定义
└── README.md           # 本文档
```

## 快速开始

### 1. 安装依赖

```bash
go mod tidy
```

### 2. 修改测试配置

编辑 `main.go` 第 37-42 行，填入你的SSH服务器信息：

```go
sessionID, err := createSession(baseURL, sshapi.SessionConfig{
    Host:     "45.207.205.96",  // 你的服务器IP
    Port:     22,
    Username: "root",
    Password: "your-password",   // 你的密码
    Shell:    "bash",
})
```

### 3. 运行测试

```bash
go run main.go
```

## API文档

### 1. 创建SSH会话

```http
POST /session/create
Content-Type: application/json

{
  "host": "45.207.205.96",
  "port": 22,
  "username": "root",
  "password": "your-password",
  "shell": "bash"
}
```

**响应:**
```json
{
  "session_id": "sess_1733251200123456789",
  "info": {
    "session_id": "sess_1733251200123456789",
    "host": "45.207.205.96",
    "username": "root",
    "connected": true,
    "created_at": "2025-12-04T01:00:00Z",
    "last_active": "2025-12-04T01:00:00Z"
  }
}
```

### 2. 获取终端屏幕

```http
GET /session/{session_id}/screen
```

**响应:**
```json
{
  "lines": [
    "root@server:~# pwd",
    "/root",
    "root@server:~# _"
  ],
  "cursor_row": 2,
  "cursor_col": 15,
  "width": 80,
  "height": 24,
  "last_output": "pwd\n/root\n",
  "idle_seconds": 0,
  "suggest_input": false,
  "command_active": true
}
```

### 3. 发送命令/输入

```http
POST /session/{session_id}/input
Content-Type: application/json

{
  "command": "ls -la\n"
}
```

**响应:** 返回执行后的屏幕状态（同上）

### 4. 获取会话信息

```http
GET /session/{session_id}/info
```

### 5. 列出所有会话

```http
GET /sessions
```

**响应:**
```json
{
  "sessions": [...],
  "count": 1
}
```

### 6. 关闭会话

```http
DELETE /session/{session_id}/close
```

## 使用示例

### Python客户端示例

```python
import requests
import time

BASE_URL = "http://localhost:8080"

# 1. 创建会话
resp = requests.post(f"{BASE_URL}/session/create", json={
    "host": "45.207.205.96",
    "port": 22,
    "username": "root",
    "password": "your-password",
    "shell": "bash"
})
session_id = resp.json()["session_id"]
print(f"会话创建: {session_id}")

# 2. 执行命令
resp = requests.post(f"{BASE_URL}/session/{session_id}/input", json={
    "command": "cd /home\n"
})
screen = resp.json()
print("\n".join(screen["lines"][-5:]))  # 显示最后5行

# 3. 验证cd有效
resp = requests.post(f"{BASE_URL}/session/{session_id}/input", json={
    "command": "pwd\n"
})
screen = resp.json()
print("\n".join(screen["lines"][-5:]))  # 应该显示 /home

# 4. 交互式场景
resp = requests.post(f"{BASE_URL}/session/{session_id}/input", json={
    "command": "./install.sh\n"
})
screen = resp.json()

# 轮询检查是否需要输入
while screen["command_active"]:
    time.sleep(1)
    resp = requests.get(f"{BASE_URL}/session/{session_id}/screen")
    screen = resp.json()
    
    print("\n".join(screen["lines"][-10:]))  # 显示最后10行
    
    if screen["suggest_input"]:
        # 检测到需要输入
        user_input = input("请输入: ")
        resp = requests.post(f"{BASE_URL}/session/{session_id}/input", json={
            "command": user_input + "\n"
        })
        screen = resp.json()
```

## 核心特性说明

### 为什么是"真"的？

不同于简单的 `session.Run()` 实现，本项目使用 `session.Shell()` 启动真实的Shell进程：

| 特性 | 普通实现 | 本项目 |
|------|---------|--------|
| cd有效 | ❌ | ✅ |
| 环境变量保持 | ❌ | ✅ |
| PATH正确 | ❌ | ✅ |
| 交互式程序 | ❌ | ✅ |
| 后台任务 | ❌ | ✅ |

### 交互式检测逻辑

系统通过以下规则判断是否需要输入：

1. 命令未退出
2. 输出停止2秒以上
3. 输出包含提示模式：
   - `(y/n)`, `(yes/no)`
   - `password:`, `Password:`
   - `Continue?`, `continue?`
   - 以 `?` 结尾

## 扩展开发

### 添加新功能包

```bash
mkdir myfeature
# 在myfeature/下创建Go文件
# 在main.go中导入 "all_project/myfeature"
```

### 集成到其他服务

```go
import "all_project/sshapi"

// 在你的服务中使用
manager := sshapi.NewSessionManager()
session, _ := manager.CreateSession(&sshapi.SessionConfig{...})
session.SendInput("ls -la\n")
screen := session.GetScreen()
```

## 注意事项

1. **安全性**: 当前版本密码明文传输，生产环境请使用HTTPS或SSH密钥认证
2. **会话清理**: 建议定期清理空闲会话，避免资源泄漏
3. **并发控制**: 单个会话不建议并发发送命令
4. **输出缓冲**: 虚拟终端固定80x24，超长输出会滚动

## License

MIT
