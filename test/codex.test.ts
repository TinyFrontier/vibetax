import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, cp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanCodex } from "../src/codex.js";
import { EMPTY_USAGE, type Period, type Turn, type Usage } from "../src/types.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "codex");
const expected = JSON.parse(readFileSync(path.join(FIXTURES, "expected.json"), "utf8"));
const FULL: Period = { from: new Date("2026-01-01T00:00:00Z"), to: new Date("2026-09-01T00:00:00Z") };

const PARENT_ID = "01a0fad6-bfcd-745f-a8b3-4b95e5b09ccb"; // A + A2, session "A" below
const SUBAGENT_ID = "01a0881f-656f-73d6-92fb-05dd5bc559f9"; // B, merges into PARENT_ID
const GUARDIAN_ID = "01a0e118-c48f-7e72-899c-c6a2ce508062"; // C
const OLD_FORMAT_ID = "01a038be-6baa-7e3b-b036-7c0474a20840"; // D, no token_count events at all

const A_FILE = path.join(FIXTURES, "sessions", "2026", "08", "21", "rollout-2026-08-21T22-03-42-01a0fad6-bfcd-745f-a8b3-4b95e5b09ccb.jsonl");
const A2_FILE = path.join(
  FIXTURES,
  "sessions",
  "2026",
  "08",
  "22",
  "rollout-2026-08-22T09-40-28-01a0fad6-bfcd-745f-a8b3-4b95e5b09ccb_01a035e6-aa75-7b75-baef-5b060f8073ed.jsonl",
);
const D_FILE = path.join(FIXTURES, "sessions", "2026", "04", "14", "rollout-2026-04-14T21-40-23-01a038be-6baa-7e3b-b036-7c0474a20840.jsonl");

// Independently of the parser: count non-null-info token_count events in a raw fixture file, and how many
// are "repeated" (identical total_token_usage.total_tokens as the immediately preceding one) - a repeat
// produces no turn, per the delta rule (spec 5.2).
function countTokenEvents(filePath: string): { events: number; repeats: number } {
  const lines = readFileSync(filePath, "utf8").split("\n").filter((l) => l.length > 0);
  let events = 0;
  let repeats = 0;
  let prevTotalTokens: number | null = null;
  for (const line of lines) {
    let rec: any;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (rec.type !== "event_msg" || rec.payload?.type !== "token_count" || rec.payload.info == null) continue;
    events++;
    const total = rec.payload.info.total_token_usage.total_tokens;
    if (prevTotalTokens !== null && total === prevTotalTokens) repeats++;
    prevTotalTokens = total;
  }
  return { events, repeats };
}

function sumUsage(turns: Turn[]): Usage {
  const acc = { ...EMPTY_USAGE };
  for (const t of turns) for (const k of Object.keys(acc) as (keyof Usage)[]) acc[k] += t.usage[k];
  return acc;
}

function count(keys: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = (out[k] ?? 0) + 1;
  return out;
}

function addCounts(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v;
  return out;
}

// expected.json keeps A and its merged subagent B as separate entries (it doesn't do the parent/subagent
// fold-in the parser does); combine them the way scanCodex is specified to, for comparison against A's session.
function mergeExpected(a: any, b: any) {
  const usage: Record<string, number> = { ...a.usage };
  for (const k of Object.keys(usage)) usage[k] += b.usage[k];
  const per_model: Record<string, any> = { ...a.per_model };
  for (const [model, u] of Object.entries(b.per_model) as [string, any][]) {
    per_model[model] = per_model[model]
      ? { input_total: per_model[model].input_total + u.input_total, cached: per_model[model].cached + u.cached, output: per_model[model].output + u.output }
      : u;
  }
  return {
    token_count_events: a.token_count_events + b.token_count_events,
    usage,
    per_model,
    tool_calls: addCounts(a.tool_calls, b.tool_calls),
    files_touched: addCounts(a.files_touched, b.files_touched),
  };
}

describe("scanCodex", () => {
  it("matches expected.json over the full fixture period", async () => {
    const result = await scanCodex(FIXTURES, FULL);
    // 6 entries in expected.json minus the subagent (merges into its parent) minus the old-CLI session
    // (zero turns, dropped) = 4 real sessions.
    expect(result.sessions).toHaveLength(Object.keys(expected.sessions).length - 2);

    for (const [id, exp] of Object.entries(expected.sessions) as [string, any][]) {
      if (id === SUBAGENT_ID || id === OLD_FORMAT_ID) continue; // checked separately below
      const session = result.sessions.find((s) => s.id === id);
      expect(session, `session ${id}`).toBeTruthy();
      if (!session) continue;
      expect(session.project).toBe(exp.project);

      const merged = id === PARENT_ID ? mergeExpected(exp, expected.sessions[SUBAGENT_ID]) : exp;
      // expected.json's token_count_events counts every non-null event, repeats included (a repeat is
      // still a real event, it just produces no turn - see the "does not double-count" test below). A's
      // own files (not B's) contain 2 such repeats, so the turn count is 2 short of the raw event count.
      const repeats = id === PARENT_ID ? countTokenEvents(A_FILE).repeats + countTokenEvents(A2_FILE).repeats : 0;
      expect(session.turns).toHaveLength(merged.token_count_events - repeats);

      const sum = sumUsage(session.turns);
      expect(sum.input + sum.cacheRead).toBe(merged.usage.input_total);
      expect(sum.cacheRead).toBe(merged.usage.cached);
      expect(sum.output).toBe(merged.usage.output);
      for (const [model, u] of Object.entries(merged.per_model) as [string, any][]) {
        const s = sumUsage(session.turns.filter((t) => t.model === model));
        expect(s.input + s.cacheRead).toBe(u.input_total);
        expect(s.cacheRead).toBe(u.cached);
        expect(s.output).toBe(u.output);
      }

      const calls = session.turns.flatMap((t) => t.toolCalls);
      expect(count(calls.map((c) => c.name))).toEqual(merged.tool_calls);
      expect(count(calls.flatMap((c) => c.files))).toEqual(merged.files_touched);

      expect(session.background).toBe(id === GUARDIAN_ID ? true : undefined);

      // expected.json's first_ts/last_ts are computed over ALL records (see README + the old-format
      // session, which has first_ts/last_ts despite zero token_count_events) - not just token_count
      // events, so they don't line up with startedAt/endedAt (which come from turns only). Check shape
      // instead of exact equality.
      expect(session.startedAt.getTime()).toBeLessThanOrEqual(session.endedAt.getTime());
      expect(session.startedAt.getTime()).toBeGreaterThanOrEqual(FULL.from.getTime());
      expect(session.endedAt.getTime()).toBeLessThan(FULL.to.getTime());
    }

    // The subagent (B) is folded into its parent (A) and never appears standalone.
    expect(result.sessions.find((s) => s.id === SUBAGENT_ID)).toBeUndefined();
    // The old-format (pre-0.100) session has no token_count events, so zero turns, so it's dropped.
    expect(result.sessions.find((s) => s.id === OLD_FORMAT_ID)).toBeUndefined();

    // Deviation from the brief: only the truncated-JSON line is a real "unparsable" line. The spliced
    // bare `garbage line` never contains any prefilter substring, so - exactly like a Claude "user" line -
    // it's skipped before JSON.parse is ever attempted and isn't counted. That's 1 unparsable line, not 2.
    expect(result.warnings).toContain(
      "sessions/2026/08/21/rollout-2026-08-21T22-03-42-01a0fad6-bfcd-745f-a8b3-4b95e5b09ccb.jsonl: 1 unparsable lines",
    );
    expect(result.warnings).toContain("sessions/2026/04/14/rollout-2026-04-14T21-40-23-01a038be-6baa-7e3b-b036-7c0474a20840.jsonl: no usage events (old Codex CLI?)");
  });

  it("does not double-count a repeated token_count event", async () => {
    const { events, repeats } = countTokenEvents(A2_FILE);
    expect(events).toBeGreaterThan(0);
    expect(repeats).toBeGreaterThan(0); // sanity: the fixture does contain a repeat to guard against

    const tmp = await mkdtemp(path.join(tmpdir(), "vibetax-codex-a2-"));
    try {
      const dest = path.join(tmp, "sessions", "2026", "08", "22", path.basename(A2_FILE));
      await mkdir(path.dirname(dest), { recursive: true });
      await cp(A2_FILE, dest);
      const result = await scanCodex(tmp, FULL);
      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0]?.turns).toHaveLength(events - repeats);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("filters turns by period (half-open, from <= at < to)", async () => {
    const period: Period = { from: new Date("2026-08-27T00:00:00Z"), to: new Date("2026-09-01T00:00:00Z") };
    const result = await scanCodex(FIXTURES, period);

    const guardian = result.sessions.find((s) => s.id === GUARDIAN_ID);
    expect(guardian).toBeTruthy();
    expect(guardian?.background).toBe(true);

    // A's own turns (Aug 21-22) predate the period and are filtered out entirely. But the parent/subagent
    // merge (spec 5.2) is unconditional on turns surviving the period filter: B (the subagent, Aug 31) is
    // still in period and still merges into A's id. So a session keyed by A's id IS present here - it
    // just carries only B's turns. Deviation from a literal "session A absent": the merge step doesn't
    // know or care that the turns it just inherited are the *only* ones left under that id.
    const a = result.sessions.find((s) => s.id === PARENT_ID);
    expect(a).toBeTruthy();
    expect(a?.turns).toHaveLength(expected.sessions[SUBAGENT_ID].token_count_events);
    for (const t of a?.turns ?? []) {
      expect(t.at.getTime()).toBeGreaterThanOrEqual(period.from.getTime());
      expect(t.at.getTime()).toBeLessThan(period.to.getTime());
    }

    expect(result.sessions.find((s) => s.id === OLD_FORMAT_ID)).toBeUndefined();
  });

  it("returns an empty result when the codex dir doesn't exist", async () => {
    expect(await scanCodex(path.join(tmpdir(), "vibetax-nope-" + Date.now()), FULL)).toEqual({ sessions: [], warnings: [] });
  });

  it("falls back to config.toml's model when a session has no turn_context", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "vibetax-codex-default-"));
    try {
      const dest = path.join(tmp, "sessions", "2026", "04", "14", path.basename(D_FILE));
      await mkdir(path.dirname(dest), { recursive: true });
      // Copy D but drop its turn_context lines: D has real ones (model gpt-5.3-codex) that would
      // otherwise mask the config default we're testing, since turn_context always wins once seen.
      const raw = readFileSync(D_FILE, "utf8");
      const kept = raw
        .split("\n")
        .filter((l) => l.length > 0)
        .filter((l) => {
          try {
            return JSON.parse(l).type !== "turn_context";
          } catch {
            return true;
          }
        });
      const synthetic = JSON.stringify({
        timestamp: "2026-04-14T21:50:00.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 15 },
            last_token_usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 15 },
          },
        },
      });
      await writeFile(dest, [...kept, synthetic].join("\n") + "\n");
      await writeFile(path.join(tmp, "config.toml"), 'model = "gpt-test"\n');

      const result = await scanCodex(tmp, FULL);
      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0]?.turns).toHaveLength(1);
      expect(result.sessions[0]?.turns[0]?.model).toBe("gpt-test");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
