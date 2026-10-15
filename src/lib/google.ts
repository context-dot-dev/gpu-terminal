import { createHash } from "node:crypto";
import type { Rate } from "./types";

function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((s) => s.trim());
}

export function parseGoogle(
  markdown: string,
  observedAt: string,
  sourceUrl: string,
): Rate[] {
  if (!Number.isFinite(Date.parse(observedAt)))
    throw new Error("Source Google observation time is invalid");
  const rates = new Map<string, Rate>();
  const starts = [...markdown.matchAll(/^ *\|\s*Machine type\s*\|/gm)];
  for (const start of starts) {
    const offset = start.index!;
    const rest = markdown.slice(offset);
    const separator = /^\|(?:\s*:?-+:?\s*\|)+[ \t]*$/m.exec(rest);
    if (!separator || separator.index > 12000)
      throw new Error(
        "Source Google machine pricing table has no valid header separator",
      );
    const header = rest.slice(0, separator.index).trim();
    const labels = cells(header).map((s) => s.replace(/\s+/g, " ").trim());
    const machineIndex = labels.indexOf("Machine type");
    const gpuIndex = labels.indexOf("GPU");
    const componentsIndex = labels.indexOf("Components");
    const priceIndices = labels.flatMap((label, i) =>
      label === "Price (USD)" ||
      (label.startsWith("Price (USD)") &&
        /Consumption model ID:\s*7754-699E-0EBF$/.test(label))
        ? [i]
        : [],
    );
    if (
      machineIndex < 0 ||
      gpuIndex < 0 ||
      componentsIndex < 0 ||
      priceIndices.length !== 1 ||
      cells(separator[0]).length !== labels.length
    ) {
      throw new Error(
        "Source Google machine pricing table has ambiguous columns",
      );
    }
    const priceIndex = priceIndices[0];
    const body = rest
      .slice(separator.index + separator[0].length)
      .replace(/^\r?\n/, "");
    for (const line of body.split(/\r?\n/)) {
      if (!line.trim().startsWith("|")) break;
      const values = cells(line);
      if (values.length !== labels.length)
        throw new Error(
          "Source Google machine pricing row does not match its header",
        );
      if (!values[gpuIndex] && !values[componentsIndex]) continue;
      const plan = values[machineIndex];
      const gpu = values[gpuIndex];
      const components = values[componentsIndex].replace(
        /<br\s*\/?\s*>/gi,
        "; ",
      );
      const countText = /(?:^|;\s*)GPUs:\s*([^;]+)/
        .exec(components)?.[1]
        .trim();
      if (countText && /^\d+\s*\/\s*\d+$/.test(countText)) continue;
      if (
        !countText ||
        !/^[1-9]\d*$/.test(countText) ||
        !/^[a-z][a-z0-9]*-[a-z0-9-]+$/.test(plan) ||
        !/^NVIDIA\s+[a-z0-9 ]+$/i.test(gpu)
      ) {
        throw new Error(
          "Source Google machine pricing row has ambiguous GPU specifications",
        );
      }
      const gpuCount = Number(countText);
      if (!Number.isSafeInteger(gpuCount) || gpuCount > 2048)
        throw new Error("Source Google GPU count is invalid");
      const price = values[priceIndex];
      if (/^(?:N\/A|\\?-|—)$/i.test(price)) continue;
      const match =
        /^\$((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*\/\s*1 hour$/.exec(price);
      if (!match)
        throw new Error(
          "Source Google on-demand price is not an unambiguous USD instance-hour amount",
        );
      const amount = Number(match[1].replaceAll(",", ""));
      if (!Number.isFinite(amount) || amount <= 0)
        throw new Error("Source Google price is invalid");
      const region = "Not specified";
      const id = createHash("sha256")
        .update(
          JSON.stringify([
            "google",
            plan,
            region,
            "On-demand",
            "USD",
            "instance-hour",
          ]),
        )
        .digest("hex")
        .slice(0, 24);
      const rate: Rate = {
        id,
        providerId: "google",
        gpu,
        vramGb: null,
        gpuCount,
        region,
        plan,
        billing: "On-demand",
        currency: "USD",
        amount,
        unit: "instance-hour",
        hourly: Math.round((amount / gpuCount) * 1e8) / 1e8,
        priceType: "Exact",
        availability: "Not verified",
        evidence: `Header:\n${header}\n\nRow:\n${line}`,
        notes: `Default USD instance-hour column (on-demand consumption model 7754-699E-0EBF). Full ${gpuCount}-GPU instance required. ${components}. CPU, memory and any listed bundled local SSD are included; other storage, network and premium licenses may cost extra. Region and GPU VRAM are not inferred from host memory or the page's region selector. Published price does not verify capacity or quota.`,
        sourceUrl,
        observedAt,
      };
      const prior = rates.get(id);
      if (
        prior &&
        (prior.amount !== rate.amount ||
          prior.gpuCount !== rate.gpuCount ||
          prior.gpu !== rate.gpu)
      ) {
        throw new Error(
          "Source Google has conflicting prices or specifications without a distinct region",
        );
      }
      rates.set(id, rate);
    }
  }
  if (!rates.size)
    throw new Error(
      "Source Google has no unambiguous full-GPU on-demand instance rates",
    );
  return [...rates.values()].sort((a, b) => a.id.localeCompare(b.id));
}
