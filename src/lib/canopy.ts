import { createHash } from "node:crypto";
import type { Rate } from "./types";

export function parseCanopy(
  markdown: string,
  observedAt: string,
  sourceUrl: string,
): Rate[] {
  const header =
    "| Instance Type | vCPUs | RAM | NVMe Storage | Public IP | Price/Hour/GPU |";
  if (!markdown.includes(header) || !Number.isFinite(Date.parse(observedAt)))
    throw new Error(
      "Source Canopy GPU price header or observation time is invalid",
    );
  const rates: Rate[] = [];
  let inTable = false;
  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    if (line === header) {
      inTable = true;
      continue;
    }
    if (!line) continue;
    if (!line.startsWith("|")) {
      inTable = false;
      continue;
    }
    if (!inTable || /^\|[- |:]+\|$/.test(line)) continue;
    const values = line
      .split("|")
      .slice(1, -1)
      .map((value) => value.trim());
    if (values.length !== 6)
      throw new Error("Source Canopy GPU table columns changed");
    const [plan, cpu, ram, storage, ips, price] = values;
    if (price === "Get Quote") continue;
    const model = plan.match(/^(\d+)x\s+(NVIDIA .+)$/);
    const quoted = price.match(/^\$(\d+(?:\.\d+)?)$/);
    if (!model || !quoted || !/^\d+$/.test(cpu))
      throw new Error(
        "Source Canopy GPU row has ambiguous count, model or price",
      );
    const gpuCount = Number(model[1]),
      amount = Number(quoted[1]);
    if (gpuCount < 1 || gpuCount > 2048 || amount <= 0)
      throw new Error("Source Canopy GPU count or price is invalid");
    const memory = ram.match(/^([\d.]+)\s*(GB|TB)$/);
    const ramGb = memory
      ? Number(memory[1]) * (memory[2] === "TB" ? 1000 : 1)
      : null;
    rates.push({
      id: createHash("sha256")
        .update(JSON.stringify(["canopy", plan, "USD", "gpu-hour"]))
        .digest("hex")
        .slice(0, 24),
      providerId: "canopy",
      gpu: model[2],
      gpuCount,
      vramGb: null,
      vcpus: Number(cpu),
      ramGb,
      commitment: "Unknown",
      region: "Not specified",
      plan,
      billing: "Unspecified",
      currency: "USD",
      amount,
      unit: "gpu-hour",
      hourly: amount,
      priceType: "Exact",
      availability: "Not verified",
      evidence: `${header}\n${line}`,
      notes: `Price/Hour/GPU is per GPU, not per instance. ${gpuCount} GPUs required, so configuration compute is USD ${amount * gpuCount}/hour. Includes ${cpu} vCPUs, ${ram} host RAM, ${storage} NVMe storage and ${ips} public IP. No GPU VRAM, billing commitment or region is specified in this table. Other storage and networking are priced separately.`,
      sourceUrl,
      observedAt,
    });
  }
  if (
    !rates.length ||
    new Set(rates.map((rate) => rate.id)).size !== rates.length
  )
    throw new Error("Source Canopy GPU prices are empty or duplicated");
  return rates;
}
