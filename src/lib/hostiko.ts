import { createHash } from "node:crypto";
import type { Rate } from "./types";
export function parseHostiko(
  markdown: string,
  observedAt: string,
  sourceUrl: string,
): Rate[] {
  const rates: Rate[] = [];
  const blocks = [
    ...markdown.matchAll(
      /### (\d+)x (RTX 5090)[^\n]*\n([\s\S]*?)(?=\n### |\n## |$)/g,
    ),
  ];
  for (const m of blocks) {
    const count = Number(m[1]),
      body = m[3],
      amount = Number(body.match(/##### ([\d.]+) ₴\/година/)?.[1]);
    const vcpus = Number(body.match(/vCPU\s+---\s+(\d+)/)?.[1]),
      ramGb = Number(body.match(/ОЗП\s+---\s+(\d+) ГБ/)?.[1]);
    const region = body.match(/Локація: ([^\n]+)/)?.[1];
    if (!amount || !vcpus || !ramGb || !region)
      throw new Error("Hostiko hourly card changed");
    const plan = `${count}x RTX 5090 · ${vcpus} vCPU · ${ramGb} GB RAM`;
    rates.push({
      id: createHash("sha256")
        .update(`hostiko|${plan}`)
        .digest("hex")
        .slice(0, 24),
      providerId: "hostiko",
      gpu: m[2],
      gpuCount: count,
      vramGb: null,
      vcpus,
      ramGb,
      region,
      plan,
      billing: "On-demand",
      commitment: "None",
      currency: "UAH",
      amount,
      unit: "instance-hour",
      hourly: amount / count,
      priceType: "Exact",
      availability: "Not verified",
      evidence: m[0],
      notes:
        "Ukrainian hourly price for the complete GPU server; normalized by the explicit GPU quantity. Host RAM is not GPU VRAM. VAT excluded. Monthly prices and administration fees excluded.",
      sourceUrl,
      observedAt,
      collectionMethod: "Table parser",
    });
  }
  if (!rates.length) throw new Error("Hostiko hourly cards missing");
  return rates;
}
