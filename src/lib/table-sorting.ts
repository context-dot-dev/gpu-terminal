import type { Rate } from "./types";
import { providers } from "./catalog";

export type SortState<K extends string> = { key: K; direction: "asc" | "desc" };
export function nextSort<K extends string>(
  current: SortState<K>,
  key: K,
): SortState<K> {
  return {
    key,
    direction:
      current.key === key && current.direction === "asc" ? "desc" : "asc",
  };
}
const collator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});
export function compareValues(
  a: string | number | null,
  b: string | number | null,
  direction: "asc" | "desc",
) {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  const order =
    typeof a === "number" && typeof b === "number"
      ? a - b
      : collator.compare(String(a), String(b));
  return direction === "asc" ? order : -order;
}
export const rateSortFields = [
  { key: "price", label: "Price", numeric: true },
  { key: "gpu", label: "GPU", numeric: false },
  { key: "provider", label: "Provider", numeric: false },
  { key: "memory", label: "Memory", numeric: true },
  { key: "count", label: "Required GPUs", numeric: true },
  { key: "billing", label: "Billing", numeric: false },
  { key: "plan", label: "Plan", numeric: false },
  { key: "region", label: "Region", numeric: false },
  { key: "total", label: "Configuration cost", numeric: true },
  { key: "availability", label: "Stock", numeric: false },
  { key: "priceType", label: "Price type", numeric: false },
  { key: "checked", label: "Checked", numeric: false },
] as const;
export type RateSortKey = (typeof rateSortFields)[number]["key"];
export const rateSortOptions = rateSortFields.flatMap((field) =>
  (["asc", "desc"] as const).map((direction) => ({
    value: `${field.key}:${direction}`,
    label: `${field.label}: ${field.key === "checked" ? (direction === "asc" ? "oldest first" : "newest first") : field.numeric ? (direction === "asc" ? "low to high" : "high to low") : direction === "asc" ? "A–Z" : "Z–A"}`,
    key: field.key,
    direction,
  })),
);
const names = new Map(providers.map((p) => [p.id, p.name]));
export function compareRates(a: Rate, b: Rate, sort: SortState<RateSortKey>) {
  const value = (r: Rate): string | number | null => {
    switch (sort.key) {
      case "price":
        return r.hourly;
      case "gpu":
        return r.gpu;
      case "provider":
        return names.get(r.providerId) ?? r.providerId;
      case "memory":
        return r.vramGb;
      case "count":
        return r.gpuCount;
      case "billing":
        return r.billing === "Unspecified" ? null : r.billing;
      case "plan":
        return r.plan || null;
      case "region":
        return r.region === "Not specified" ? null : r.region;
      case "total":
        return r.gpuCount === null ? null : r.hourly * r.gpuCount;
      case "availability":
        return r.availability === "Not verified" ? null : r.availability;
      case "priceType":
        return r.priceType;
      case "checked":
        return Number.isFinite(Date.parse(r.observedAt))
          ? Date.parse(r.observedAt)
          : null;
    }
  };
  const av = value(a),
    bv = value(b);
  // Group money by currency rather than implying an exchange-rate conversion.
  if (
    (sort.key === "price" || sort.key === "total") &&
    av !== null &&
    bv !== null &&
    a.currency !== b.currency
  )
    return collator.compare(a.currency, b.currency);
  return compareValues(av, bv, sort.direction) || a.id.localeCompare(b.id);
}
