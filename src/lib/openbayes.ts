import { createHash } from "node:crypto";
import type { Rate } from "./types";

export function parseOpenBayes(
  markdown: string,
  observedAt: string,
  sourceUrl: string,
): Rate[] {
  if (!Number.isFinite(Date.parse(observedAt)))
    throw new Error("Source OpenBayes observation time is invalid");
  const start = markdown.indexOf("### 更多算力类型租用");
  const end = markdown.indexOf("#### CPU 算力", start);
  if (start < 0 || end < 0)
    throw new Error("Source OpenBayes detailed GPU pricing section is missing");
  const source = markdown.slice(start, end);
  const families: Record<
    string,
    { sku: string; vram: number; counts: number[] }
  > = {
    "NVIDIA Tesla V100 32GB": { sku: "V100-32", vram: 32, counts: [1] },
    "NVIDIA GeForce RTX 4090": {
      sku: "RTX-4090",
      vram: 24,
      counts: [1, 2, 4, 8],
    },
    "NVIDIA GeForce RTX 5090": {
      sku: "RTX-5090",
      vram: 32,
      counts: [1, 2, 4, 8],
    },
    "NVIDIA RTX A6000 48GB": { sku: "A6000", vram: 48, counts: [1, 2, 4, 8] },
    "NVIDIA RTX PRO 6000 Blackwell Server Edition": {
      sku: "RTX-PRO-6000",
      vram: 96,
      counts: [1, 2, 4, 8],
    },
  };
  const rates: Rate[] = [];
  const seen = new Set<string>();
  const sections = [
    ...source.matchAll(/^#### ([^\n]+)\n([\s\S]*?)(?=^#### |$(?![\s\S]))/gm),
  ];
  if (!sections.length)
    throw new Error("Source OpenBayes detailed GPU pricing cards are missing; retained the last successful observation");
  if (sections.length !== Object.keys(families).length)
    throw new Error("Source OpenBayes GPU families changed");
  for (const section of sections) {
    const gpu = section[1],
      family = families[gpu];
    if (!family) throw new Error("Source OpenBayes GPU family is not mapped");
    const blocks = [
      ...section[2].matchAll(
        /¥(\d+(?:\.\d+)?)\/小时\s*\n\s*([A-Z0-9-]+)\s*\n\s*(\d+)GB 显存\s*\n\s*(\d+)GB 内存\s*\n\s*(\d+)GB 工作空间\s*\n\s*(\d+) 核 CPU/g,
      ),
    ];
    if (blocks.length !== family.counts.length)
      throw new Error("Source OpenBayes has incomplete GPU hardware blocks");
    for (const block of blocks) {
      const plan = block[2];
      const gpuCount =
        plan === family.sku
          ? 1
          : Number(
              plan.startsWith(`${family.sku}-`)
                ? plan.slice(family.sku.length + 1)
                : NaN,
            );
      if (
        !family.counts.includes(gpuCount) ||
        Number(block[3]) !== family.vram * gpuCount ||
        seen.has(plan)
      )
        throw new Error(
          "Source OpenBayes SKU multiplicity and aggregate GPU memory disagree",
        );
      seen.add(plan);
      const amount = Number(block[1]);
      if (!(amount > 0))
        throw new Error("Source OpenBayes hourly price must be positive");
      rates.push({
        id: createHash("sha256")
          .update(JSON.stringify(["openbayes", plan, "CNY", "instance-hour"]))
          .digest("hex")
          .slice(0, 24),
        providerId: "openbayes",
        gpu,
        gpuCount,
        vramGb: Number(block[3]) / gpuCount,
        vcpus: Number(block[6]),
        ramGb: Number(block[4]),
        plan,
        region: "Not specified",
        billing: "Unspecified",
        commitment: "Unknown",
        currency: "CNY",
        amount,
        unit: "instance-hour",
        hourly: Math.round((amount / gpuCount) * 1e8) / 1e8,
        priceType: "Exact",
        availability: "Not verified",
        collectionMethod: "Table parser",
        evidence: `#### ${gpu}\n${block[0]}`,
        notes: `Published CNY price per hardware configuration per hour (小时). GPU multiplicity follows the SKU suffix and is verified against aggregate GPU memory. ${block[5]}GB workspace included; additional storage is charged separately. Tax treatment and capacity not verified.`,
        sourceUrl,
        observedAt,
      });
    }
  }
  return rates;
}
