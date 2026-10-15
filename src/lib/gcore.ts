import { createHash } from "node:crypto";
import type { Rate } from "./types";

function columns(row: string) {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((s) => s.trim());
}
function numeric(value: string): number | null {
  const normalized = value.replace(/,/g, "").trim();
  return /^\d+(?:\.\d+)?$/.test(normalized) ? Number(normalized) : null;
}
function section(markdown: string, title: string) {
  const start = markdown.indexOf(`## ${title}\n`);
  if (start < 0)
    throw new Error(`Source Gcore is missing the ${title} section`);
  const after = markdown.slice(start + title.length + 4);
  return after.split(/\n## |\nPrices do not include VAT/)[0];
}
function tableRows(content: string) {
  return [...content.matchAll(/^\|[^\n]*(?:\n(?!\|)[^\n]*)*/gm)]
    .map((m) => m[0].trim())
    .filter((row) => !/^\|\s*-+\s*\|/.test(row));
}
function gpuSpec(value: string) {
  const match = /^([1-9]\d*)×([A-Z][A-Z0-9 ]+)$/i.exec(value);
  if (!match)
    throw new Error("Source Gcore has an ambiguous GPU configuration");
  return { count: Number(match[1]), gpu: match[2] };
}

export function parseGcore(
  markdown: string,
  observedAt: string,
  sourceUrl: string,
): Rate[] {
  if (!Number.isFinite(Date.parse(observedAt)))
    throw new Error("Source Gcore observation time is invalid");
  const rates: Rate[] = [];
  function add(input: {
    kind: string;
    gpu: string;
    count: number;
    vram: number | null;
    ram: number | null;
    cpus: number | null;
    amount: number;
    billing: Rate["billing"];
    evidence: string;
    notes: string;
  }) {
    const plan = `${input.kind} · ${input.count}×${input.gpu}`;
    const identity = [
      "gcore",
      plan,
      input.ram,
      input.cpus,
      "EUR",
      "instance-hour",
      input.billing,
    ];
    rates.push({
      id: createHash("sha256")
        .update(JSON.stringify(identity))
        .digest("hex")
        .slice(0, 24),
      providerId: "gcore",
      gpu: input.gpu,
      vramGb: input.vram,
      gpuCount: input.count,
      vcpus: input.cpus,
      ramGb: input.ram,
      commitment: "Unknown",
      region: "Not specified",
      plan,
      billing: input.billing,
      currency: "EUR",
      amount: input.amount,
      unit: "instance-hour",
      hourly: Math.round((input.amount / input.count) * 1e8) / 1e8,
      priceType: "Exact",
      availability: "Not verified",
      evidence: input.evidence,
      notes: `${input.notes} VAT excluded. Published price does not verify capacity.`,
      sourceUrl,
      observedAt,
      collectionMethod: "Table parser",
    });
  }

  const cloudRows = tableRows(
    section(markdown, "GPU Cloud prices and configuration"),
  );
  const cloud = new Map(
    cloudRows.map((raw) => [columns(raw)[0], { values: columns(raw), raw }]),
  );
  const header = cloud.get("");
  const price = cloud.get("Price"),
    specs = cloud.get("GPU"),
    vram = cloud.get("VRAM, _GB_"),
    ram = cloud.get("RAM, _GB_"),
    cpu = cloud.get("vCPUs");
  if (
    !header ||
    !price ||
    !specs ||
    !vram ||
    !ram ||
    !cpu ||
    [price, specs, vram, ram, cpu].some(
      (r) => r.values.length !== header.values.length,
    )
  ) {
    throw new Error("Source Gcore GPU Cloud column alignment is invalid");
  }
  for (let i = 1; i < header.values.length; i++) {
    if (/^\[Contact sales\]/.test(price.values[i])) continue;
    const quoted = /^€(\d+(?:\.\d+)?)_\/hr_\s+€\d+(?:\.\d+)? per GPU$/.exec(
      price.values[i],
    );
    if (!quoted)
      throw new Error("Source Gcore GPU Cloud price unit is ambiguous");
    const spec = gpuSpec(specs.values[i]);
    const label = header.values[i].replace(/^NEW\s+/, "").split(/\s/)[0];
    if (label !== spec.gpu.split(" ")[0])
      throw new Error("Source Gcore GPU Cloud model columns do not align");
    const totalVram = numeric(vram.values[i]),
      totalRam = numeric(ram.values[i]),
      cpus = numeric(cpu.values[i]);
    if (!totalVram || !totalRam || !cpus)
      throw new Error("Source Gcore GPU Cloud resource values are invalid");
    add({
      kind: "GPU Cloud",
      ...spec,
      vram: totalVram / spec.count,
      ram: totalRam,
      cpus,
      amount: Number(quoted[1]),
      billing: "Unspecified",
      evidence: [
        header.raw,
        price.raw,
        specs.raw,
        vram.raw,
        ram.raw,
        cpu.raw,
      ].join("\n\n"),
      notes:
        "Whole-server hourly total divided by required GPU count; the page's separately rounded per-GPU figure is not used. VRAM is total server GPU memory divided by count. The selected pricing model and commitment are not exposed in the source.",
    });
  }

  for (const kind of ["Everywhere Inference", "Virtual GPU"] as const) {
    const rawRows = tableRows(section(markdown, kind));
    const headerRaw = rawRows[0];
    const header = columns(headerRaw ?? "");
    const required = [
      "GPU Configuration",
      "GPU Memory",
      "CPU/RAM",
      "Cost per hour",
    ];
    if (
      required.some((label) => header.filter((h) => h === label).length !== 1)
    )
      throw new Error(`Source Gcore ${kind} pricing header changed`);
    const entries = rawRows.slice(1).map((raw) => {
      const row = columns(raw);
      if (row.length !== header.length)
        throw new Error(`Source Gcore ${kind} row alignment is invalid`);
      const spec = gpuSpec(row[header.indexOf("GPU Configuration")]);
      const memory = /^(\d[\d,]*)\s+GB$/.exec(
        row[header.indexOf("GPU Memory")],
      );
      const host = /^(\d+)\s+vCPU\s*\/\s*(\d[\d,]*)\s+(GiB|GB) RAM$/.exec(
        row[header.indexOf("CPU/RAM")],
      );
      const price = /^€(\d+(?:\.\d+)?)$/.exec(
        row[header.indexOf("Cost per hour")],
      );
      if (!memory || !host || !price)
        throw new Error(
          `Source Gcore ${kind} units or resource values are invalid`,
        );
      return {
        ...spec,
        raw,
        vram: Number(memory[1].replaceAll(",", "")) / spec.count,
        ram: Number(host[2].replaceAll(",", "")),
        cpus: Number(host[1]),
        amount: Number(price[1]),
        hostUnit: host[3],
      };
    });
    for (const entry of entries) {
      const conflict = entries.some(
        (other) => other.gpu === entry.gpu && other.vram !== entry.vram,
      );
      add({
        ...entry,
        kind,
        vram: conflict ? null : entry.vram,
        billing: kind === "Everywhere Inference" ? "Serverless" : "On-demand",
        evidence: `Header:\n${headerRaw}\n\nRow:\n${entry.raw}`,
        notes: `Hourly cost covers the entire ${entry.count}-GPU configuration; GPU memory is aggregate across its cards. Host RAM is published in ${entry.hostUnit}. ${kind === "Everywhere Inference" ? "Inference compute time is billed to the minute." : "Compute is billed while powered on; shelving retains IPs and volumes, which may incur separate charges."}${conflict ? " The source lists conflicting per-card memory across configurations of this GPU, so VRAM is withheld." : ""}`,
      });
    }
  }
  if (!rates.length || new Set(rates.map((r) => r.id)).size !== rates.length)
    throw new Error(
      "Source Gcore rates are empty or have duplicate configurations",
    );
  return rates;
}
