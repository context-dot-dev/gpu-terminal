import { createHash } from "node:crypto";
import type { Rate } from "./types";

export function parseVerda(
  markdown: string,
  observedAt: string,
  sourceUrl: string,
): Rate[] {
  const rates: Rate[] = [];
  let section = "",
    table = false;
  const seen = new Set<string>();
  for (const line of markdown.split("\n")) {
    if (line.startsWith("## ")) {
      section = line.slice(3).trim();
      table = false;
      continue;
    }
    if (line.startsWith("### ")) {
      table = false;
      continue;
    }
    if (
      !["GPU instances", "Instant clusters", "Serverless containers"].includes(
        section,
      )
    )
      continue;
    if (
      line === "| Hardware | CPUs | RAM | GPU VRAM | Price | Spot price |" ||
      line === "| Hardware | CPUs | RAM | GPU VRAM | Price (1x GPU) |"
    ) {
      table = true;
      seen.add(section);
      continue;
    }
    if (!table) continue;
    if (!line.startsWith("|")) {
      table = false;
      continue;
    }
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.every((cell) => /^[-: ]+$/.test(cell))) continue;
    const cluster = section === "Instant clusters";
    if (cells.length !== (cluster ? 5 : 6))
      throw new Error("Verda GPU table shape changed");
    const [hardware, cpu, ram, memory, onDemand, spot] = cells;
    if (memory === "—") continue;
    const model = hardware.match(/^(?:(\d+)x )?(.+?) (\d+)GB$/);
    if (!model || (!cluster && model[1] !== "1") || (cluster && model[1]))
      throw new Error("Verda GPU model or quantity changed");
    if (cluster && !markdown.includes("Specs and price are shown per GPU."))
      throw new Error("Verda cluster pricing basis changed");
    const gpu = model[2],
      gpuCount = cluster ? null : Number(model[1]);
    const vramGb = Number(memory.match(/^([\d.]+) GB$/)?.[1]);
    const vcpus = cluster ? null : Number(cpu);
    const ramGb = cluster ? null : Number(ram.match(/^([\d.]+) GB$/)?.[1]);
    if (
      !Number.isFinite(vramGb) ||
      vramGb !== Number(model[3]) ||
      (!cluster &&
        [vcpus, ramGb].some(
          (value) => value === null || !Number.isFinite(value) || value <= 0,
        ))
    )
      throw new Error("Verda GPU memory or host configuration is invalid");
    for (const [tier, price] of [
      ["On-demand", onDemand],
      ["Spot", spot],
    ] as const) {
      if (price === undefined || price === "—") continue;
      const quote = price.match(/^([$€])([\d.]+)\/h$/);
      const amount = Number(quote?.[2]);
      if (!quote || !Number.isFinite(amount) || amount <= 0)
        throw new Error("Verda hourly price is invalid");
      const billing =
        tier === "Spot"
          ? "Spot"
          : section === "Serverless containers"
            ? "Serverless"
            : "On-demand";
      const plan = `${section} · ${hardware} · ${cpu} CPU · ${ram} RAM · ${tier}`;
      rates.push({
        id: createHash("sha256")
          .update(`verda|${plan}`)
          .digest("hex")
          .slice(0, 24),
        providerId: "verda",
        gpu,
        vramGb,
        gpuCount,
        vcpus,
        ramGb,
        commitment: "None",
        region: "Not specified",
        plan,
        billing,
        currency: quote[1] === "$" ? "USD" : "EUR",
        amount,
        unit: "gpu-hour",
        hourly: amount,
        priceType: "Exact",
        availability: "Not verified",
        evidence: line,
        notes: `${section}. ${cluster ? `Cluster prices and specs are per GPU; minimum deployable GPU quantity is not stated. Per GPU: ${cpu} CPUs and ${ram} RAM.` : `${cpu} CPUs and ${ram} host RAM.`} ${tier === "Spot" ? "Interruptible spot pricing. " : ""}${section === "Serverless containers" ? "Autoscaling, pay-per-use containers with scale-to-zero. " : ""}Published price does not verify available capacity.`,
        sourceUrl,
        observedAt,
        collectionMethod: "Table parser",
      });
    }
  }
  if (
    seen.size !== 3 ||
    !rates.length ||
    new Set(rates.map((rate) => rate.id)).size !== rates.length
  )
    throw new Error("Verda GPU pricing sections are missing or duplicated");
  return rates;
}
