import { createHash } from "node:crypto";
import type { Rate } from "./types";
export function parsePetabyte(
  markdown: string,
  observedAt: string,
  sourceUrl: string,
): Rate[] {
  const section = markdown.match(
    /Live prices\s+([\s\S]*?)(?=\nMarket prices)/,
  )?.[1];
  if (!section || !section.includes("| GPU | VRAM | Petabyte |"))
    throw new Error("Petabyte live price section changed");
  const rates: Rate[] = [];
  for (const m of section.matchAll(
    /\| ([^|]+) \| (\d+) GB \| \$([\d.]+)\/hr \| [^|]+ \| [^|]+ \| ([^|]+) \| \[View\]\((https:\/\/petabyte\.market\/gpu\/[^)]+)\) \|/g,
  )) {
    const amount = Number(m[3]),
      gpu = m[1].trim();
    rates.push({
      id: createHash("sha256")
        .update(`petabyte|${m[5]}`)
        .digest("hex")
        .slice(0, 24),
      providerId: "petabyte",
      gpu,
      vramGb: Number(m[2]),
      gpuCount: null,
      region: m[4].trim(),
      plan: gpu,
      billing: "On-demand",
      commitment: "None",
      currency: "USD",
      amount,
      unit: "gpu-hour",
      hourly: amount,
      priceType: "Exact",
      availability: "Not verified",
      evidence: m[0],
      notes:
        "Only the live marketplace host listing table is used. Synthetic TFLOPS reference prices and third-party comparison prices are excluded. Metered rentals round started hours up; review checkout before renting.",
      sourceUrl,
      observedAt,
      collectionMethod: "Table parser",
    });
  }
  return rates;
}
