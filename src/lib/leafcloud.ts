import { createHash } from "node:crypto";
import type { Rate } from "./types";

export function parseLeafcloud(tables: unknown, observedAt: string, sourceUrl: string): Rate[] {
  const invalid = () => new Error("Source Leafcloud embedded GPU-hour pricing is missing or invalid");
  if (!Number.isFinite(Date.parse(observedAt)) || !Array.isArray(tables) || tables.length !== 1 || typeof tables[0] !== "string")
    throw invalid();
  const encoded = tables[0].match(/\bprops="([^"]+)"/)?.[1];
  if (!encoded) throw invalid();
  const entities: Record<string, string> = { quot: '"', amp: "&", lt: "<", gt: ">", "#39": "'" };
  let props;
  try {
    props = JSON.parse(encoded.replace(/&(quot|amp|lt|gt|#39);/g, (_, entity) => entities[entity]));
  } catch { throw invalid(); }
  const value = (pair: unknown): unknown => {
    if (!Array.isArray(pair) || pair.length !== 2 || pair[0] !== 0) throw invalid();
    return pair[1];
  };
  const object = (pair: unknown): Record<string, unknown> => {
    const result = value(pair);
    if (!result || typeof result !== "object" || Array.isArray(result)) throw invalid();
    return result as Record<string, unknown>;
  };
  const data = object(props.data);
  const hourlyMeta = object(object(data.meta).hourly_rate);
  if (value(hourlyMeta.prefix) !== "€" || value(hourlyMeta.label) !== "Price / Hour") throw invalid();
  if (!Array.isArray(data.items) || data.items[0] !== 1 || !Array.isArray(data.items[1]) || !data.items[1].length)
    throw invalid();
  const seen = new Set<string>();
  return data.items[1].map((entry: unknown) => {
    const row = object(entry), gpu = value(row.name), plan = value(row.flavor);
    const gpuCount = value(row.cards), amount = value(row.hourly_rate);
    if (
      typeof gpu !== "string" || !gpu.startsWith("NVIDIA ") ||
      typeof plan !== "string" || !plan || seen.has(plan) ||
      typeof gpuCount !== "number" || !Number.isSafeInteger(gpuCount) || gpuCount < 1 || gpuCount > 2048 ||
      typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0
    ) throw invalid();
    seen.add(plan);
    return {
      id: createHash("sha256").update(JSON.stringify(["leafcloud", plan, gpuCount, "EUR", "instance-hour"])).digest("hex").slice(0, 24),
      providerId: "leafcloud", gpu, gpuCount, vramGb: null, vcpus: null, ramGb: null,
      plan, commitment: "Unknown", region: "Not specified", billing: "Unspecified",
      currency: "EUR", amount, hourly: Math.round(amount / gpuCount * 1e8) / 1e8,
      unit: "instance-hour", priceType: "Exact", availability: "Not verified", collectionMethod: "Table parser",
      evidence: JSON.stringify(row),
      notes: "Published GPU table data: EUR Price / Hour per complete instance, divided by the explicit cards count. Includes VM; excludes VAT. Hourly values come directly from the pricing table's embedded source data, not from converting monthly amounts. GPU count follows the cards field rather than the flavor name. Region, minimum term and stock are not specified for this configuration.",
      sourceUrl, observedAt,
    } satisfies Rate;
  });
}
