import { offerCharacteristics } from "./offer-characteristics";
import type { Rate } from "./types";

const regionAliases: Record<string, string> = {
  "ams-1 (amsterdam)": "Amsterdam",
  "eu · frankfurt": "Frankfurt",
  "us east · virginia": "US East (Virginia)",
  "virginia · us-east-1": "US East (Virginia)",
};

export function normalizeRegion(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  const cleaned = trimmed.replace(/^[,:;]+|[,:;]+$/g, "").trim();
  if (
    !cleaned ||
    /^[\p{P}\p{S}\s]+$/u.test(trimmed) ||
    /^(?:null|undefined|none|unknown|n\/a|not available)$/i.test(cleaned) ||
    /^\D*\d+\s*区$/u.test(cleaned) ||
    /[/{}]|^https?:/i.test(cleaned)
  )
    return "Not specified";
  return regionAliases[cleaned.toLowerCase()] ?? cleaned;
}

export function publishableRates(rates: Rate[]): Rate[] {
  return rates
    .filter((r) => {
      if (["vshosting", "gpuli", "leadergpu", "zcloud"].includes(r.providerId)) return false;
      if (["hostkey", "tencentcloud", "petabyte", "io", "runpod"].includes(r.providerId) && r.collectionMethod !== "Table parser") return false;
      if (r.providerId === "cherryservers" && /\bA16\b/i.test(r.gpu)) return false;
      if (r.providerId === "hostiko" && r.collectionMethod !== "Table parser")
        return false;
      if (
        r.providerId === "computegpu" &&
        !/\b\d+ available from \$[\d.]+\/hr\b/.test(r.evidence)
      )
        return false;
      if (
        [
          "neevcloud",
          "openbayes",
          "edgevana",
          "novacloud",
          "cloudrift",
          "yottashakticloud",
        ].includes(r.providerId) &&
        r.collectionMethod !== "Table parser"
      )
        return false;
      if (r.providerId === "matpool" && /\bA16\b/i.test(r.gpu)) return false;
      if (
        r.providerId === "upcloud" &&
        /H100|B200/i.test(r.gpu) &&
        Date.parse(r.observedAt) < Date.parse("2026-10-20T00:00:00Z")
      )
        return false;
      if (r.providerId === "canopy" && r.collectionMethod !== "Table parser")
        return false;
      if (r.providerId === "nebius" && r.collectionMethod !== "Table parser")
        return false;
      if (r.providerId === "akash" && !/^(?:NVIDIA )?B[23]00$/i.test(r.gpu))
        return false;
      if (r.providerId === "sfcompute" || r.providerId === "tensordock")
        return false;
      if (
        ["gcore", "baseten", "replicate"].includes(r.providerId) &&
        r.collectionMethod !== "Table parser"
      )
        return false;
      if (
        /\bMIG\b|fractional|shared GPU/i.test(`${r.gpu} ${r.plan} ${r.notes}`)
      )
        return false;
      if (r.providerId === "google" && r.collectionMethod !== "Table parser")
        return false;
      if (
        r.providerId === "huggingface" &&
        r.collectionMethod !== "Table parser"
      )
        return false;
      if (r.providerId === "packet" && /dynamic/i.test(r.plan)) return false;
      if (
        r.providerId === "seeweb" &&
        /H100/i.test(r.gpu) &&
        r.gpuCount === null
      )
        return false;
      if (r.providerId === "io" && r.gpuCount === null) return false;
      if (
        r.providerId === "paperspace" &&
        ((/H100/i.test(r.gpu) && r.amount === 3.09) ||
          (/P6000/i.test(r.gpu) && r.vramGb !== 24))
      )
        return false;
      if (/shared GPU|fractional GPU|vgpu/i.test(`${r.plan} ${r.notes}`))
        return false;
      if (
        r.providerId === "thunder" &&
        r.unit === "gpu-second" &&
        rates.some(
          (other) =>
            other.providerId === r.providerId &&
            other.gpu === r.gpu &&
            other.unit === "gpu-hour" &&
            Math.abs(other.hourly - r.hourly) < 0.01,
        )
      )
        return false;
      return true;
    })
    .map((r) => ({
      ...r,
      gpu:
        r.providerId === "gpuai"
          ? r.gpu.replace(/\s*community\s*$/i, "").trim()
          : r.gpu,
      gpuCount:
        r.providerId === "verda" &&
        /Instant clusters/i.test(`${r.plan} ${r.notes}`)
          ? null
          : r.gpuCount,
      plan:
        r.providerId === "gpuai" && /community/i.test(`${r.gpu} ${r.plan}`)
          ? `Community · ${r.gpu.replace(/\s*community\s*$/i, "").trim()}`
          : r.providerId === "crusoe" &&
              /Self-Serve Deployments/i.test(r.notes) &&
              !/Self-Serve Deployments/i.test(r.plan)
            ? `Self-Serve Deployments · ${r.plan}`
            : r.providerId === "verda" &&
                /Instant clusters/i.test(r.notes) &&
                !/Instant clusters/i.test(r.plan)
              ? `Instant clusters · ${r.plan}`
              : r.plan,
      collectionMethod:
        r.collectionMethod ??
        (["aws", "azure"].includes(r.providerId)
          ? "Provider API"
          : "Source extraction"),
      vramGb:
        r.providerId === "databasemart" && /RTX 2060/i.test(r.gpu)
          ? null
          : r.vramGb,
      region: normalizeRegion(r.region),
      rawRegion: r.rawRegion ?? r.region,
      priceType: ["sesterce", "gpuai", "computegpu"].includes(r.providerId)
        ? "Starting at"
        : r.priceType,
      billing:
        r.providerId === "crusoe" && /Self-Serve Deployments/i.test(r.notes)
          ? "Serverless"
          : r.providerId === "salad" && offerCharacteristics(r).supply === "Community"
            ? "Spot"
            : /sandbox/i.test(`${r.plan} ${r.notes}`) &&
                r.providerId === "thunder"
              ? "Serverless"
              : r.billing,
      notes:
        r.providerId === "gpuai" &&
        /community/i.test(`${r.gpu} ${r.plan}`) &&
        !r.notes.includes("Community tier")
          ? `${r.notes} Community tier; lowest live on-demand rate across matching provider and region inventory, not a region-specific fixed quote.`
          : r.providerId === "hostinger" &&
              !r.notes.includes("rounded up to the next full hour")
            ? `${r.notes} Billing is rounded up to the next full hour; instances accrue charges while idle until deleted.`
            : r.providerId === "nebius" &&
                r.billing === "Spot" &&
                !/L40S/i.test(r.gpu) &&
                !r.notes.includes("Published spot floor")
              ? `${r.notes} Published spot floor, not a live console quote. Actual GPU-hour rates vary with capacity and can change every 15 minutes while running.`
              : r.providerId === "databasemart" &&
                  /RTX 2060/i.test(r.gpu) &&
                  !r.notes.includes("conflicting VRAM")
                ? `${r.notes} The source gives conflicting VRAM specifications; memory is not verified.`
                : r.providerId === "salad" && offerCharacteristics(r).supply === "Community" &&
                    !r.notes.includes("Salad nodes are interruptible")
                  ? `${r.notes} Salad nodes are interruptible; priority tiers affect interruption risk.`
                  : r.notes,
    }));
}
