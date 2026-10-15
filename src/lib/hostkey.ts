import { createHash } from "node:crypto";
import type { Rate } from "./types";
export function parseHostkey(
  markdown: string,
  observedAt: string,
  sourceUrl: string,
): Rate[] {
  const rates: Rate[] = [];
  const pattern =
    /\n([A-Z]{2})\s+(\d+)x ([^\n]+?) (\d+)GB\s+([^\n]+)\s+([\d,.]+) Gb\s+([^\n]+)\s+([^\n]+)\s+€[\d ,.]+or€([\d.]+) \/hour/g;
  for (const m of markdown.matchAll(pattern)) {
    const gpuCount = Number(m[2]),
      amount = Number(m[9]),
      gpu = m[3],
      region = m[1];
    const plan = `${gpuCount}x ${gpu} · ${m[5]} · ${m[6]} GB RAM · ${m[7]}`;
    rates.push({
      id: createHash("sha256")
        .update(`hostkey|${region}|${plan}`)
        .digest("hex")
        .slice(0, 24),
      providerId: "hostkey",
      gpu,
      gpuCount,
      vramGb: Number(m[4]),
      ramGb: Number(m[6].replaceAll(",", "")),
      region,
      plan,
      billing: "On-demand",
      commitment: "None",
      currency: "EUR",
      amount,
      unit: "instance-hour",
      hourly: amount / gpuCount,
      priceType: "Exact",
      availability: m[8] === "Instant" ? "Available" : "Not verified",
      evidence: m[0],
      notes:
        "Explicit hourly alternative to monthly server rental. Total instance price divided by GPU count; GPU VRAM is per card. CPU model and storage retained to distinguish configurations. Availability from source snapshot.",
      sourceUrl,
      observedAt,
      collectionMethod: "Table parser",
    });
  }
  if (!rates.length || new Set(rates.map((r) => r.id)).size !== rates.length)
    throw new Error("Hostkey hourly cards missing or duplicate");
  return rates;
}
