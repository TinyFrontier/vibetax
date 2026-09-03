import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Usage } from "./types.js";

export type Price = { input: number; output: number; cacheWrite5m: number; cacheWrite1h: number; cacheRead: number };
export type PriceTable = { models: Record<string, Price>; families: Record<string, string> };

// src/pricing.ts -> ../pricing.json and dist/pricing.js -> ../pricing.json both land on the repo-root file.
const BUNDLED = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "pricing.json");

export function loadPricing(file?: string): PriceTable {
  return JSON.parse(readFileSync(file ?? BUNDLED, "utf8"));
}

/**
 * Exact match, or a key followed by "-" (date suffixes: claude-opus-4-1-20250805 -> claude-opus-4-1; longest key
 * wins), else the first matching `families` substring flagged as estimated. The "-" boundary keeps an unknown
 * gpt-5.6-xyz from silently taking gpt-5's price.
 */
export function priceFor(model: string, table: PriceTable): { price: Price; estimated: boolean } | null {
  let best: string | null = null;
  for (const key of Object.keys(table.models)) {
    if ((model === key || model.startsWith(key + "-")) && (best === null || key.length > best.length)) best = key;
  }
  if (best !== null) return { price: table.models[best]!, estimated: false };

  for (const [substr, modelKey] of Object.entries(table.families)) {
    const price = model.includes(substr) ? table.models[modelKey] : undefined;
    if (price) return { price, estimated: true };
  }
  return null;
}

export function cost(usage: Usage, price: Price): number {
  return (
    (usage.input * price.input +
      usage.output * price.output +
      usage.cacheWrite5m * price.cacheWrite5m +
      usage.cacheWrite1h * price.cacheWrite1h +
      usage.cacheRead * price.cacheRead) /
    1e6
  );
}
