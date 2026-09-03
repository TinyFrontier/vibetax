import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, cp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanClaude } from "../src/claude.js";
import { EMPTY_USAGE, type Period, type Turn, type Usage } from "../src/types.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "claude");
const expected = JSON.parse(readFileSync(path.join(FIXTURES, "expected.json"), "utf8"));
const AUGUST: Period = { from: new Date("2026-08-01T00:00:00Z"), to: new Date("2026-09-01T00:00:00Z") };

const A_ID = "1e6f88bb-7003-4edb-8776-b4e02f9f979e";
const B_ID = "d1c901fe-f6d0-4d77-a4a6-ca4a0d084be8";
const C_ID = "a020e721-edf7-47cf-997e-8f419333a544";

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

function maxGapMinutes(turns: Turn[]): number {
  let max = 0;
  for (let i = 1; i < turns.length; i++) max = Math.max(max, turns[i]!.at.getTime() - turns[i - 1]!.at.getTime());
  return Math.round(max / 600) / 100;
}

describe("scanClaude", () => {
  it("matches expected.json over the full fixture period", async () => {
    const result = await scanClaude(FIXTURES, AUGUST);
    expect(result.sessions).toHaveLength(expected.all.sessions);

    for (const [id, exp] of Object.entries(expected.sessions) as [string, any][]) {
      const session = result.sessions.find((s) => s.id === id);
      expect(session, `session ${id}`).toBeTruthy();
      if (!session) continue;
      expect(session.project).toBe(exp.project);
      expect(session.turns).toHaveLength(exp.unique_messages);
      expect(sumUsage(session.turns)).toEqual(exp.usage);
      for (const [model, usage] of Object.entries(exp.per_model)) {
        expect(sumUsage(session.turns.filter((t) => t.model === model))).toEqual(usage);
      }
      const calls = session.turns.flatMap((t) => t.toolCalls);
      expect(count(calls.map((c) => c.name))).toEqual(exp.tool_calls);
      expect(count(calls.flatMap((c) => c.files))).toEqual(exp.files_touched);
      expect(session.startedAt.toISOString()).toBe(exp.first_ts);
      expect(session.endedAt.toISOString()).toBe(exp.last_ts);
      expect(maxGapMinutes(session.turns)).toBe(exp.max_gap_minutes);
    }

    // Session A's main file has a truncated assistant line (counted) and a plain-garbage line
    // (never parsed because it doesn't mention "assistant", so not counted).
    expect(result.warnings).toEqual([`projects/-Users-dev-work-alpha/${A_ID}.jsonl: 1 unparsable lines`]);
  });

  it("filters turns by period (half-open, from <= at < to)", async () => {
    const period: Period = { from: new Date("2026-08-23T00:00:00Z"), to: AUGUST.to };
    const result = await scanClaude(FIXTURES, period);
    expect(result.sessions.find((s) => s.id === B_ID)).toBeUndefined(); // Aug 3
    expect(result.sessions.find((s) => s.id === C_ID)?.turns).toHaveLength(expected.sessions[C_ID].unique_messages); // Aug 25
    // Session A spans Aug 22-23 UTC: 3 of its 9 unique messages start on Aug 23 (counted with jq, see fixtures README).
    const a = result.sessions.find((s) => s.id === A_ID);
    expect(a?.turns).toHaveLength(3);
    for (const t of a?.turns ?? []) expect(t.at.getTime()).toBeGreaterThanOrEqual(period.from.getTime());
  });

  it("skips files whose mtime predates the period", async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), "vibetax-claude-"));
    try {
      const dest = path.join(tmp, "projects", "-Users-dev-work-beta", `${B_ID}.jsonl`);
      await mkdir(path.dirname(dest), { recursive: true });
      await cp(path.join(FIXTURES, "projects", "-Users-dev-work-beta", `${B_ID}.jsonl`), dest);
      const old = new Date("2026-07-01T00:00:00Z");
      await utimes(dest, old, old);
      expect((await scanClaude(tmp, AUGUST)).sessions).toHaveLength(0);
      await utimes(dest, new Date(), new Date());
      expect((await scanClaude(tmp, AUGUST)).sessions).toHaveLength(1);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("returns an empty result when the claude dir doesn't exist", async () => {
    expect(await scanClaude(path.join(tmpdir(), "vibetax-nope-" + Date.now()), AUGUST)).toEqual({ sessions: [], warnings: [] });
  });
});
