"use client";

import type { Points } from "@/lib/points";
import type { Filters } from "@/lib/stats";
import { withoutDim } from "@/lib/variation";

type Chip = { id: string; text: string; remove: () => void };

type Props = {
  points: Points;
  filters: Filters;
  onChange: (next: Filters) => void;
};

function buildChips({ points, filters, onChange }: Props): Chip[] {
  const { departments, cities, neighborhoods, owner_groups } = points.meta;
  const chips: Chip[] = [];
  if (filters.dept !== null) chips.push({ id: "dept", text: departments[filters.dept], remove: () => onChange(withoutDim(filters, "dept")) });
  if (filters.city !== null) chips.push({ id: "city", text: cities[filters.city][0], remove: () => onChange(withoutDim(filters, "city")) });
  if (filters.hood !== null) chips.push({ id: "hood", text: neighborhoods[filters.hood - 1], remove: () => onChange(withoutDim(filters, "hood")) });
  for (const stratum of filters.stratum) {
    chips.push({
      id: `stratum-${stratum}`,
      text: `Estrato ${stratum}`,
      remove: () => onChange({ ...filters, stratum: filters.stratum.filter((x) => x !== stratum) }),
    });
  }
  for (const beds of filters.beds) {
    chips.push({
      id: `beds-${beds}`,
      text: beds === 5 ? "5 o más hab." : `${beds} hab.`,
      remove: () => onChange({ ...filters, beds: filters.beds.filter((x) => x !== beds) }),
    });
  }
  for (const owner of filters.owner) {
    chips.push({
      id: `owner-${owner}`,
      text: owner_groups[owner],
      remove: () => onChange({ ...filters, owner: filters.owner.filter((x) => x !== owner) }),
    });
  }
  return chips;
}

export default function ActiveChips(props: Props) {
  const chips = buildChips(props);
  if (!chips.length) return null;
  return (
    <ul className="achips" aria-label="Filtros elegidos">
      {chips.map((chip) => (
        <li key={chip.id}>
          <button type="button" className="achip" onClick={chip.remove} aria-label={`Quitar ${chip.text}`}>
            {chip.text}
            <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
            </svg>
          </button>
        </li>
      ))}
    </ul>
  );
}
