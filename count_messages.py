#!/usr/bin/env python3
"""
统计对话历史中的消息数量和 Token 数

用法:
    python count_messages.py <对话JSON文件路径>

Token 统计方式:
    - 如果安装了 tiktoken: 使用精确计数（推荐）
      安装: pip install tiktoken
    
    - 如果未安装 tiktoken: 使用估算（中文≈1.5 tokens/字，英文≈1.3 tokens/词）

示例:
    python count_messages.py /root/.ssh_web_data/sessions/xxx.json
"""
import json
import sys
from collections import Counter

# 尝试导入 tiktoken（用于精确 token 计数）
try:
    import tiktoken
    HAS_TIKTOKEN = True
except ImportError:
    HAS_TIKTOKEN = False

def estimate_tokens_simple(text):
    """简单估算 token 数（不需要额外库）"""
    if not text:
        return 0
    
    # 统计中文字符和英文单词
    chinese_chars = sum(1 for c in text if '\u4e00' <= c <= '\u9fff')
    # 英文单词粗略估算（按空格分割）
    english_words = len(text.split())
    # 其他字符
    other_chars = len(text) - chinese_chars
    
    # 估算规则：
    # - 中文字符：约 1.5 tokens/字
    # - 英文单词：约 1.3 tokens/词
    # - 标点和空格：约 0.5 tokens/字符
    tokens = int(chinese_chars * 1.5 + english_words * 1.3)
    return max(tokens, len(text) // 4)  # 保底：文本长度除以4

def count_tokens_tiktoken(text, model="gpt-4"):
    """使用 tiktoken 精确计数（需要安装 tiktoken）"""
    if not HAS_TIKTOKEN or not text:
        return 0
    try:
        enc = tiktoken.encoding_for_model(model)
        return len(enc.encode(text))
    except Exception:
        return estimate_tokens_simple(text)

def count_message_tokens(messages, use_tiktoken=False):
    """统计所有消息的 token 数"""
    total_tokens = 0
    tokens_by_role = Counter()
    
    for msg in messages:
        # 构建消息文本（包含 role 和 content）
        text_parts = []
        
        # Role
        role = msg.get('role', '')
        text_parts.append(role)
        
        # Content
        content = msg.get('content', '')
        if content:
            text_parts.append(str(content))
        
        # Tool calls (如果有)
        if msg.get('tool_calls'):
            text_parts.append(json.dumps(msg['tool_calls'], ensure_ascii=False))
        
        # Tool call ID
        if msg.get('tool_call_id'):
            text_parts.append(msg['tool_call_id'])
        
        # Reasoning content
        if msg.get('reasoning_content'):
            text_parts.append(str(msg['reasoning_content']))
        
        full_text = ' '.join(text_parts)
        
        # 计算 tokens
        if use_tiktoken and HAS_TIKTOKEN:
            tokens = count_tokens_tiktoken(full_text)
        else:
            tokens = estimate_tokens_simple(full_text)
        
        total_tokens += tokens
        tokens_by_role[role] += tokens
    
    return total_tokens, dict(tokens_by_role)

def count_messages(json_file_path):
    """统计 JSON 对话文件中的消息数量"""
    
    try:
        with open(json_file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # 检查是否有 messages 字段
        if 'messages' not in data:
            print("❌ 错误: JSON 文件中没有 'messages' 字段")
            return
        
        messages = data['messages']
        total = len(messages)
        
        # 按 role 统计
        role_counts = Counter(msg.get('role', 'unknown') for msg in messages)
        
        # 计算对话轮数（user 消息的数量）
        user_turns = role_counts.get('user', 0)
        
        # 🔢 计算 Token 数
        use_tiktoken = HAS_TIKTOKEN
        total_tokens, tokens_by_role = count_message_tokens(messages, use_tiktoken)
        
        # 输出统计结果
        print("=" * 60)
        print("📊 对话消息统计")
        print("=" * 60)
        print(f"对话ID: {data.get('id', 'N/A')}")
        print(f"标题: {data.get('title', 'N/A')}")
        print(f"模型: {data.get('model_id', 'N/A')}")
        print("-" * 60)
        print(f"📨 总消息数: {total} 条")
        print(f"🔄 对话轮数: {user_turns} 轮 (user消息数)")
        
        # Token 统计
        if use_tiktoken:
            print(f"🎯 总 Tokens: {total_tokens:,} tokens (tiktoken 精确计数)")
        else:
            print(f"🎯 总 Tokens: {total_tokens:,} tokens (估算值，安装 tiktoken 可精确计数)")
        
        print("-" * 60)
        print("📋 按角色统计 (消息数 | Token数):")
        
        for role, count in sorted(role_counts.items(), key=lambda x: x[1], reverse=True):
            percentage = (count / total * 100) if total > 0 else 0
            role_tokens = tokens_by_role.get(role, 0)
            token_percentage = (role_tokens / total_tokens * 100) if total_tokens > 0 else 0
            emoji = {
                'user': '👤',
                'assistant': '🤖',
                'tool': '🔧',
                'system': '⚙️'
            }.get(role, '❓')
            print(f"  {emoji} {role:12s}: {count:4d} 条 ({percentage:5.1f}%) | {role_tokens:8,} tokens ({token_percentage:5.1f}%)")
        
        print("=" * 60)
        
        # 额外统计：工具调用
        tool_calls_count = sum(1 for msg in messages if msg.get('role') == 'assistant' and msg.get('tool_calls'))
        print(f"\n🛠️  包含工具调用的 assistant 消息: {tool_calls_count} 条")
        
        # 统计工具类型
        if tool_calls_count > 0:
            tool_names = []
            for msg in messages:
                if msg.get('role') == 'assistant' and msg.get('tool_calls'):
                    for tc in msg['tool_calls']:
                        if 'function' in tc and 'name' in tc['function']:
                            tool_names.append(tc['function']['name'])
            
            if tool_names:
                tool_counter = Counter(tool_names)
                print("\n🔧 工具调用统计:")
                for tool_name, count in sorted(tool_counter.items(), key=lambda x: x[1], reverse=True):
                    print(f"  • {tool_name:20s}: {count:3d} 次")
        
        return {
            'total': total,
            'turns': user_turns,
            'by_role': dict(role_counts),
            'tool_calls': tool_calls_count,
            'total_tokens': total_tokens,
            'tokens_by_role': tokens_by_role,
            'use_tiktoken': use_tiktoken
        }
        
    except FileNotFoundError:
        print(f"❌ 错误: 文件不存在: {json_file_path}")
    except json.JSONDecodeError as e:
        print(f"❌ 错误: JSON 格式错误: {e}")
    except Exception as e:
        print(f"❌ 错误: {e}")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("用法: python count_messages.py <对话JSON文件路径>")
        print("\n示例:")
        print("  python count_messages.py conversation.json")
        sys.exit(1)
    
    json_file = sys.argv[1]
    count_messages(json_file)
