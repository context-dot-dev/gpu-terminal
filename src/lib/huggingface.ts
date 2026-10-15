import { createHash } from "node:crypto";
import type { Rate } from "./types";

export function parseHuggingFace(
  markdown: string,
  observedAt: string,
  sourceUrl: string,
): Rate[] {
  const rates: Rate[] = [];
  let section: "Spaces" | "Inference Endpoints" | null = null;
  let endpointModel = "",
    cloud = "",
    inEndpoints = false;
  const spacesHeader =
    "| Name | CPU | Memory | Accelerator | VRAM | Hourly price |";
  const endpointHeading = "GPU Instances";
  if (
    !markdown.includes(spacesHeader) ||
    !/Dedicated inference,.*\/hour/.test(markdown) ||
    !markdown.includes(endpointHeading)
  ) {
    throw new Error("Hugging Face pricing sections or units changed");
  }
  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    if (line === spacesHeader) {
      section = "Spaces";
      continue;
    }
    if (/^## Dedicated inference,/.test(line)) {
      section = null;
      inEndpoints = true;
      continue;
    }
    if (inEndpoints && line === endpointHeading) {
      section = "Inference Endpoints";
      continue;
    }
    if (!section || !line) continue;
    if (!line.startsWith("|")) {
      section = null;
      continue;
    }
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.every((cell) => /^[-: ]+$/.test(cell))) continue;
    let gpu: string,
      count: number,
      totalMemory: number,
      amount: number,
      plan: string,
      notes: string,
      evidence: string;
    if (section === "Spaces") {
      if (cells.length !== 6)
        throw new Error("Hugging Face Spaces table shape changed");
      const [name, cpu, ram, accelerator, memory, price] = cells;
      if (!/^Nvidia /i.test(accelerator) || !/^\$[\d.]+$/.test(price)) continue;
      const labelModel = name
        .replace(/^\d+x\s+/i, "")
        .replace(/\s+-.*$/, "")
        .trim();
      if (labelModel.toLowerCase() !== accelerator.toLowerCase()) continue;
      gpu = accelerator.replace(/^Nvidia /i, "NVIDIA ");
      count = Number(name.match(/^(\d+)x\s/i)?.[1] ?? 1);
      totalMemory = Number(memory.match(/^([\d.]+)\s*GB$/)?.[1]);
      amount = Number(price.slice(1));
      plan = `Spaces · ${name} · ${cpu} · ${ram} RAM`;
      notes = `Hugging Face Spaces application hosting. ${cpu}, ${ram} host RAM. Table VRAM is total across the instance; normalized per GPU. Single-model hardware names without an x multiplier denote one accelerator. Published rates do not verify capacity.`;
      evidence = `Spaces: On-demand GPU hardware.\n${spacesHeader}\n${line}`;
    } else {
      if (cells.length !== 4)
        throw new Error("Hugging Face Inference Endpoints table shape changed");
      const [name, quantity, memory, price] = cells;
      if (name) {
        const match = name.match(/^(NVIDIA .+?)\s+(aws|azure|gcp)$/i);
        if (!match)
          throw new Error("Hugging Face GPU model or cloud label changed");
        endpointModel = match[1];
        cloud = match[2];
      }
      if (!endpointModel)
        throw new Error("Hugging Face continuation row has no GPU model");
      gpu = endpointModel;
      count = Number(quantity);
      totalMemory = Number(memory.match(/^([\d.]+)\s*GB$/)?.[1]);
      amount = /^\$[\d.]+$/.test(price) ? Number(price.slice(1)) : NaN;
      plan = `Inference Endpoints · ${cloud} · ${count}x ${gpu}`;
      notes = `Dedicated managed inference on ${cloud.toUpperCase()}; provider does not specify region here. Source memory is total instance VRAM; normalized per GPU. Published rates do not verify capacity.`;
      evidence = `Inference Endpoints: Dedicated inference, starting at $0.033/hour.\nGPU Instances; model ${endpointModel} ${cloud}\n${line}`;
    }
    if (
      !Number.isInteger(count) ||
      count < 1 ||
      !Number.isFinite(totalMemory) ||
      totalMemory <= 0 ||
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      throw new Error("Hugging Face GPU price, count, or memory is invalid");
    }
    rates.push({
      id: createHash("sha256")
        .update(`huggingface|${plan}`)
        .digest("hex")
        .slice(0, 24),
      providerId: "huggingface",
      gpu,
      vramGb: totalMemory / count,
      gpuCount: count,
      region: "Not specified",
      plan,
      billing: "On-demand",
      currency: "USD",
      amount,
      unit: "instance-hour",
      hourly: amount / count,
      priceType: "Exact",
      availability: "Not verified",
      evidence,
      notes,
      sourceUrl,
      observedAt,
    });
  }
  if (
    !rates.length ||
    new Set(rates.map((rate) => rate.id)).size !== rates.length
  )
    throw new Error("Hugging Face pricing is empty or duplicated");
  return rates;
}
