import { createHash } from "node:crypto";
import type { Rate } from "./types";

export function parseNovaCloud(
  markdown: string,
  observedAt: string,
  sourceUrl: string,
  controls: string[] = [],
): Rate[] {
  const verifiedOnDemand =
    controls.some((html) =>
      /class="[^"]*\bbg-indigo-600\b[^"]*"[^>]*>On-demand<\/button>/.test(html),
    ) &&
    controls.some((html) =>
      /class="[^"]*\bbg-slate-200\b[^"]*"[^>]*>None<\/button>/.test(html),
    );
  const section = markdown.split("## Infrastructure Costs")[0];
  if (
    !section.includes("On-demandInterruptible") ||
    !section.includes("Multi-GPU Pricing")
  )
    throw new Error("Nova pricing layout changed");
  const rates: Rate[] = [];
  for (const model of section.matchAll(
    /### ([^\n]+)\n([\s\S]*?)(?=\n### |$)/g,
  )) {
    const gpu = model[1],
      body = model[2];
    const perGpu = Number(body.match(/\$([\d.]+)\/hr per GPU/)?.[1]);
    const vram = Number(body.match(/VRAM\s+(\d+) GB/)?.[1]);
    if (!perGpu || !vram) throw new Error("Nova GPU rate or VRAM missing");
    let count = 0;
    for (const m of body.matchAll(
      /(\d+)x GPU · (\d+) GB VRAM · (\d+) GB RAM\$([\d.]+)\/hr/g,
    )) {
      const gpuCount = Number(m[1]),
        amount = Number(m[4]);
      if (
        Number(m[2]) !== vram * gpuCount ||
        Math.abs(amount / gpuCount - perGpu) > 0.0001
      )
        throw new Error("Nova GPU totals disagree");
      const plan = `${gpuCount}x ${gpu} · ${m[3]} GB RAM`;
      rates.push({
        id: createHash("sha256")
          .update(`novacloud|${plan}`)
          .digest("hex")
          .slice(0, 24),
        providerId: "novacloud",
        gpu,
        vramGb: vram,
        gpuCount,
        vcpus: null,
        ramGb: Number(m[3]),
        region: "Not specified",
        plan,
        billing: verifiedOnDemand ? "On-demand" : "Unspecified",
        commitment: verifiedOnDemand
          ? "None"
          : "Source billing toggle selection not verified",
        currency: "USD",
        amount,
        unit: "instance-hour",
        hourly: amount / gpuCount,
        priceType: "Exact",
        availability: "Not verified",
        evidence: `${gpu}\n${m[0]}${verifiedOnDemand ? "\nSelected controls: On-demand / None" : ""}`,
        notes: `Explicit multi-GPU instance total and total VRAM, normalized by GPU count. ${verifiedOnDemand ? "Active on-demand and no-reservation controls verified in source HTML." : "Selected pricing controls unavailable; billing and commitment not assumed."} Storage and traffic extra.`,
        sourceUrl,
        observedAt,
        collectionMethod: "Table parser",
      });
      count++;
    }
    if (count !== 4) throw new Error("Nova GPU quantity tiers changed");
  }
  if (!rates.length) throw new Error("Nova pricing empty");
  return rates;
}
