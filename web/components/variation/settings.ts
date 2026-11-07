import type { Unit } from "@/lib/variation";

export type Mode = "median" | "mean" | "both";
export type Order = "price" | "count";

export const MIN_LISTINGS_DEFAULT = 30;

export const MODES: { key: Mode; label: string }[] = [
  { key: "median", label: "Mediana" },
  { key: "mean", label: "Promedio" },
  { key: "both", label: "Ambos" },
];

export const UNITS: { key: Unit; label: string }[] = [
  { key: "m2", label: "Por m²" },
  { key: "total", label: "Total" },
];

export const ORDERS: { key: Order; label: string }[] = [
  { key: "price", label: "Más caros" },
  { key: "count", label: "Más anuncios" },
];

export const unitDigits = (unit: Unit) => (unit === "m2" ? 1 : 0);

export const unitText = (unit: Unit) => (unit === "m2" ? "por metro cuadrado" : "precio total");
