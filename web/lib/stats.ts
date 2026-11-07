import type { AmenityStat, CityStat, DepartmentStat, StratumBox, TopCity } from "./types";
import type { Points } from "./points";

export const PRICE_STEPS = 100;
export const AREA_STEPS = 57;
const PRICE_FLOOR = 50e6;
const PRICE_CEIL = 3000e6;
const AREA_FLOOR = 15;
const AREA_STEP = 5;

export function priceAt(pos: number): number {
  const raw = PRICE_FLOOR * Math.pow(PRICE_CEIL / PRICE_FLOOR, pos / PRICE_STEPS);
  const step = raw < 1e9 ? 10e6 : 50e6;
  return Math.round(raw / step) * step;
}

export const areaAt = (pos: number) => AREA_FLOOR + pos * AREA_STEP;

export type Filters = {
  dept: number | null;
  city: number | null;
  price: [number, number];
  beds: number[];
  area: [number, number];
  stratum: number[];
  owner: number[];
  hood: number | null;
};

export const NO_FILTERS: Filters = {
  dept: null,
  city: null,
  price: [0, PRICE_STEPS],
  beds: [],
  area: [0, AREA_STEPS],
  stratum: [],
  owner: [],
  hood: null,
};

export function activeCount(f: Filters): number {
  return (
    Number(f.dept !== null) +
    Number(f.price[0] !== 0 || f.price[1] !== PRICE_STEPS) +
    Number(f.beds.length > 0) +
    Number(f.area[0] !== 0 || f.area[1] !== AREA_STEPS) +
    Number(f.stratum.length > 0) +
    Number(f.owner.length > 0) +
    Number(f.hood !== null)
  );
}

export const isActive = (f: Filters) => activeCount(f) > 0;

export function selectRows(p: Points, f: Filters): Uint32Array {
  const unit = p.meta.price_unit;
  const out = new Uint32Array(p.n);
  let m = 0;
  let bedMask = 0;
  for (const b of f.beds) bedMask |= 1 << b;
  let stratumMask = 0;
  for (const st of f.stratum) stratumMask |= 1 << st;
  let ownerMask = 0;
  for (const o of f.owner) ownerMask |= 1 << o;
  const pMin = f.price[0] === 0 ? -Infinity : priceAt(f.price[0]);
  const pMax = f.price[1] === PRICE_STEPS ? Infinity : priceAt(f.price[1]);
  const aMin = f.area[0] === 0 ? -Infinity : areaAt(f.area[0]);
  const aMax = f.area[1] === AREA_STEPS ? Infinity : areaAt(f.area[1]);
  for (let i = 0; i < p.n; i++) {
    if (f.dept !== null && p.dept[i] !== f.dept) continue;
    if (f.city !== null && p.city[i] !== f.city) continue;
    if (f.hood !== null && p.hood[i] !== f.hood) continue;
    if (stratumMask && !(stratumMask & (1 << p.stratum[i]))) continue;
    if (ownerMask && !(ownerMask & (1 << p.owner[i]))) continue;
    const price = p.price[i] * unit;
    if (price < pMin || price > pMax) continue;
    const area = p.area[i];
    if (area < aMin || area > aMax) continue;
    if (bedMask && !(bedMask & (1 << Math.min(p.beds[i], 5)))) continue;
    out[m++] = i;
  }
  return out.subarray(0, m);
}

export function quantileSorted(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, n - 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const sortedCopy = (values: ArrayLike<number>) => Float64Array.from(values).sort();

export type Summary = {
  count: number;
  kpis: {
    price_median_cop: number;
    price_p25_cop: number;
    price_p75_cop: number;
    price_m2_median_cop: number;
    area_median_m2: number;
  };
  histogram: { edges_cop: number[]; counts: number[]; p99_cop: number } | null;
  byDepartment: DepartmentStat[];
  byCity: CityStat[];
  topCities: TopCity[];
  amenities: AmenityStat[];
  byStratum: StratumBox[];
  byOwner: { code: number; label: string; listings: number; price_m2_median: number }[];
};

const HISTOGRAM_BINS = 60;
const TOP_N = 15;

function groupMedians(keys: Int32Array, groups: number, ...series: Float64Array[]): { count: number[]; medians: number[][] } {
  const count = new Array<number>(groups).fill(0);
  for (const k of keys) if (k >= 0) count[k]++;
  const offsets = new Array<number>(groups + 1).fill(0);
  for (let g = 0; g < groups; g++) offsets[g + 1] = offsets[g] + count[g];
  const medians = series.map(() => new Array<number>(groups).fill(NaN));
  const cursor = offsets.slice(0, groups);
  const buffers = series.map(() => new Float64Array(offsets[groups]));
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (k < 0) continue;
    series.forEach((s, j) => (buffers[j][cursor[k]] = s[i]));
    cursor[k]++;
  }
  for (let g = 0; g < groups; g++) {
    if (!count[g]) continue;
    buffers.forEach((b, j) => {
      const slice = b.subarray(offsets[g], offsets[g + 1]).sort();
      medians[j][g] = quantileSorted(slice, 0.5);
    });
  }
  return { count, medians };
}

export function computeSummary(p: Points, rows: Uint32Array, mapCities: number[]): Summary {
  const m = rows.length;
  const unit = p.meta.price_unit;
  const price = new Float64Array(m);
  const ppm2 = new Float64Array(m);
  const area = new Float64Array(m);
  for (let k = 0; k < m; k++) {
    const i = rows[k];
    price[k] = p.price[i] * unit;
    area[k] = p.area[i];
    ppm2[k] = price[k] / area[k];
  }
  const sortedPrice = sortedCopy(price);
  const sortedPpm2 = sortedCopy(ppm2);
  const sortedArea = sortedCopy(area);

  let histogram: Summary["histogram"] = null;
  if (m >= 10) {
    const p99 = quantileSorted(sortedPrice, 0.99);
    const below = sortedPrice.filter((v) => v < p99);
    if (below.length > 1) {
      const lo = below[0];
      const hi = below[below.length - 1];
      const width = (hi - lo) / HISTOGRAM_BINS;
      const counts = new Array<number>(HISTOGRAM_BINS).fill(0);
      for (const v of below) counts[Math.min(HISTOGRAM_BINS - 1, Math.floor((v - lo) / width))]++;
      histogram = {
        edges_cop: Array.from({ length: HISTOGRAM_BINS + 1 }, (_, b) => Math.round(lo + b * width)),
        counts,
        p99_cop: Math.round(p99),
      };
    }
  }

  const deptKeys = new Int32Array(m);
  const citySlot = new Int16Array(p.meta.cities.length).fill(-1);
  mapCities.forEach((c, slot) => (citySlot[c] = slot));
  const cityKeys = new Int32Array(m);
  for (let k = 0; k < m; k++) {
    deptKeys[k] = p.dept[rows[k]];
    cityKeys[k] = citySlot[p.city[rows[k]]];
  }
  const byDept = groupMedians(deptKeys, p.meta.departments.length, ppm2, price);
  const byCityGroups = groupMedians(cityKeys, mapCities.length, ppm2, price);

  const ownerKeys = new Int32Array(m);
  for (let k = 0; k < m; k++) ownerKeys[k] = p.owner[rows[k]] >= 1 ? p.owner[rows[k]] - 1 : -1;
  const byOwnerGroups = groupMedians(ownerKeys, 4, ppm2);
  const byOwner = [1, 2, 3, 4].map((code, slot) => ({
    code,
    label: p.meta.owner_groups[code],
    listings: byOwnerGroups.count[slot],
    price_m2_median: Math.round(byOwnerGroups.medians[0][slot]),
  }));

  const byDepartment: DepartmentStat[] = p.meta.departments
    .map((department, d) => ({
      department,
      listings: byDept.count[d],
      price_m2_median: Math.round(byDept.medians[0][d]),
      price_median: Math.round(byDept.medians[1][d]),
    }))
    .filter((d) => d.listings > 0)
    .sort((a, b) => b.listings - a.listings);

  const byCity: CityStat[] = mapCities
    .map((c, slot) => ({
      city: p.meta.cities[c][0],
      department: p.meta.departments[p.meta.cities[c][1]],
      listings: byCityGroups.count[slot],
      price_m2_median: Math.round(byCityGroups.medians[0][slot]),
      price_median: Math.round(byCityGroups.medians[1][slot]),
    }))
    .filter((c) => c.listings > 0)
    .sort((a, b) => b.listings - a.listings);

  const cityCount = new Map<string, number>();
  const amenityCount = new Array<number>(p.meta.amenities.length).fill(0);
  const stratumValues: number[][] = [[], [], [], [], [], [], []];
  for (let k = 0; k < m; k++) {
    const i = rows[k];
    const name = p.meta.cities[p.city[i]][0];
    cityCount.set(name, (cityCount.get(name) ?? 0) + 1);
    const mask = p.amen[i];
    if (mask) for (let b = 0; b < amenityCount.length; b++) if (mask & (1 << b)) amenityCount[b]++;
    const s = p.stratum[i];
    if (s >= 1 && s <= 6) stratumValues[s].push(price[k]);
  }
  const topCities = [...cityCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_N)
    .map(([city, listings]) => ({ city, listings }));
  const amenities = p.meta.amenities
    .map((amenity, b) => ({ amenity, listings: amenityCount[b], share_pct: m ? Math.round((1000 * amenityCount[b]) / m) / 10 : 0 }))
    .filter((a) => a.listings > 0)
    .sort((a, b) => b.listings - a.listings)
    .slice(0, TOP_N);

  const byStratum: StratumBox[] = [];
  for (let s = 1; s <= 6; s++) {
    const values = Float64Array.from(stratumValues[s]).sort();
    if (values.length < 5) continue;
    const q1 = quantileSorted(values, 0.25);
    const median = quantileSorted(values, 0.5);
    const q3 = quantileSorted(values, 0.75);
    const iqr = q3 - q1;
    const inside = values.filter((v) => v >= q1 - 1.5 * iqr && v <= q3 + 1.5 * iqr);
    byStratum.push({
      stratum: s,
      listings: values.length,
      whisker_low: inside[0],
      q1: Math.round(q1),
      median: Math.round(median),
      q3: Math.round(q3),
      whisker_high: inside[inside.length - 1],
      outliers: values.length - inside.length,
    });
  }

  return {
    count: m,
    kpis: {
      price_median_cop: Math.round(quantileSorted(sortedPrice, 0.5)),
      price_p25_cop: Math.round(quantileSorted(sortedPrice, 0.25)),
      price_p75_cop: Math.round(quantileSorted(sortedPrice, 0.75)),
      price_m2_median_cop: Math.round(quantileSorted(sortedPpm2, 0.5)),
      area_median_m2: Math.round(quantileSorted(sortedArea, 0.5) * 10) / 10,
    },
    histogram,
    byDepartment,
    byCity,
    topCities,
    amenities,
    byStratum,
    byOwner,
  };
}

export type Reference = "zone" | "model";

export const Position = { InLine: 0, Below: 1, Above: 2, Extreme: 3 } as const;

export const BELOW_RATIO = 0.75;
export const ABOVE_RATIO = 1 / 0.75;
export const EXTREME_LOW = 0.35;
export const EXTREME_HIGH = 3;

export type Classified = {
  medianPpm2: number;
  ratio: Float32Array;
  position: Uint8Array;
  counts: [number, number, number, number];
};

export function classify(p: Points, rows: Uint32Array, reference: Reference): Classified {
  const unit = p.meta.price_unit;
  const m = rows.length;
  const ppm2 = new Float64Array(m);
  for (let k = 0; k < m; k++) ppm2[k] = (p.price[rows[k]] * unit) / p.area[rows[k]];
  const medianPpm2 = quantileSorted(sortedCopy(ppm2), 0.5);

  const ratio = new Float32Array(m);
  const position = new Uint8Array(m);
  const counts: Classified["counts"] = [0, 0, 0, 0];
  for (let k = 0; k < m; k++) {
    const i = rows[k];
    const r =
      reference === "zone"
        ? ppm2[k] / medianPpm2
        : p.expected[i] > 0
          ? p.price[i] / p.expected[i]
          : NaN;
    ratio[k] = r;
    let pos: number = Position.InLine;
    if (Number.isNaN(r)) pos = Position.InLine;
    else if (r < EXTREME_LOW || r > EXTREME_HIGH) pos = Position.Extreme;
    else if (r <= BELOW_RATIO) pos = Position.Below;
    else if (r >= ABOVE_RATIO) pos = Position.Above;
    position[k] = pos;
    counts[pos]++;
  }
  return { medianPpm2, ratio, position, counts };
}
