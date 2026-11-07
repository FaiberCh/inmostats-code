"use client";

import { int, millions } from "@/lib/format";
import { linear, ticks } from "@/lib/scale";
import type { Group, Unit } from "@/lib/variation";
import { useWidth } from "../useWidth";
import { unitDigits, type Mode } from "./settings";

const ROW_HEIGHT = 32;
const PADDING_TOP = 6;
const PADDING_BOTTOM = 24;
const CHAR_WIDTH = 6.4;

type Props = {
  groups: Group[];
  mode: Mode;
  unit: Unit;
  selectedKeys: Set<number>;
  anySelected: boolean;
  onPick: (key: number) => void;
};

function rowTooltip(group: Group, unit: Unit) {
  const digits = unitDigits(unit);
  return (
    `${group.label}: mediana ${millions(group.median, digits)}, de ${millions(group.q1, digits)} a ${millions(group.q3, digits)}, ` +
    `promedio ${millions(group.mean, digits)} (${int(group.n)} anuncios). Toca para filtrar.`
  );
}

function truncate(text: string, maxChars: number) {
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

export default function VariationBars({ groups, mode, unit, selectedKeys, anySelected, onPick }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const narrow = width < 460;
  const left = narrow ? 96 : 156;
  const right = narrow ? 92 : 112;
  const plotWidth = Math.max(0, width - left - right);
  const plotHeight = groups.length * ROW_HEIGHT;
  const height = PADDING_TOP + plotHeight + PADDING_BOTTOM;
  const highest = Math.max(1, ...groups.map((g) => (mode === "mean" ? g.mean : Math.max(g.q3, g.mean))));
  const xTicks = ticks(0, highest, narrow ? 2 : 4);
  const top = Math.max(highest, xTicks[xTicks.length - 1] ?? highest);
  const x = linear(0, top, 0, plotWidth);
  const tickDigits = unit === "m2" && top < 10e6 ? 1 : 0;
  const maxChars = Math.floor((left - 12) / CHAR_WIDTH);

  return (
    <div ref={ref} style={{ height }} role="group" aria-label="Precio por grupo">
      {width > 0 && (
        <svg width={width} height={height}>
          <g transform={`translate(${left},${PADDING_TOP})`}>
            {xTicks.map((tick) => (
              <g key={tick}>
                <line className="grid" x1={x(tick)} x2={x(tick)} y1={0} y2={plotHeight} />
                <text className="tick" x={x(tick)} y={plotHeight + 16} textAnchor="middle">
                  {millions(tick, tickDigits)}
                </text>
              </g>
            ))}
            {groups.map((group, index) => {
              const cy = index * ROW_HEIGHT + ROW_HEIGHT / 2;
              const selected = selectedKeys.has(group.key);
              const dimmed = anySelected && !selected;
              const shown = mode === "mean" ? group.mean : group.median;
              const tooltip = rowTooltip(group, unit);
              const pick = () => onPick(group.key);
              return (
                <g
                  key={group.key}
                  className={`pv-row${selected ? " on" : ""}${dimmed ? " dim" : ""}`}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected}
                  aria-label={tooltip}
                  onClick={pick}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      pick();
                    }
                  }}
                >
                  <rect className="pv-hit" x={-left} y={index * ROW_HEIGHT} width={width} height={ROW_HEIGHT} />
                  <text className="tick ink" x={-10} y={cy} textAnchor="end" dominantBaseline="middle">
                    {truncate(group.label, maxChars)}
                  </text>
                  {mode === "mean" ? (
                    <rect className="bar-main" x={0} y={cy - 7} width={Math.max(2, x(group.mean))} height={14} rx={2} />
                  ) : (
                    <>
                      <rect className="box" x={x(group.q1)} y={cy - 8} width={Math.max(2, x(group.q3) - x(group.q1))} height={16} />
                      <line className="median" x1={x(group.median)} x2={x(group.median)} y1={cy - 8} y2={cy + 8} />
                      {mode === "both" && (
                        <polygon
                          className="pv-mean"
                          points={`${x(group.mean) - 5},${cy} ${x(group.mean)},${cy - 5} ${x(group.mean) + 5},${cy} ${x(group.mean)},${cy + 5}`}
                        />
                      )}
                    </>
                  )}
                  <text className="tick strong num" x={plotWidth + 10} y={cy} dominantBaseline="middle">
                    {millions(shown, unitDigits(unit))}
                  </text>
                  <text className="tick num" x={plotWidth + right - 4} y={cy} textAnchor="end" dominantBaseline="middle">
                    {int(group.n)}
                  </text>
                  <title>{tooltip}</title>
                </g>
              );
            })}
          </g>
        </svg>
      )}
    </div>
  );
}
