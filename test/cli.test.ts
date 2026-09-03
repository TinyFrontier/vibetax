process.env.TZ = "UTC"; // must run before any Date is created, so local time == UTC in this file

import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parsePeriod, money, tokens, duration, hourRange, anonymize, terminalCard } from "../src/card.js";
import { main } from "../src/cli.js";
import type { Metrics } from "../src/metrics.js";

describe("parsePeriod", () => {
  const now = new Date("2026-09-03T12:00:00Z");

  it("30d: 30 calendar days including today, from local midnight", () => {
    const { period, label } = parsePeriod("30d", now);
    expect(period.from.toISOString()).toBe("2026-08-05T00:00:00.000Z");
    expect(period.to).toEqual(now);
    expect(label).toBe("last 30 days");
  });

  it("rejects dates that are not on the calendar and reversed ranges", () => {
    expect(() => parsePeriod("2026-13-01..2026-08-15", now)).toThrow(/calendar/);
    expect(() => parsePeriod("2026-02-30..2026-03-01", now)).toThrow(/calendar/);
    expect(() => parsePeriod("2026-08-15..2026-08-01", now)).toThrow(/after end/);
    const day = parsePeriod("2026-08-10..2026-08-10", now); // a single day is fine
    expect(day.period.from.toISOString()).toBe("2026-08-10T00:00:00.000Z");
    expect(day.period.to.toISOString()).toBe("2026-08-11T00:00:00.000Z");
  });

  it("ytd: from local Jan 1 of now's year", () => {
    const { period, label } = parsePeriod("ytd", now);
    expect(period.from.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(period.to).toEqual(now);
    expect(label).toBe("2026 so far");
  });

  it("A..B: half-open range, inclusive of B's whole day", () => {
    const { period, label } = parsePeriod("2026-06-01..2026-08-31", now);
    expect(period.from.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(period.to.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(label).toBe("Jun 1 – Aug 31, 2026");
  });

  it("all: from epoch", () => {
    const { period } = parsePeriod("all", now);
    expect(period.from.toISOString()).toBe("1970-01-01T00:00:00.000Z");
    expect(period.to).toEqual(now);
  });

  it("rejects garbage", () => {
    expect(() => parsePeriod("13x", now)).toThrow();
  });
});

describe("formatters", () => {
  it("money", () => {
    expect(money(412.8)).toBe("$412.80");
    expect(money(4737.19)).toBe("$4,737.19");
  });

  it("tokens", () => {
    expect(tokens(48_200_000)).toBe("48.2M");
    expect(tokens(6_412_088_192)).toBe("6.4B");
    expect(tokens(512)).toBe("512");
    expect(tokens(1_000_000)).toBe("1M");
  });

  it("duration", () => {
    expect(duration(61 * 3600e3 + 12 * 60e3)).toBe("61 h 12 m");
    expect(duration(4 * 3600e3 + 7 * 60e3)).toBe("4 h 07 m");
    expect(duration(42 * 60e3)).toBe("42 m");
  });

  it("hourRange", () => {
    expect(hourRange(23)).toBe("23:00–00:00");
  });
});

// Hand-built Metrics matching the spec §4 sample numbers.
const SAMPLE: Metrics = {
  period: { from: "2026-06-05T00:00:00.000Z", to: "2026-09-03T00:00:00.000Z" },
  agents: ["claude-code"],
  sessions: 214,
  totalCost: 412.8,
  estimated: false,
  totalTokens: 48_200_000,
  agentTimeMs: 61 * 3600e3 + 12 * 60e3,
  longestSessionMs: 4 * 3600e3 + 7 * 60e3,
  mostExpensiveDay: { date: "2026-08-14", cost: 38.1 },
  favoriteTool: { name: "Edit", calls: 2341 },
  mostTouchedFile: { file: "src/api/router.ts", count: 12 },
  peakHour: 23,
  topModel: { model: "claude-opus-4-1", cost: 300 },
  warnings: [],
};

describe("terminalCard", () => {
  it("renders a rectangular box with the expected content", () => {
    const out = terminalCard(SAMPLE, "last 90 days", false);
    const lines = out.split("\n");
    const widths = new Set(lines.map((l) => l.length));
    expect(widths.size).toBe(1); // every line the same visible width
    expect(out).toContain("YOUR VIBE TAX · last 90 days");
    expect(out).toContain("$412.80 vibe tax");
    expect(out).toContain("Edit (2,341 calls)");
    expect(out).toContain("23:00–00:00");
    expect(out).toContain("npx vibetax");
    expect(out).toContain("API-equivalent cost");
  });

  it("truncates a very long file name and stays rectangular", () => {
    const longFile = "src/" + "x".repeat(116); // 120 chars
    expect(longFile.length).toBe(120);
    const m: Metrics = { ...SAMPLE, mostTouchedFile: { file: longFile, count: 1 } };
    const out = terminalCard(m, "last 90 days", false);
    const lines = out.split("\n");
    expect(new Set(lines.map((l) => l.length)).size).toBe(1);
    expect(out).toContain("…");
  });

  it("prefixes the money value with ≈ and notes estimation in the caption when estimated", () => {
    const m: Metrics = { ...SAMPLE, estimated: true };
    const out = terminalCard(m, "last 90 days", false);
    expect(out).toContain("≈ $412.80");
    expect(out).toMatch(/API-equivalent cost.*estimated/);
  });
});

describe("anonymize", () => {
  it("turns the most touched file into its extension only", () => {
    const m = anonymize(SAMPLE);
    expect(m.mostTouchedFile).toEqual({ file: "a .ts file", count: 12 });
    // everything else is unchanged
    expect(m.totalCost).toBe(SAMPLE.totalCost);
    expect(m.sessions).toBe(SAMPLE.sessions);
  });
});

describe("main (end-to-end on fixtures)", () => {
  const claudeDir = "test/fixtures/claude";
  const codexDir = "test/fixtures/codex";
  const period = "2026-08-01..2026-08-31";

  it("--json prints valid JSON with aggregated sessions across both agents", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await main(["--claude-dir", claudeDir, "--codex-dir", codexDir, "--period", period, "--json"], {
      out: (s) => out.push(s),
      err: (s) => err.push(s),
    });
    expect(code).toBe(0);
    const metrics = JSON.parse(out.join(""));
    expect(metrics.sessions).toBeGreaterThan(3); // 3 Claude sessions + at least 1 non-background Codex session
    expect(metrics.agents).toEqual(["claude-code", "codex"]);
    expect(metrics.totalCost).toBeGreaterThan(0);
  });

  it("without --json prints the terminal card to stdout and the scan summary to stderr", async () => {
    const out: string[] = [];
    const err: string[] = [];
    // --no-image: this test is about the terminal card, not the PNG (covered in test/svg.test.ts) — skip
    // rendering so it doesn't write a real file into the repo's cwd on every test run.
    const code = await main(["--claude-dir", claudeDir, "--codex-dir", codexDir, "--period", period, "--no-image"], {
      out: (s) => out.push(s),
      err: (s) => err.push(s),
    });
    expect(code).toBe(0);
    const outText = out.join("");
    expect(outText).toContain("YOUR VIBE TAX");
    expect(outText).toContain("share it: https://x.com/intent/post?text=");
    const errText = err.join("");
    expect(errText).toContain("found ");
    expect(errText).toContain("sessions");
  });

  it("--agent claude restricts scanning to Claude Code only", async () => {
    const out: string[] = [];
    const code = await main(["--claude-dir", claudeDir, "--codex-dir", codexDir, "--period", period, "--agent", "claude", "--json"], {
      out: (s) => out.push(s),
      err: () => {},
    });
    expect(code).toBe(0);
    const metrics = JSON.parse(out.join(""));
    expect(metrics.agents).toEqual(["claude-code"]);
  });

  it("returns 1 with a clear message when no logs exist at all", async () => {
    const emptyClaude = await mkdtemp(path.join(tmpdir(), "vibetax-empty-claude-"));
    const emptyCodex = await mkdtemp(path.join(tmpdir(), "vibetax-empty-codex-"));
    try {
      const err: string[] = [];
      const code = await main(["--claude-dir", emptyClaude, "--codex-dir", emptyCodex], { out: () => {}, err: (s) => err.push(s) });
      expect(code).toBe(1);
      expect(err.join("")).toContain("no Claude Code or Codex logs found");
    } finally {
      await rm(emptyClaude, { recursive: true, force: true });
      await rm(emptyCodex, { recursive: true, force: true });
    }
  });

  it("returns 2 on an invalid --period", async () => {
    const err: string[] = [];
    const code = await main(["--period", "nope"], { out: () => {}, err: (s) => err.push(s) });
    expect(code).toBe(2);
  });

  it("--help returns 0 and describes --period", async () => {
    const out: string[] = [];
    const code = await main(["--help"], { out: (s) => out.push(s), err: () => {} });
    expect(code).toBe(0);
    expect(out.join("")).toContain("--period");
  });
});
