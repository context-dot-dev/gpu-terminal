import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { unstable_cache } from "next/cache";
import { publishableRates } from "./quality";
import { providers } from "./catalog";
import type { ProviderState, Rate, Snapshot } from "./types";

export function database() {
  if (!process.env.DATABASE_URL) throw new Error("Database is not configured");
  return neon(process.env.DATABASE_URL);
}

export function databaseCacheKey() {
  const url = new URL(process.env.DATABASE_URL!);
  const identity = `${url.hostname}${url.pathname}:${url.username}`;
  return `gpu-market:${createHash("sha256").update(identity).digest("hex").slice(0, 16)}`;
}

let lastGoodSnapshot: Snapshot | undefined;

export function unavailableSnapshot(): Snapshot {
  return {
    ...(lastGoodSnapshot ?? {
      loadedAt: new Date().toISOString(),
      providers: providers.map((provider) =>
        provider.trackingScope === "inference-api"
          ? {
              id: provider.id,
              checkedAt: null,
              observedAt: null,
              status: "not-applicable" as const,
              message:
                provider.trackingNote ??
                "Inference API; GPU-hour pricing is not tracked.",
              rates: [],
            }
          : {
              id: provider.id,
              checkedAt: null,
              observedAt: null,
              status: "pending" as const,
              message: "First check pending",
              rates: [],
            },
      ),
    }),
    error: "Pricing data is temporarily unavailable. Please try again shortly.",
  };
}

async function cachedProviderBatch(ids: string[], databaseKey: string) {
  return unstable_cache(
    async () => {
      const rows = await database().query(
        "SELECT provider_id, checked_at, observed_at, status, message, rates FROM provider_state WHERE provider_id = ANY($1::text[])",
        [ids],
        { fetchOptions: { signal: AbortSignal.timeout(20000) } },
      );
      return { rows, loadedAt: new Date().toISOString() };
    },
    ["provider-batch", databaseKey, ...ids],
    { revalidate: 900 },
  )();
}

export async function getSnapshot(): Promise<Snapshot> {
  try {
    const collectibleProviders = providers.filter(
      (provider) => provider.trackingScope === "gpu-hourly",
    );
    const groups = Array.from(
      { length: Math.ceil(collectibleProviders.length / 25) },
      (_, i) =>
        collectibleProviders.slice(i * 25, i * 25 + 25).map((p) => p.id),
    );
    const databaseKey = databaseCacheKey();
    const batches = await Promise.all(
      groups.map((ids) => cachedProviderBatch(ids, databaseKey)),
    );
    const rows = new Map(
      batches
        .flatMap((batch) => batch.rows)
        .map((row) => [row.provider_id, row]),
    );
    const snapshot: Snapshot = {
      loadedAt: batches.map((batch) => batch.loadedAt).sort()[0],
      providers: providers.map((p) => {
        if (p.trackingScope === "inference-api")
          return {
            id: p.id,
            checkedAt: null,
            observedAt: null,
            status: "not-applicable",
            message:
              p.trackingNote ??
              "Inference API; GPU-hour pricing is not tracked.",
            rates: [],
          } satisfies ProviderState;
        const row = rows.get(p.id);
        if (!row)
          return {
            id: p.id,
            checkedAt: null,
            observedAt: null,
            status: "pending",
            message: "First check pending",
            rates: [],
          };
        const rates = publishableRates(row.rates as Rate[]);
        const excluded = (row.rates as Rate[]).length - rates.length;
        return {
          id: p.id,
          checkedAt: row.checked_at as string | null,
          observedAt: row.observed_at as string | null,
          status:
            row.status === "ok" && !rates.length
              ? "no-rates"
              : (row.status as ProviderState["status"]),
          message: excluded
            ? `${rates.length} published rates; ${excluded} withheld for ambiguous or non-comparable source data`
            : (row.message as string),
          rates,
        };
      }),
    };
    lastGoodSnapshot = snapshot;
    return snapshot;
  } catch {
    return unavailableSnapshot();
  }
}
