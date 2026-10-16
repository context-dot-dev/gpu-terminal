import { createHash } from "node:crypto";
import type { Rate } from "./types";

export function parseSalad(markdown: string, observedAt: string, sourceUrl: string): Rate[] {
  const start = markdown.indexOf("## Per GPU, per hour. vCPU and RAM included.");
  const end = markdown.indexOf("\n## ", start + 4);
  const section = markdown.slice(start, end < 0 ? undefined : end);
  if (
    !Number.isFinite(Date.parse(observedAt)) || start < 0 ||
    !section.includes("USD per GPU-hour by priority tier") ||
    !section.includes("| GPU | VRAM | High | Medium | Low | Lowest | $/mo (Lowest) |")
  ) throw new Error("Source Salad GPU pricing headers or units changed");
  const rows = section.split("\n").filter((row) => row.startsWith("| **"));
  if (!rows.length) throw new Error("Source Salad GPU pricing rows are missing");
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    const cells = row.split("|").slice(1, -1).map((cell) => cell.trim());
    const model = cells[0]?.match(/^\*\*(RTX [A-Za-z0-9 ]+)\*\*$/);
    const memory = cells[1]?.match(/^(\d+) GB$/);
    if (cells.length !== 7 || !model || !memory || seen.has(model[1]))
      throw new Error("Source Salad GPU row is invalid or duplicated");
    seen.add(model[1]);
    return ["High", "Medium", "Low", "Lowest"].map((tier, index) => {
      const quoted = cells[index + 2].match(/^\$(\d+(?:\.\d+)?)$/);
      if (!quoted || Number(quoted[1]) <= 0)
        throw new Error("Source Salad GPU-hour amount is invalid");
      const amount = Number(quoted[1]);
      return {
        id: createHash("sha256").update(JSON.stringify(["salad", model[1], tier, "USD", "gpu-hour"])).digest("hex").slice(0, 24),
        providerId: "salad", gpu: model[1], vramGb: Number(memory[1]),
        gpuCount: null, vcpus: null, ramGb: null,
        plan: `Community · ${model[1]} · ${tier} priority`,
        commitment: "None", region: "Not specified", billing: "Spot",
        currency: "USD", amount, hourly: amount, unit: "gpu-hour",
        priceType: "Exact", availability: "Not verified", collectionMethod: "Table parser",
        evidence: row,
        notes: `Published per-GPU-hour rate at ${tier} priority; vCPU and RAM included, billed per second while running. Community nodes are interruptible. ${tier === "High" ? "High priority is protected from other workloads but remains subject to node disconnection." : "Higher-priority workloads can preempt this tier."} Monthly calculator equivalents are excluded; live capacity is not verified for this offer.`,
        sourceUrl, observedAt,
      } satisfies Rate;
    });
  });
}
