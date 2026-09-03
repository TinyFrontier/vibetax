import type { Agent } from "./types.js";
import type { Metrics } from "./metrics.js";
import { money, duration, dayLabel } from "./card.js";

export type Theme = "dark" | "light";

const ACCENT = "#b9f227";

type Palette = {
  bg0: string; bg1: string; paper: string; ink: string; hero: string;
  labelDim: string; captionDim: string; faint2: string; dividerThick: string; dividerThin: string;
  barOpacity: number; stampBoxFill: string;
};

const THEMES: Record<Theme, Palette> = {
  dark: {
    bg0: "#1a2610", bg1: "#07080a", paper: "#0f1114", ink: "#e9ecee", hero: "#b9f227",
    labelDim: "#7d8590", captionDim: "#5c636d", faint2: "#4d545d", dividerThick: "#242a31", dividerThin: "#1a1e24",
    barOpacity: 0.5, stampBoxFill: "none",
  },
  light: {
    bg0: "#f3f0e6", bg1: "#ded8c9", paper: "#fffdf7", ink: "#14161a", hero: "#14161a",
    labelDim: "#8a8578", captionDim: "#a39d8f", faint2: "#a39d8f", dividerThick: "#cfc9ba", dividerThin: "#e2ddd0",
    barOpacity: 0.17, stampBoxFill: "#b9f227",
  },
};

// Coordinates lifted from the four designer SVGs (receipt, dark/light, 1200x675 and 1080x1350).
const LANDSCAPE = {
  w: 1200, h: 675, bgCx: "18%", bgCy: "0%", bgR: "95%",
  paper: { x: 40, y: 36, w: 1120, h: 603 },
  perf: { x0: 51, x1: 1151, step: 22, y1: 36, y2: 639, r: 10.5 },
  title: { x: 92, y: 118, size: 44, tracking: -0.4, anchor: "start" as const },
  subtitle: { x: 92, y: 143, size: 15, tracking: 3.9, anchor: "start" as const },
  header: { x: 1108, y: 97, size: 13, tracking: 1, anchor: "end" as const },
  thickDividerY: 115,
  rows: { xLabel: 690, xValue: 1108, yStart: 144, rowH: 42, thinOffset: 13, size: 18 },
  spark: { x0: 92, x1: 646, baseline: 597, maxH: 62, captionY: 612, capSize: 12, capTracking: 1.7 },
  total: { labelX: 92, labelY: 388, labelSize: 16, labelTracking: 3.5, bigX: 92, bigY: 488, bigSize: 114, bigTracking: -5.5, bigMaxW: 540, capX: 92, capY: 514, capSize: 13, capTracking: 1.3 },
  stamp: { cx: 1028, cy: 536, rotate: -8, boxH: 58, strokeW: 3, nameSize: 22, maxW: 215, right: 1108, nameDy: -2.84, certSize: 12, certDy: 22, certTracking: 1.7 },
  barcode: { x0: 690, y: 502, h: 34, count: 28 },
  footer: { wX: 690, wY: 564, wSize: 18, wTracking: 2.2, anchor: "start" as const, subX: 690, subY: 588, subSize: 12, subTracking: 1.2, subText: "LOCAL ONLY" },
};

const PORTRAIT = {
  w: 1080, h: 1350, bgCx: "50%", bgCy: "-4%", bgR: "70%",
  paper: { x: 82, y: 56, w: 916, h: 1238 },
  perf: { x0: 93, x1: 995, step: 22, y1: 56, y2: 1294, r: 10.5 },
  title: { x: 540, y: 178, size: 72, tracking: -0.7, anchor: "middle" as const },
  subtitle: { x: 540, y: 212, size: 18, tracking: 5.4, anchor: "middle" as const },
  header: { xLeft: 146, xRight: 934, y: 261, size: 15, tracking: 1.2 },
  thickDividerY: 278,
  rows: { xLabel: 146, xValue: 934, yStart: 313, rowH: 51, thinOffset: 16, size: 21 },
  spark: { x0: 146, x1: 934, baseline: 849, maxH: 88, captionY: 869, capSize: 13, capTracking: 2 },
  sparkDividerY: 891,
  total: { labelX: 146, labelY: 937, labelSize: 18, labelTracking: 4.3, bigX: 146, bigY: 1049, bigSize: 128, bigTracking: -6, bigMaxW: 620, capX: 146, capY: 1077, capSize: 14, capTracking: 1.4 },
  stamp: { cx: 829, cy: 987, rotate: -8, boxH: 68, strokeW: 4, nameSize: 28, maxW: 260, right: 934, nameDy: -1.16, certSize: 12, certDy: 25, certTracking: 1.7 },
  barcode: { x0: 380, y: 1128, h: 48, count: 46 },
  footer: { wX: 540, wY: 1214, wSize: 22, wTracking: 3, anchor: "middle" as const, subX: 540, subY: 1240, subSize: 14, subTracking: 1.7, subText: "COMPUTED LOCALLY · NOTHING UPLOADED" },
};

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function t(x: number, y: number, opts: { size: number; fill: string; tracking?: number; anchor?: string; family?: string; weight?: number }, content: string): string {
  const family = opts.family ?? "JetBrains Mono";
  const anchor = opts.anchor ?? "start";
  const weight = opts.weight !== undefined ? ` font-weight="${opts.weight}"` : "";
  const tracking = opts.tracking !== undefined ? ` letter-spacing="${opts.tracking}"` : "";
  return `<text x="${x}" y="${y}" font-family="${family}" font-size="${opts.size}"${weight} fill="${opts.fill}"${tracking} text-anchor="${anchor}">${esc(content)}</text>`;
}

const dashLine = (x1: number, y: number, x2: number, stroke: string, thick: boolean): string =>
  `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${stroke}" stroke-width="${thick ? 2 : 1}" stroke-dasharray="${thick ? "8 7" : "4 5"}"/>`;

function perforation(x0: number, x1: number, step: number, y1: number, y2: number, r: number, fill: string): string {
  let out = "";
  for (let x = x0; x <= x1 + 0.01; x += step) out += `<circle cx="${x}" cy="${y1}" r="${r}" fill="${fill}"/><circle cx="${x}" cy="${y2}" r="${r}" fill="${fill}"/>`;
  return out;
}

function bars(byDay: { date: string; cost: number }[], x0: number, x1: number, baseline: number, maxH: number, fill: string, opacity: number): string {
  if (byDay.length === 0) return "";
  const max = Math.max(...byDay.map((d) => d.cost)) || 1;
  const slot = (x1 - x0) / byDay.length;
  const w = slot * 0.77;
  return byDay
    .map((d, i) => {
      const h = d.cost > 0 ? Math.max(2, (d.cost / max) * maxH) : 2;
      return `<rect x="${(x0 + i * slot).toFixed(2)}" y="${(baseline - h).toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" fill="${fill}" opacity="${opacity}"/>`;
    })
    .join("");
}

// Reproduces the decorative barcode pattern from the designer SVGs: widths [3,2,4] and
// spacings [6,7,8] repeat every 3 bars, matched exactly against the original coordinates.
function barcode(x0: number, y: number, h: number, count: number, fill: string): string {
  const widths = [3, 2, 4], steps = [6, 7, 8];
  let x = x0, out = "";
  for (let i = 0; i < count; i++) {
    out += `<rect x="${x}" y="${y}" width="${widths[i % 3]}" height="${h}" fill="${fill}"/>`;
    x += steps[i % 3]!;
  }
  return out;
}

function stamp(persona: string, cfg: typeof LANDSCAPE.stamp, hero: string, boxFill: string): string {
  const name = persona.toUpperCase();
  // Archivo Black caps are ~0.72em wide, a space ~0.28em; 12px padding per side reproduces the designs' NIGHT OWL box.
  const units = [...name].reduce((n, c) => n + (c === " " ? 0.28 : 0.72), 0);
  const size = Math.min(cfg.nameSize, (cfg.maxW - 24) / units); // long names shrink instead of overflowing
  const boxW = units * size + 24;
  const cx = Math.min(cfg.cx, cfg.right - boxW / 2 - 8); // never past the paper edge
  return (
    `<g transform="translate(${cx.toFixed(1)},${cfg.cy}) rotate(${cfg.rotate})">` +
    `<rect x="${(-boxW / 2).toFixed(1)}" y="${(-cfg.boxH / 2).toFixed(1)}" width="${boxW.toFixed(1)}" height="${cfg.boxH}" fill="${boxFill}" stroke="${hero}" stroke-width="${cfg.strokeW}"/>` +
    t(0, +(cfg.nameDy * (size / cfg.nameSize)).toFixed(2), { size: +size.toFixed(1), fill: hero, anchor: "middle", family: "Archivo Black" }, name) +
    t(0, cfg.certDy, { size: cfg.certSize, fill: hero, anchor: "middle", tracking: cfg.certTracking }, "CERTIFIED") +
    `</g>`
  );
}

function highlightRect(text: string, x: number, y: number, size: number, tracking: number, anchor: "start" | "middle"): string {
  const w = text.length * 0.6 * size + Math.max(0, text.length - 1) * tracking + 64;
  const h = size * 1.75;
  const rx = anchor === "middle" ? x - w / 2 : x - 6;
  return `<rect x="${rx.toFixed(1)}" y="${(y - size - 2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${ACCENT}"/>`;
}

function fitValue(label: string, value: string, xLabel: number, xValue: number, fontSize: number): string {
  const maxChars = Math.floor((xValue - xLabel - label.length * 0.6 * fontSize - 24) / (0.6 * fontSize));
  return value.length > maxChars ? value.slice(0, Math.max(1, maxChars - 1)) + "…" : value;
}

function fitBigNumber(text: string, baseSize: number, baseTracking: number, maxWidth: number): { size: number; tracking: number } {
  const size = Math.min(baseSize, maxWidth / (text.length * 0.68));
  return { size, tracking: baseTracking * (size / baseSize) };
}

function thinGroups(n: number): string {
  return Math.round(n).toLocaleString("en-US").replace(/,/g, " ");
}

function hourRangeEm(h: number): string {
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${pad(h)}:00 — ${pad((h + 1) % 24)}:00`;
}

function agentLabel(agents: Agent[], full: boolean): string {
  const cc = full ? "CLAUDE CODE" : "CC";
  const hasClaude = agents.includes("claude-code"), hasCodex = agents.includes("codex");
  return hasClaude && hasCodex ? `${cc} + CODEX` : hasClaude ? cc : hasCodex ? "CODEX" : "";
}

function buildRows(m: Metrics, portrait: boolean): [string, string][] {
  const rows: [string, string][] = [
    ["tokens", thinGroups(m.totalTokens)],
    ["sessions", String(m.sessions)],
    ["agent time", duration(m.agentTimeMs)],
  ];
  if (portrait) rows.push(["most expensive day", m.mostExpensiveDay ? `${dayLabel(m.mostExpensiveDay.date).toLowerCase()} · ${money(m.mostExpensiveDay.cost)}` : "—"]);
  rows.push(
    ["longest session", m.longestSessionMs > 0 ? duration(m.longestSessionMs) : "—"],
    ["favorite tool", m.favoriteTool ? `${m.favoriteTool.name} · ${thinGroups(m.favoriteTool.calls)}` : "—"],
    [portrait ? "most touched file" : "most touched", m.mostTouchedFile ? m.mostTouchedFile.file : "—"],
    ["peak hour", m.peakHour !== null ? hourRangeEm(m.peakHour) : "—"],
    ["top model", m.topModel ? m.topModel.model : "—"],
  );
  return rows;
}

function rowsSvg(rows: [string, string][], xLabel: number, xValue: number, yStart: number, rowH: number, thinOffset: number, size: number, pal: Palette): string {
  return rows
    .map(([label, value], i) => {
      const y = yStart + i * rowH;
      const divider = i > 0 ? dashLine(xLabel, y - rowH + thinOffset, xValue, pal.dividerThin, false) : "";
      return (
        divider +
        t(xLabel, y, { size, fill: pal.labelDim }, label) +
        t(xValue, y, { size, fill: pal.ink, anchor: "end" }, fitValue(label, value, xLabel, xValue, size))
      );
    })
    .join("");
}

function totalDueSvg(m: Metrics, cfg: typeof LANDSCAPE.total, pal: Palette): string {
  const moneyStr = (m.estimated ? "≈ " : "") + money(m.totalCost);
  const fit = fitBigNumber(moneyStr, cfg.bigSize, cfg.bigTracking, cfg.bigMaxW);
  const caption = "API-EQUIVALENT COST" + (m.estimated ? " · ≈ ESTIMATED" : "");
  return (
    t(cfg.labelX, cfg.labelY, { size: cfg.labelSize, fill: pal.labelDim, tracking: cfg.labelTracking }, "TOTAL DUE") +
    t(cfg.bigX, cfg.bigY, { size: fit.size, fill: pal.hero, tracking: fit.tracking, family: "Archivo Black" }, moneyStr) +
    t(cfg.capX, cfg.capY, { size: cfg.capSize, fill: pal.captionDim, tracking: cfg.capTracking }, caption)
  );
}

function sparkSvg(m: Metrics, cfg: typeof LANDSCAPE.spark, pal: Palette, theme: Theme, peakCaption: string): string {
  if (m.byDay.length === 0) return "";
  const barFill = theme === "dark" ? pal.hero : pal.ink;
  return (
    bars(m.byDay, cfg.x0, cfg.x1, cfg.baseline, cfg.maxH, barFill, pal.barOpacity) +
    t(cfg.x0, cfg.captionY, { size: cfg.capSize, fill: pal.faint2, tracking: cfg.capTracking }, `DAILY SPEND · ${m.byDay.length} DAYS`) +
    t(cfg.x1, cfg.captionY, { size: cfg.capSize, fill: pal.faint2, tracking: cfg.capTracking, anchor: "end" }, peakCaption)
  );
}

function paperGroup(L: { w: number; h: number; bgCx: string; bgCy: string; bgR: string; paper: { x: number; y: number; w: number; h: number }; perf: { x0: number; x1: number; step: number; y1: number; y2: number; r: number } }, pal: Palette, gradId: string): string {
  return (
    // The perforation is a mask on the paper, so the holes show the gradient behind them instead of flat discs.
    `<defs><radialGradient id="${gradId}" cx="${L.bgCx}" cy="${L.bgCy}" r="${L.bgR}"><stop offset="0" stop-color="${pal.bg0}"/><stop offset="1" stop-color="${pal.bg1}"/></radialGradient>` +
    `<mask id="${gradId}-perf"><rect x="0" y="0" width="${L.w}" height="${L.h}" fill="#fff"/>${perforation(L.perf.x0, L.perf.x1, L.perf.step, L.perf.y1, L.perf.y2, L.perf.r, "#000")}</mask></defs>` +
    `<rect x="0" y="0" width="${L.w}" height="${L.h}" fill="url(#${gradId})"/>` +
    `<rect x="${L.paper.x}" y="${L.paper.y}" width="${L.paper.w}" height="${L.paper.h}" fill="${pal.paper}" mask="url(#${gradId}-perf)"/>`
  );
}

function renderLandscape(m: Metrics, pal: Palette, theme: Theme, o: { label: string; dateRange: string }): string {
  const L = LANDSCAPE;
  const subtitle = `RECEIPT · ${o.label.toUpperCase()}`;
  const header = o.dateRange + (agentLabel(m.agents, false) ? ` · ${agentLabel(m.agents, false)}` : "");
  const peakCaption = m.mostExpensiveDay ? `PEAK ${dayLabel(m.mostExpensiveDay.date).toUpperCase()} · ${money(m.mostExpensiveDay.cost)}` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${L.w}" height="${L.h}" viewBox="0 0 ${L.w} ${L.h}">` +
    paperGroup(L, pal, "bg") +
    t(L.title.x, L.title.y, { size: L.title.size, fill: pal.ink, tracking: L.title.tracking, anchor: L.title.anchor, family: "Archivo Black" }, "VIBE TAX") +
    (theme === "light" ? highlightRect(subtitle, L.subtitle.x, L.subtitle.y, L.subtitle.size, L.subtitle.tracking, L.subtitle.anchor) : "") +
    t(L.subtitle.x, L.subtitle.y, { size: L.subtitle.size, fill: pal.hero, tracking: L.subtitle.tracking, anchor: L.subtitle.anchor }, subtitle) +
    totalDueSvg(m, L.total, pal) +
    sparkSvg(m, L.spark, pal, theme, peakCaption) +
    t(L.header.x, L.header.y, { size: L.header.size, fill: pal.captionDim, tracking: L.header.tracking, anchor: L.header.anchor }, header) +
    dashLine(L.rows.xLabel, L.thickDividerY, L.rows.xValue, pal.dividerThick, true) +
    rowsSvg(buildRows(m, false), L.rows.xLabel, L.rows.xValue, L.rows.yStart, L.rows.rowH, L.rows.thinOffset, L.rows.size, pal) +
    barcode(L.barcode.x0, L.barcode.y, L.barcode.h, L.barcode.count, pal.ink) +
    t(L.footer.wX, L.footer.wY, { size: L.footer.wSize, fill: pal.hero, tracking: L.footer.wTracking, anchor: L.footer.anchor, weight: 700 }, "npx vibetax") +
    t(L.footer.subX, L.footer.subY, { size: L.footer.subSize, fill: pal.faint2, tracking: L.footer.subTracking, anchor: L.footer.anchor }, L.footer.subText) +
    (m.persona ? stamp(m.persona, L.stamp, pal.hero, pal.stampBoxFill) : "") +
    `</svg>`
  );
}

function renderPortrait(m: Metrics, pal: Palette, theme: Theme, o: { label: string; dateRange: string }): string {
  const P = PORTRAIT;
  const subtitle = `RECEIPT · ${o.label.toUpperCase()}`;
  const peakCaption = m.mostExpensiveDay ? `PEAK ${money(m.mostExpensiveDay.cost)}` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${P.w}" height="${P.h}" viewBox="0 0 ${P.w} ${P.h}">` +
    paperGroup(P, pal, "bg") +
    t(P.title.x, P.title.y, { size: P.title.size, fill: pal.ink, tracking: P.title.tracking, anchor: P.title.anchor, family: "Archivo Black" }, "VIBE TAX") +
    (theme === "light" ? highlightRect(subtitle, P.subtitle.x, P.subtitle.y, P.subtitle.size, P.subtitle.tracking, P.subtitle.anchor) : "") +
    t(P.subtitle.x, P.subtitle.y, { size: P.subtitle.size, fill: pal.hero, tracking: P.subtitle.tracking, anchor: P.subtitle.anchor }, subtitle) +
    t(P.header.xLeft, P.header.y, { size: P.header.size, fill: pal.labelDim, tracking: P.header.tracking }, o.dateRange) +
    t(P.header.xRight, P.header.y, { size: P.header.size, fill: pal.labelDim, tracking: P.header.tracking, anchor: "end" }, agentLabel(m.agents, true)) +
    dashLine(P.rows.xLabel, P.thickDividerY, P.rows.xValue, pal.dividerThick, true) +
    rowsSvg(buildRows(m, true), P.rows.xLabel, P.rows.xValue, P.rows.yStart, P.rows.rowH, P.rows.thinOffset, P.rows.size, pal) +
    sparkSvg(m, P.spark, pal, theme, peakCaption) +
    (m.byDay.length > 0 ? dashLine(P.rows.xLabel, P.sparkDividerY, P.rows.xValue, pal.dividerThick, true) : "") +
    totalDueSvg(m, P.total, pal) +
    (m.persona ? stamp(m.persona, P.stamp, pal.hero, pal.stampBoxFill) : "") +
    barcode(P.barcode.x0, P.barcode.y, P.barcode.h, P.barcode.count, pal.ink) +
    t(P.footer.wX, P.footer.wY, { size: P.footer.wSize, fill: pal.hero, tracking: P.footer.wTracking, anchor: P.footer.anchor, weight: 700 }, "npx vibetax") +
    t(P.footer.subX, P.footer.subY, { size: P.footer.subSize, fill: pal.faint2, tracking: P.footer.subTracking, anchor: P.footer.anchor }, P.footer.subText) +
    `</svg>`
  );
}

export function cardSvg(m: Metrics, o: { label: string; theme: Theme; portrait: boolean; dateRange: string }): string {
  const pal = THEMES[o.theme];
  return o.portrait ? renderPortrait(m, pal, o.theme, o) : renderLandscape(m, pal, o.theme, o);
}
