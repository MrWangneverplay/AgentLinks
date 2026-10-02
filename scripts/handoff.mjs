#!/usr/bin/env node
// Cross-Agent Handoff builder.
// Scans local Codex (~/.codex/sessions) and Claude Code (~/.claude/projects)
// session logs and distills them into a compact, private handoff document
// (markdown + json) that an orchestrating model can read to resume prior work.
//
// Zero dependencies. Node 18+.
// Usage: node handoff.mjs [--since 7d] [--top 20] [--out ./.handoff] [--format md|json|both]

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const HOME = homedir();

function parseArgs(argv) {
  const a = { since: '7d', top: 20, out: null, format: 'both', includeCodex: true, includeClaude: true, full: false };
  for (let i = 2; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--since') a.since = argv[++i] || a.since;
    else if (x === '--top') a.top = Number(argv[++i]) || a.top;
    else if (x === '--out') a.out = argv[++i];
    else if (x === '--format') a.format = argv[++i] || a.format;
    else if (x === '--full') a.full = true;
    else if (x === '--no-codex') a.includeCodex = false;
    else if (x === '--no-claude') a.includeClaude = false;
    else if (x === '--help' || x === '-h') { printHelp(); process.exit(0); }
  }
  return a;
}

function printHelp() {
  console.log([
    'cross-agent-handoff',
    '',
    'Usage:',
    '  node handoff.mjs [options]',
    '',
    'Options:',
    '  --since 7d|24h|30m   Only sessions touched within this window (default 7d)',
    '  --top 20             Max number of recent sessions to include (default 20)',
    '  --out <dir>          Output directory (default ./handoffs)',
    '  --format md|json|both  Output format (default both)',
    '  --full               Also include a truncated full transcript',
    '  --no-codex           Skip Codex sessions',
    '  --no-claude          Skip Claude Code sessions',
  ].join('\n'));
}

function parseSince(v) {
  const m = /^(\d+)(d|h|m)$/.exec(v || '');
  if (!m) return 7 * 86400e3;
  const unit = { d: 86400e3, h: 3600e3, m: 60e3 }[m[2]];
  return Number(m[1]) * unit;
}

function collectJsonl(dir, sinceMs, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collectJsonl(p, sinceMs, out);
    else if (e.name.endsWith('.jsonl')) {
      try { if (statSync(p).mtimeMs >= sinceMs) out.push(p); } catch {}
    }
  }
  return out;
}

function clip(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function fmt(ts) {
  if (!ts) return '?';
  if (typeof ts === 'number') ts = new Date(ts).toISOString();
  return String(ts).replace('T', ' ').slice(0, 19);
}

function textFromContent(content, types = ['text', 'input_text', 'output_text']) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .map((b) => (b && typeof b.text === 'string' && types.includes(b.type) ? b.text : ''))
    .join('\n')
    .trim();
}

function textFromBlocks(blocks, types = ['text']) {
  if (!Array.isArray(blocks)) return '';
  return blocks
    .map((b) => (b && typeof b.text === 'string' && types.includes(b.type) ? b.text : ''))
    .join('\n')
    .trim();
}

function looksLikePath(s) {
  if (s.length < 2 || s.length > 500) return false;
  if (/^[A-Za-z]:[\\/]/.test(s)) return true;
  if (/^[./~]/.test(s)) return true;
  return /\.[A-Za-z0-9]{1,6}$/.test(s) && /[\\/]/.test(s);
}

function extractPaths(str, set) {
  if (typeof str !== 'string' || str.length > 4000 || set.size > 200) return;
  if (/https?:\/\//i.test(str)) return;
  if (looksLikePath(str)) set.add(str);
  const re = /[A-Za-z]:[\\/][^\s"'\u0000-\u001f]{1,200}/g;
  let m;
  while ((m = re.exec(str))) set.add(m[0]);
  const re2 = /(?:\.\.\/|\.\/|\/)[\w.\-@]+(?:\/[\w.\-@]+)+/g;
  while ((m = re2.exec(str))) set.add(m[0]);
}

function walk(v, set, depth) {
  if (depth > 4 || set.size > 200) return;
  if (typeof v === 'string') extractPaths(v, set);
  else if (Array.isArray(v)) { for (const x of v) walk(x, set, depth + 1); }
  else if (v && typeof v === 'object') { for (const k in v) walk(v[k], set, depth + 1); }
}

function collectPaths(input, set) {
  let obj = input;
  if (typeof input === 'string') { try { obj = JSON.parse(input); } catch { obj = input; } }
  walk(obj, set, 0);
}

function mergeUsage(acc, u) {
  if (!u || typeof u !== 'object') return acc;
  acc = acc || {};
  for (const [k, v] of Object.entries(u)) {
    if (typeof v === 'number' && /token/i.test(k)) acc[k] = (acc[k] || 0) + v;
  }
  return acc;
}

function usageSummary(u) {
  if (!u || Object.keys(u).length === 0) return null;
  const total = u.total_tokens ?? ((u.input_tokens || 0) + (u.output_tokens || 0));
  return `≈${total} (in ${u.input_tokens || 0} / out ${u.output_tokens || 0})`;
}

function makeTitle(text) {
  if (!text) return null;
  const first = text.split('\n').map((s) => s.trim()).filter(Boolean)[0] || text.trim();
  return clip(first, 80);
}

function baseSession(source, file) {
  return {
    source,
    id: path.basename(file, '.jsonl'),
    title: null,
    cwd: null,
    branch: null,
    model: null,
    startedAt: null,
    lastAt: null,
    userCount: 0,
    assistantCount: 0,
    tools: new Map(),
    files: new Set(),
    usage: null,
    reasoning: [],
    lastUser: null,
    lastAssistant: null,
    transcript: [],
  };
}

function loadCodexTitleIndex() {
  const map = new Map();
  const f = path.join(HOME, '.codex', 'session_index.jsonl');
  let text;
  try { text = readFileSync(f, 'utf8'); } catch { return map; }
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      if (o.id && o.thread_name) map.set(o.id, o.thread_name);
    } catch {}
  }
  return map;
}

function readCodexSession(file, titleIndex) {
  const s = baseSession('codex', file);
  let firstUser = null;
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return null; }
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const ts = typeof o.timestamp === 'number' ? new Date(o.timestamp).toISOString() : o.timestamp;
    if (ts) { if (!s.startedAt) s.startedAt = ts; s.lastAt = ts; }
    const p = o.payload;
    if (!p) continue;
    if (o.type === 'session_meta') {
      if (p.session_id || p.id) s.id = p.session_id || p.id;
      if (p.cwd) s.cwd = p.cwd;
      if (p.model_provider) s.model = p.model_provider;
      if (p.timestamp) s.startedAt = p.timestamp;
    } else if (o.type === 'turn_context' && p.model) {
      s.model = p.model;
    } else if (o.type === 'response_item') {
      if (p.type === 'message' && (p.role === 'user' || p.role === 'assistant')) {
        const t = textFromContent(p.content);
        if (!t) continue;
        if (p.role === 'user') { s.userCount++; s.lastUser = t; if (!firstUser) firstUser = t; }
        else { s.assistantCount++; s.lastAssistant = t; }
        s.transcript.push({ role: p.role, ts, text: t });
      } else if (p.type === 'function_call' || p.type === 'custom_tool_call') {
        const name = p.name || p.type;
        s.tools.set(name, (s.tools.get(name) || 0) + 1);
        collectPaths(p.arguments || p.input, s.files);
      } else if (p.type === 'reasoning' && typeof p.summary === 'string' && p.summary.trim()) {
        s.reasoning.push(p.summary.trim());
      }
    } else if (o.type === 'token_usage_record') {
      s.usage = mergeUsage(s.usage, p.usage);
    } else if (o.type === 'task_complete' && typeof p.last_agent_message === 'string' && p.last_agent_message.trim()) {
      s.lastAssistant = s.lastAssistant || p.last_agent_message;
    }
  }
  s.title = (titleIndex && titleIndex.get(s.id)) || (s.cwd ? path.basename(s.cwd) : null) || makeTitle(firstUser) || s.id;
  return s;
}

function readClaudeSession(file) {
  const s = baseSession('claude', file);
  let firstUser = null;
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return null; }
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const ts = o.timestamp;
    if (ts) { if (!s.startedAt) s.startedAt = ts; s.lastAt = ts; }
    if (o.type === 'ai-title' && o.aiTitle) s.title = o.aiTitle;
    if (o.cwd) s.cwd = o.cwd;
    if (o.gitBranch) s.branch = o.gitBranch;
    if (o.type === 'user') {
      const t = textFromBlocks(o.message && o.message.content, ['text']);
      if (t) {
        s.userCount++;
        s.lastUser = t;
        if (!firstUser) firstUser = t;
        s.transcript.push({ role: 'user', ts, text: t });
      }
    } else if (o.type === 'assistant') {
      const m = o.message;
      s.assistantCount++;
      if (m && m.model) s.model = m.model;
      const t = textFromBlocks(m && m.content, ['text']);
      if (t) { s.lastAssistant = t; s.transcript.push({ role: 'assistant', ts, text: t }); }
      for (const b of (m && m.content) || []) {
        if (b && b.type === 'tool_use' && b.name) {
          s.tools.set(b.name, (s.tools.get(b.name) || 0) + 1);
          collectPaths(b.input, s.files);
        }
      }
      if (m && m.usage) s.usage = mergeUsage(s.usage, m.usage);
    }
  }
  if (!s.title) s.title = makeTitle(firstUser) || s.id;
  return s;
}

function toolsList(m) {
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} x${v}`).join(', ') || '(none)';
}

function renderMd(handoff) {
  const L = [];
  L.push('# Cross-Agent Handoff');
  L.push('');
  L.push(`Generated: ${handoff.generatedAt}`);
  L.push(`Scope: last ${handoff.scope}`);
  L.push(`Sources: codex=${handoff.counts.codex} claude=${handoff.counts.claude}`);
  L.push('');
  L.push('> Auto-generated from local session logs. Contains private content — do not commit.');
  L.push('');
  L.push(`## Sessions (${handoff.sessions.length})`);
  L.push('');
  for (const s of handoff.sessions) {
    L.push(`### ${s.title}`);
    L.push('');
    L.push(`- source: ${s.source}`);
    L.push(`- session: ${s.id}`);
    if (s.cwd) L.push(`- cwd: ${s.cwd}`);
    if (s.branch) L.push(`- branch: ${s.branch}`);
    if (s.model) L.push(`- model: ${s.model}`);
    L.push(`- span: ${fmt(s.startedAt)} → ${fmt(s.lastAt)}`);
    L.push(`- messages: ${s.userCount} user / ${s.assistantCount} assistant`);
    L.push(`- tools: ${toolsList(s.tools)}`);
    if (s.usage) L.push(`- tokens: ${usageSummary(s.usage)}`);
    if (s.files.size) L.push(`- files: ${[...s.files].slice(0, 20).join(', ')}`);
    L.push('');
    if (s.lastUser) { L.push('> last user'); L.push(clip(s.lastUser, 500)); L.push(''); }
    if (s.lastAssistant) { L.push('> last assistant'); L.push(clip(s.lastAssistant, 500)); L.push(''); }
    if (s.reasoning.length) {
      L.push('> recent reasoning');
      for (const r of s.reasoning.slice(-3)) L.push('- ' + clip(r, 280));
      L.push('');
    }
    if (handoff.full && s.transcript.length) {
      L.push('#### transcript');
      for (const m of s.transcript.slice(-120)) L.push(`- [${m.role}] ${clip(m.text, 1200)}`);
      L.push('');
    }
  }
  return L.join('\n') + '\n';
}

function toJson(handoff) {
  const sessions = handoff.sessions.map((s) => ({
    source: s.source,
    id: s.id,
    title: s.title,
    cwd: s.cwd,
    branch: s.branch,
    model: s.model,
    startedAt: s.startedAt,
    lastAt: s.lastAt,
    userCount: s.userCount,
    assistantCount: s.assistantCount,
    tools: Object.fromEntries(s.tools),
    files: [...s.files],
    usage: s.usage,
    lastUser: clip(s.lastUser, 2000),
    lastAssistant: clip(s.lastAssistant, 2000),
    reasoning: s.reasoning.slice(-5).map((r) => clip(r, 400)),
    transcript: handoff.full ? s.transcript.slice(-120).map((m) => ({ role: m.role, ts: m.ts, text: clip(m.text, 1200) })) : [],
  }));
  return { generatedAt: handoff.generatedAt, scope: handoff.scope, counts: handoff.counts, sessions };
}

const args = parseArgs(process.argv);
const sinceMs = Date.now() - parseSince(args.since);
const codexTitleIndex = loadCodexTitleIndex();
const roots = [];
if (args.includeCodex) roots.push({ dir: path.join(HOME, '.codex', 'sessions'), kind: 'codex' });
if (args.includeClaude) roots.push({ dir: path.join(HOME, '.claude', 'projects'), kind: 'claude' });

const found = [];
for (const r of roots) {
  for (const f of collectJsonl(r.dir, sinceMs)) found.push({ file: f, kind: r.kind });
}
found.sort((a, b) => statSync(b.file).mtimeMs - statSync(a.file).mtimeMs);

const chosen = found.slice(0, args.top);
const sessions = [];
for (const c of chosen) {
  const s = c.kind === 'codex' ? readCodexSession(c.file, codexTitleIndex) : readClaudeSession(c.file);
  if (s && (s.userCount || s.assistantCount)) sessions.push(s);
}

const counts = { codex: sessions.filter((s) => s.source === 'codex').length, claude: sessions.filter((s) => s.source === 'claude').length };
const handoff = {
  generatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
  scope: args.since,
  counts,
  sessions,
  full: args.full,
};

const outDir = args.out ? path.resolve(args.out) : path.join(process.cwd(), 'handoffs');
mkdirSync(outDir, { recursive: true });
const wrote = [];
if (args.format === 'md' || args.format === 'both') {
  const p = path.join(outDir, 'handoff.md');
  writeFileSync(p, renderMd(handoff), 'utf8');
  wrote.push(p);
}
if (args.format === 'json' || args.format === 'both') {
  const p = path.join(outDir, 'handoff.json');
  writeFileSync(p, JSON.stringify(toJson(handoff), null, 2), 'utf8');
  wrote.push(p);
}

console.log(`scanned=${found.length} recent=${sessions.length} (codex=${counts.codex} claude=${counts.claude})`);
for (const p of wrote) console.log('wrote ' + p);
