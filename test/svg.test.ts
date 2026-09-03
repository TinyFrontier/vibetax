process.env.TZ = "UTC"; // must run before any Date is created, so local time == UTC in this file

import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cardSvg, type Theme } from "../src/svg.js";
import { renderPng } from "../src/render.js";
import { main } from "../src/cli.js";
import type { Metrics } from "../src/metrics.js";

// 60 days of spend, peak on day 14 to match SAMPLE.mostExpensiveDay below.
function makeByDay(n: number): { date: string; cost: number }[] {
  const start = new Date("2026-07-05T00:00:00.000Z");
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10),
    cost: i === 14 ? 38.1 : Math.round(Math.abs(Math.sin(i / 6)) * 3000) / 100,
  }));
}

// Hand-built Metrics matching the spec §4 sample numbers, plus a persona and a 60-day sparkline.
const SAMPLE: Metrics = {
  period: { from: "2026-06-05T00:00:00.000Z", to: "2026-09-03T00:00:00.000Z" },
  agents: ["claude-code", "codex"],
  sessions: 214,
  totalCost: 412.8,
  estimated: false,
  totalTokens: 48_200_000,
  agentTimeMs: 61 * 3600e3 + 12 * 60e3,
  longestSessionMs: 4 * 3600e3 + 7 * 60e3,
  mostExpensiveDay: { date: "2026-08-14", cost: 38.1 },
  favoriteTool: { name: "Edit", calls: 2341 },
  mostTouchedFile: { file: "api/router.ts", count: 12 },
  peakHour: 23,
  topModel: { model: "claude-opus-4-1", cost: 300 },
  byDay: makeByDay(60),
  persona: "Night Owl",
  warnings: [],
};

const LABEL = "last 90 days";
const DATE_RANGE = "JUN 1 — SEP 3 2026";
const card = (m: Metrics, theme: Theme, portrait: boolean) => cardSvg(m, { label: LABEL, theme, portrait, dateRange: DATE_RANGE });

describe("cardSvg", () => {
  const combos: { theme: Theme; portrait: boolean; w: number; h: number }[] = [
    { theme: "dark", portrait: false, w: 1200, h: 675 },
    { theme: "dark", portrait: true, w: 1080, h: 1350 },
    { theme: "light", portrait: false, w: 1200, h: 675 },
    { theme: "light", portrait: true, w: 1080, h: 1350 },
  ];
  for (const c of combos) {
    it(`${c.theme} ${c.portrait ? "portrait" : "landscape"}: renders a well-formed, complete card`, () => {
      const svg = card(SAMPLE, c.theme, c.portrait);
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg).toContain(`width="${c.w}"`);
      expect(svg).toContain(`height="${c.h}"`);
      expect(svg).toContain("$412.80");
      expect(svg).toContain("NIGHT OWL");
      expect(svg).toContain("npx vibetax");
      expect(svg).toContain("DAILY SPEND · 60 DAYS");
      expect(svg).not.toContain("undefined");
      expect(svg).not.toContain("NaN");
      expect(svg).not.toContain("c2pa");
    });
  }

  it("omits the stamp entirely when persona is null", () => {
    expect(card({ ...SAMPLE, persona: null }, "dark", false)).not.toContain("CERTIFIED");
  });

  it("omits the sparkline entirely when byDay is empty", () => {
    expect(card({ ...SAMPLE, byDay: [] }, "dark", false)).not.toContain("DAILY SPEND");
  });

  it("shrinks the big number's font-size to fit a longer, estimated amount", () => {
    const base = card(SAMPLE, "dark", false);
    const big = card({ ...SAMPLE, totalCost: 14490.54, estimated: true }, "dark", false);
    const baseSize = base.match(/font-size="([\d.]+)"[^>]*>\$412\.80</);
    const bigSize = big.match(/font-size="([\d.]+)"[^>]*>≈ \$14,490\.54</);
    expect(baseSize).not.toBeNull();
    expect(bigSize).not.toBeNull();
    expect(Number(bigSize![1])).toBeLessThan(Number(baseSize![1]));
  });

  it("truncates a very long most-touched-file value with an ellipsis", () => {
    const longFile = "src/" + "x".repeat(116);
    expect(longFile.length).toBe(120);
    const svg = card({ ...SAMPLE, mostTouchedFile: { file: longFile, count: 1 } }, "dark", false);
    expect(svg).not.toContain(longFile);
    expect(svg).toContain("…");
  });

  it("escapes & < > in text content", () => {
    const svg = card({ ...SAMPLE, topModel: { model: "weird<&>model", cost: 1 } }, "dark", false);
    expect(svg).toContain("&lt;&amp;&gt;");
    expect(svg).not.toContain("weird<&>model");
  });
});

describe("renderPng", () => {
  it("renders a real PNG whose IHDR dimensions match the layout", () => {
    for (const [portrait, w, h] of [[false, 1200, 675], [true, 1080, 1350]] as const) {
      const png = Buffer.from(renderPng(card(SAMPLE, "dark", portrait)));
      expect(png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      expect(png.readUInt32BE(16)).toBe(w); // IHDR width
      expect(png.readUInt32BE(20)).toBe(h); // IHDR height
    }
  });
});

describe("main: image flags", () => {
  const claudeDir = "test/fixtures/claude";
  const codexDir = "test/fixtures/codex";
  const period = "2026-08-01..2026-08-31";

  it("--out saves a real PNG and prints the saved line", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "vibetax-png-"));
    const outPath = path.join(dir, "card.png");
    try {
      const out: string[] = [];
      const code = await main(["--claude-dir", claudeDir, "--codex-dir", codexDir, "--period", period, "--out", outPath], { out: (s) => out.push(s), err: () => {} });
      expect(code).toBe(0);
      expect(out.join("")).toContain("✓ saved");
      expect(statSync(outPath).size).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("--no-image writes no file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "vibetax-noimg-"));
    const outPath = path.join(dir, "card.png");
    try {
      const code = await main(["--claude-dir", claudeDir, "--codex-dir", codexDir, "--period", period, "--out", outPath, "--no-image"], { out: () => {}, err: () => {} });
      expect(code).toBe(0);
      expect(existsSync(outPath)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("--json writes no file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "vibetax-json-"));
    const outPath = path.join(dir, "card.png");
    try {
      const code = await main(["--claude-dir", claudeDir, "--codex-dir", codexDir, "--period", period, "--out", outPath, "--json"], { out: () => {}, err: () => {} });
      expect(code).toBe(0);
      expect(existsSync(outPath)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns 2 on an invalid --theme", async () => {
    const code = await main(["--theme", "neon"], { out: () => {}, err: () => {} });
    expect(code).toBe(2);
  });
});
