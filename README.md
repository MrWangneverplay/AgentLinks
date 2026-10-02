# Agentlinks

一个用于多 AI 协作的小工具：把本机 Codex 和 Claude Code 的会话记录整理成一份简短的交接文档，并将量大且简单的工作转发给更便宜的模型，以降低整体成本、减少上下文丢失。

## 背景

我同时使用 Codex 和 Claude Code，两个工具之间的进度无法共享，切换时经常需要重新说明上下文。此外，不同模型的价格差异明显（DeepSeek 比 Claude 便宜约一个数量级），用昂贵的模型逐句阅读资料并不划算。这个项目围绕两个目标：

1. 从本地会话日志中提取关键信息，生成交接文档，帮助后续模型快速恢复上下文；
2. 提供 `delegate.mjs`，把适合批量处理的工作转发给更便宜的模型。

## 功能

两个脚本，无第三方依赖，需要 Node 18+。

- `handoff.mjs`：读取 `~/.codex/sessions` 与 `~/.claude/projects` 下的 JSONL 日志，提取每段会话的标题、工作目录、使用的工具、token 用量及最近的对话内容，输出 `handoff.md`（以及结构化的 `handoff.json`）。
- `delegate.mjs`：将一个明确的 prompt 发送至 OpenAI 兼容接口（默认 DeepSeek），并输出模型回复。

设计原则：便宜模型负责广度的阅读与概括，昂贵模型负责判断与最终核验。

## 安装

无需 `npm install`，克隆后即可运行。作为 Codex skill 使用时，把目录放到 `~/.codex/skills/cross-agent-handoff/` 即可。

## 使用

生成交接文档（默认扫描最近 7 天）：

```bash
node scripts/handoff.mjs --since 7d --out ./.handoff
```

常用参数：`--since 7d|24h|30m`（时间范围）、`--top 20`（最多包含的会话数）、`--out`（输出目录）、`--format md|json|both`（输出格式）、`--full`（附带截断的完整对话）、`--no-codex` / `--no-claude`（排除某一来源）。

将任务转发给更便宜的模型：

```bash
export DEEPSEEK_API_KEY="你的key"   # PowerShell: $env:DEEPSEEK_API_KEY="..."
node scripts/delegate.mjs "阅读以下文件，列出所有函数及其职责：..."
```

可选环境变量：`DEEPSEEK_BASE_URL`（默认 `https://api.deepseek.com`）、`DEEPSEEK_MODEL`（默认 `deepseek-chat`）。

## 路线图

- 根据任务类型自动判断应使用昂贵还是便宜模型；
- 将核验作为独立步骤：便宜模型返回结果后，由昂贵模型生成核对清单；
- 支持更多工具的日志格式（Cursor、Windsurf 等）；
- 提供最小可用的图形界面：输入 API key 即可添加模型、分配子任务。

## 许可

MIT，见 [LICENSE](LICENSE)。
