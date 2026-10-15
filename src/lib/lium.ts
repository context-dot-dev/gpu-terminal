import { createHash } from "node:crypto";
import type { Rate } from "./types";
export function parseLium(
  markdown: string,
  observedAt: string,
  sourceUrl: string,
): Rate[] {
  const count = markdown.match(/(\d+) \/ (\d+) Available Pods/);
  if (!count) throw new Error("Lium visible pod count missing");
  const expectedCards = [...markdown.matchAll(/(?:^|\n)\d+X\s+\[\*\*/g)].length;
  const rates: Rate[] = [];
  for (const m of markdown.matchAll(
    /(?:^|\n)(\d+)X\s+\[\*\*([^\n]+?)\*\*\]\([^\n]+\)\s+([\s\S]*?)(?=\n\d+X\s+\[\*\*|$)/g,
  )) {
    const gpuCount = Number(m[1]),
      body = m[3],
      amount = Number(body.match(/\$([\d.]+)\s+\/HOUR/)?.[1]);
    const link = body.match(/\[RENT NOW\]\(([^)]+)\)/)?.[1];
    const podId = link
      ? decodeURIComponent(link).match(/browse-pods\/([\da-f-]{36})/)?.[1]
      : null;
    const vcpus = Number(body.match(/CPU\s+(\d+)X/)?.[1]);
    const ram = body.match(/Memory\s+([\d,]+) GB/)?.[1],
      vram = body.match(/VRAM\s+([\d,]+) GB/)?.[1],
      region = body.match(/Location\s+([^\n]+)/)?.[1];
    if (!amount || !podId || !vcpus || !ram || !vram || !region)
      throw new Error("Lium pod configuration incomplete");
    const gpu = m[2],
      plan = `${gpuCount}x ${gpu} · Pod ${podId}`;
    rates.push({
      id: createHash("sha256")
        .update(`lium|${podId}`)
        .digest("hex")
        .slice(0, 24),
      providerId: "lium",
      gpu,
      gpuCount,
      vramGb: Number(vram.replaceAll(",", "")) / gpuCount,
      vcpus,
      ramGb: Number(ram.replaceAll(",", "")),
      region,
      plan,
      billing: "On-demand",
      commitment: "None",
      currency: "USD",
      amount,
      unit: "instance-hour",
      hourly: amount / gpuCount,
      priceType: "Exact",
      availability: "Available",
      evidence: m[0],
      notes: `Visible marketplace pod ${podId}; source renders ${expectedCards} cards while its counter says ${count[1]} of ${count[2]} available pods. This is a partial snapshot, not exhaustive inventory. VRAM is source-reported total divided by GPU count, not nominal model memory. ${/Reduced power limit/.test(body) ? "Reduced power limit. " : ""}Availability is the source snapshot.`,
      sourceUrl,
      observedAt,
      collectionMethod: "Table parser",
    });
  }
  if (
    !rates.length ||
    rates.length !== expectedCards ||
    new Set(rates.map((r) => r.id)).size !== rates.length
  )
    throw new Error(
      `Lium parsed ${rates.length} of ${expectedCards} rendered pods`,
    );
  return rates;
}
