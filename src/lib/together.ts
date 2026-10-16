import { createHash } from "node:crypto";
import type { Rate } from "./types";

export function parseTogether(markdown: string, observedAt: string, sourceUrl: string): Rate[] {
  const start = markdown.indexOf("## GPU Clusters\n");
  const end = markdown.indexOf("\n## ", start + 4);
  const section = markdown.slice(start, end < 0 ? undefined : end);
  const split = section.indexOf("On-demand hourly rates and reserved capacity");
  const details = section.slice(split);
  const compact = details.replace(/\s+/g, " ");
  if (
    !Number.isFinite(Date.parse(observedAt)) || start < 0 || split < 0 ||
    !compact.includes("All prices are per GPU per hour.") ||
    !compact.includes("| Hardware | Preemptible Compute | ON-Demand | Reserved |") ||
    !compact.includes("| Pay as you go | Pay as you go | 3-30 days | 31-90 days | 91-180 days | 181+ days |")
  ) throw new Error("Source Together GPU-cluster headers or units changed");
  const rows = (text: string) => [...text.matchAll(/^\| (NVIDIA[^|]+)\|([\s\S]*?)(?=^\| NVIDIA|$(?![\s\S]))/gm)];
  const summary = new Map<string, number>();
  for (const row of rows(section.slice(0, split))) {
    const quote = row[2].trim().replace(/\|$/, "").trim();
    if (quote === "—") continue;
    if (!/^\$\d+(?:\.\d+)?$/.test(quote))
      throw new Error("Source Together on-demand summary is ambiguous");
    const model = row[1].replace(/\s+/g, " ").trim();
    if (summary.has(model)) throw new Error("Source Together summary GPU is duplicated");
    summary.set(model, Number(quote.slice(1)));
  }
  const rates: Rate[] = [];
  const seen = new Set<string>();
  const terms = ["None", "None", "3-30 days", "31-90 days", "91-180 days", "181+ days"];
  for (const row of rows(details)) {
    const gpu = row[1].replace(/\s+/g, " ").trim();
    const cells = row[2].trim().replace(/\|$/, "").split("|").map((cell) => cell.trim());
    if (seen.has(gpu) || ![3, 6].includes(cells.length))
      throw new Error("Source Together GPU-cluster row is invalid or duplicated");
    seen.add(gpu);
    for (let index = 0; index < cells.length; index++) {
      const value = cells[index];
      if (value === "—" || /^\[Contact us\]\(https:\/\/www\.together\.ai\//.test(value)) continue;
      const quote = value.match(/^\$(\d+(?:\.\d+)?)$/);
      if (!quote || Number(quote[1]) <= 0 || (cells.length === 3 && index === 2))
        throw new Error("Source Together GPU-hour amount or reservation is ambiguous");
      const amount = Number(quote[1]);
      if (index === 1 && summary.get(gpu) !== amount)
        throw new Error("Source Together on-demand price tables disagree");
      const billing = index === 0 ? "Spot" : index === 1 ? "On-demand" : "Committed";
      const commitment = terms[index];
      rates.push({
        id: createHash("sha256").update(JSON.stringify(["together", gpu, billing, commitment, "USD", "gpu-hour"])).digest("hex").slice(0, 24),
        providerId: "together", gpu, vramGb: null, gpuCount: null, vcpus: null, ramGb: null,
        plan: `${gpu} · ${billing}${index > 1 ? ` · ${commitment}` : ""}`,
        commitment, region: "Not specified", billing, currency: "USD", amount,
        hourly: amount, unit: "gpu-hour", priceType: "Exact", availability: "Not verified",
        collectionMethod: "Table parser", evidence: row[0].trim(),
        notes: `Published GPU-cluster price per GPU per hour. ${index === 0 ? "Preemptible compute can be interrupted. " : ""}${index > 1 ? `Reserved duration: ${commitment}. ` : ""}Minimum cluster GPU count, host resources, region and capacity are not stated in this table. Token-based inference and fine-tuning prices are excluded.`,
        sourceUrl, observedAt,
      });
    }
  }
  if (!rates.length || rates.filter((rate) => rate.billing === "On-demand").length !== summary.size)
    throw new Error("Source Together GPU-cluster pricing is incomplete");
  return rates;
}
