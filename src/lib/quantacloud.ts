import { createHash } from "node:crypto";
import type { Rate } from "./types";

export function parseQuantaCloud(
  markdown: string,
  observedAt: string,
  sourceUrl: string,
): Rate[] {
  const expected = Number(
    markdown.match(/(\d+) configurationsUSD \/ hour/)?.[1],
  );
  if (!expected)
    throw new Error("QuantaCloud configuration count or currency missing");
  const pattern =
    /(\d+) GPUs?(\d+) GB VRAM \/ GPU\s+### (\d+)x ([^\n]+)\s+([^\n]+)\s+vCPU\s+(\d+)\s+RAM\s+([\d,]+) GB\s+Disk\s+([\d,]+) GB\s+\*\*\$([\d.]+)\*\*\/ instance-hour\s+\$([\d.]+) per GPU-hour\s+(Available now|Unavailable|Sold out)\[Launch configuration\]\(([^)]+)\)/g;
  const rates: Rate[] = [];
  for (const m of markdown.matchAll(pattern)) {
    const gpuCount = Number(m[1]),
      amount = Number(m[9]),
      hourly = amount / gpuCount;
    const offerId = new URL(m[12]).searchParams.get("offerId");
    if (
      gpuCount !== Number(m[3]) ||
      !offerId ||
      Math.abs(hourly - Number(m[10])) > 0.011
    )
      throw new Error(
        "QuantaCloud quantity, offer ID or price arithmetic changed",
      );
    rates.push({
      id: createHash("sha256")
        .update(`quantacloud|${offerId}`)
        .digest("hex")
        .slice(0, 24),
      providerId: "quantacloud",
      gpu: m[4],
      vramGb: Number(m[2]),
      gpuCount,
      vcpus: Number(m[6]),
      ramGb: Number(m[7].replaceAll(",", "")),
      region: m[5],
      plan: `${gpuCount}x ${m[4]} · ${m[6]} vCPU · ${m[7]} GB RAM · ${m[8]} GB disk`,
      billing: "On-demand",
      commitment: "None",
      currency: "USD",
      amount,
      unit: "instance-hour",
      hourly,
      priceType: "Exact",
      availability: m[11] === "Available now" ? "Available" : "Unavailable",
      evidence: m[0],
      notes:
        "Source quotes total per instance-hour and a rounded per-GPU reference. Normalization uses the total and explicit count. Prepaid balance; unused time refunded by the second. Availability is the source snapshot.",
      sourceUrl,
      observedAt,
      collectionMethod: "Table parser",
    });
  }
  if (
    rates.length !== expected ||
    new Set(rates.map((r) => r.id)).size !== rates.length
  )
    throw new Error(
      `QuantaCloud parsed ${rates.length} of ${expected} configurations`,
    );
  return rates;
}
