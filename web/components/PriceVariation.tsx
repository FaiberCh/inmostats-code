"use client";

import { useMemo, useState } from "react";

import { int } from "@/lib/format";
import type { Points } from "@/lib/points";
import { selectRows, type Filters } from "@/lib/stats";
import {
  DIMENSION_KEYS,
  dimLabel,
  groupStats,
  hasSelection,
  isSelected,
  toggleGroup,
  withoutDim,
  type DimKey,
  type Group,
  type Unit,
} from "@/lib/variation";
import { Card, EmptyNote } from "./ui";
import { DimensionChips, DimensionSelect, NumberSelect, Segmented } from "./variation/controls";
import { MIN_LISTINGS_DEFAULT, MODES, ORDERS, UNITS, unitText, type Mode, type Order } from "./variation/settings";
import VariationBars from "./variation/VariationBars";
import VariationHeat from "./variation/VariationHeat";

type Props = {
  points: Points;
  filters: Filters;
  onChange: (next: Filters) => void;
};

function rankGroups(groups: Group[], filters: Filters, dim: DimKey, mode: Mode, order: Order, limit: number, minListings: number) {
  const value = (group: Group) => (mode === "mean" ? group.mean : group.median);
  const eligible = groups.filter((group) => group.n >= minListings);
  eligible.sort((a, b) => (order === "count" ? b.n - a.n : value(b) - value(a)));
  const shown = eligible.slice(0, limit);
  for (const group of eligible.slice(limit)) if (isSelected(filters, dim, group.key)) shown.push(group);
  return shown;
}

export default function PriceVariation({ points, filters, onChange }: Props) {
  const [dim, setDim] = useState<DimKey>("dept");
  const [mode, setMode] = useState<Mode>("both");
  const [unit, setUnit] = useState<Unit>("m2");
  const [order, setOrder] = useState<Order>("price");
  const [limit, setLimit] = useState(15);
  const [minListings, setMinListings] = useState(MIN_LISTINGS_DEFAULT);
  const [rowDim, setRowDim] = useState<DimKey>("stratum");
  const [colDim, setColDim] = useState<DimKey>("dept");

  const rows = useMemo(() => selectRows(points, withoutDim(filters, dim)), [points, filters, dim]);
  const groups = useMemo(
    () => rankGroups(groupStats(points, rows, dim, unit), filters, dim, mode, order, limit, minListings),
    [points, rows, dim, unit, filters, mode, order, limit, minListings],
  );
  const selectedKeys = useMemo(
    () => new Set(groups.filter((group) => isSelected(filters, dim, group.key)).map((group) => group.key)),
    [groups, filters, dim],
  );

  const otherDimension = (than: DimKey) => DIMENSION_KEYS.find((key) => key !== than)!;
  const changeRowDim = (next: DimKey) => {
    setRowDim(next);
    if (next === colDim) setColDim(otherDimension(next));
  };
  const changeColDim = (next: DimKey) => {
    setColDim(next);
    if (next === rowDim) setRowDim(otherDimension(next));
  };

  return (
    <section id="variacion" className="sec" aria-labelledby="h-variacion">
      <h2 id="h-variacion">Cómo varían los precios</h2>
      <p className="sec-note">
        Compara el precio entre grupos. Toca una barra o una celda para filtrar todo el tablero con ese grupo; vuelve a tocarla para quitarlo.
      </p>

      <Card title={`Precio ${unitText(unit)} por ${dimLabel(dim).toLowerCase()}`} note="Caja: mitad central de los anuncios. Marca: mediana. Rombo: promedio.">
        <div className="pv-controls">
          <DimensionChips value={dim} onChange={setDim} />
          <Segmented label="Medida" value={mode} options={MODES} onChange={setMode} />
          <Segmented label="Unidad" value={unit} options={UNITS} onChange={setUnit} />
          <Segmented label="Orden" value={order} options={ORDERS} onChange={setOrder} />
          <NumberSelect label="Mostrar" value={limit} options={[10, 15, 25]} onChange={setLimit} />
          <NumberSelect label="Mínimo de anuncios" value={minListings} options={[10, 30, 100, 300]} onChange={setMinListings} />
        </div>

        {groups.length ? (
          <VariationBars
            groups={groups}
            mode={mode}
            unit={unit}
            selectedKeys={selectedKeys}
            anySelected={hasSelection(filters, dim) && selectedKeys.size > 0}
            onPick={(key) => onChange(toggleGroup(points, filters, dim, key))}
          />
        ) : (
          <EmptyNote>Ningún grupo llega al mínimo de {int(minListings)} anuncios con los filtros actuales. Baja el mínimo o quita filtros.</EmptyNote>
        )}
        <p className="foot muted">
          Millones de pesos {unitText(unit)}. A la derecha, el valor y el número de anuncios de cada grupo. Se usa la mediana (el apartamento típico: la mitad
          cuesta menos y la mitad más) porque unos pocos inmuebles muy caros inflan el promedio.
          {dim === "city" || dim === "hood" ? " Con filtros de ciudad o barrio se ven las demás de la misma zona." : ""}
        </p>
      </Card>

      <Card
        title="Cruce de dos variables"
        note={`Cada celda es la ${mode === "mean" ? "media" : "mediana"} ${unit === "m2" ? "del m²" : "del precio"} en millones de pesos. Más oscuro es más caro.`}
      >
        <div className="pv-controls">
          <DimensionSelect label="Filas" value={rowDim} onChange={changeRowDim} />
          <DimensionSelect label="Columnas" value={colDim} onChange={changeColDim} />
        </div>
        <VariationHeat
          points={points}
          filters={filters}
          rowDim={rowDim}
          colDim={colDim}
          unit={unit}
          mode={mode}
          minListings={minListings}
          onChange={onChange}
        />
        <p className="foot muted">
          La medida, la unidad y el mínimo de anuncios son los de arriba. El punto indica que no hay anuncios suficientes. Se muestran hasta 8 filas y 8
          columnas, las de más anuncios.
        </p>
      </Card>
    </section>
  );
}
