process.env.TZ = "UTC"; // must run before any Date is created, so local time == UTC in this file

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeMetrics } from "../src/metrics.js";
import { cost, loadPricing, priceFor, type Price, type PriceTable } from "../src/pricing.js";
import { scanClaude } from "../src/claude.js";
import { EMPTY_USAGE, type Period, type Session, type Turn, type Usage } from "../src/types.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "claude");

const ZERO: Usage = { input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 };

// Tiny inline table: exact-match prices only, no family fallback needed for test 1.
const TABLE: PriceTable = {
  models: {
    "claude-opus-5": { input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5 },
    "claude-sonnet-5": { input: 2, output: 10, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.2 },
    "claude-haiku-4-5": { input: 1, output: 5, cacheWrite5m: 1.25, cacheWrite1h: 2, cacheRead: 0.1 },
  },
  families: { opus: "claude-opus-5", sonnet: "claude-sonnet-5", haiku: "claude-haiku-4-5" },
};

describe("computeMetrics", () => {
  it("matches hand-computed values on synthetic sessions", () => {
    // S1: claude-code/alpha, model claude-opus-5 ($5/1M input). 4 turns, each 1,000,000 input tokens
    // => $5.00/turn => $20.00 total, 4,000,000 tokens total.
    // Gaps: 10:00->10:10 = 10min (counted, 600_000ms), 10:10->10:50 = 40min (>30min, contributes 0),
    // 10:50->11:00 = 10min (counted, 600_000ms) => agentTimeMs = 1_200_000.
    // Session span 10:00->11:00 = 3_600_000ms (no pause cut) => longestSessionMs candidate.
    const s1: Session = {
      agent: "claude-code",
      id: "s1",
      project: "alpha",
      startedAt: new Date("2026-08-10T10:00:00Z"),
      endedAt: new Date("2026-08-10T11:00:00Z"),
      turns: [
        {
          at: new Date("2026-08-10T10:00:00Z"),
          model: "claude-opus-5",
          usage: { ...ZERO, input: 1_000_000 },
          toolCalls: [
            { name: "Edit", files: ["/a/src/x.ts"] },
            { name: "Bash", files: [] },
          ],
        },
        {
          at: new Date("2026-08-10T10:10:00Z"),
          model: "claude-opus-5",
          usage: { ...ZERO, input: 1_000_000 },
          toolCalls: [{ name: "Bash", files: [] }],
        },
        {
          at: new Date("2026-08-10T10:50:00Z"),
          model: "claude-opus-5",
          usage: { ...ZERO, input: 1_000_000 },
          toolCalls: [
            { name: "Edit", files: ["/a/src/x.ts"] },
            { name: "Read", files: ["/b/src/x.ts"] },
          ],
        },
        {
          at: new Date("2026-08-10T11:00:00Z"),
          model: "claude-opus-5",
          usage: { ...ZERO, input: 1_000_000 },
          toolCalls: [{ name: "Bash", files: [] }],
        },
      ],
    };

    // S2: single turn on 2026-08-11 23:30, different model (sonnet, $2/1M input), 1,000,000 input
    // tokens => $2.00, 1,000,000 tokens. Single-turn session => contributes 0 to agentTimeMs.
    const s2: Session = {
      agent: "claude-code",
      id: "s2",
      project: "alpha",
      startedAt: new Date("2026-08-11T23:30:00Z"),
      endedAt: new Date("2026-08-11T23:30:00Z"),
      turns: [
        {
          at: new Date("2026-08-11T23:30:00Z"),
          model: "claude-sonnet-5",
          usage: { ...ZERO, input: 1_000_000 },
          toolCalls: [],
        },
      ],
    };

    // S3: background session on 2026-08-12 09:00, model haiku ($1/1M input), 3,000,000 input tokens
    // => $3.00, 3,000,000 tokens. Must count in cost/tokens/time, must NOT count in `sessions`.
    const s3: Session = {
      agent: "claude-code",
      id: "s3",
      project: "alpha",
      startedAt: new Date("2026-08-12T09:00:00Z"),
      endedAt: new Date("2026-08-12T09:00:00Z"),
      turns: [
        {
          at: new Date("2026-08-12T09:00:00Z"),
          model: "claude-haiku-4-5",
          usage: { ...ZERO, input: 3_000_000 },
          toolCalls: [],
        },
      ],
      background: true,
    };

    const period: Period = { from: new Date("2026-08-01T00:00:00Z"), to: new Date("2026-09-01T00:00:00Z") };
    const metrics = computeMetrics([s1, s2, s3], period, TABLE);

    // period: straight passthrough of the given range as ISO strings.
    expect(metrics.period).toEqual({ from: "2026-08-01T00:00:00.000Z", to: "2026-09-01T00:00:00.000Z" });
    // agents: distinct, sorted — only claude-code used here.
    expect(metrics.agents).toEqual(["claude-code"]);
    // sessions: s1 + s2 (s3 is background, excluded from the count).
    expect(metrics.sessions).toBe(2);
    // totalCost: 20.00 (s1) + 2.00 (s2) + 3.00 (s3, background still counts) = 25.00.
    expect(metrics.totalCost).toBeCloseTo(25, 6);
    // every turn priced by an exact table entry, no family fallback, no unknown model.
    expect(metrics.estimated).toBe(false);
    // totalTokens: 4,000,000 (s1) + 1,000,000 (s2) + 3,000,000 (s3) = 8,000,000.
    expect(metrics.totalTokens).toBe(8_000_000);
    // agentTimeMs: only s1 contributes, 10min + 10min (40min gap cut) = 20min = 1_200_000ms.
    expect(metrics.agentTimeMs).toBe(1_200_000);
    // longestSessionMs: s1 spans 60min = 3_600_000ms, no pause cut; s2/s3 are 0-length single turns.
    expect(metrics.longestSessionMs).toBe(3_600_000);
    // mostExpensiveDay: 2026-08-10 has all 4 of s1's $5 turns = $20, beats 08-11 ($2) and 08-12 ($3).
    expect(metrics.mostExpensiveDay).toEqual({ date: "2026-08-10", cost: 20 });
    // favoriteTool: Bash appears 3 times (s1 turns 1, 2, 4), Edit 2, Read 1.
    expect(metrics.favoriteTool).toEqual({ name: "Bash", calls: 3 });
    // mostTouchedFile: /a/src/x.ts touched twice (Edit x2) beats /b/src/x.ts once (Read x1);
    // full paths are distinct keys, display collapses to parentDir/basename = "src/x.ts".
    expect(metrics.mostTouchedFile).toEqual({ file: "src/x.ts", count: 2 });
    // peakHour: hour 10 (UTC) has 3 turns (10:00, 10:10, 10:50) vs 1 turn for hours 11, 23, 9.
    expect(metrics.peakHour).toBe(10);
    // topModel: claude-opus-5 (s1) totals $20, beats sonnet ($2) and haiku ($3).
    expect(metrics.topModel).toEqual({ model: "claude-opus-5", cost: 20 });
    // no unknown models in this test.
    expect(metrics.warnings).toEqual([]);
  });

  it("prices an unknown-but-familiar model via family fallback, and an unknown model as $0 with a warning", () => {
    const session: Session = {
      agent: "claude-code",
      id: "s1",
      project: "p",
      startedAt: new Date("2026-08-10T10:00:00Z"),
      endedAt: new Date("2026-08-10T10:10:00Z"),
      turns: [
        {
          // Not a key in TABLE.models, but "opus" is a substring => family fallback to claude-opus-5 ($5/1M input).
          at: new Date("2026-08-10T10:00:00Z"),
          model: "claude-opus-9-preview",
          usage: { ...ZERO, input: 1_000_000 },
          toolCalls: [],
        },
        {
          // Matches no model key and no family substring => priced as $0, one warning.
          at: new Date("2026-08-10T10:10:00Z"),
          model: "mystery-1",
          usage: { ...ZERO, input: 1_000_000 },
          toolCalls: [],
        },
      ],
    };
    const period: Period = { from: new Date("2026-08-01T00:00:00Z"), to: new Date("2026-09-01T00:00:00Z") };
    const metrics = computeMetrics([session], period, TABLE);

    expect(metrics.totalCost).toBeCloseTo(5, 6); // family-priced turn only; unknown turn costs $0
    expect(metrics.estimated).toBe(true);
    expect(metrics.warnings).toEqual(["unknown model mystery-1: priced as $0"]);
  });
});

describe("priceFor", () => {
  it("matches the longest prefix key exactly, over family fallback", () => {
    const table: PriceTable = {
      models: { "claude-opus-4-1": { input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5 } },
      families: { opus: "claude-opus-4-1" },
    };
    const result = priceFor("claude-opus-4-1-20250805", table);
    expect(result).toEqual({ price: table.models["claude-opus-4-1"], estimated: false });
  });

  it("matches an exact single-entry table", () => {
    const table: PriceTable = {
      models: { "claude-opus-5": { input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5 } },
      families: {},
    };
    const result = priceFor("claude-opus-5", table);
    expect(result).toEqual({ price: table.models["claude-opus-5"], estimated: false });
  });
});

describe("loadPricing", () => {
  it("loads the bundled pricing.json with claude-opus-5 and claude-sonnet-5", () => {
    const table = loadPricing();
    expect(table.models["claude-opus-5"]).toBeTruthy();
    expect(table.models["claude-sonnet-5"]).toBeTruthy();
    const priced = priceFor("claude-opus-5", table)!;
    expect(cost({ input: 1_000_000, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 }, priced.price)).toBe(5);
  });
});

describe("computeMetrics + scanClaude (end-to-end)", () => {
  it("prices the Claude fixtures against the bundled pricing table", async () => {
    const period: Period = { from: new Date("2026-08-01T00:00:00Z"), to: new Date("2026-09-01T00:00:00Z") };
    const expected = JSON.parse(readFileSync(path.join(FIXTURES, "expected.json"), "utf8"));
    const table = loadPricing();

    const { sessions } = await scanClaude(FIXTURES, period);
    const metrics = computeMetrics(sessions, period, table);

    expect(metrics.sessions).toBe(3);
    expect(metrics.estimated).toBe(false);
    expect(metrics.warnings).toEqual([]);

    // Independent cost computation straight from expected.json's per_model usage, not via computeMetrics.
    function manualCost(u: Usage, p: Price): number {
      return (
        (u.input * p.input + u.output * p.output + u.cacheWrite5m * p.cacheWrite5m + u.cacheWrite1h * p.cacheWrite1h + u.cacheRead * p.cacheRead) /
        1e6
      );
    }
    let expectedCost = 0;
    for (const session of Object.values(expected.sessions) as any[]) {
      for (const [model, usage] of Object.entries(session.per_model) as [string, Usage][]) {
        const priced = priceFor(model, table);
        expect(priced?.estimated).toBe(false);
        expectedCost += manualCost(usage, priced!.price);
      }
    }
    expect(metrics.totalCost).toBeCloseTo(expectedCost, 6);

    const u = expected.all.usage;
    expect(metrics.totalTokens).toBe(u.input + u.output + u.cacheWrite5m + u.cacheWrite1h + u.cacheRead);
  });
});

describe("byDay and persona", () => {
  const table = loadPricing();
  const turn = (iso: string): Turn => ({ at: new Date(iso), model: "claude-opus-5", usage: { ...EMPTY_USAGE, input: 1_000_000 }, toolCalls: [] });
  const session = (id: string, turns: Turn[]): Session => ({ agent: "claude-code", id, project: "p", startedAt: turns[0]!.at, endedAt: turns[turns.length - 1]!.at, turns });
  const period: Period = { from: new Date("2026-08-01T00:00:00Z"), to: new Date("2026-08-06T00:00:00Z") };

  it("fills every day of the period from the first turn on, zeros included", () => {
    const m = computeMetrics([session("s", [turn("2026-08-03T10:00:00Z"), turn("2026-08-05T10:00:00Z"), turn("2026-08-05T11:00:00Z")])], period, table);
    expect(m.byDay).toEqual([
      { date: "2026-08-03", cost: 5 },
      { date: "2026-08-04", cost: 0 },
      { date: "2026-08-05", cost: 10 },
    ]);
  });

  it("picks Night Owl when 30% of turns fall between 22:00 and 05:00, else falls through", () => {
    const night = computeMetrics([session("s", [turn("2026-08-03T23:00:00Z"), turn("2026-08-04T01:00:00Z"), turn("2026-08-04T12:00:00Z")])], period, table);
    expect(night.persona).toBe("Night Owl");
    const sprinter = computeMetrics([session("s", [turn("2026-08-03T12:00:00Z"), turn("2026-08-03T12:05:00Z")])], period, table);
    expect(sprinter.persona).toBe("Sprinter");
    expect(computeMetrics([], period, table)).toMatchObject({ byDay: [], persona: null });
  });
});
