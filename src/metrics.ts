import path from "node:path";
import type { Agent, Period, Session } from "./types.js";
import { cost, priceFor, type PriceTable } from "./pricing.js";

export type Metrics = {
  period: { from: string; to: string };
  agents: Agent[];
  sessions: number;
  totalCost: number;
  estimated: boolean;
  totalTokens: number;
  agentTimeMs: number;
  longestSessionMs: number;
  mostExpensiveDay: { date: string; cost: number } | null;
  favoriteTool: { name: string; calls: number } | null;
  mostTouchedFile: { file: string; count: number } | null;
  peakHour: number | null;
  topModel: { model: string; cost: number } | null;
  /** Cost per local day for the sparkline: every day from max(period.from, first turn) to period.to, zeros included. */
  byDay: { date: string; cost: number }[];
  /** Stamp on the card; null when no pattern is strong enough. */
  persona: "Night Owl" | "Early Bird" | "Weekend Warrior" | "Marathoner" | "Sprinter" | null;
  warnings: string[];
};

const IDLE_GAP_MS = 30 * 60 * 1000;

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
// Highest value wins; ties broken by the smallest key (string compare), so results are deterministic.
function argmax(counts: Map<string, number>): [string, number] | null {
  let best: [string, number] | null = null;
  for (const entry of counts) {
    if (!best || entry[1] > best[1] || (entry[1] === best[1] && entry[0] < best[0])) best = entry;
  }
  return best;
}
function displayFile(p: string): string {
  const base = path.basename(p);
  const dir = path.basename(path.dirname(p));
  return dir && dir !== "." ? `${dir}/${base}` : base;
}

export function computeMetrics(sessions: Session[], period: Period, table: PriceTable): Metrics {
  const agents = new Set<Agent>();
  let sessionCount = 0;
  let totalCost = 0;
  let estimated = false;
  let totalTokens = 0;
  let agentTimeMs = 0;
  let longestSessionMs = 0;
  const dayCost = new Map<string, number>();
  const toolCounts = new Map<string, number>();
  const fileCounts = new Map<string, number>();
  const hourCounts = new Map<string, number>();
  const modelCost = new Map<string, number>();
  const warnedModels = new Set<string>();
  const warnings: string[] = [];
  let turnCount = 0, nightTurns = 0, earlyTurns = 0, weekendTurns = 0;
  let firstTurnMs = Infinity;

  for (const s of sessions) {
    agents.add(s.agent);
    if (!s.background) sessionCount++;
    longestSessionMs = Math.max(longestSessionMs, s.endedAt.getTime() - s.startedAt.getTime());

    const turns = [...s.turns].sort((a, b) => a.at.getTime() - b.at.getTime());
    for (let i = 1; i < turns.length; i++) {
      const gap = turns[i]!.at.getTime() - turns[i - 1]!.at.getTime();
      if (gap <= IDLE_GAP_MS) agentTimeMs += gap;
    }

    for (const t of turns) {
      const u = t.usage;
      totalTokens += u.input + u.output + u.cacheWrite5m + u.cacheWrite1h + u.cacheRead;
      const priced = priceFor(t.model, table);
      let turnCost = 0;
      if (priced) {
        turnCost = cost(u, priced.price);
        if (priced.estimated) estimated = true;
      } else {
        estimated = true;
        if (!warnedModels.has(t.model)) {
          warnedModels.add(t.model);
          warnings.push(`unknown model ${t.model}: priced as $0`);
        }
      }
      totalCost += turnCost;
      modelCost.set(t.model, (modelCost.get(t.model) ?? 0) + turnCost);
      dayCost.set(dayKey(t.at), (dayCost.get(dayKey(t.at)) ?? 0) + turnCost);
      const h = t.at.getHours();
      const hour = String(h).padStart(2, "0"); // zero-padded so the string tie-break is numeric
      hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
      turnCount++;
      if (h >= 22 || h < 5) nightTurns++;
      if (h >= 5 && h < 9) earlyTurns++;
      const wd = t.at.getDay();
      if (wd === 0 || wd === 6) weekendTurns++;
      firstTurnMs = Math.min(firstTurnMs, t.at.getTime());
      for (const call of t.toolCalls) {
        toolCounts.set(call.name, (toolCounts.get(call.name) ?? 0) + 1);
        for (const f of call.files) fileCounts.set(f, (fileCounts.get(f) ?? 0) + 1);
      }
    }
  }
  const bestDay = argmax(dayCost);
  const bestTool = argmax(toolCounts);
  const bestFile = argmax(fileCounts);
  const bestHour = argmax(hourCounts);
  const bestModel = argmax(modelCost);

  const byDay: { date: string; cost: number }[] = [];
  if (turnCount > 0) {
    const d = new Date(Math.max(period.from.getTime(), firstTurnMs));
    d.setHours(0, 0, 0, 0);
    for (; d < period.to; d.setDate(d.getDate() + 1)) byDay.push({ date: dayKey(d), cost: dayCost.get(dayKey(d)) ?? 0 });
  }

  // Thresholds are ~1.5x the uniform share of each window (night 7h = 29%, early 4h = 17%, weekend 2/7 = 29%),
  // so a stamp means a real skew, not noise. First match wins.
  // ponytail: fixed thresholds; tune once real cards show which stamps people actually get.
  const share = (n: number) => (turnCount ? n / turnCount : 0);
  const avgTurns = sessions.length ? turnCount / sessions.length : 0;
  const persona: Metrics["persona"] =
    share(nightTurns) >= 0.45 ? "Night Owl"
    : share(earlyTurns) >= 0.25 ? "Early Bird"
    : share(weekendTurns) >= 0.4 ? "Weekend Warrior"
    : avgTurns >= 50 ? "Marathoner"
    : turnCount > 0 && avgTurns <= 12 ? "Sprinter"
    : null;

  return {
    period: { from: period.from.toISOString(), to: period.to.toISOString() },
    agents: [...agents].sort(),
    sessions: sessionCount,
    totalCost,
    estimated,
    totalTokens,
    agentTimeMs,
    longestSessionMs,
    mostExpensiveDay: bestDay ? { date: bestDay[0], cost: bestDay[1] } : null,
    favoriteTool: bestTool ? { name: bestTool[0], calls: bestTool[1] } : null,
    mostTouchedFile: bestFile ? { file: displayFile(bestFile[0]), count: bestFile[1] } : null,
    peakHour: bestHour ? Number(bestHour[0]) : null,
    topModel: bestModel ? { model: bestModel[0], cost: bestModel[1] } : null,
    byDay,
    persona,
    warnings,
  };
}
