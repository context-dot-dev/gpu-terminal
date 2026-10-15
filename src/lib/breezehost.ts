import { createHash } from "node:crypto";
import type { Rate } from "./types";
export function parseBreezeHost(
  markdown: string,
  observedAt: string,
  sourceUrl: string,
): Rate[] {
  const amount = Number(
    markdown.match(/\$([\d.]+)\/hour\s+Reserve Pricing \(guaranteed\)/)?.[1],
  );
  const unavailable =
    /RTX 5090 instances are currently out of stock/.test(markdown) &&
    /Reserve Pricing \(guaranteed\)\s+Sold Out/.test(markdown);
  if (
    !amount ||
    !unavailable ||
    !markdown.includes("One Fully Dedicated RTX 5090")
  )
    throw new Error("BreezeHost guaranteed hourly offer changed");
  return [
    {
      id: createHash("sha256")
        .update("breezehost|RTX5090|guaranteed-hourly")
        .digest("hex")
        .slice(0, 24),
      providerId: "breezehost",
      gpu: "RTX 5090",
      gpuCount: 1,
      vramGb: 32,
      ramGb: 32,
      region: "Not specified",
      plan: "RTX 5090 guaranteed hourly",
      billing: "On-demand",
      commitment: "None",
      currency: "USD",
      amount,
      unit: "instance-hour",
      hourly: amount,
      priceType: "Exact",
      availability: "Unavailable",
      evidence: markdown.match(
        /\$[\d.]+\/hour\s+Reserve Pricing \(guaranteed\)\s+Sold Out/,
      )![0],
      notes:
        "Guaranteed hourly option is sold out. Future spot pricing, monthly plans and storage charges excluded. Source offers pay-as-you-go hourly billing. Availability changes require reviewing the updated source layout.",
      sourceUrl,
      observedAt,
      collectionMethod: "Table parser",
    },
  ];
}
