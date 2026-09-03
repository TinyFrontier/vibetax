#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync, realpathSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import os from "node:os";
import path from "node:path";
import { scanClaude } from "./claude.js";
import { scanCodex } from "./codex.js";
import { loadPricing } from "./pricing.js";
import { computeMetrics } from "./metrics.js";
import { parsePeriod, anonymize, terminalCard, shareUrl } from "./card.js";
import { cardSvg, type Theme } from "./svg.js";
import { renderPng } from "./render.js";

const USAGE_HINT = "usage: vibetax [--period 7d|30d|90d|ytd|all|A..B] [--agent claude|codex|all] [--json] [--anonymize] [--pricing FILE] [--claude-dir DIR] [--codex-dir DIR] [--out PATH] [--portrait] [--theme dark|light] [--open] [--no-image] [--help] [--version]";

const HELP = `vibetax [options]
  --period <p>                      7d | 30d | 90d | ytd | all | 2026-06-01..2026-08-31  (default: 30d)
  --agent <a>                        claude | codex | all                                 (default: all)
  --json                             print all metrics to stdout as JSON
  --anonymize                        hide project/file names (Most touched file -> "a .ts file")
  --pricing <file>                   custom price list                    (default: bundled pricing.json)
  --claude-dir, --codex-dir <path>   override the logs dirs               (default: $CLAUDE_CONFIG_DIR or ~/.claude, $CODEX_HOME or ~/.codex)
  --out <path>                      where to save the PNG                (default: ./vibetax-<date>.png)
  --portrait                        1080x1350 instead of 1200x675 (Instagram/LinkedIn)
  --theme <t>                       dark | light                          (default: dark)
  --open                            open the PNG after saving
  --no-image                        terminal card only, skip the PNG
  --help, -h                         show this help
  --version, -v                      print the version
`;

function abbreviateHome(p: string): string {
  const home = os.homedir();
  return p === home || p.startsWith(home + path.sep) ? "~" + p.slice(home.length) : p;
}

function rangeDate(d: Date, withYear: boolean): string {
  const s = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return withYear ? `${s} ${d.getFullYear()}` : s;
}

// Shared by the terminal "found …" line (en dash) and the SVG header (em dash, upper-cased).
function dayRange(a: Date, b: Date, sep: string, upper = false): string {
  const text = `${rangeDate(a, a.getFullYear() !== b.getFullYear())} ${sep} ${rangeDate(b, true)}`;
  return upper ? text.toUpperCase() : text;
}

const localDate = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function usageError(err: (s: string) => void, msg: string): number {
  err(msg + "\n");
  err(USAGE_HINT + "\n");
  return 2;
}

type Io = { out?: (s: string) => void; err?: (s: string) => void; now?: Date; env?: NodeJS.ProcessEnv };
export async function main(argv: string[], io: Io = {}): Promise<number> {
  const out = io.out ?? ((s: string) => void process.stdout.write(s));
  const err = io.err ?? ((s: string) => void process.stderr.write(s));
  const now = io.now ?? new Date(),
    env = io.env ?? process.env;

  const OPTIONS = {
    period: { type: "string", default: "30d" }, agent: { type: "string", default: "all" },
    json: { type: "boolean", default: false }, anonymize: { type: "boolean", default: false },
    pricing: { type: "string" }, "claude-dir": { type: "string" }, "codex-dir": { type: "string" },
    out: { type: "string" }, portrait: { type: "boolean", default: false }, theme: { type: "string", default: "dark" }, open: { type: "boolean", default: false },
    "no-image": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false }, version: { type: "boolean", short: "v", default: false },
  } as const;
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({ args: argv, strict: true, allowPositionals: false, options: OPTIONS }));
  } catch (e) {
    return usageError(err, (e as Error).message);
  }

  if (values.help) { out(HELP); return 0; }
  if (values.version) {
    const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    out(`vibetax ${JSON.parse(readFileSync(pkgPath, "utf8")).version}\n`);
    return 0;
  }

  const agent = values.agent as string;
  if (!["claude", "codex", "all"].includes(agent)) return usageError(err, `invalid --agent "${agent}": use claude, codex, or all`);
  const theme = values.theme as string;
  if (!["dark", "light"].includes(theme)) return usageError(err, `invalid --theme "${theme}": use dark or light`);

  let spec;
  try {
    spec = parsePeriod(values.period as string, now);
  } catch (e) {
    return usageError(err, (e as Error).message);
  }

  const claudeDir = (values["claude-dir"] as string) ?? env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
  const codexDir = (values["codex-dir"] as string) ?? env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
  const wantClaude = agent !== "codex",
    wantCodex = agent !== "claude";
  const dirsList = [wantClaude && abbreviateHome(claudeDir), wantCodex && abbreviateHome(codexDir)].filter(Boolean).join(" and ");
  if (!values.json) err(`vibetax · scanning ${dirsList} …\n`);

  const [claudeResult, codexResult] = await Promise.all([
    wantClaude ? scanClaude(claudeDir, spec.period) : Promise.resolve({ sessions: [], warnings: [], files: 0 }),
    wantCodex ? scanCodex(codexDir, spec.period) : Promise.resolve({ sessions: [], warnings: [], files: 0 }),
  ]);
  const sessions = [...claudeResult.sessions, ...codexResult.sessions];
  const scanWarnings = [...claudeResult.warnings, ...codexResult.warnings];

  if (sessions.length === 0) {
    if (claudeResult.files + codexResult.files === 0) err(`no Claude Code or Codex logs found in ${dirsList} — pass --claude-dir / --codex-dir if they live elsewhere\n`);
    else err(`no sessions in ${spec.label} — try --period 90d or --period all\n`);
    return 1;
  }

  const table = loadPricing(values.pricing as string | undefined);
  let metrics = computeMetrics(sessions, spec.period, table);
  if (values.anonymize) metrics = anonymize(metrics);

  const first = new Date(Math.min(...sessions.map((s) => s.startedAt.getTime()))),
    last = new Date(Math.max(...sessions.map((s) => s.endedAt.getTime())));
  if (!values.json) {
    const claudeCount = sessions.filter((s) => s.agent === "claude-code" && !s.background).length,
      codexCount = sessions.filter((s) => s.agent === "codex" && !s.background).length;
    err(`found ${claudeCount + codexCount} sessions (Claude Code: ${claudeCount}, Codex: ${codexCount}) · ${dayRange(first, last, "–")}\n`);
  }

  if (values.json) out(JSON.stringify(metrics, null, 2) + "\n");
  else {
    const color = Boolean(process.stdout.isTTY) && !env.NO_COLOR;
    let body = "\n" + terminalCard(metrics, spec.label, color) + "\n\n";
    if (!values["no-image"]) {
      const portrait = Boolean(values.portrait);
      const svg = cardSvg(metrics, { label: spec.label, theme: theme as Theme, portrait, dateRange: dayRange(first, last, "—", true) });
      const outPath = (values.out as string) ?? `./vibetax-${localDate(now)}.png`;
      writeFileSync(outPath, renderPng(svg));
      const [w, h] = portrait ? [1080, 1350] : [1200, 675];
      body += `  ✓ saved ${outPath} (${w}×${h})\n`;
      if (values.open) {
        const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
        const args = process.platform === "win32" ? ["/c", "start", "", outPath] : [outPath];
        // best-effort: a missing opener binary must not fail the run, hence the swallowed 'error' event.
        spawn(opener, args, { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
      }
    }
    body += "  share it: " + shareUrl(metrics, spec.label) + "\n";
    out(body);
  }

  const allWarnings = [...scanWarnings, ...metrics.warnings];
  for (const w of allWarnings.slice(0, 10)) err(`warning: ${w}\n`);
  if (allWarnings.length > 10) err(`warning: +${allWarnings.length - 10} more\n`);
  return 0;
}

// Run only when executed directly. npm installs the bin as a symlink (node_modules/.bin/vibetax), so compare real paths.
const entry = process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href;
if (entry === import.meta.url) process.exitCode = await main(process.argv.slice(2));
