---
name: cross-agent-handoff
description: Read local Codex and Claude Code session logs, build a compact cross-agent handoff, and delegate cheap reading/search work to a cheaper model so the orchestrating model focuses on framing and verification.
---

# Cross-Agent Handoff

Help an orchestrating agent resume prior work from other agents and split a task
by cost and difficulty: keep framing, planning, and verification on the expensive
model, push bulk reading, searching, and first-pass summarization to a cheaper model.

## When to use

- Before continuing work done in another agent (Codex, Claude Code), so you do not
  redo it or miss context.
- When a task has a large cheap part (read many files, search, summarize) and a
  small expensive part (understand intent, decide, verify).

## Workflow

1. Build a handoff from local sessions:
   `node scripts/handoff.mjs --since 7d --out ./.handoff`
2. Read the generated `handoff.md` (or `handoff.json` for another tool). Do not
   read raw session logs by hand.
3. Decide the split:
   - You (expensive model): understand intent, set the plan, build the framework,
     verify every delegated result.
   - Cheaper model: bulk retrieval, reading, first-pass summarization, candidate lists.
4. Delegate one well-scoped prompt at a time:
   `node scripts/delegate.mjs "Read these files and list ..."`
   Pass the actual content or file paths; do not ask a vague open question.
5. Verify the delegated result yourself before using it. Never treat a delegated
   summary as fact.

## Rules

- Never hardcode API keys. `delegate.mjs` reads `DEEPSEEK_API_KEY` (and optional
  `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL`) from the environment.
- Handoffs contain private local content. Keep them out of git (the default output
  directory is git-ignored).
- A cheaper model is for breadth, not final judgment. Always verify.

## Scripts

- `scripts/handoff.mjs` — scan local sessions, emit a compact handoff (markdown + json).
- `scripts/delegate.mjs` — send one prompt to a cheaper OpenAI-compatible model and print the reply.

See README.md for install instructions and examples.
