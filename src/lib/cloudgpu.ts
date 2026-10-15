import { createHash } from "node:crypto";
import type { Rate } from "./types";

export function parseCloudGPU(markdown: string, observedAt: string, sourceUrl: string): Rate[] {
  const header = "| GPU Model | Stock | CloudGPU | Market rate |";
  const currencyProof = "All prices are in US dollars.";
  const countProof = "GPU Count1x";
  if (!Number.isFinite(Date.parse(observedAt)) || !markdown.includes(currencyProof) || !markdown.includes(countProof) || !markdown.includes("### On-Demand\n\nPay as you go. No commitment."))
    throw new Error("Source CloudGPU currency, count, billing or observation is unverified");
  const start = markdown.indexOf(header);
  if (start < 0) throw new Error("Source CloudGPU pricing column headers changed");
  const table = markdown.slice(start).split("\n\n")[0];
  const specsStart = markdown.indexOf("| GPU | Arch | VRAM | FP16 TFLOPS | Mem BW | Best For |");
  const specsEnd = markdown.indexOf("\nVRAM determines model size", specsStart);
  if (specsStart < 0 || specsEnd < 0) throw new Error("Source CloudGPU GPU specifications table is missing");
  const specs = markdown.slice(specsStart, specsEnd);
  const rows: Rate[] = [];
  for (const row of table.split("\n").slice(2)) {
    const cells = row.slice(1, -1).split("|").map(s => s.trim());
    if (cells[0].startsWith("Ascend 910B") && cells[0].includes("NPU")) continue;
    const model = /^(H20|A800|H800)(?=\d|\s|China)/.exec(cells[0]);
    const price = /^\$(\d+(?:\.\d+)?)\/hr$/.exec(cells[2]);
    if (cells.length !== 4 || !model || !price) throw new Error("Source CloudGPU has an unmapped pricing row");
    const gpu = model[1], amount = Number(price[1]);
    const memory = new RegExp(`\\n${gpu}(?: \\d+G)?\\n[^|]*\\| (?:Hopper|Ampere) \\| (\\d+) GB \\|`).exec(specs);
    if (!memory || !(amount > 0) || rows.some(r => r.gpu === gpu)) throw new Error("Source CloudGPU model specifications or prices are ambiguous");
    rows.push({
      id: createHash("sha256").update(JSON.stringify(["cloudgpu", gpu, "USD", "gpu-hour", "On-demand"])).digest("hex").slice(0, 24),
      providerId: "cloudgpu", gpu, gpuCount: 1, vramGb: Number(memory[1]), vcpus: null, ramGb: null,
      plan: `${gpu} on-demand`, region: "Not specified", billing: "On-demand", commitment: "None",
      currency: "USD", amount, unit: "gpu-hour", hourly: amount, priceType: "Exact", availability: "Not verified", collectionMethod: "Table parser",
      evidence: `${header}\n${row}\n${specs}\n${countProof}\n${currencyProof}`,
      notes: `CloudGPU's own published per-card hourly rate; historical market comparison excluded. Source stock label: ${cells[1]}; capacity not independently verified. GPU time billed by the minute. Card payments temporarily unavailable; USDT or business bank transfer. Tax treatment not specified.`,
      sourceUrl, observedAt,
    });
  }
  if (rows.length !== 3) throw new Error("Source CloudGPU expected three GPU model rates");
  return rows;
}
