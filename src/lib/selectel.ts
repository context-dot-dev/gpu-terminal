import { createHash } from "node:crypto";
import type { Rate } from "./types";

const amountFrom = (value: string) =>
  Number(value.replace(/[\s\u00a0\u202f]/g, "").replace(",", "."));

export function parseSelectel(
  markdown: string,
  observedAt: string,
  sourceUrl: string,
): Rate[] {
  if (
    !Number.isFinite(Date.parse(observedAt)) ||
    !/^https:\/\/selectel\.ru\/services\/gpu\/?$/.test(sourceUrl) ||
    !/Серверы\s+с\s+GPU/i.test(markdown)
  )
    throw new Error("Source Selectel GPU page, URL or observation is missing");

  const hourlyPrice = /\*\*От\s+([\d\s\u00a0\u202f,.]+)\*\*\s*₽\s*\/\s*час/i;
  const cloudSections = [
    ...markdown.matchAll(/^#{3}\s+Арендуйте облачный сервер с\s+GPU\b[^\n]*$/gim),
  ];
  const rates = new Map<string, Rate>();

  for (const heading of cloudSections) {
    if (heading.index === undefined) continue;
    const bodyStart = heading.index + heading[0].length;
    const rest = markdown.slice(bodyStart);
    const nextSection = rest.match(/^#{1,3}\s+/m)?.index;
    const section = rest.slice(0, nextSection ?? rest.length);
    const offerHeadings = [...section.matchAll(/^####\s+([^\n]+)$/gm)];

    for (const [offerIndex, offerHeading] of offerHeadings.entries()) {
      if (offerHeading.index === undefined) continue;
      const offerStart = offerHeading.index + offerHeading[0].length;
      const offerEnd = offerHeadings[offerIndex + 1]?.index ?? section.length;
      const offer = section.slice(offerStart, offerEnd);
      const price = hourlyPrice.exec(offer);
      const gpuMatch = /\|\s*GPU\s*\|\s*(\d+)\s*[×xх]\s*([^|\n]+)\s*\|/i.exec(offer);
      if (!price) continue;
      if (!gpuMatch || price.index === undefined || gpuMatch.index === undefined)
        throw new Error("Source Selectel hourly offer is missing its GPU model or count");

      const count = Number(gpuMatch[1]);
      const sourceGpu = gpuMatch[2].trim();
      const gpu = sourceGpu.replace(/\s*\([^)]*\)\s*$/, "").trim();
      const vramGb = Number(sourceGpu.match(/(\d+)\s*(?:ГБ|GB)/i)?.[1]) || null;
      const context = offer.slice(0, price.index + price[0].length);
      const vcpus = Number(context.match(/(\d+)\s*vCPU/i)?.[1]) || null;
      const ramGb = Number(
        context.match(/\|\s*(?:Память|Оперативная память)\s*\|\s*(\d+)\s*(?:ГБ|GB)/i)?.[1],
      ) || null;
      const amount = amountFrom(price[1]);
      const evidence = offer.slice(gpuMatch.index, price.index + price[0].length);
      if (
        !Number.isSafeInteger(count) ||
        count < 1 ||
        !gpu ||
        !vcpus ||
        !ramGb ||
        !Number.isFinite(amount) ||
        amount <= 0 ||
        evidence.length > 2000
      )
        throw new Error("Source Selectel GPU offer configuration or price is ambiguous");

      const title = offerHeading[1].trim();
      const plan = `${title} · ${count}× ${gpu} · ${vcpus} vCPU · ${ramGb} GB RAM`;
      const id = createHash("sha256")
        .update(JSON.stringify(["selectel", title, gpu, count, vcpus, ramGb, "RUB", "instance-hour"]))
        .digest("hex")
        .slice(0, 24);
      const rate: Rate = {
        id,
        providerId: "selectel",
        gpu,
        vramGb,
        gpuCount: count,
        vcpus,
        ramGb,
        region: "Not specified",
        plan,
        billing: "On-demand",
        commitment: "None",
        currency: "RUB",
        amount,
        unit: "instance-hour",
        hourly: amount / count,
        priceType: "Starting at",
        availability: "Not verified",
        evidence,
        notes:
          "Starting hourly price for a cloud-server configuration. The source gives a total instance-hour price and explicit GPU count; comparison normalizes by that count. Cloud servers are described as pay-as-you-go. Monthly dedicated-server offers are excluded.",
        sourceUrl,
        observedAt,
        collectionMethod: "Table parser",
      };
      const previous = rates.get(id);
      if (previous && previous.amount !== amount)
        throw new Error("Source Selectel repeated GPU offer has conflicting prices");
      rates.set(id, rate);
    }
  }

  if (!rates.size)
    throw new Error("Source Selectel cloud GPU hourly configurations were missing or changed");

  return [...rates.values()];
}
