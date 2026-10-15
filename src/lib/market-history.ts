import { cacheLife } from "next/cache";
import { database } from "./db";
import { cachedSnapshot } from "./snapshot";
import type { MarketHistory, Snapshot } from "./types";
import { readFilters } from "./market-filters";
import {
  matchesMarketRequirements,
  providerHistoryOffers,
} from "./market-selection";
import { gpuFamily } from "./gpu-family";
import { compareRates } from "./table-sorting";

export const historyWindows = {
  "24h": 24,
  "7d": 168,
  "30d": 720,
  "90d": 2160,
  "1y": 8760,
} as const;

export async function cachedMarketHistory(
  ids: string[],
  range: string,
  start: string,
  end: string,
): Promise<MarketHistory | null> {
  "use cache";
  cacheLife({ stale: 300, revalidate: 60, expire: 86400 });
  const now = Date.now();
  const since =
    range === "custom"
      ? new Date(start).toISOString()
      : range === "all"
        ? "1970-01-01T00:00:00.000Z"
        : new Date(
            now -
              (historyWindows[range as keyof typeof historyWindows] ?? 168) *
                3600000,
          ).toISOString();
  const until = new Date(
    range === "custom" ? Math.min(now, Date.parse(end) + 86400000) : now,
  ).toISOString();
  const snapshot = await cachedSnapshot();
  const current = snapshot.providers.flatMap((p) => p.rates);
  const offers = ids.map((id) => current.find((r) => r.id === id));
  if (offers.some((offer) => !offer)) return null;
  const rows = await database().query(
    `WITH points AS (
        SELECT r->>'id' AS id, o.observed_at AS at, r->>'hourly' AS hourly,
          r->>'currency' AS currency,
          row_number() OVER (PARTITION BY r->>'id' ORDER BY o.observed_at DESC) AS position
        FROM observations o CROSS JOIN LATERAL jsonb_array_elements(o.rates) r
        WHERE o.provider_id = ANY($1::text[]) AND o.observed_at >= $2::timestamptz
          AND o.observed_at < $4::timestamptz AND r->>'id' = ANY($3::text[])
      ) SELECT id, at, hourly, currency FROM points WHERE position <= 2001 ORDER BY at`,
    [[...new Set(offers.map((offer) => offer!.providerId))], since, ids, until],
    { fetchOptions: { signal: AbortSignal.timeout(15000) } },
  );
  return {
    window: { start: since, end: until },
    series: offers.map((offer) => ({
      id: offer!.id,
      truncated: rows.filter((row) => row.id === offer!.id).length > 2000,
      points: rows
        .filter(
          (row) =>
            row.id === offer!.id &&
            row.currency === offer!.currency &&
            Number.isFinite(Number(row.hourly)) &&
            Number(row.hourly) > 0,
        )
        .slice(-2000)
        .map((row) => ({
          at: row.at,
          hourly: Number(row.hourly),
          currency: row.currency,
        })),
    })),
    loadedAt: new Date().toISOString(),
  };
}

export async function initialMarketHistory(
  snapshot: Snapshot,
  query = "",
): Promise<MarketHistory | undefined> {
  const filters = readFilters(new URLSearchParams(query));
  const rates = snapshot.providers
    .flatMap((p) => p.rates)
    .filter(
      (r) =>
        matchesMarketRequirements(r, filters, Date.parse(snapshot.loadedAt)) &&
        (filters.gpu === "all" || r.gpu === filters.gpu) &&
        (filters.family === "all" || gpuFamily(r.gpu) === filters.family),
    )
    .sort((a, b) => compareRates(a, b, { key: "price", direction: "asc" }));
  const offers = providerHistoryOffers(rates);
  if (!offers.length) return undefined;
  try {
    return (
      (await cachedMarketHistory(
        offers.map((r) => r.id).sort(),
        "7d",
        "",
        "",
      )) ?? undefined
    );
  } catch {
    return undefined;
  }
}
