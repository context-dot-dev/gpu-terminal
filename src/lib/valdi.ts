import { createHash } from "node:crypto";
import type { Rate } from "./types";

const cardPattern =
  /\[([^\]]+)\]\(([^)\s]+)\)/g;

type Offer = {
  card: string;
  url: string;
  title: string;
  gpu: string;
  gpusPerNode: number;
  region: string;
  tier: string;
  availableNodes: number;
  minimumNodes: number;
  weeks: number;
  prices: { amount: number; monthly: boolean }[];
};

function parseOffer(card: string, url: string): Offer {
  const label = card.slice(1, card.lastIndexOf("]("));
  const text = label
    .replace(/\\+/g, " ")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const title = /^\*\*(\d+)x\s+(.+?)\*\*/.exec(text);
  const tierAndRegion = /\b(Tier\s+\d+\s+DC)\s+(.+?)\s+\$\d/.exec(text);
  const inventory =
    /\b(\d+) nodes? available\s*\|\s*Min\. order:\s*(\d+) nodes? for (\d+) weeks\b/i.exec(
      text,
    );
  const prices = [
    ...text.matchAll(
      /\$(\d+(?:,\d{3})*(?:\.\d+)?)\s*\/\s*GPU-hr(?:\s*\((monthly)\))?/gi,
    ),
  ];

  if (
    !title ||
    !tierAndRegion ||
    !inventory ||
    !/^Available(?:\s|$)/.test(
      text.slice(inventory.index + inventory[0].length).trimStart(),
    )
  )
    throw new Error("Source VALDI inventory card is incomplete or changed");
  if (!/^https:\/\/gpulist\.valdi\.ai\/gpu\/[^/?#]+(?:[?#].*)?$/.test(url))
    throw new Error("Source VALDI offer link is malformed or off-domain");
  if (prices.length < 1 || prices.length > 2 || prices[0][2])
    throw new Error("Source VALDI GPU-hour price variants are ambiguous");
  if (prices.length === 2 && !prices[1][2])
    throw new Error("Source VALDI second GPU-hour price is not labeled monthly");
  if ((text.match(/\$/g) ?? []).length !== prices.length)
    throw new Error("Source VALDI card contains an unrecognized price");

  const gpusPerNode = Number(title[1]);
  const availableNodes = Number(inventory[1]);
  const minimumNodes = Number(inventory[2]);
  const weeks = Number(inventory[3]);
  if (
    ![gpusPerNode, availableNodes, minimumNodes, weeks].every(
      (n) => Number.isSafeInteger(n) && n > 0,
    ) ||
    minimumNodes > availableNodes ||
    gpusPerNode * minimumNodes > Number.MAX_SAFE_INTEGER
  )
    throw new Error("Source VALDI inventory counts or commitment are invalid");

  const parsedPrices = prices.map((price) => ({
    amount: Number(price[1].replaceAll(",", "")),
    monthly: Boolean(price[2]),
  }));
  if (
    parsedPrices.some(
      ({ amount }) =>
        !Number.isFinite(amount) || amount <= 0 || amount > 1_000_000,
    )
  )
    throw new Error("Source VALDI GPU-hour price is invalid");

  return {
    card,
    url,
    title: title[0].slice(2, -2),
    gpu: title[2]
      .trim()
      .replace(/\s+-\s+TEE Confidential Computing Supported$/i, ""),
    gpusPerNode,
    tier: tierAndRegion[1],
    region: tierAndRegion[2].trim(),
    availableNodes,
    minimumNodes,
    weeks,
    prices: parsedPrices,
  };
}

function makeRate(
  offer: Offer,
  price: Offer["prices"][number],
  variant: "listed" | "monthly commit",
  observedAt: string,
  monthlyQuoteMatches = false,
): Rate {
  const gpuCount = offer.gpusPerNode * offer.minimumNodes;
  const commitment = `Minimum ${offer.weeks} weeks; ${offer.minimumNodes} ${offer.minimumNodes === 1 ? "node" : "nodes"}`;
  const plan = `${offer.title} · ${offer.tier} · ${offer.minimumNodes} ${offer.minimumNodes === 1 ? "node" : "nodes"} minimum · ${offer.weeks}-week commitment${variant === "monthly commit" ? " · monthly commit" : ""}`;
  return {
    id: createHash("sha256")
      .update(
        JSON.stringify([
          "valdi-offer-v1",
          offer.url,
          offer.gpu,
          offer.gpusPerNode,
          offer.minimumNodes,
          offer.weeks,
          variant,
          "USD",
          "gpu-hour",
        ]),
      )
      .digest("hex")
      .slice(0, 24),
    providerId: "valdi",
    collectionMethod: "Table parser",
    gpu: offer.gpu,
    gpuCount,
    vramGb: null,
    vcpus: null,
    ramGb: null,
    commitment,
    region: offer.region,
    plan,
    billing: "Committed",
    currency: "USD",
    amount: price.amount,
    unit: "gpu-hour",
    hourly: price.amount,
    priceType: "Exact",
    availability: "Available",
    evidence: offer.card,
    notes: `VALDI lists ${offer.availableNodes} available nodes and a minimum order of ${offer.minimumNodes} nodes for ${offer.weeks} weeks (${gpuCount} GPUs minimum at ${offer.gpusPerNode} GPUs per node). This is committed inventory, not on-demand pricing. ${variant === "monthly commit" ? "The source labels this published GPU-hour quote as a monthly commit; it does not show a separate monthly total." : monthlyQuoteMatches ? "The source's separately labeled monthly-commit GPU-hour quote matches this amount." : "The source lists this GPU-hour quote."} Only the first inventory page was parsed; later pages may contain additional offers. Availability is point-in-time. VRAM and whether CPU/RAM figures apply per node or to the full cluster are not specified clearly enough to publish.`,
    sourceUrl: offer.url,
    observedAt,
  };
}

export function parseValdi(
  markdown: string,
  observedAt: string,
): Rate[] {
  if (!Number.isFinite(Date.parse(observedAt)))
    throw new Error("Source VALDI observation time is invalid");
  if (!/\bPage 1\b/.test(markdown))
    throw new Error("Source VALDI first-page marker is missing");

  const matches = [...markdown.matchAll(cardPattern)].filter((match) =>
    /^\*\*\d+x\s+.+\*\*/.test(match[1]),
  );
  const titleCount = [
    ...markdown.matchAll(/\[\*\*\d+x\s+[^*]+\*\*/g),
  ].length;
  if (titleCount !== matches.length)
    throw new Error("Source VALDI inventory card link is missing or malformed");
  if (!matches.length)
    throw new Error("Source VALDI inventory page contains no offer cards");
  const offers = matches.map((match) => parseOffer(match[0], match[2]));
  const seen = new Map<string, string>();
  for (const offer of offers) {
    const prior = seen.get(offer.url);
    if (prior && prior !== offer.card)
      throw new Error("Source VALDI duplicate offer link has conflicting data");
    if (prior)
      throw new Error("Source VALDI inventory contains a duplicate offer link");
    seen.set(offer.url, offer.card);
  }

  const rates: Rate[] = [];
  for (const offer of offers) {
    const [listed, monthly] = offer.prices;
    if (monthly && monthly.amount !== listed.amount) {
      rates.push(makeRate(offer, listed, "listed", observedAt));
      rates.push(makeRate(offer, monthly, "monthly commit", observedAt));
    } else {
      rates.push(
        makeRate(
          offer,
          listed,
          "listed",
          observedAt,
          Boolean(monthly),
        ),
      );
    }
  }

  if (!rates.length)
    throw new Error("Source VALDI inventory has no complete rates");
  return rates;
}
