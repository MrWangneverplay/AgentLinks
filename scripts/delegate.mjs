#!/usr/bin/env node
// Send one prompt to a cheaper model (DeepSeek by default) through an
// OpenAI-compatible chat-completions endpoint, and print the reply.
//
// The orchestrating (expensive) model decides WHAT to delegate and VERIFIES the
// result; this script only runs the cheap model. Never hardcode keys.
//
// Env:
//   DEEPSEEK_API_KEY   required
//   DEEPSEEK_BASE_URL  default https://api.deepseek.com
//   DEEPSEEK_MODEL     default deepseek-chat
//
// Usage:
//   node delegate.mjs "Summarize these files ..."        (prompt as arg)
//   echo "..." | node delegate.mjs                       (prompt on stdin)

const key = process.env.DEEPSEEK_API_KEY;
const base = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => (buf += d));
    process.stdin.on('end', () => resolve(buf.trim()));
  });
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log([
    'delegate.mjs — run one prompt on a cheaper OpenAI-compatible model.',
    '',
    'Env:',
    '  DEEPSEEK_API_KEY   required',
    '  DEEPSEEK_BASE_URL  default https://api.deepseek.com',
    '  DEEPSEEK_MODEL     default deepseek-chat',
    '',
    'Usage:',
    '  node delegate.mjs "prompt text"',
    '  echo "prompt text" | node delegate.mjs',
  ].join('\n'));
  process.exit(0);
}

if (!key) {
  console.error('Error: DEEPSEEK_API_KEY is not set. Export it in your environment, never in code.');
  process.exit(1);
}

const argPrompt = process.argv.slice(2).filter((a) => !a.startsWith('--')).join(' ');
const stdinPrompt = await readStdin();
const prompt = argPrompt || stdinPrompt;

if (!prompt) {
  console.error('Error: no prompt provided (pass it as an argument or on stdin).');
  process.exit(1);
}

const url = base.replace(/\/+$/, '') + '/chat/completions';
const body = { model, messages: [{ role: 'user', content: prompt }], stream: false };

try {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error(`Error: HTTP ${res.status} ${errText.slice(0, 500)}`);
    process.exit(1);
  }
  const data = await res.json();
  const out = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!out) { console.error('Error: unexpected response shape.'); process.exit(1); }
  process.stdout.write(out.trim() + '\n');
} catch (e) {
  console.error('Error: ' + e.message);
  process.exit(1);
}
