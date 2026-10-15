import { createHash } from "node:crypto";
import type { Rate } from "./types";

export function parseNeevCloud(
  markdown: string,
  observedAt: string,
  sourceUrl: string,
): Rate[] {
  if (!Number.isFinite(Date.parse(observedAt)))
    throw new Error("Source NeevCloud observation time is invalid");
  const rates = new Map<string, Rate>();
  function readTable(title: string, headers: string[], single: boolean) {
    const start = markdown.indexOf(title);
    if (start < 0) throw new Error("Source NeevCloud pricing table is missing");
    const table = markdown
      .slice(start + title.length)
      .split(/\n###### Use Cases|\n###### \/\/|\n## /)[0];
    const rawRows = [...table.matchAll(/^\|[\s\S]*?(?=^\||$(?![\s\S]))/gm)].map(
      (m) => m[0].trim(),
    );
    const rows = rawRows.map((raw) =>
      raw
        .slice(1, -1)
        .split("|")
        .map((c) => c.replace(/######\s*/g, "").trim()),
    );
    if (!rows.length || headers.some((h, i) => rows[0][i] !== h))
      throw new Error("Source NeevCloud table headers changed");
    for (let i = 2; i < rows.length; i++) {
      const cells = rows[i];
      if (cells.length !== headers.length) break;
      const model = single
        ? /^(H100|A100)$/.exec(cells[0])
        : /^([1-9]\d*)x (H100|A100)$/.exec(cells[0]);
      if (!model) break;
      const gpuCount = single ? 1 : Number(model[1]),
        gpu = single ? model[1] : model[2];
      const amountText = cells[single ? 2 : 1];
      const price = (
        single
          ? /^₹(\d+(?:,\d{3})*(?:\.\d+)?)$/
          : /^₹(\d+(?:,\d{3})*(?:\.\d+)?)\/hr$/
      ).exec(amountText);
      const memory = /^(\d+)GB(?: HBM\d[e]?)?$/.exec(cells[single ? 1 : 2]);
      if (!price || !memory)
        throw new Error("Source NeevCloud price or memory format is ambiguous");
      const amount = Number(price[1].replace(/,/g, "")),
        vramGb = Number(memory[1]),
        plan = `${gpuCount}x ${gpu}`;
      const previous = rates.get(plan);
      if (previous) {
        if (previous.amount !== amount || previous.vramGb !== vramGb)
          throw new Error("Source NeevCloud duplicate pricing conflicts");
        continue;
      }
      rates.set(plan, {
        id: createHash("sha256")
          .update(
            JSON.stringify([
              "neevcloud",
              plan,
              "INR",
              "instance-hour",
              "On-demand",
            ]),
          )
          .digest("hex")
          .slice(0, 24),
        providerId: "neevcloud",
        gpu,
        gpuCount,
        vramGb,
        vcpus: null,
        ramGb: null,
        plan,
        region: "India",
        billing: "On-demand",
        commitment: "None",
        currency: "INR",
        amount,
        unit: "instance-hour",
        hourly: Math.round((amount / gpuCount) * 1e8) / 1e8,
        priceType: "Exact",
        availability: "Not verified",
        collectionMethod: "Table parser",
        evidence: `${title}\n${rawRows[0]}\n${rawRows[i]}`,
        notes:
          "Published hardware configuration price per instance-hour; billed per second while running. Memory column describes each GPU. First 25GB local NVMe per GPU included; additional storage charged separately. Commitment example tables and calculators excluded. Tax treatment not specified; capacity not verified.",
        sourceUrl,
        observedAt,
      });
    }
  }
  readTable(
    "GPU configuration and hourly pricing for NVIDIA H100 (80GB HBM3)",
    ["configuration", "Price / Hour", "Memory", "Bandwidth", "FP16"],
    false,
  );
  readTable(
    "GPU configurations and hourly pricing for Single GPU",
    ["GPU Type", "Memory", "Pricing/hour", "Typical Workload"],
    true,
  );
  if (rates.size !== 3)
    throw new Error(
      "Source NeevCloud expected three unique complete on-demand configurations",
    );
  return [...rates.values()];
}
