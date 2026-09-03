import path from "node:path";
import { styleText } from "node:util";
import type { Period } from "./types.js";
import type { Metrics } from "./metrics.js";

export type PeriodSpec = { period: Period; label: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortDate(y: number, m: number, d: number): string {
  return `${MONTHS[m - 1]} ${d}`;
}

export function parsePeriod(text: string, now: Date): PeriodSpec {
  const nDays = text.match(/^(\d+)d$/);
  if (nDays) {
    // N calendar days including today: "30d" = today plus the 29 days before it, from local midnight.
    const n = Number(nDays[1]);
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (n - 1));
    return { period: { from, to: now }, label: `last ${n} days` };
  }
  if (text === "ytd") {
    return { period: { from: new Date(now.getFullYear(), 0, 1), to: now }, label: `${now.getFullYear()} so far` };
  }
  if (text === "all") {
    return { period: { from: new Date(0), to: now }, label: "all time" };
  }
  const range = text.match(/^(\d{4})-(\d{2})-(\d{2})\.\.(\d{4})-(\d{2})-(\d{2})$/);
  if (range) {
    const [, ay, am, ad, by, bm, bd] = range.map(Number);
    const from = new Date(ay!, am! - 1, ad!);
    const end = new Date(by!, bm! - 1, bd!);
    // Date() silently rolls 2026-13-01 into 2027; a real calendar date survives the round trip unchanged.
    const real = (d: Date, y: number, mo: number, day: number) => d.getFullYear() === y && d.getMonth() === mo - 1 && d.getDate() === day;
    if (!real(from, ay!, am!, ad!) || !real(end, by!, bm!, bd!)) throw new Error(`invalid --period "${text}": not a calendar date`);
    if (from > end) throw new Error(`invalid --period "${text}": start is after end`);
    const to = new Date(by!, bm! - 1, bd! + 1); // half-open: day after B
    const label =
      ay === by ? `${shortDate(ay!, am!, ad!)} – ${shortDate(by!, bm!, bd!)}, ${by}` : `${shortDate(ay!, am!, ad!)}, ${ay} – ${shortDate(by!, bm!, bd!)}, ${by}`;
    return { period: { from, to }, label };
  }
  throw new Error(`invalid --period "${text}": use 7d, 30d, 90d, ytd, all, or YYYY-MM-DD..YYYY-MM-DD`);
}

export function anonymize(m: Metrics): Metrics {
  if (!m.mostTouchedFile) return m;
  const ext = path.extname(m.mostTouchedFile.file);
  const file = ext ? `a ${ext} file` : "a file";
  return { ...m, mostTouchedFile: { ...m.mostTouchedFile, file } };
}

export function money(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export function tokens(n: number): string {
  const units: [number, string][] = [
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [div, suffix] of units) {
    if (Math.abs(n) >= div) return `${(Math.round((n / div) * 10) / 10).toFixed(1).replace(/\.0$/, "")}${suffix}`;
  }
  return String(Math.round(n));
}

export function duration(ms: number): string {
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")} m` : `${m} m`;
}

export function hourRange(h: number): string {
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${pad(h)}:00–${pad((h + 1) % 24)}:00`;
}

export function dayLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return shortDate(y!, m!, d!);
}

export function cardRows(m: Metrics, label: string): { title: string; hero: [string, string][]; rows: [string, string][]; caption: string } {
  const moneyStr = (m.estimated ? "≈ " : "") + money(m.totalCost);
  const hero: [string, string][] = [
    [moneyStr, "vibe tax"],
    [tokens(m.totalTokens), "tokens"],
    [String(m.sessions), "sessions"],
    [duration(m.agentTimeMs), "of agent time"],
  ];
  const rows: [string, string][] = [
    ["Most expensive day", m.mostExpensiveDay ? `${dayLabel(m.mostExpensiveDay.date)} · ${money(m.mostExpensiveDay.cost)}` : "—"],
    ["Longest session", m.longestSessionMs > 0 ? duration(m.longestSessionMs) : "—"],
    ["Favorite tool", m.favoriteTool ? `${m.favoriteTool.name} (${m.favoriteTool.calls.toLocaleString("en-US")} calls)` : "—"],
    ["Most touched file", m.mostTouchedFile ? m.mostTouchedFile.file : "—"],
    ["Peak hour", m.peakHour !== null ? hourRange(m.peakHour) : "—"],
    ["Top model", m.topModel ? m.topModel.model : "—"],
  ];
  const caption = "API-equivalent cost" + (m.estimated ? " · ≈ estimated for some models" : "");
  return { title: `YOUR VIBE TAX · ${label}`, hero, rows, caption };
}

/** Truncates with a trailing "…" when longer than `n`. */
function cut(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** The box grows to its widest line (min 45), so real numbers are never cut; only the file name is capped. */
export function terminalCard(m: Metrics, label: string, color: boolean): string {
  const { title, hero, rows, caption } = cardRows(m, label);
  const cell = (h: [string, string]) => `${h[0]} ${h[1]}`;
  const col = Math.max(cell(hero[0]!).length, cell(hero[2]!).length) + 3;
  const watermark = "npx vibetax";
  // [plain text, substring to style, style]; padding always happens on the plain text, styling after.
  // validateStream: false — the CLI already decides `color` from isTTY/NO_COLOR, styleText must not second-guess it.
  const body: [string, string, Parameters<typeof styleText>[0]][] = [
    [title, "", "dim"],
    ["", "", "dim"],
    [cell(hero[0]!).padEnd(col) + cell(hero[1]!), hero[0]![0], "bold"],
    [cell(hero[2]!).padEnd(col) + cell(hero[3]!), "", "dim"],
    ["", "", "dim"],
    ...rows.map(([l, v]): [string, string, "dim"] => [l.padEnd(22) + cut(v, 40), l, "dim"]),
    ["", "", "dim"],
    [caption, caption, "dim"],
  ];
  const width = Math.max(41, ...body.map(([s]) => s.length)) + 4;
  const line = (plain: string, mark: string, fmt: Parameters<typeof styleText>[0]) => {
    const padded = plain.padEnd(width - 2);
    return `│  ${color && mark ? padded.replace(mark, styleText(fmt, mark, { validateStream: false })) : padded}│`;
  };
  return [
    `┌${"─".repeat(width)}┐`,
    ...body.map(([s, mark, fmt]) => line(s, mark, fmt)),
    `│${(color ? styleText("dim", watermark, { validateStream: false }) : watermark).padStart(width - 2 + (color ? styleText("dim", watermark, { validateStream: false }).length - watermark.length : 0))}  │`,
    `└${"─".repeat(width)}┘`,
  ].join("\n");
}

export function shareUrl(m: Metrics, label: string): string {
  const text = `my vibe tax for ${label}: ${money(m.totalCost)} · ${tokens(m.totalTokens)} tokens · ${m.sessions} sessions. npx vibetax, local only #vibetax`;
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}
