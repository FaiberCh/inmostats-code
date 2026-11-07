"use client";

import { useMemo } from "react";

import { dec, int, millions } from "@/lib/format";
import type { Points } from "@/lib/points";
import { selectRows, type Filters } from "@/lib/stats";
import {
  crossStats,
  dimLabel,
  isSelected,
  keyOf,
  labelOf,
  selectOnly,
  withoutDim,
  type Cell,
  type DimKey,
  type Unit,
} from "@/lib/variation";
import { EmptyNote } from "../ui";
import { unitDigits, type Mode } from "./settings";

const MAX_LINES = 8;
const DARK_TEXT_FROM = 0.55;
const ORDERED_DIMENSIONS: DimKey[] = ["stratum", "beds", "owner"];

type Line = { key: number; label: string; n: number };

type Props = {
  points: Points;
  filters: Filters;
  rowDim: DimKey;
  colDim: DimKey;
  unit: Unit;
  mode: Mode;
  minListings: number;
  onChange: (next: Filters) => void;
};

function topLines(points: Points, rows: Uint32Array, dim: DimKey): Line[] {
  const counts = new Map<number, number>();
  for (let r = 0; r < rows.length; r++) {
    const key = keyOf(points, dim, rows[r]);
    if (key >= 0) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const lines = [...counts]
    .map(([key, n]) => ({ key, label: labelOf(points, dim, key), n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, MAX_LINES);
  return ORDERED_DIMENSIONS.includes(dim) ? lines.sort((a, b) => a.key - b.key) : lines;
}

const cellValue = (cell: Cell, mode: Mode) => (mode === "mean" ? cell.mean : cell.median);

export default function VariationHeat({ points, filters, rowDim, colDim, unit, mode, minListings, onChange }: Props) {
  const rows = useMemo(
    () => selectRows(points, withoutDim(withoutDim(filters, rowDim), colDim)),
    [points, filters, rowDim, colDim],
  );

  const view = useMemo(() => {
    const rowLines = topLines(points, rows, rowDim);
    const colLines = topLines(points, rows, colDim);
    const cells = crossStats(points, rows, rowDim, colDim, unit);
    let low = Infinity;
    let high = -Infinity;
    for (const r of rowLines) {
      for (const c of colLines) {
        const cell = cells.get(`${r.key}|${c.key}`);
        if (!cell || cell.n < minListings) continue;
        const value = cellValue(cell, mode);
        low = Math.min(low, value);
        high = Math.max(high, value);
      }
    }
    return { rowLines, colLines, cells, low, high };
  }, [points, rows, rowDim, colDim, unit, mode, minListings]);

  const pickCell = (rowKey: number, colKey: number) => {
    const bothSelected = isSelected(filters, rowDim, rowKey) && isSelected(filters, colDim, colKey);
    onChange(
      bothSelected
        ? withoutDim(withoutDim(filters, rowDim), colDim)
        : selectOnly(points, selectOnly(points, filters, rowDim, rowKey), colDim, colKey),
    );
  };

  if (!view.rowLines.length || !view.colLines.length || !Number.isFinite(view.low)) {
    return <EmptyNote>Muy pocos anuncios para cruzar estas dos variables con los filtros actuales.</EmptyNote>;
  }
  const span = view.high - view.low || 1;
  const digits = unitDigits(unit);

  return (
    <div className="heat-wrap">
      <table className="heat">
        <thead>
          <tr>
            <th scope="col" className="heat-corner">
              {dimLabel(rowDim)} / {dimLabel(colDim)}
            </th>
            {view.colLines.map((col) => (
              <th key={col.key} scope="col" className={isSelected(filters, colDim, col.key) ? "heat-col on" : "heat-col"}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.rowLines.map((row) => (
            <tr key={row.key}>
              <th scope="row" className={isSelected(filters, rowDim, row.key) ? "heat-row on" : "heat-row"}>
                {row.label}
              </th>
              {view.colLines.map((col) => {
                const cell = view.cells.get(`${row.key}|${col.key}`);
                if (!cell || cell.n < minListings) {
                  return (
                    <td key={col.key} className="heat-empty" title={cell ? `Solo ${int(cell.n)} anuncios` : "Sin anuncios"}>
                      ·
                    </td>
                  );
                }
                const value = cellValue(cell, mode);
                const intensity = (value - view.low) / span;
                const picked = isSelected(filters, rowDim, row.key) && isSelected(filters, colDim, col.key);
                return (
                  <td key={col.key} className="heat-cell-td">
                    <button
                      type="button"
                      className={`heat-cell${intensity > DARK_TEXT_FROM ? " hi" : ""}${picked ? " picked" : ""}`}
                      style={{ background: `color-mix(in srgb, var(--map-hi) ${Math.round(intensity * 100)}%, var(--map-lo))` }}
                      aria-pressed={picked}
                      title={`${row.label} y ${col.label}: ${mode === "mean" ? "promedio" : "mediana"} ${millions(value, digits)} (${int(cell.n)} anuncios). Toca para filtrar.`}
                      onClick={() => pickCell(row.key, col.key)}
                    >
                      {dec(value / 1e6, digits)}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
