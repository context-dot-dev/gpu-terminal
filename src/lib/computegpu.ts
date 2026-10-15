import type { Rate } from "./types";

export function parseComputeGpu(
  markdown: string,
  observedAt: string,
  sourceUrl: string,
): Rate[] {
  if (!Number.isFinite(Date.parse(observedAt)))
    throw new Error("Source ComputeGpu observation time is invalid");
  if (new URL(sourceUrl).origin !== "https://computegpu.com")
    throw new Error("Source ComputeGpu URL is not canonical");

  const start = markdown.indexOf("## Available GPUs");
  const end = markdown.indexOf("\n## Developer tools", start);
  if (start < 0 || end < 0)
    throw new Error("Source ComputeGpu available GPU catalogue is missing");
  const section = markdown.slice(start, end);
  if (
    !/^\d+ models · \d+ available now$/m.test(section) ||
    !markdown.includes("$ USD € EUR £ GBP") ||
    !markdown.includes("Instances bill per second of uptime.")
  )
    throw new Error("Source ComputeGpu model count, currency or billing proof changed");

  const seen = new Set<string>();
  let recognizedListings = 0;
  for (const match of section.matchAll(
    /^\[([^\]]+)\]\((https:\/\/computegpu\.com\/marketplace\?gpu=[^)]+)\)$/gm,
  )) {
    const listing = match[1].replace(/\\/g, "").replace(/\s+/g, " ").trim();
    const row = /^(.*?)\s+(\d+(?:\.\d+)?)\s+GB\s+(\d+) available from \$(\d+(?:\.\d+)?)\/hr$/.exec(
      listing,
    );
    if (!row)
      throw new Error("Source ComputeGpu hourly listing columns are ambiguous");

    const gpu = row[1].trim();
    const memory = Number(row[2]);
    const inventory = Number(row[3]);
    const amount = Number(row[4]);
    if (!gpu || !Number.isFinite(memory) || memory <= 0)
      throw new Error("Source ComputeGpu GPU model or memory is ambiguous");
    if (!Number.isSafeInteger(inventory) || inventory < 0 || !Number.isFinite(amount) || amount < 0)
      throw new Error("Source ComputeGpu inventory or hourly rate is invalid");
    recognizedListings++;

    // Zero-stock entries expose a placeholder $0.00, not a usable rental rate.
    if (inventory === 0 || amount === 0) continue;
    if (seen.has(gpu))
      throw new Error(`Source ComputeGpu has duplicate hourly listings for ${gpu}`);
    seen.add(gpu);
  }

  if (!recognizedListings)
    throw new Error("Source ComputeGpu has no current, priced GPU listings");

  // The homepage shows a model, VRAM, inventory and $/hr, but not the number
  // of GPUs in the billed configuration. Do not label that listing as a
  // per-GPU hour rate or derive an instance-hour rate without an explicit count.
  return [];
}
