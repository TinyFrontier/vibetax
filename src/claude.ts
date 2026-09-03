import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import type { Period, ScanResult, Session, Turn, ToolCall, Usage } from "./types.js";

type TurnAcc = { at: Date; model: string; usage: Usage; tools: Map<string, ToolCall> };
type SessionAcc = { project: string; turns: Map<string, TurnAcc> };

function mapUsage(u: {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
}): Usage {
  const input = u.input_tokens ?? 0;
  const output = u.output_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  if (u.cache_creation) {
    return {
      input,
      output,
      cacheRead,
      cacheWrite5m: u.cache_creation.ephemeral_5m_input_tokens ?? 0,
      cacheWrite1h: u.cache_creation.ephemeral_1h_input_tokens ?? 0,
    };
  }
  return { input, output, cacheRead, cacheWrite5m: u.cache_creation_input_tokens ?? 0, cacheWrite1h: 0 };
}

/** Scans one .jsonl file, folding its assistant turns into `sessions`. Returns its unparsable-line count. */
async function scanFile(full: string, rel: string, period: Period, sessions: Map<string, SessionAcc>): Promise<number> {
  let badLines = 0;
  const rl = createInterface({ input: createReadStream(full, "utf8"), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.length === 0) continue;
    // Cheap prefilter: user/tool-result/etc. lines never mention "assistant" and skip JSON.parse entirely.
    if (!line.includes('"assistant"')) continue;
    let rec: any;
    try {
      rec = JSON.parse(line);
    } catch {
      badLines++;
      continue;
    }
    if (rec.type !== "assistant") continue;
    const msg = rec.message;
    if (!msg?.usage || msg.model === "<synthetic>") continue;
    const at = typeof rec.timestamp === "string" ? new Date(rec.timestamp) : null;
    if (!at || Number.isNaN(at.getTime())) {
      badLines++; // invalid/missing timestamp: skip record, folded into the same warning bucket
      continue;
    }
    if (at.getTime() < period.from.getTime() || at.getTime() >= period.to.getTime()) continue;

    const sessionId: string | undefined = rec.sessionId;
    if (!sessionId) continue;
    let sess = sessions.get(sessionId);
    if (!sess) {
      const cwd = typeof rec.cwd === "string" && rec.cwd.length > 0 ? rec.cwd : undefined;
      const project = cwd ? path.basename(cwd) : (rel.split(path.sep)[0] ?? sessionId);
      sess = { project, turns: new Map() };
      sessions.set(sessionId, sess);
    }

    // Dedup 1: one API message is logged as several lines (one per content block), each repeating the
    // full usage. One Turn per (message.id, requestId); if copies disagree keep the larger output_tokens.
    const key = `${msg.id}|${rec.requestId ?? rec.uuid}`;
    const usage = mapUsage(msg.usage);
    let turn = sess.turns.get(key);
    if (!turn) {
      turn = { at, model: msg.model, usage, tools: new Map() };
      sess.turns.set(key, turn);
    } else if (usage.output > turn.usage.output) {
      turn.usage = usage;
      turn.model = msg.model;
    }

    // Dedup 2: tool_use blocks come from every line of the message and whole lines can be replayed
    // verbatim, so collect across lines and dedup by block id.
    for (const block of msg.content ?? []) {
      if (block?.type !== "tool_use" || typeof block.id !== "string" || turn.tools.has(block.id)) continue;
      const input = block.input;
      const file = input?.file_path ?? input?.notebook_path;
      turn.tools.set(block.id, { name: block.name, files: typeof file === "string" ? [file] : [] });
    }
  }
  return badLines;
}

export async function scanClaude(dir: string, period: Period): Promise<ScanResult> {
  const projectsDir = path.join(dir, "projects");
  let entries: string[];
  try {
    entries = (await readdir(projectsDir, { recursive: true })).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return { sessions: [], warnings: [] };
  }

  const warnings: string[] = [];
  const sessions = new Map<string, SessionAcc>();
  for (const rel of entries) {
    const full = path.join(projectsDir, rel);
    let mtimeMs: number;
    try {
      mtimeMs = (await stat(full)).mtimeMs;
    } catch {
      continue;
    }
    if (mtimeMs < period.from.getTime()) continue; // a file can't contain records newer than its mtime

    const badLines = await scanFile(full, rel, period, sessions);
    if (badLines > 0) warnings.push(`${path.join("projects", rel)}: ${badLines} unparsable lines`);
  }

  const result: Session[] = [];
  for (const [id, { project, turns }] of sessions) {
    const turnList: Turn[] = [...turns.values()]
      .map((t): Turn => ({ at: t.at, model: t.model, usage: t.usage, toolCalls: [...t.tools.values()] }))
      .sort((a, b) => a.at.getTime() - b.at.getTime());
    // turns is never empty: a SessionAcc is only created together with its first turn.
    const startedAt = turnList[0]!.at;
    const endedAt = turnList[turnList.length - 1]!.at;
    result.push({ agent: "claude-code", id, project, startedAt, endedAt, turns: turnList });
  }
  return { sessions: result, warnings };
}
