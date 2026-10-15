import { createHash } from "node:crypto";
import type { Rate } from "./types";

export function parseRunpod(
  markdown: string,
  observedAt: string,
  sourceUrl: string,
): Rate[] {
  const section = markdown.match(/## Pods\n([\s\S]*?)(?=\n## Serverless)/)?.[1];
  if (!section || !section.includes("Per hour"))
    throw new Error("Runpod Pods pricing section changed");
  const cards = [
    ...section.matchAll(
      /\n([^\n]+)\n\n(\d+) GB[^\n]*\n\n(\d+) GB RAM\n\n(\d+)\s+vCPUs\n\n\$([\d.]+)\/hr\n([\s\S]*?)\[Deploy ([^\]]+)\]\(([^)]+)\)/g,
    ),
  ];
  if (
    !cards.length ||
    cards.length !== [...section.matchAll(/\[Deploy /g)].length
  )
    throw new Error("Runpod pricing cards incomplete");
  const rates: Rate[] = [];
  for (const m of cards) {
    const gpu = m[1],
      sku = new URL(m[8]).searchParams.get("gpu");
    if (gpu !== m[7] || !sku)
      throw new Error("Runpod GPU deployment label changed");
    if (/\bMIG\b/i.test(gpu) || /\bMIG\b/i.test(sku)) continue;
    const amount = Number(m[5]);
    if (!amount) throw new Error("Runpod hourly price invalid");
    const plan = `Pods · ${gpu} · ${m[4]} vCPU · ${m[3]} GB RAM`;
    rates.push({
      id: createHash("sha256")
        .update(`runpod|pods|${sku}`)
        .digest("hex")
        .slice(0, 24),
      providerId: "runpod",
      gpu,
      gpuCount: null,
      vramGb: Number(m[2]),
      ramGb: Number(m[3]),
      vcpus: Number(m[4]),
      region: "Not specified",
      plan,
      billing: "On-demand",
      commitment: "None",
      currency: "USD",
      amount,
      unit: "gpu-hour",
      hourly: amount,
      priceType: "Exact",
      availability: "Not verified",
      evidence: m[0],
      notes:
        "Published Pods GPU hourly rate with associated host resources. The Markdown does not establish the selected Community/Secure cloud option, so the cloud tier is unspecified. Minimum GPU quantity and region not stated. Only individual full-card Pods offers included.",
      sourceUrl,
      observedAt,
      collectionMethod: "Table parser",
    });
  }
  if (!rates.length || new Set(rates.map((r) => r.id)).size !== rates.length)
    throw new Error("Runpod full GPU rates missing or duplicated");
  return rates;
}
