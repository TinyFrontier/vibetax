import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import type { Period, ScanResult, Session, Turn, ToolCall, Usage } from "./types.js";

const FIELDS = ["input_tokens", "cached_input_tokens", "cache_write_input_tokens", "output_tokens", "reasoning_output_tokens"] as const;
type TokenTotal = Record<(typeof FIELDS)[number], number>;
const ZERO_TOTAL = Object.fromEntries(FIELDS.map((f) => [f, 0])) as TokenTotal;
type SessionAcc = { project: string; threadSource?: string; parentId?: string; turns: Turn[] };

// Cheap prefilter: skips JSON.parse for message/reasoning/*_output bodies, which dwarf the file.
// function_call_output also contains "function_call" and gets parsed-and-discarded below; acceptable.
const PREFILTER = ["session_meta", "turn_context", "token_count", "function_call", "custom_tool_call", "patch_apply_end"];
const FILE_UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:_|\.jsonl$)/;

/** Missing fields (older CLIs have no cache_write_input_tokens) read as 0. */
function normalize(t: Partial<TokenTotal> | undefined): TokenTotal {
  return Object.fromEntries(FIELDS.map((f) => [f, t?.[f] ?? 0])) as TokenTotal;
}

/** total_token_usage is cumulative within a file; the delta since the last event is a turn's real usage. */
function delta(total: TokenTotal, prev: TokenTotal, last: TokenTotal): TokenTotal {
  const d = Object.fromEntries(FIELDS.map((f) => [f, total[f] - prev[f]])) as TokenTotal;
  // A new task mid-file resets the counters, so some field goes negative; last_token_usage is honest then.
  return FIELDS.some((f) => d[f] < 0) ? last : d;
}

/** Scans one .jsonl file, folding its turns into `sessions`. Returns its unparsable-line count. */
async function scanFile(
  full: string,
  rel: string,
  period: Period,
  sessions: Map<string, SessionAcc>,
  defaultModel: string,
): Promise<{ badLines: number; sawTokenCount: boolean }> {
  let badLines = 0;
  let sawTokenCount = false;
  let sessionId = path.basename(full).match(FILE_UUID)?.[1]; // fallback until a session_meta overrides it
  let cwd: string | undefined;
  let threadSource: string | undefined;
  let parentId: string | undefined;
  let model = defaultModel;
  let prevTotal = ZERO_TOTAL;
  let pendingTools: ToolCall[] = [];
  const callMap = new Map<string, ToolCall>(); // call_id -> pending ToolCall, for function_call/custom_tool_call only
  const fileTurns: Turn[] = [];

  const rl = createInterface({ input: createReadStream(full, "utf8"), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.length === 0 || !PREFILTER.some((s) => line.includes(s))) continue;
    let rec: any;
    try {
      rec = JSON.parse(line);
    } catch {
      badLines++;
      continue;
    }
    const payload = rec.payload;
    if (rec.type === "session_meta") {
      sessionId = payload?.id ?? sessionId; // several session_meta for the same id (resumes): overwrite
      if (typeof payload?.cwd === "string") cwd = payload.cwd;
      threadSource = payload?.thread_source;
      parentId = payload?.source?.subagent?.thread_spawn?.parent_thread_id;
    } else if (rec.type === "turn_context") {
      model = payload?.model ?? model;
      if (typeof payload?.cwd === "string") cwd = payload.cwd;
    } else if (rec.type === "event_msg" && payload?.type === "token_count") {
      const info = payload.info;
      if (info == null) continue;
      sawTokenCount = true;
      const total = normalize(info.total_token_usage);
      const d = delta(total, prevTotal, normalize(info.last_token_usage));
      prevTotal = total; // advance even if this turn is later dropped by the period filter below
      if (d.input_tokens === 0 && d.output_tokens === 0) continue; // repeated event: no turn, tools carry over
      const toolCalls = pendingTools;
      pendingTools = [];
      const at = new Date(rec.timestamp);
      if (Number.isNaN(at.getTime()) || at.getTime() < period.from.getTime() || at.getTime() >= period.to.getTime()) continue;
      // cached_input_tokens is a subset of input_tokens; cache writes are billed only on the GPT-5.6 family
      // (short-context rate, mapped to cacheWrite5m). No 1h tier at OpenAI.
      const usage: Usage = {
        input: d.input_tokens - d.cached_input_tokens,
        cacheRead: d.cached_input_tokens,
        output: d.output_tokens,
        cacheWrite5m: d.cache_write_input_tokens,
        cacheWrite1h: 0,
      };
      fileTurns.push({ at, model, usage, toolCalls });
    } else if (rec.type === "response_item" && (payload?.type === "function_call" || payload?.type === "custom_tool_call")) {
      const tc: ToolCall = { name: payload.name, files: [] };
      pendingTools.push(tc);
      if (typeof payload.call_id === "string") callMap.set(payload.call_id, tc);
    } else if (rec.type === "event_msg" && payload?.type === "patch_apply_end") {
      const files = Object.keys(payload.changes ?? {});
      const tc = typeof payload.call_id === "string" ? callMap.get(payload.call_id) : undefined;
      if (tc) tc.files = files;
      else pendingTools.push({ name: "apply_patch", files });
    }
  }
  // Tool calls with no following token_count (file ends mid-turn) land on the last turn we did emit.
  if (pendingTools.length > 0 && fileTurns.length > 0) fileTurns[fileTurns.length - 1]!.toolCalls.push(...pendingTools);

  if (sessionId) {
    let sess = sessions.get(sessionId);
    if (!sess) {
      sess = { project: cwd ? path.basename(cwd) : sessionId, turns: [] };
      sessions.set(sessionId, sess);
    }
    if (threadSource !== undefined) sess.threadSource = threadSource;
    if (parentId !== undefined) sess.parentId = parentId;
    sess.turns.push(...fileTurns);
  }
  return { badLines, sawTokenCount };
}

async function readDefaultModel(dir: string): Promise<string> {
  try {
    const text = await readFile(path.join(dir, "config.toml"), "utf8");
    return text.match(/^\s*model\s*=\s*"([^"]+)"/m)?.[1] ?? "unknown";
  } catch {
    return "unknown";
  }
}

export async function scanCodex(dir: string, period: Period): Promise<ScanResult> {
  const files: { full: string; rel: string }[] = [];
  for (const root of ["sessions", "archived_sessions"]) {
    try {
      const base = path.join(dir, root);
      const entries = (await readdir(base, { recursive: true })).filter((f) => f.endsWith(".jsonl"));
      for (const f of entries) files.push({ full: path.join(base, f), rel: path.join(root, f) });
    } catch {
      continue; // root doesn't exist
    }
  }
  if (files.length === 0) return { sessions: [], warnings: [] };

  const defaultModel = await readDefaultModel(dir);
  const warnings: string[] = [];
  const sessions = new Map<string, SessionAcc>();
  for (const { full, rel } of files) {
    let mtimeMs: number;
    try {
      mtimeMs = (await stat(full)).mtimeMs;
    } catch {
      continue;
    }
    if (mtimeMs < period.from.getTime()) continue; // a file can't contain records newer than its mtime

    const { badLines, sawTokenCount } = await scanFile(full, rel, period, sessions, defaultModel);
    if (badLines > 0) warnings.push(`${rel}: ${badLines} unparsable lines`);
    if (!sawTokenCount) warnings.push(`${rel}: no usage events (old Codex CLI?)`);
  }

  // Subagent threads point at a parent thread; fold their turns in and drop the standalone entry.
  // ponytail: one merge pass, matches every real fixture (depth 1); a subagent-of-a-subagent needs a
  // second pass or a topological merge order, add if real logs ever show depth > 1.
  for (const [id, sess] of [...sessions]) {
    if (sess.threadSource !== "subagent" || !sess.parentId) continue;
    let parent = sessions.get(sess.parentId);
    if (!parent) {
      parent = { project: sess.project, turns: [] };
      sessions.set(sess.parentId, parent);
    }
    parent.turns.push(...sess.turns);
    sessions.delete(id);
  }

  const result: Session[] = [];
  for (const [id, sess] of sessions) {
    if (sess.turns.length === 0) continue; // old CLI (<0.100) sessions never got a turn; drop, already warned
    const turns = sess.turns.sort((a, b) => a.at.getTime() - b.at.getTime());
    const session: Session = {
      agent: "codex",
      id,
      project: sess.project,
      startedAt: turns[0]!.at,
      endedAt: turns[turns.length - 1]!.at,
      turns,
    };
    if (sess.threadSource === "guardian_review") session.background = true;
    result.push(session);
  }
  return { sessions: result, warnings };
}
