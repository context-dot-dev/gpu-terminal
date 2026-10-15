import { neon } from "@neondatabase/serverless";
import { publishableRates } from "./quality";
import { providers } from "./catalog";
import type { ProviderState, Rate, Snapshot } from "./types";

export function database() {
  if (!process.env.DATABASE_URL) throw new Error("Database is not configured");
  return neon(process.env.DATABASE_URL);
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

export async function getSnapshot(): Promise<Snapshot> {
  try {
    const sql = database();
    const signal = AbortSignal.timeout(20000);
    const collectibleProviders = providers.filter(
      (provider) => provider.trackingScope === "gpu-hourly",
    );
    const groups = Array.from(
      { length: Math.ceil(collectibleProviders.length / 25) },
      (_, i) =>
        collectibleProviders.slice(i * 25, i * 25 + 25).map((p) => p.id),
    );
    const batches = await Promise.all(
      groups.map((ids) =>
        sql.query(
          "SELECT provider_id, checked_at, observed_at, status, message, rates FROM provider_state WHERE provider_id = ANY($1::text[])",
          [ids],
          { fetchOptions: { signal } },
        ),
      ),
    );
    const rows = new Map(batches.flat().map((row) => [row.provider_id, row]));
    const snapshot: Snapshot = {
      loadedAt: new Date().toISOString(),
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
