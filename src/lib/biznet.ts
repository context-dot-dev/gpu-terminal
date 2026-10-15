import { createHash } from "node:crypto";
import type { Rate } from "./types";

export function parseBiznet(
  markdown: string,
  observedAt: string,
  sourceUrl: string,
): Rate[] {
  if (!Number.isFinite(Date.parse(observedAt)))
    throw new Error("Source Biznet observation time is invalid");
  const cards = [
    ...markdown.matchAll(
      /^[- ]*#### ([1-8])x NVIDIA H200\s*\n([\s\S]*?)(?=^[- ]*#### |^## |$(?![\s\S]))/gm,
    ),
  ];
  if (cards.length !== 8 || new Set(cards.map((m) => m[1])).size !== 8)
    throw new Error(
      "Source Biznet does not contain eight distinct GPU configurations",
    );
  return cards.map((card) => {
    const price =
      /^[ \t]*(?:~Rp\d{1,3}(?:\.\d{3})*~[ \t]+)?Rp(\d{1,3}(?:\.\d{3})*)[ \t]*\n\s*\/ jam[ \t]*(?:\n|$)/m.exec(
        card[2],
      );
    if (!price)
      throw new Error("Source Biznet current IDR hourly price is ambiguous");
    const amount = Number(price[1].replace(/\./g, "")),
      gpuCount = Number(card[1]);
    if (!(amount > 0))
      throw new Error("Source Biznet hourly price must be positive");
    const plan = `NEO GPU ${gpuCount}x NVIDIA H200`;
    return {
      id: createHash("sha256")
        .update(
          JSON.stringify([
            "biznetgio",
            plan,
            "IDR",
            "instance-hour",
            "On-demand",
          ]),
        )
        .digest("hex")
        .slice(0, 24),
      providerId: "biznetgio",
      gpu: "H200",
      gpuCount,
      vramGb: null,
      vcpus: null,
      ramGb: null,
      plan,
      region: "Indonesia",
      billing: "On-demand",
      commitment: "None",
      currency: "IDR",
      amount,
      unit: "instance-hour",
      hourly: Math.round((amount / gpuCount) * 1e8) / 1e8,
      priceType: "Exact",
      availability: "Not verified",
      collectionMethod: "Table parser",
      evidence: card[0].trim(),
      notes:
        "Current published promotional price per whole GPU instance per hour (jam). Crossed-out price excluded. GPU memory and host resources are not available in the captured table. Discount duration and tax treatment are not specified; availability is not verified.",
      sourceUrl,
      observedAt,
    } satisfies Rate;
  });
}
