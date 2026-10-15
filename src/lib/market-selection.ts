import { providers } from "./catalog";
import { hardwareVariant, offerCharacteristics } from "./offer-characteristics";
import { isFresh, type Rate } from "./types";
import type { Filters } from "./market-filters";

const providerMap = new Map(providers.map((p) => [p.id, p]));

export function providerHistoryOffers(rates: Rate[], activeId = ""): Rate[] {
  const chosen = new Map<string, Rate>();
  for (const rate of rates) {
    if (rate.availability === "Unavailable" && rate.id !== activeId) continue;
    const previous = chosen.get(rate.providerId);
    if (
      !previous ||
      rate.id === activeId ||
      (previous.id !== activeId &&
        (rate.hourly < previous.hourly ||
          (rate.hourly === previous.hourly && rate.id < previous.id)))
    )
      chosen.set(rate.providerId, rate);
  }
  return [...chosen.values()].sort(
    (a, b) => a.hourly - b.hourly || a.id.localeCompare(b.id),
  );
}

export function matchesMarketRequirements(
  r: Rate,
  filters: Filters,
  now: number,
) {
  const p = providerMap.get(r.providerId)!;
  const traits = offerCharacteristics(r);
  const text =
    `${r.gpu} ${p.name} ${r.region} ${r.plan} ${r.notes}`.toLowerCase();
  return (
    filters.query
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .every((t) => text.includes(t)) &&
    (!filters.totalBudget ||
      (r.gpuCount !== null &&
        r.hourly * r.gpuCount <= Number(filters.totalBudget))) &&
    (filters.provider === "all" || r.providerId === filters.provider) &&
    (filters.kind === "all" || p.kind === filters.kind) &&
    (filters.variant === "all" || hardwareVariant(r) === filters.variant) &&
    (filters.exactMemory === "all" ||
      (filters.exactMemory === "unknown"
        ? r.vramGb === null
        : r.vramGb === Number(filters.exactMemory))) &&
    (filters.community === "all" ||
      (filters.community === "only"
        ? traits.supply === "Community"
        : traits.supply !== "Community")) &&
    (filters.interruption === "all" ||
      (filters.interruption === "only"
        ? traits.interruptible === true
        : filters.interruption === "unknown"
          ? traits.interruptible === null
          : traits.interruptible !== true)) &&
    (filters.storage === "all" || traits.ephemeral !== true) &&
    (filters.execution === "all" || traits.execution === filters.execution) &&
    (filters.priority === "all" || traits.priority === filters.priority) &&
    (filters.billing === "all" || r.billing === filters.billing) &&
    (filters.method === "all" ||
      (r.collectionMethod ?? "Source extraction") === filters.method) &&
    (filters.region === "all" || r.region === filters.region) &&
    (Number(filters.memory) === 0 ||
      (r.vramGb !== null && r.vramGb >= Number(filters.memory))) &&
    (!filters.budget || r.hourly <= Number(filters.budget)) &&
    r.currency === filters.currency &&
    (!filters.exact || r.priceType === "Exact") &&
    (!filters.fresh || isFresh(r.observedAt, p.intervalMinutes, now)) &&
    (!filters.available || r.availability === "Available") &&
    (filters.count === "all" || r.gpuCount === Number(filters.count))
  );
}
