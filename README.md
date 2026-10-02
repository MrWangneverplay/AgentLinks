# Agentlinks

> 让多个 AI 共用一个大脑 —— 跨 agent 上下文交接 + 按成本分工。

（Codex skill 名：`cross-agent-handoff`）

把本机 Codex 和 Claude Code 的会话记录压成一份紧凑的交接文档，让负责编排的模型（贵的那个）快速接上之前的进度；再把「大量但简单」的阅读/搜索/概括工作丢给便宜模型（如 DeepSeek）去做，贵的模型只负责定框架、分配、核验。

## 为什么

不同模型价格差 10～30 倍。贵模型该干的是「想清楚 + 把关」，而不是一句句读资料。这个项目做两件事：

1. **交接**：从 `~/.codex/sessions` 和 `~/.claude/projects` 的 JSONL 里，自动抽出每段会话的标题、工作目录、用过的工具、涉及的 token、最近说了什么、最近在想什么，生成 `handoff.md`。
2. **分工**：`delegate.mjs` 把一个明确的 prompt 发给便宜模型（OpenAI 兼容接口），把结果交回给你核验。

核心假设：**便宜模型负责广度，贵模型负责判断。** 交接文档存在的意义，是让贵模型不丢失上下文，而不是替代它思考。

## 安装

零依赖，需要 Node 18+。克隆后即可用，无需 `npm install`。

作为 Codex skill 使用：把整个目录放进 `~/.codex/skills/cross-agent-handoff/`（或你的 `CODEX_HOME/skills` 下）。

## 用法

生成交接文档（默认扫最近 7 天）：

```bash
node scripts/handoff.mjs --since 7d --out ./.handoff
```

常用参数：

```text
--since 7d|24h|30m   只看这个时间窗内动过的会话
--top 20             最多纳入最近 20 段会话
--out <dir>          输出目录（默认 ./handoffs）
--format md|json|both 输出格式
--full               附带截断的完整对话
--no-codex / --no-claude  只扫其中一种
```

把任务发给便宜模型：

```bash
export DEEPSEEK_API_KEY="你的 key"        # PowerShell: $env:DEEPSEEK_API_KEY="..."
node scripts/delegate.mjs "阅读以下文件，列出所有函数及其职责：..."
```

可选环境变量：`DEEPSEEK_BASE_URL`（默认 `https://api.deepseek.com`）、`DEEPSEEK_MODEL`（默认 `deepseek-chat`）。

## 隐私

- 交接文档包含你本机的对话内容，默认输出目录已在 `.gitignore` 里，别提交。
- 密钥一律走环境变量，代码里不出现任何 key。

## 现状与路线

现状：v0.1，能稳定解析 Codex rollout 和 Claude Code session 的 JSONL，生成交接文档；`delegate.mjs` 已就绪但需你自己填 key 实测。

路线：

- 按任务类型自动打分（贵模型 vs 便宜模型），而不是手工决定。
- 把「核验」做成显式步骤：便宜模型输出后，由贵模型生成核对清单。
- 支持更多 agent 的日志格式（Cursor、Windsurf 等）。
- 一个最小 GUI：输入 API key 即可加模型，拖拽式分配子任务。

## 许可

MIT，见 [LICENSE](LICENSE)。
