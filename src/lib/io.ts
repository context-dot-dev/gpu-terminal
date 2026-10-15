import { createHash } from "node:crypto";
import type { Rate } from "./types";
export function parseIo(
  markdown: string,
  observedAt: string,
  sourceUrl: string,
): Rate[] {
  const pattern =
    /\n([^\n]+)\n\n(Nvidia|AMD)\n\n(\d+)x\n\nAmount\n\n([\d.]+) GB\n\nVRAM\s+Per Card\n\n([^\n]+)\n\nStorage\n\nPrice From:\n\n\$([\d.]+)\/hr\n\n\[Deploy Cluster\]\(([^)]+)\)/g;
  const rates = new Map<string, Rate>();
  let matched = 0;
  for (const m of markdown.matchAll(pattern)) {
    matched++;
    const hardwareId = new URL(m[7]).searchParams.get("hardware_id");
    const gpuCount = Number(m[3]),
      amount = Number(m[6]),
      vramGb = Number(m[4]);
    if (!hardwareId || !gpuCount || !amount || !vramGb)
      throw new Error("io.net GPU configuration incomplete");
    const gpu = m[1].replaceAll("\\_", "_");
    const plan = `${gpuCount}x ${gpu} · ${m[5]} storage · ${hardwareId}`;
    const id = createHash("sha256")
      .update(`io|${hardwareId}`)
      .digest("hex")
      .slice(0, 24);
    const rate: Rate = {
      id,
      providerId: "io",
      gpu,
      gpuCount,
      vramGb,
      region: "Not specified",
      plan,
      billing: "On-demand",
      commitment: "None",
      currency: "USD",
      amount,
      unit: "instance-hour",
      hourly: amount / gpuCount,
      priceType: "Starting at",
      availability: "Not verified",
      evidence: m[0],
      notes:
        "Current deployable configuration card, distinguished by the provider hardware ID. Source quotes the complete cluster hourly price and explicitly per-card VRAM. Duplicate responsive cards collapsed. Published floor is not independent capacity verification; historical comparison prices excluded.",
      sourceUrl,
      observedAt,
      collectionMethod: "Table parser",
    };
    const old = rates.get(id);
    if (
      old &&
      (old.amount !== amount ||
        old.gpuCount !== gpuCount ||
        old.gpu !== gpu ||
        old.vramGb !== vramGb)
    )
      throw new Error(
        "io.net repeated hardware ID has conflicting specifications",
      );
    rates.set(id, rate);
  }
  const expected = [...markdown.matchAll(/\[Deploy Cluster\]\(/g)].length;
  if (!rates.size || matched !== expected)
    throw new Error(
      `io.net parsed ${matched} of ${expected} configuration cards`,
    );
  return [...rates.values()];
}
