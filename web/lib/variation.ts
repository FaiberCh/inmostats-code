import type { Points } from "./points";
import { quantileSorted, type Filters } from "./stats";

export type DimKey = "stratum" | "dept" | "city" | "hood" | "beds" | "owner";
export type Unit = "m2" | "total";

type Dimension = {
  label: string;
  keyOf: (p: Points, i: number) => number;
  labelOf: (p: Points, key: number) => string;
  without: (f: Filters) => Filters;
  isSelected: (f: Filters, key: number) => boolean;
  hasSelection: (f: Filters) => boolean;
  toggle: (p: Points, f: Filters, key: number) => Filters;
  only: (p: Points, f: Filters, key: number) => Filters;
};

const HOOD_BASE = 8192;
const MISSING = -1;

const toggleIn = (list: number[], key: number) => (list.includes(key) ? list.filter((x) => x !== key) : [...list, key]);
const hoodCode = (key: number) => Math.floor(key / HOOD_BASE);
const hoodCity = (key: number) => key % HOOD_BASE;

function listDimension(
  label: string,
  field: "stratum" | "beds" | "owner",
  keyOf: Dimension["keyOf"],
  labelOf: Dimension["labelOf"],
): Dimension {
  return {
    label,
    keyOf,
    labelOf,
    without: (f) => ({ ...f, [field]: [] }),
    isSelected: (f, key) => f[field].includes(key),
    hasSelection: (f) => f[field].length > 0,
    toggle: (_p, f, key) => ({ ...f, [field]: toggleIn(f[field], key) }),
    only: (_p, f, key) => ({ ...f, [field]: [key] }),
  };
}

const deptDimension: Dimension = {
  label: "Departamento",
  keyOf: (p, i) => p.dept[i],
  labelOf: (p, key) => p.meta.departments[key],
  without: (f) => ({ ...f, dept: null, city: null, hood: null }),
  isSelected: (f, key) => f.dept === key,
  hasSelection: (f) => f.dept !== null,
  toggle: (_p, f, key) =>
    f.dept === key ? { ...f, dept: null, city: null, hood: null } : { ...f, dept: key, city: null, hood: null },
  only: (_p, f, key) => (f.dept === key ? f : { ...f, dept: key, city: null, hood: null }),
};

const cityDimension: Dimension = {
  label: "Ciudad",
  keyOf: (p, i) => p.city[i],
  labelOf: (p, key) => p.meta.cities[key][0],
  without: (f) => ({ ...f, city: null, hood: null }),
  isSelected: (f, key) => f.city === key,
  hasSelection: (f) => f.city !== null,
  toggle: (p, f, key) =>
    f.city === key ? { ...f, city: null, hood: null } : { ...f, city: key, dept: p.meta.cities[key][1], hood: null },
  only: (p, f, key) => (f.city === key ? f : { ...f, city: key, dept: p.meta.cities[key][1], hood: null }),
};

const hoodDimension: Dimension = {
  label: "Barrio",
  keyOf: (p, i) => (p.hood[i] === 0 ? MISSING : p.hood[i] * HOOD_BASE + p.city[i]),
  labelOf: (p, key) => `${p.meta.neighborhoods[hoodCode(key) - 1]}, ${p.meta.cities[hoodCity(key)][0]}`,
  without: (f) => ({ ...f, hood: null }),
  isSelected: (f, key) => f.hood === hoodCode(key) && f.city === hoodCity(key),
  hasSelection: (f) => f.hood !== null,
  toggle: (p, f, key) =>
    hoodDimension.isSelected(f, key)
      ? { ...f, hood: null }
      : { ...f, hood: hoodCode(key), city: hoodCity(key), dept: p.meta.cities[hoodCity(key)][1] },
  only: (p, f, key) =>
    hoodDimension.isSelected(f, key)
      ? f
      : { ...f, hood: hoodCode(key), city: hoodCity(key), dept: p.meta.cities[hoodCity(key)][1] },
};

const DIMENSIONS: Record<DimKey, Dimension> = {
  stratum: listDimension(
    "Estrato",
    "stratum",
    (p, i) => (p.stratum[i] >= 1 && p.stratum[i] <= 6 ? p.stratum[i] : MISSING),
    (_p, key) => `Estrato ${key}`,
  ),
  dept: deptDimension,
  city: cityDimension,
  hood: hoodDimension,
  beds: listDimension(
    "Habitaciones",
    "beds",
    (p, i) => (p.beds[i] < 1 ? MISSING : Math.min(p.beds[i], 5)),
    (_p, key) => (key === 5 ? "5 o más hab." : `${key} hab.`),
  ),
  owner: listDimension(
    "Anunciante",
    "owner",
    (p, i) => (p.owner[i] >= 1 ? p.owner[i] : MISSING),
    (p, key) => p.meta.owner_groups[key],
  ),
};

export const DIMENSION_KEYS = Object.keys(DIMENSIONS) as DimKey[];
export const dimLabel = (dim: DimKey) => DIMENSIONS[dim].label;
export const keyOf = (p: Points, dim: DimKey, i: number) => DIMENSIONS[dim].keyOf(p, i);
export const labelOf = (p: Points, dim: DimKey, key: number) => DIMENSIONS[dim].labelOf(p, key);
export const withoutDim = (f: Filters, dim: DimKey) => DIMENSIONS[dim].without(f);
export const isSelected = (f: Filters, dim: DimKey, key: number) => DIMENSIONS[dim].isSelected(f, key);
export const hasSelection = (f: Filters, dim: DimKey) => DIMENSIONS[dim].hasSelection(f);
export const toggleGroup = (p: Points, f: Filters, dim: DimKey, key: number) => DIMENSIONS[dim].toggle(p, f, key);
export const selectOnly = (p: Points, f: Filters, dim: DimKey, key: number) => DIMENSIONS[dim].only(p, f, key);

export type Group = { key: number; label: string; n: number; q1: number; median: number; q3: number; mean: number };
export type Cell = { n: number; median: number; mean: number };

function valueOf(p: Points, unit: Unit, i: number): number {
  const price = p.price[i] * p.meta.price_unit;
  if (unit === "total") return price;
  return p.area[i] > 0 ? price / p.area[i] : NaN;
}

function summarize(values: number[]): Cell & { q1: number; q3: number } {
  const sorted = Float64Array.from(values).sort();
  let sum = 0;
  for (const v of sorted) sum += v;
  return {
    n: sorted.length,
    q1: quantileSorted(sorted, 0.25),
    median: quantileSorted(sorted, 0.5),
    q3: quantileSorted(sorted, 0.75),
    mean: sum / sorted.length,
  };
}

function bucketBy<K>(p: Points, rows: Uint32Array, unit: Unit, bucketKey: (i: number) => K | null): Map<K, number[]> {
  const buckets = new Map<K, number[]>();
  for (let r = 0; r < rows.length; r++) {
    const i = rows[r];
    const key = bucketKey(i);
    if (key === null) continue;
    const value = valueOf(p, unit, i);
    if (!Number.isFinite(value)) continue;
    const list = buckets.get(key);
    if (list) list.push(value);
    else buckets.set(key, [value]);
  }
  return buckets;
}

export function groupStats(p: Points, rows: Uint32Array, dim: DimKey, unit: Unit): Group[] {
  const buckets = bucketBy(p, rows, unit, (i) => {
    const key = keyOf(p, dim, i);
    return key === MISSING ? null : key;
  });
  return [...buckets].map(([key, values]) => ({ key, label: labelOf(p, dim, key), ...summarize(values) }));
}

export function crossStats(p: Points, rows: Uint32Array, dimRow: DimKey, dimCol: DimKey, unit: Unit): Map<string, Cell> {
  const buckets = bucketBy(p, rows, unit, (i) => {
    const row = keyOf(p, dimRow, i);
    const col = keyOf(p, dimCol, i);
    return row === MISSING || col === MISSING ? null : `${row}|${col}`;
  });
  const out = new Map<string, Cell>();
  for (const [id, values] of buckets) {
    const { n, median, mean } = summarize(values);
    out.set(id, { n, median, mean });
  }
  return out;
}
