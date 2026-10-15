import { createHash } from "node:crypto";
import type { Rate } from "./types";

export function parseLambda(
  markdown: string,
  observedAt: string,
  sourceUrl: string,
): Rate[] {
  const section = markdown.match(
    /## Pay by the minute\n([\s\S]*?)(?=\n## GPU instances)/,
  )?.[1];
  if (!section || !/\b8x\s*4x\s*2x\s*1x\b/.test(section))
    throw new Error("Lambda GPU configuration tabs changed");
  const tables = [
    ...section.matchAll(
      /\| Plan \| VRAM\/GPU \| vCPUs \| RAM \| STORAGE \| PRICE\/GPU\/HR\\?\* \|\n((?:\|[^\n]*\n?)+)/g,
    ),
  ];
  if (tables.length !== 4) throw new Error("Lambda GPU price tables changed");
  const rates: Rate[] = [];
  tables.forEach((table, index) => {
    const gpuCount = [8, 4, 2, 1][index];
    for (const line of table[1].trim().split("\n")) {
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      if (cells.every((cell) => /^[-: ]+$/.test(cell))) continue;
      if (cells.length !== 6)
        throw new Error("Lambda GPU price table shape changed");
      const [gpu, memory, cpu, ram, storage, price] = cells;
      const vramGb = Number(memory.match(/^([\d.]+) GB$/)?.[1]);
      const vcpus = Number(cpu);
      const ramGb = Number(ram.match(/^([\d.]+) GiB$/)?.[1]);
      const amount = Number(price.match(/^\$([\d.]+)$/)?.[1]);
      if (
        !gpu.startsWith("NVIDIA ") ||
        [vramGb, vcpus, ramGb, amount].some(
          (value) => !Number.isFinite(value) || value <= 0,
        )
      )
        throw new Error("Lambda GPU price or configuration is invalid");
      const plan = `${gpuCount}x ${gpu} ${vramGb}GB · ${vcpus} vCPU · ${ram} RAM`;
      rates.push({
        id: createHash("sha256")
          .update(`lambda|${plan}`)
          .digest("hex")
          .slice(0, 24),
        providerId: "lambda",
        gpu,
        vramGb,
        gpuCount,
        vcpus,
        ramGb,
        commitment: "None",
        region: "Not specified",
        plan,
        billing: "On-demand",
        currency: "USD",
        amount,
        unit: "gpu-hour",
        hourly: amount,
        priceType: "Exact",
        availability: "Not verified",
        evidence: line,
        notes: `${gpuCount}-GPU configuration from the 8x/4x/2x/1x price tables. Source quotes per GPU per hour; billing is per minute. ${ram} host RAM; ${storage} storage. Applicable tax excluded. Published price does not verify available capacity.`,
        sourceUrl,
        observedAt,
        collectionMethod: "Table parser",
      });
    }
  });
  if (
    !rates.length ||
    new Set(rates.map((rate) => rate.id)).size !== rates.length
  )
    throw new Error("Lambda GPU pricing is empty or duplicated");
  return rates;
}
