import { createHash } from "node:crypto";
import type { Rate } from "./types";
export function parseTencent(
  markdown: string,
  observedAt: string,
  sourceUrl: string,
): Rate[] {
  const rates = new Map<string, Rate>();
  for (const m of markdown.matchAll(
    /(Spot Instance|Pay-As-You-Go)\s+([\s\S]*?)\[Buy Now\]\(([^)]+)\)/g,
  )) {
    const body = m[2],
      url = new URL(m[3]),
      mode = url.searchParams.get("devPayMode"),
      instance = url.searchParams.get("instanceType"),
      region = url.searchParams.get("regionId");
    const amount = Number(body.match(/\$([\d.]+)\/hour/)?.[1]),
      gpuCount = Number(body.match(/\nGPU\s+(\d+)/)?.[1]),
      vcpus = Number(body.match(/\nCPU\s+(\d+)-core/)?.[1]),
      ramGb = Number(body.match(/\nMemory\s+(\d+)GB/)?.[1]),
      gpu = body.match(/\+ (NVIDIA[^\n]+)/)?.[1];
    if (
      !amount ||
      !gpuCount ||
      !vcpus ||
      !ramGb ||
      !gpu ||
      !instance ||
      !region ||
      !["spotpaid", "hourly"].includes(mode || "")
    )
      throw new Error("Tencent GPU instance card changed");
    const billing = mode === "spotpaid" ? "Spot" : "On-demand";
    if ((billing === "Spot") !== (m[1] === "Spot Instance"))
      throw new Error("Tencent billing label and checkout disagree");
    const id = createHash("sha256")
      .update(`tencentcloud|${instance}|${region}|${billing}`)
      .digest("hex")
      .slice(0, 24);
    const rate: Rate = {
      id,
      providerId: "tencentcloud",
      gpu,
      gpuCount,
      vramGb: Number(gpu.match(/(\d+)GB/)?.[1]) || null,
      vcpus,
      ramGb,
      region: `Tencent region ${region}`,
      plan: instance,
      billing,
      commitment: "None",
      currency: "USD",
      amount,
      unit: "instance-hour",
      hourly: amount / gpuCount,
      priceType: "Exact",
      availability: "Not verified",
      evidence: m[0],
      notes:
        "GPU quantity and total hourly instance price are explicit. Billing verified against the linked checkout mode; duplicate promotional cards collapsed. Numeric source region ID retained without inferring its geography.",
      sourceUrl,
      observedAt,
      collectionMethod: "Table parser",
    };
    if (rates.has(id) && rates.get(id)!.amount !== amount)
      throw new Error("Tencent repeated instance prices conflict");
    rates.set(id, rate);
  }
  if (!rates.size) throw new Error("Tencent GPU prices missing");
  return [...rates.values()];
}
