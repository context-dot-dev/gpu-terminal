import { createHash } from "node:crypto";
import type { Rate } from "./types";

export function parseCloudRift(
  markdown: string,
  observedAt: string,
  sourceUrl: string,
): Rate[] {
  const table = markdown.match(
    /\| Model \| Vendor \| On-Demand \(\$\/hr\) \| 1 Month \(\$\/hr\)[↑↓]? \| 3 Month \(\$\/hr\) \| VRAM \| Local Storage \| Max GPUs \|\n((?:\|[^\n]+\n?)+)/,
  )?.[1];
  if (!table) throw new Error("CloudRift price table changed");
  const rates: Rate[] = [];
  for (const line of table.trim().split("\n")) {
    const c = line
      .split("|")
      .slice(1, -1)
      .map((x) => x.trim());
    if (c.every((x) => /^[-: ]+$/.test(x))) continue;
    if (c.length !== 8) throw new Error("CloudRift table column count changed");
    const gpu = c[0].replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"),
      vramGb = Number(c[5].match(/^(\d+) GB$/)?.[1]);
    if (!vramGb || !["NVIDIA", "AMD"].includes(c[1]))
      throw new Error("CloudRift GPU identity invalid");
    for (let i = 2; i <= 4; i++) {
      if (c[i] === "Upon request") continue;
      const amount = Number(c[i].match(/^\$([\d.]+)$/)?.[1]);
      if (!amount) throw new Error("CloudRift amount invalid");
      const commitment = i === 2 ? "None" : i === 3 ? "1 month" : "3 months";
      const plan = `${gpu} · ${i === 2 ? "On-demand" : commitment + " reserved"}`;
      rates.push({
        id: createHash("sha256")
          .update(`cloudrift|${plan}`)
          .digest("hex")
          .slice(0, 24),
        providerId: "cloudrift",
        gpu,
        vramGb,
        gpuCount: null,
        region: "Not specified",
        plan,
        billing: i === 2 ? "On-demand" : "Committed",
        commitment,
        currency: "USD",
        amount,
        unit: "gpu-hour",
        hourly: amount,
        priceType: "Exact",
        availability: "Not verified",
        evidence: line,
        notes: `Rate from explicit ${i === 2 ? "On-Demand" : i === 3 ? "1 Month" : "3 Month"} USD/hour column. Maximum ${c[7]} GPUs is capacity, not a required rental count. Source local storage ${c[6]}; available capacity not independently verified.`,
        sourceUrl,
        observedAt,
        collectionMethod: "Table parser",
      });
    }
  }
  if (!rates.length || new Set(rates.map((r) => r.id)).size !== rates.length)
    throw new Error("CloudRift price table empty or duplicated");
  return rates;
}
