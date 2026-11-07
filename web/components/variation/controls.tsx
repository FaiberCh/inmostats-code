import { DIMENSION_KEYS, dimLabel, type DimKey } from "@/lib/variation";

type Option<T> = { key: T; label: string };

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="pv-field">
      <span className="fsel-label">{label}</span>
      <div className="seg" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            className={option.key === value ? "seg-on" : ""}
            aria-pressed={option.key === value}
            onClick={() => onChange(option.key)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function NumberSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: number;
  options: number[];
  onChange: (value: number) => void;
}) {
  return (
    <label className="pv-field pv-pick">
      <span className="fsel-label">{label}</span>
      <select className="input" value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

export function DimensionSelect({ label, value, onChange }: { label: string; value: DimKey; onChange: (value: DimKey) => void }) {
  return (
    <label className="pv-field pv-pick wide">
      <span className="fsel-label">{label}</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value as DimKey)}>
        {DIMENSION_KEYS.map((key) => (
          <option key={key} value={key}>
            {dimLabel(key)}
          </option>
        ))}
      </select>
    </label>
  );
}

export function DimensionChips({ value, onChange }: { value: DimKey; onChange: (value: DimKey) => void }) {
  return (
    <div className="pv-field pv-wide">
      <span className="fsel-label">Comparar por</span>
      <div className="chip-row tight" role="group" aria-label="Comparar por">
        {DIMENSION_KEYS.map((key) => (
          <button key={key} type="button" className={key === value ? "chip on" : "chip"} aria-pressed={key === value} onClick={() => onChange(key)}>
            {dimLabel(key)}
          </button>
        ))}
      </div>
    </div>
  );
}
