import type { Dynamics } from "./types";

const DAY_MS = 86_400_000;
const MAX_DAYS_BETWEEN_COMPARABLE_RUNS = 7;
const MAX_RELATIVE_SIZE_DIFFERENCE = 0.1;
const LEVEL_PADDING = 0.2;

export function weeksBetween(from: string, to: string): number {
  return Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS / 7));
}

export function levelAxis(level: Dynamics["price_level"]): { min: number; max: number } {
  const values = level ? [...level.chained, ...(level.balanced ?? []), 100] : [100];
  return {
    min: Math.floor((Math.min(...values) - LEVEL_PADDING) * 10) / 10,
    max: Math.ceil((Math.max(...values) + LEVEL_PADDING) * 10) / 10,
  };
}

export function comparablePersistence(dynamics: Dynamics): number | null {
  const sizes = new Map(dynamics.runs.map((run) => [run.date, run.listings]));
  const pairs = (dynamics.turnover?.pairs ?? []).filter((pair) => {
    const days = (Date.parse(pair.to) - Date.parse(pair.from)) / DAY_MS;
    const before = sizes.get(pair.from) ?? 0;
    const after = sizes.get(pair.to) ?? 0;
    return days <= MAX_DAYS_BETWEEN_COMPARABLE_RUNS && before > 0 && Math.abs(after - before) / before < MAX_RELATIVE_SIZE_DIFFERENCE;
  });
  if (!pairs.length) return null;
  return pairs.reduce((sum, pair) => sum + pair.persist_pct, 0) / pairs.length;
}
