// Host-side cross-check for dsh-task-cost: fold one session log's provider
// usage exactly like the `tokenUsage` Session projection and price it with the
// plugin's rate tables. Read-only; works on the persisted v4 JSONL(.zstd).
//
// Usage:
//   node scripts/session-cost.mjs                   # every session under $DSH_HOME/sessions
//   node scripts/session-cost.mjs <sessionId>       # one session (id substring)
//   node scripts/session-cost.mjs --tier offpeak    # price window (default peak)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { zstdDecompressSync } from 'node:zlib';

const PRICES = {
  'deepseek-flash': {
    peak: { cacheHit: 0.04, cacheMiss: 2, output: 8 },
    offpeak: { cacheHit: 0.02, cacheMiss: 1, output: 4 },
  },
  'deepseek-v4-pro': {
    peak: { cacheHit: 0.3, cacheMiss: 9, output: 27 },
    offpeak: { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 },
  },
};
const PER_MILLION = 1e6;

const args = process.argv.slice(2);
const tierIndex = args.indexOf('--tier');
const tier = tierIndex !== -1 && args[tierIndex + 1] === 'offpeak' ? 'offpeak' : 'peak';
const target = args.find((value) => !value.startsWith('--') && value !== args[tierIndex + 1]);
const sessionsRoot = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'sessions');

/**
 * Read a session log as text. The persisted file appends one zstd frame per
 * flush, so a single decompress call only returns the first frame; split on the
 * zstd magic and decode every frame.
 */
function readLog(file) {
  const bytes = readFileSync(file);
  if (!file.endsWith('.zstd')) return bytes.toString('utf8');
  const magic = [0x28, 0xb5, 0x2f, 0xfd];
  const starts = [];
  for (let index = 0; index + 3 < bytes.length; index += 1) {
    if (
      bytes[index] === magic[0] &&
      bytes[index + 1] === magic[1] &&
      bytes[index + 2] === magic[2] &&
      bytes[index + 3] === magic[3]
    ) {
      starts.push(index);
    }
  }
  if (starts.length === 0) return zstdDecompressSync(bytes).toString('utf8');
  let text = '';
  for (let frame = 0; frame < starts.length; frame += 1) {
    const start = starts[frame];
    const end = frame + 1 < starts.length ? starts[frame + 1] : bytes.length;
    text += zstdDecompressSync(bytes.subarray(start, end)).toString('utf8');
  }
  return text;
}

function exists(file) {
  try {
    statSync(file);
    return true;
  } catch {
    return false;
  }
}

/** Last `usage` chunk of an assistant stream, when the settlement carries no direct usage. */
function lastStreamUsage(stream) {
  if (!Array.isArray(stream)) return undefined;
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const chunk = stream[index];
    if (chunk !== null && typeof chunk === 'object' && chunk.usage !== undefined) return chunk.usage;
  }
  return undefined;
}

/** Fold assistant settlements into the four durable token buckets. */
function foldUsage(text) {
  const totals = { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  let last = null;
  for (const line of text.split('\n')) {
    if (line.length === 0) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === 'llm/retry-started') {
      if (last !== null && last.turn === event.data?.turn && last.step === event.data?.step) last = null;
      continue;
    }
    if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') continue;
    const usage = event.data?.usage ?? lastStreamUsage(event.data?.stream);
    if (usage === undefined || usage === null) continue;
    const buckets = {
      uncachedInputTokens: Number(usage.inputTokens) || 0,
      outputTokens: Number(usage.outputTokens) || 0,
      cacheReadTokens: Number(usage.cacheReadTokens) || 0,
      cacheWriteTokens: Number(usage.cacheWriteTokens) || 0,
    };
    const turn = event.data?.turn;
    const step = event.data?.step;
    const replace = last !== null && last.turn === turn && last.step === step ? last.buckets : null;
    const same = replace !== null && Object.keys(buckets).every((key) => replace[key] === buckets[key]);
    if (!same) {
      for (const key of Object.keys(totals)) totals[key] += buckets[key] - (replace === null ? 0 : replace[key]);
      last = { turn, step, buckets };
    }
  }
  return totals;
}

/** Fold the session's model id from `model/selection` or the first request header. */
function modelOf(text) {
  let model = 'deepseek-flash';
  for (const line of text.split('\n')) {
    if (line.length === 0) continue;
    if (line.indexOf('model/selection') === -1 && line.indexOf('request/header') === -1) continue;
    try {
      const data = JSON.parse(line)?.data;
      const value = data?.model ?? data?.header?.config?.model;
      if (typeof value === 'string' && value.length > 0) model = value;
    } catch {
      /* ignore malformed line */
    }
  }
  return model;
}

/** Price one session's buckets (CNY) at the CLI's tier. */
function costOf(usage, model) {
  const table = /pro/i.test(model) ? 'deepseek-v4-pro' : 'deepseek-flash';
  const price = PRICES[table][tier];
  return (
    (usage.cacheReadTokens * price.cacheHit +
      usage.uncachedInputTokens * price.cacheMiss +
      usage.cacheWriteTokens * price.cacheMiss +
      usage.outputTokens * price.output) /
    PER_MILLION
  );
}

/** Find session logs, optionally filtered by an id substring. */
function collect() {
  const found = [];
  let groups = [];
  try {
    groups = readdirSync(sessionsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  } catch {
    return found;
  }
  for (const group of groups) {
    const groupDir = join(sessionsRoot, group.name);
    for (const session of readdirSync(groupDir, { withFileTypes: true })) {
      if (!session.isDirectory()) continue;
      if (target !== undefined && !session.name.includes(target)) continue;
      for (const name of ['session.v4.jsonl.zstd', 'session.v4.jsonl']) {
        const file = join(groupDir, session.name, name);
        if (exists(file)) {
          found.push({ id: session.name.replace(/^session-/, ''), cwdGroup: group.name, file });
          break;
        }
      }
    }
  }
  return found;
}

const sessions = collect();
if (sessions.length === 0) {
  console.error(`no session logs under ${sessionsRoot}${target === undefined ? '' : ` matching "${target}"`}`);
  process.exit(1);
}

const report = sessions.map(({ id, cwdGroup, file }) => {
  const text = readLog(file);
  const usage = foldUsage(text);
  const model = modelOf(text);
  const billedInput = usage.cacheReadTokens + usage.uncachedInputTokens + usage.cacheWriteTokens;
  return {
    sessionId: id,
    project: cwdGroup,
    model,
    tokens: usage,
    billedInput,
    totalTokens: billedInput + usage.outputTokens,
    costCny: Number(costOf(usage, model).toFixed(4)),
  };
});
report.sort((left, right) => right.totalTokens - left.totalTokens);
const grand = report.reduce((sum, row) => sum + row.costCny, 0);
console.log(JSON.stringify({ tier, sessions: report, totalCostCny: Number(grand.toFixed(4)) }, null, 2));
