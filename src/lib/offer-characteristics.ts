import type { Rate } from "./types";

export type HardwareVariant =
  "SXM" | "SXM4" | "SXM5" | "PCIe" | "NVL" | "Not specified";

export type OfferCharacteristics = {
  supply: "Community" | "Not specified";
  execution: "Container" | "Serverless" | "Not specified";
  interruptible: boolean | null;
  ephemeral: boolean | null;
  priority: "High" | "Medium" | "Low" | "Lowest" | "Not specified";
  caveats: string[];
  sources: { label: string; url: string }[];
};

const saladSources = [
  { label: "Salad products", url: "https://salad.com/products/" },
  { label: "Salad pricing", url: "https://salad.com/pricing/" },
  {
    label: "Salad Container Engine architecture",
    url: "https://docs.salad.com/container-engine/explanation/core-concepts/architectural-overview",
  },
];

function isSaladCommunity(rate: Rate) {
  return (
    rate.providerId === "salad" &&
    /(?:\b(?:high|medium|low|lowest)(?:\s+priority(?:\s+tier)?)?|\bcommunity)\s*$/i.test(
      rate.plan,
    )
  );
}

function saladPriority(rate: Rate): OfferCharacteristics["priority"] {
  const match = rate.plan.match(
    /\b(high|medium|low|lowest)(?:\s+priority(?:\s+tier)?)?\s*$/i,
  );
  if (!match) return "Not specified";
  return (match[1][0].toUpperCase() + match[1].slice(1).toLowerCase()) as
    "High" | "Medium" | "Low" | "Lowest";
}

export function offerCharacteristics(rate: Rate): OfferCharacteristics {
  const saladCommunity = isSaladCommunity(rate);
  const gpuAiCommunity =
    rate.providerId === "gpuai" &&
    /\bcommunity\b/i.test(`${rate.gpu} ${rate.plan} ${rate.notes}`);
  const community = saladCommunity || gpuAiCommunity;

  return {
    supply: community ? "Community" : "Not specified",
    execution: saladCommunity
      ? "Container"
      : rate.billing === "Serverless"
        ? "Serverless"
        : "Not specified",
    interruptible: saladCommunity || rate.billing === "Spot" ? true : null,
    ephemeral: saladCommunity ? true : null,
    priority: saladCommunity ? saladPriority(rate) : "Not specified",
    caveats: saladCommunity
      ? [
          "Distributed consumer GPUs; node interruption can end the workload, including at High priority.",
          "Local container storage is ephemeral and is erased on exit or node interruption; checkpoint data externally.",
        ]
      : [],
    sources: saladCommunity ? saladSources : [],
  };
}

function normalizedGpuName(gpu: string) {
  return gpu
    .trim()
    .replace(/^(?:NVIDIA|AMD)\s+/i, "")
    .replace(/\s+/g, " ")
    .replace(/\bSXM\s*([45])\b/gi, "SXM$1")
    .toUpperCase();
}

export function hardwareVariant(rate: Rate): HardwareVariant {
  const gpu = normalizedGpuName(rate.gpu);
  if (/\bSXM\s*5\b/i.test(gpu)) return "SXM5";
  if (/\bSXM\s*4\b/i.test(gpu)) return "SXM4";
  if (/\bSXM\b/i.test(gpu)) return "SXM";
  if (/\bPCI(?:E| EXPRESS)\b/i.test(gpu)) return "PCIe";
  if (/\bNVL\b/i.test(gpu)) return "NVL";
  return "Not specified";
}

export function hardwareLabel(rate: Rate) {
  const memory =
    rate.vramGb === null ? "VRAM unspecified" : `${rate.vramGb} GB VRAM`;
  const variant = hardwareVariant(rate);
  const requiresVariant = /\b(?:A100|H100|H200|V100)\b/i.test(rate.gpu);
  return `${rate.gpu} · ${memory}${requiresVariant && variant === "Not specified" ? " · variant unspecified" : ""}`;
}

export function hardwareKey(rate: Rate) {
  const variant = hardwareVariant(rate);
  return [
    normalizedGpuName(rate.gpu),
    rate.vramGb === null ? "VRAM unspecified" : `${rate.vramGb} GB VRAM`,
    variant,
  ].join(" | ");
}

export function comparisonKey(rate: Rate) {
  const characteristics = offerCharacteristics(rate);
  return JSON.stringify([
    hardwareKey(rate),
    rate.vramGb === null ||
    rate.gpuCount === null ||
    (/\b(?:A100|H100|H200|V100)\b/i.test(rate.gpu) &&
      hardwareVariant(rate) === "Not specified")
      ? rate.id
      : null,
    rate.billing,
    rate.gpuCount,
    rate.commitment ?? "Not specified",
    rate.plan,
    rate.vcpus ?? null,
    rate.ramGb ?? null,
    rate.priceType,
    rate.region,
    characteristics.supply,
    characteristics.execution,
    characteristics.interruptible,
    characteristics.ephemeral,
    characteristics.priority,
  ]);
}

export function comparableOffers(a: Rate, b: Rate) {
  if (a.id === b.id) return true;
  if (hardwareKey(a) !== hardwareKey(b)) return false;
  if (
    a.gpuCount === null ||
    b.gpuCount === null ||
    a.gpuCount !== b.gpuCount ||
    a.billing !== b.billing ||
    a.priceType !== b.priceType ||
    a.region !== b.region
  )
    return false;

  const variantSensitive = /\b(?:A100|H100|H200|V100)\b/i.test(
    `${a.gpu} ${b.gpu}`,
  );
  const aVariant = hardwareVariant(a);
  const bVariant = hardwareVariant(b);
  const unknownHardware =
    a.vramGb === null ||
    b.vramGb === null ||
    (variantSensitive &&
      (aVariant === "Not specified" || bVariant === "Not specified"));
  if (unknownHardware) return false;
  if ((a.commitment ?? "") !== (b.commitment ?? "")) return false;
  if (variantSensitive && aVariant !== bVariant) return false;

  const aTraits = offerCharacteristics(a);
  const bTraits = offerCharacteristics(b);
  if (
    aTraits.supply !== bTraits.supply ||
    aTraits.execution !== bTraits.execution ||
    aTraits.interruptible !== bTraits.interruptible ||
    aTraits.ephemeral !== bTraits.ephemeral ||
    aTraits.priority !== bTraits.priority
  )
    return false;
  return true;
}
