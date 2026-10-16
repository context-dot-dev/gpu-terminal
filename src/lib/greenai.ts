import { createHash } from "node:crypto";
import type { Rate } from "./types";

export function parseGreenAi(markdown: string, observedAt: string, sourceUrl: string): Rate[] {
  const quotes = [...markdown.matchAll(/Interested in (B\d{3}) from NVIDIA \?[^\n]*?rates starting at (\d+(?:[.,]\d{1,2})?) USD\/GPU\/H\b/g)];
  if (!Number.isFinite(Date.parse(observedAt)) || !quotes.length)
    throw new Error("Source Green AI explicit GPU-hour quote is missing");
  const rates = new Map<string, Rate>();
  for (const quote of quotes) {
    const gpu = quote[1], amount = Number(quote[2].replace(",", "."));
    if (amount <= 0 || (rates.has(gpu) && rates.get(gpu)!.amount !== amount))
      throw new Error("Source Green AI GPU-hour quote is invalid or conflicting");
    rates.set(gpu, {
      id: createHash("sha256").update(JSON.stringify(["greenaicloud", gpu, "USD", "gpu-hour", "Starting at"])).digest("hex").slice(0, 24),
      providerId: "greenaicloud", gpu, vramGb: null, gpuCount: null, vcpus: null, ramGb: null,
      plan: `${gpu} · Published starting price`, commitment: "Unknown", region: "Not specified",
      billing: "Unspecified", currency: "USD", amount, hourly: amount, unit: "gpu-hour",
      priceType: "Starting at", availability: "Not verified", collectionMethod: "Table parser",
      evidence: quote[0],
      notes: "Published starting GPU-hour price, using a decimal comma. Source also advertises monthly, quarterly and yearly contracts; required term, GPU count, region and stock are not specified for this quote. Contact the provider for configuration-specific pricing.",
      sourceUrl, observedAt,
    });
  }
  return [...rates.values()];
}
