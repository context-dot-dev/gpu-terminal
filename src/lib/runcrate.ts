import { createHash } from "node:crypto";
import { z } from "zod";
import type { Rate } from "./types";

const sourceUrl = "https://www.runcrate.ai/api/gpu-pricing";
const gpuPrice = z
  .object({
    gpu_type: z.string().min(1).max(100),
    name: z.string().min(1).max(100),
    vram: z.string().max(30),
    min_price_hr: z.number().nonnegative().finite(),
    max_price_hr: z.number().nonnegative().finite(),
    available_options: z.number().int().nonnegative(),
  })
  .passthrough();
const priceFeed = z.object({
  gpus: z.array(gpuPrice).min(1).max(100),
  fetched_at: z.string(),
});

export async function collectRuncrate() {
  const response = await fetch(sourceUrl, {
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(`Source Runcrate API returned HTTP ${response.status}`);
  const feed = priceFeed.parse(await response.json());
  const observed = Date.parse(feed.fetched_at);
  if (
    !Number.isFinite(observed) ||
    observed > Date.now() + 300000 ||
    Date.now() - observed > 1800000
  )
    throw new Error("Source Runcrate API timestamp is missing or stale");

  const seen = new Set<string>();
  const rates: Rate[] = feed.gpus
    .filter((gpu) => gpu.available_options > 0)
    .map((gpu) => {
      if (
        seen.has(gpu.gpu_type) ||
        gpu.min_price_hr <= 0 ||
        gpu.min_price_hr > gpu.max_price_hr
      )
        throw new Error("Source Runcrate API has duplicate or invalid GPU prices");
      seen.add(gpu.gpu_type);
      const memory = gpu.vram.match(/^(\d+(?:\.\d+)?)\s*GB$/i);
      const evidence = JSON.stringify(gpu);
      return {
        id: createHash("sha256")
          .update(JSON.stringify(["runcrate-api-v1", gpu.gpu_type]))
          .digest("hex")
          .slice(0, 24),
        providerId: "runcrate",
        gpu: gpu.name,
        gpuCount: null,
        vramGb: memory && Number(memory[1]) > 0 ? Number(memory[1]) : null,
        vcpus: null,
        ramGb: null,
        commitment: "None",
        region: "Not specified",
        plan: `${gpu.name} · lowest listed GPU rate`,
        billing: "On-demand",
        currency: "USD",
        amount: gpu.min_price_hr,
        unit: "gpu-hour",
        hourly: gpu.min_price_hr,
        priceType: "Starting at",
        availability: "Not verified",
        sourceUrl,
        observedAt: feed.fetched_at,
        collectionMethod: "Provider API",
        evidence,
        notes: `Lowest listed per-GPU hourly rate across ${gpu.available_options} API options. The minimum is not tied to a particular GPU count, CPU, RAM, or region. Runcrate describes this compute as billed by the second without a commitment; current stock is not verified.`,
      };
    });
  if (!rates.length)
    throw new Error("Source Runcrate API has no available GPU prices");
  return {
    rates,
    document: JSON.stringify(feed),
    observedAt: feed.fetched_at,
    sourceUrl,
  };
}
