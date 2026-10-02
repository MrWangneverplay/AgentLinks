# Agentlinks

我平时 Codex 和 Claude Code 换着用，最烦的是进度对不上——在 Claude 里做到一半的事，换到 Codex 又得从头讲一遍。这个项目就是把两边的本地会话记录扫出来，压成一份简短的交接文档，让接手的模型一眼看懂「之前干到哪了、还差什么」。

还有个现实问题：模型价格差挺多，DeepSeek 比 Claude 便宜一个量级，没必要让贵的模型去一句句读资料。所以再加一个 `delegate.mjs`，把那种量大但不怎么费脑的活（读文件、搜资料、先粗粗概括一遍）丢给便宜模型，贵的模型只负责想清楚和最后把关。

## 做什么

两个脚本，零依赖，Node 18+ 就能跑。

`handoff.mjs` 读 `~/.codex/sessions` 和 `~/.claude/projects` 下的 JSONL，抽出每段会话的标题、工作目录、用过的工具、token 量、最近的对话，输出 `handoff.md`（外加一份 `handoff.json`）。

`delegate.mjs` 把一个明确的 prompt 发给 OpenAI 兼容接口（默认 DeepSeek），把回复打印出来。

原则一句话：便宜模型管广度，贵模型管判断。交接文档只是帮贵模型别丢上下文，不是替它做决定。

## 装

不用 `npm install`，clone 下来直接跑。想当 Codex skill 用，把目录放到 `~/.codex/skills/cross-agent-handoff/` 就行。

## 用

```bash
node scripts/handoff.mjs --since 7d --out ./.handoff
```

常用参数：`--since 7d|24h|30m`（时间窗）、`--top 20`（最多几段）、`--out`（输出目录）、`--format md|json|both`、`--full`（带截断完整对话）、`--no-codex` / `--no-claude`。

```bash
export DEEPSEEK_API_KEY="你的key"   # PowerShell: $env:DEEPSEEK_API_KEY="..."
node scripts/delegate.mjs "读这些文件，把函数和职责列出来：..."
```

可选环境变量：`DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`（默认 `deepseek-chat`）。

## 注意

生成的交接文档是你本机对话内容，输出目录已经加进 `.gitignore`，别不小心提交了。key 走环境变量，代码里不放任何密钥。

## 后面想加

- 按任务自动判断用贵模型还是便宜模型，不用手动定。
- 把「核验」做成一步：便宜模型出结果，贵模型生成核对清单。
- 支持更多工具的日志格式（Cursor、Windsurf）。
- 一个最小 GUI，输入 key 加模型、拖拽分任务。

## 许可

MIT，见 [LICENSE](LICENSE)。
