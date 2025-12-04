# 终端颜色高亮使用说明

## ✅ 已启用功能

1. **ANSI颜色支持** - 终端已配置完整的ANSI颜色主题
2. **WebGL渲染器** - 提升性能和颜色显示效果
3. **10000行回滚缓冲** - 可查看更多历史输出

## 🎨 服务器端配置

要在终端中看到彩色输出，需要在服务器上配置：

### 1. Bash/Zsh 配置

编辑 `~/.bashrc` 或 `~/.zshrc`:

```bash
# 启用彩色提示符
export PS1='\[\033[01;32m\]\u@\h\[\033[00m\]:\[\033[01;34m\]\w\[\033[00m\]\$ '

# 启用ls颜色
alias ls='ls --color=auto'
alias grep='grep --color=auto'

# 启用git颜色
git config --global color.ui auto
```

### 2. 验证TERM环境变量

```bash
echo $TERM
# 应该输出: xterm-256color 或 xterm-color
```

如果不是，添加到配置文件：
```bash
export TERM=xterm-256color
```

### 3. 启用常用工具颜色

```bash
# bat (cat替代品，带语法高亮)
alias cat='bat --style=plain'

# exa (ls替代品，带彩色图标)
alias ls='exa --icons'

# diff颜色
alias diff='diff --color=auto'
```

## 🧪 测试颜色

运行以下命令测试颜色是否正常：

```bash
# 测试基本颜色
for i in {0..7}; do echo -e "\e[3${i}m Color $i \e[0m"; done

# 测试ls颜色
ls --color=auto

# 测试git颜色
git log --oneline --decorate --color=always | head
```

## 💡 推荐工具

这些工具会自动输出彩色内容：

- **htop** - 彩色系统监控
- **ncdu** - 彩色磁盘使用分析
- **bat** - 彩色cat
- **exa** - 彩色ls
- **delta** - 彩色git diff
- **jq** - 彩色JSON处理

## 🎯 效果

启用后您将看到：
- ✅ 彩色命令提示符
- ✅ 彩色文件列表 (目录、可执行文件等不同颜色)
- ✅ 彩色git输出
- ✅ 语法高亮的代码
- ✅ 彩色错误信息

## 🔧 已实现的终端特性

终端配置包含：
- 16色ANSI基本颜色
- 8色Bright颜色
- 光标闪烁
- 文本选择高亮
- 平滑滚动
- WebGL加速渲染
