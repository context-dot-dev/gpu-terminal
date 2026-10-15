import { createHash } from "node:crypto";
import type { Rate } from "./types";

export function parseNebius(
  markdown: string,
  observedAt: string,
  sourceUrl: string,
): Rate[] {
  const observed = Date.parse(observedAt);
  if (!Number.isFinite(observed))
    throw new Error("Source Nebius observation time is invalid");
  const rates: Rate[] = [];
  for (const section of [
    "NVIDIA GPU Instances",
    "Preemptible NVIDIA GPU Instances",
  ]) {
    const start = markdown.indexOf(`## ${section}\n`);
    if (start < 0) throw new Error("Source Nebius GPU section is missing");
    const next = markdown.indexOf("\n## ", start + 4);
    const content = markdown.slice(start, next < 0 ? undefined : next);
    const lines = content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const firstModel = lines.findIndex((line) => /^NVIDIA /.test(line));
    if (firstModel < 0) throw new Error("Source Nebius GPU rows are missing");
    const header = lines.slice(1, firstModel);
    const spot = section.startsWith("Preemptible");
    if (
      header[0] !== "Item" ||
      header[1] !== "vCPUs" ||
      header[2] !== "RAM, GB"
    )
      throw new Error("Source Nebius GPU resource headers changed");
    let selectedPrice = 0,
      effectiveLabel = "";
    if (spot) {
      if (
        header.length !== 4 ||
        header[3].replace(/\\/g, "") !== "Spot price, GPU-hour*"
      )
        throw new Error("Source Nebius spot unit is ambiguous");
    } else {
      if (header.length < 4 || header[3] !== "On-demand, GPU-hour")
        throw new Error("Source Nebius on-demand unit is ambiguous");
      if (header.length === 5) {
        const match = header[4].match(/^GPU-hour \(Effective (.+)\)$/);
        const effective = match ? Date.parse(`${match[1]} UTC`) : NaN;
        if (!Number.isFinite(effective))
          throw new Error("Source Nebius effective-price date is invalid");
        selectedPrice = observed >= effective ? 1 : 0;
        effectiveLabel = selectedPrice
          ? `Effective ${match![1]}.`
          : `Before ${match![1]} effective change.`;
      } else if (header.length !== 4)
        throw new Error("Source Nebius price columns are ambiguous");
    }
    let index = firstModel;
    while (index < lines.length) {
      const gpu = lines[index];
      let end = index + 1;
      while (end < lines.length && !/^NVIDIA /.test(lines[end])) end++;
      const row = lines.slice(index, end);
      const prices = row.slice(3);
      if (!/^NVIDIA /.test(gpu) || row.length !== (spot ? 4 : header.length))
        throw new Error("Source Nebius row does not match price headers");
      const price = prices[selectedPrice].replace(/\\/g, "");
      index = end;
      if (/^\[Contact us\]\(https:\/\/nebius\.com\//.test(price)) continue;
      const quoted = price.match(/^(from )?\$(\d+(?:\.\d+)?)(\*{0,2})$/);
      if (!quoted)
        throw new Error("Source Nebius GPU-hour amount is ambiguous");
      const amount = Number(quoted[2]);
      if (!Number.isFinite(amount) || amount <= 0)
        throw new Error("Source Nebius GPU price is invalid");
      const fixedPreemptible = spot && /L40S/.test(gpu);
      const billing = spot ? "Spot" : "On-demand";
      const terms = fixedPreemptible
        ? "Preemptible L40S is billed at a flat rate and is excluded from dynamic spot pricing."
        : spot
          ? "Published spot floor, not a live console quote. Actual GPU-hour rates vary with capacity and can change every 15 minutes while running."
          : effectiveLabel;
      rates.push({
        id: createHash("sha256")
          .update(
            JSON.stringify([
              "nebius",
              gpu,
              billing,
              "USD",
              "gpu-hour",
              "header-parser",
            ]),
          )
          .digest("hex")
          .slice(0, 24),
        providerId: "nebius",
        gpu,
        vramGb: null,
        gpuCount: null,
        vcpus: /^\d+$/.test(row[1]) ? Number(row[1]) : null,
        ramGb: /^\d+$/.test(row[2]) ? Number(row[2]) : null,
        commitment: "Unknown",
        region: "Not specified",
        plan: `${gpu} · ${billing}`,
        billing,
        currency: "USD",
        amount,
        unit: "gpu-hour",
        hourly: amount,
        priceType: quoted[1] ? "Starting at" : "Exact",
        availability: "Not verified",
        evidence: `${header.join("\n\n")}\n\n${row.join("\n\n")}`,
        notes: `${terms} Published price is per GPU-hour. Host resources shown: ${row[1]} vCPUs, ${row[2]} GB RAM; these are not GPU count or VRAM. Minimum GPU count and region are not stated here. Storage is priced separately.`,
        sourceUrl,
        observedAt,
      });
    }
  }
  if (
    !rates.length ||
    new Set(rates.map((rate) => rate.id)).size !== rates.length
  )
    throw new Error("Source Nebius GPU rates are empty or duplicated");
  return rates;
}
