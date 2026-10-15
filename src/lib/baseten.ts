import { createHash } from "node:crypto";
import type { Rate } from "./types";

export function parseBaseten(
  markdown: string,
  observedAt: string,
  sourceUrl: string,
  buttons: string[],
): Rate[] {
  const toggles = buttons.flatMap((html) => {
    const label = html.replace(/<[^>]*>/g, "").trim();
    if (label !== "Minute" && label !== "Hour") return [];
    const classes =
      html.match(/^<button\b[^>]*class="([^"]*)"/)?.[1].split(/\s+/) ?? [];
    const active = classes.includes("text-black");
    const inactive = classes.includes("text-gray-500");
    if (active === inactive)
      throw new Error("Baseten pricing unit selection is ambiguous");
    return [{ label, active }];
  });
  if (toggles.length !== 4)
    throw new Error("Baseten pricing unit controls changed");
  const sections = [
    {
      name: "Dedicated deployments",
      match: markdown.match(
        /Dedicated Deployments\n+Only pay for the compute you use,[\s\S]*?(?=\nCPU Instances)/,
      ),
      billing: "Serverless" as const,
    },
    {
      name: "Training",
      match: markdown.match(
        /\nTraining\n+On-demand compute,[\s\S]*?(?=\nTalk to Sales)/,
      ),
      billing: "On-demand" as const,
    },
  ];
  const rates: Rate[] = [];
  sections.forEach((section, index) => {
    const controls = toggles.slice(index * 2, index * 2 + 2);
    const selected = controls.filter((control) => control.active);
    if (
      new Set(controls.map((control) => control.label)).size !== 2 ||
      selected.length !== 1
    )
      throw new Error("Baseten pricing unit selection is ambiguous");
    const unit = selected[0].label === "Minute" ? "gpu-minute" : "gpu-hour";
    const content = section.match?.[0];
    if (
      !content ||
      !/Price per\n+Minute\n+Hour\n+GPU Instances\n+Price\n/.test(content)
    )
      throw new Error("Baseten GPU pricing section changed");
    const cards = [
      ...content.matchAll(
        /\n([A-Z][A-Za-z0-9 -]+)\n+(\d+(?:\.\d+)?) GiB (VRAM|VM)\n+\$(\d+(?:\.\d+)?)\n/g,
      ),
    ];
    if (!cards.length) throw new Error("Baseten GPU cards are missing");
    for (const card of cards) {
      const [, gpu, memory, memoryKind, price] = card;
      if (/\bMIG\b|fraction|shared/i.test(gpu)) continue;
      const amount = Number(price);
      if (!Number.isFinite(amount) || amount <= 0)
        throw new Error("Baseten GPU price is invalid");
      const plan = `${section.name} · ${gpu}`;
      rates.push({
        id: createHash("sha256")
          .update(`baseten|${plan}`)
          .digest("hex")
          .slice(0, 24),
        providerId: "baseten",
        gpu,
        vramGb: memoryKind === "VRAM" ? Number(memory) : null,
        gpuCount: 1,
        vcpus: null,
        ramGb: null,
        commitment: "None",
        region: "Not specified",
        plan,
        billing: section.billing,
        currency: "USD",
        amount,
        unit,
        hourly:
          Math.round(amount * (unit === "gpu-minute" ? 60 : 1) * 1e8) / 1e8,
        priceType: "Exact",
        availability: "Not verified",
        evidence: card[0].trim(),
        notes: `Published per ${selected[0].label.toLowerCase()}, verified from the active pricing toggle in the same source response. ${section.name}; full GPU instance. ${memoryKind === "VM" ? "Source labels memory as VM rather than VRAM; GPU memory is not inferred. " : ""}Published price does not verify available capacity.`,
        sourceUrl,
        observedAt,
        collectionMethod: "Table parser",
      });
    }
  });
  if (
    !rates.length ||
    new Set(rates.map((rate) => rate.id)).size !== rates.length
  )
    throw new Error("Baseten GPU pricing is empty or duplicated");
  return rates;
}
