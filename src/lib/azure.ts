import { createHash } from "node:crypto";
import { z } from "zod";
import type { Rate } from "./types";

const docs =
  "https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/gpu-accelerated/";
type Hardware = {
  gpu: string;
  count: number;
  vram: number;
  document: string;
  product: string;
};
const hardware: Record<string, Hardware> = {};
for (const [sku, count] of [
  ["NC4as_T4_v3", 1],
  ["NC8as_T4_v3", 1],
  ["NC16as_T4_v3", 1],
  ["NC64as_T4_v3", 4],
] as const) {
  hardware[`Standard_${sku}`] = {
    gpu: "NVIDIA T4",
    count,
    vram: 16,
    document: `${docs}ncast4v3-series`,
    product: "Virtual Machines NCasT4 v3 Series",
  };
}
for (const [sku, count] of [
  ["NC24ads_A100_v4", 1],
  ["NC48ads_A100_v4", 2],
  ["NC96ads_A100_v4", 4],
] as const) {
  hardware[`Standard_${sku}`] = {
    gpu: "NVIDIA A100 PCIe",
    count,
    vram: 80,
    document: `${docs}nca100v4-series`,
    product: "NCads A100 v4 Series Linux",
  };
}
hardware.Standard_ND96asr_v4 = {
  gpu: "NVIDIA A100",
  count: 8,
  vram: 40,
  document: `${docs}ndasra100v4-series`,
  product: "Virtual Machines NDasr A100 v4 Series",
};
for (const [sku, count] of [
  ["NC40ads_H100_v5", 1],
  ["NC80adis_H100_v5", 2],
] as const) {
  hardware[`Standard_${sku}`] = {
    gpu: "NVIDIA H100 NVL",
    count,
    vram: 94,
    document: `${docs}ncadsh100v5-series`,
    product: "Virtual Machines NCadsH100v5 Series",
  };
}

const itemSchema = z
  .object({
    currencyCode: z.string(),
    tierMinimumUnits: z.number(),
    retailPrice: z.number().finite(),
    armRegionName: z.string(),
    effectiveStartDate: z
      .string()
      .refine((s) => Number.isFinite(Date.parse(s))),
    meterId: z.string(),
    meterName: z.string(),
    productName: z.string(),
    skuName: z.string(),
    serviceName: z.string(),
    unitOfMeasure: z.string(),
    type: z.string(),
    isPrimaryMeterRegion: z.boolean(),
    armSkuName: z.string(),
  })
  .passthrough();
const pageSchema = z.object({
  Items: z.array(itemSchema),
  NextPageLink: z.string().url().nullable(),
});

export async function collectAzure(): Promise<{
  rates: Rate[];
  document: string;
  sourceUrl: string;
}> {
  const endpoint = new URL("https://prices.azure.com/api/retail/prices");
  endpoint.searchParams.set("currencyCode", "USD");
  endpoint.searchParams.set(
    "$filter",
    `serviceName eq 'Virtual Machines' and priceType eq 'Consumption' and (${Object.keys(
      hardware,
    )
      .map((sku) => `armSkuName eq '${sku}'`)
      .join(" or ")})`,
  );
  const sourceUrl = endpoint.toString();
  const pages: {
    url: string;
    observedAt: string;
    items: z.infer<typeof itemSchema>[];
  }[] = [];
  const visited = new Set<string>();
  let next: string | null = sourceUrl;
  const signal = AbortSignal.timeout(90000);
  while (next) {
    if (pages.length >= 10 || visited.has(next))
      throw new Error(
        "Source Azure pagination did not complete; snapshot rejected",
      );
    const url = new URL(next);
    if (
      url.origin !== endpoint.origin ||
      url.pathname !== endpoint.pathname ||
      url.username ||
      url.password
    ) {
      throw new Error("Source Azure returned an invalid pagination URL");
    }
    visited.add(next);
    const response = await fetch(next, {
      cache: "no-store",
      signal,
      redirect: "error",
    });
    if (!response.ok)
      throw new Error(
        `Source Azure retail API returned HTTP ${response.status}`,
      );
    const parsed = pageSchema.safeParse(await response.json());
    if (!parsed.success)
      throw new Error(
        "Source Azure retail API returned an invalid pricing schema",
      );
    pages.push({
      url: next,
      observedAt: new Date().toISOString(),
      items: parsed.data.Items,
    });
    next = parsed.data.NextPageLink;
  }

  const selected = new Map<string, { rate: Rate; effective: number }>();
  for (const page of pages) {
    for (const row of page.items) {
      const spec = hardware[row.armSkuName];
      if (
        !spec ||
        row.productName !== spec.product ||
        row.serviceName !== "Virtual Machines" ||
        row.type !== "Consumption" ||
        row.currencyCode !== "USD" ||
        row.unitOfMeasure !== "1 Hour" ||
        !row.isPrimaryMeterRegion ||
        row.tierMinimumUnits !== 0 ||
        row.retailPrice <= 0 ||
        !row.armRegionName ||
        /windows|spot|low priority|devtest/i.test(
          `${row.productName} ${row.skuName} ${row.meterName}`,
        )
      )
        continue;
      const effective = Date.parse(row.effectiveStartDate);
      if (effective > Date.parse(page.observedAt)) continue;
      const identity = [
        "azure",
        row.armSkuName,
        row.armRegionName,
        "On-demand",
        "instance-hour",
        "USD",
      ];
      const id = createHash("sha256")
        .update(JSON.stringify(identity))
        .digest("hex")
        .slice(0, 24);
      const rate: Rate = {
        id,
        providerId: "azure",
        gpu: spec.gpu,
        vramGb: spec.vram,
        gpuCount: spec.count,
        region: row.armRegionName,
        plan: row.armSkuName,
        billing: "On-demand",
        currency: "USD",
        amount: row.retailPrice,
        unit: "instance-hour",
        hourly: Math.round((row.retailPrice / spec.count) * 1e8) / 1e8,
        priceType: "Exact",
        availability: "Not verified",
        evidence: JSON.stringify(row),
        notes: `Linux retail VM price includes all ${spec.count} GPU(s) and the predefined host CPU/RAM. Storage, network and applicable taxes may cost extra. Published regional pricing does not verify capacity or account quota. Price effective ${row.effectiveStartDate}. GPU specification: ${spec.document}`,
        sourceUrl: page.url,
        observedAt: page.observedAt,
      };
      const prior = selected.get(id);
      if (
        prior &&
        prior.effective === effective &&
        prior.rate.amount !== rate.amount
      ) {
        throw new Error(
          "Source Azure returned conflicting prices for the same configuration",
        );
      }
      if (!prior || effective > prior.effective)
        selected.set(id, { rate, effective });
    }
  }
  const rates = [...selected.values()]
    .map((r) => r.rate)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (!rates.length)
    throw new Error("Source Azure returned no supported hourly GPU rates");
  return {
    rates,
    sourceUrl,
    document: JSON.stringify({
      source: "Azure Retail Prices API",
      complete: true,
      scope:
        "Ten documented full-GPU VM SKUs; all published regions; Linux USD on-demand; excludes Spot, reservations, DevTest and fractional GPUs",
      hardware,
      pages,
    }),
  };
}
