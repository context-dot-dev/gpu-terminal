import { cacheLife, cacheTag } from "next/cache";
import { database, getSnapshot } from "./db";
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

async function cachedOfferHistory(id: string, start: string, end: string) {
  "use cache: remote";
  cacheTag("gpu-market");
  cacheLife({ stale: 300, revalidate: 1800, expire: 86400 });
  const snapshot = await getSnapshot();
  const provider = snapshot?.providers.find((p) => p.rates.some((r) => r.id === id));
  const until = end
    ? new Date(Math.min(Date.now(), Date.parse(end) + 86400000)).toISOString()
    : new Date().toISOString();
  const rows = await database().query(
    `SELECT o.provider_id, o.observed_at AS at, r->>'hourly' AS hourly,
      r->>'currency' AS currency
     FROM observations o CROSS JOIN LATERAL jsonb_array_elements(o.rates) r
     WHERE ($1::text IS NULL OR o.provider_id = $1)
       AND o.observed_at >= $2::timestamptz AND o.observed_at <= $3::timestamptz
       AND r->>'id' = $4
     ORDER BY o.observed_at DESC LIMIT 2001`,
    [provider?.id ?? null, start || "1970-01-01", until, id],
    { fetchOptions: { signal: AbortSignal.timeout(15000) } },
  );
  return {
    loadedAt: new Date().toISOString(),
    points: rows.reverse().filter((row) => Number.isFinite(Number(row.hourly)) && Number(row.hourly) > 0)
      .map((row) => ({
        providerId: row.provider_id as string,
        at: row.at as string,
        hourly: Number(row.hourly),
        currency: row.currency as string,
      })),
  };
}

export async function cachedMarketHistory(
  ids: string[],
  providerIds: string[],
  range: string,
  start: string,
  end: string,
): Promise<MarketHistory> {
  "use cache";
  cacheTag("gpu-market");
  cacheLife({ stale: 300, revalidate: 1800, expire: 86400 });
  return getMarketHistory(ids, providerIds, range, start, end);
}

export async function getMarketHistory(
  ids: string[],
  providerIds: string[],
  range: string,
  start: string,
  end: string,
): Promise<MarketHistory> {
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
  const histories: Awaited<ReturnType<typeof cachedOfferHistory>>[] = [];
  const pointLimit = Math.min(2000, Math.floor(30000 / Math.max(1, ids.length)));
  for (let i = 0; i < ids.length; i += 8) {
    histories.push(...await Promise.all(ids.slice(i, i + 8).map((id) =>
      cachedOfferHistory(id, range === "custom" ? start : "", range === "custom" ? end : ""),
    )));
  }
  return {
    window: { start: since, end: until },
    series: ids.map((id, index) => {
      const points = histories[index].points.filter((point) =>
        providerIds.includes(point.providerId) &&
        Date.parse(point.at) >= Date.parse(since) && Date.parse(point.at) <= Date.parse(until),
      );
      return {
        id,
        truncated: points.length > pointLimit,
        points: points.slice(-pointLimit).map(({ at, hourly, currency }) => ({ at, hourly, currency })),
      };
    }),
    loadedAt: histories.map((history) => history.loadedAt).sort()[0] ?? new Date().toISOString(),
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
    return await cachedMarketHistory(
      offers.map((r) => r.id).sort(),
      [...new Set(offers.map((r) => r.providerId))].sort(),
      "7d",
      "",
      "",
    );
  } catch {
    return undefined;
  }
}
