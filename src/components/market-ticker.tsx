"use client";

import { useEffect, useMemo, useState } from "react";
import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { gpuFamily } from "@/lib/gpu-family";
import { hardwareLabel } from "@/lib/offer-characteristics";
import { providers } from "@/lib/catalog";
import {
  isFresh,
  type HistoryPoint,
  type Rate,
  type Snapshot,
} from "@/lib/types";

const families = [
  "H100",
  "H200",
  "B200",
  "A100",
  "RTX 5090",
  "RTX 4090",
  "L40S",
  "RTX A6000",
];
const providerMap = new Map(
  providers.map((provider) => [provider.id, provider]),
);
const familyOf = gpuFamily;
const money = (value: number, currency: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: value < 0.01 ? 8 : value < 0.1 ? 4 : 2,
  }).format(value);
const elapsed = (milliseconds: number) => {
  const minutes = Math.floor(milliseconds / 60000);
  return minutes < 1
    ? "<1m"
    : minutes < 60
      ? `${minutes}m`
      : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

export function MarketTicker({
  snapshot,
  rates,
  family,
  onFamilyChange,
  currency = "USD",
}: {
  snapshot: Snapshot;
  rates: Rate[];
  family: string;
  onFamilyChange: (family: string) => void;
  currency?: string;
}) {
  const [paused, setPaused] = useState(false);
  const entries = useMemo(
    () =>
      families.map((model) => {
        const matches = rates
          .filter((rate) => {
            const provider = providerMap.get(rate.providerId);
            return (
              provider &&
              familyOf(rate.gpu) === model &&
              rate.currency === currency &&
              Number.isFinite(rate.hourly) &&
              rate.hourly > 0 &&
              rate.availability !== "Unavailable" &&
              (rate.billing === "On-demand" ||
                rate.billing === "Unspecified") &&
              isFresh(
                rate.observedAt,
                provider.intervalMinutes,
                Date.parse(snapshot.loadedAt),
              )
            );
          })
          .sort((a, b) => a.hourly - b.hourly || a.id.localeCompare(b.id));
        return {
          model,
          best: matches[0],
          count: new Set(matches.map((rate) => rate.providerId)).size,
        };
      }),
    [rates, currency, snapshot.loadedAt],
  );
  const ids = entries
    .flatMap((entry) => (entry.best ? [entry.best.id] : []))
    .join(",");
  const requestKey = ids;
  const [history, setHistory] = useState<{
    key: string;
    points: Record<string, HistoryPoint[]>;
  }>({ key: "", points: {} });

  useEffect(() => {
    if (!ids) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
      setHistory({ key: requestKey, points: {} });
    }, 20000);
    const selected = ids.split(",");
    const batches = [selected.slice(0, 4), selected.slice(4)].filter(
      (batch) => batch.length,
    );
    Promise.allSettled(
      batches.map(async (batch) => {
        const providerIds = [
          ...new Set(
            entries
              .filter((entry) => entry.best && batch.includes(entry.best.id))
              .map((entry) => entry.best!.providerId),
          ),
        ];
        const query = new URLSearchParams({
          ids: batch.join(","),
          providers: providerIds.join(","),
          range: "24h",
        });
        const response = await fetch(
          `/api/market-history?${query}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("History unavailable");
        const data = (await response.json()) as {
          series?: { id: string; points: HistoryPoint[] }[];
        };
        if (!Array.isArray(data.series)) throw new Error("Invalid history");
        return data.series.filter(
          (series) => batch.includes(series.id) && Array.isArray(series.points),
        );
      }),
    )
      .then((results) => {
        if (controller.signal.aborted) return;
        const points: Record<string, HistoryPoint[]> = {};
        for (const result of results) {
          if (result.status === "fulfilled") {
            for (const series of result.value)
              points[series.id] = series.points;
          }
        }
        setHistory({ key: requestKey, points });
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [ids, requestKey, snapshot.loadedAt, entries]);

  return (
    <nav
      aria-label="GPU market ticker"
      data-testid="market-ticker"
      className="market-ticker flex min-w-0 bg-card"
      data-paused={paused}
    >
      <div className="market-ticker-viewport min-w-0 flex-1">
        <div className="market-ticker-track">
          {[false, true].map((duplicate) => (
            <div
              key={String(duplicate)}
              className="market-ticker-group"
              aria-hidden={duplicate || undefined}
            >
              {entries.map(({ model, best, count }) => {
                const points =
                  best && history.key === requestKey
                    ? (history.points[best.id] ?? [])
                        .filter(
                          (point) =>
                            point.currency === currency &&
                            Number.isFinite(point.hourly) &&
                            point.hourly > 0 &&
                            Number.isFinite(Date.parse(point.at)) &&
                            Date.parse(point.at) <= Date.parse(best.observedAt),
                        )
                        .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
                    : [];
                const first = points[0],
                  last = points.at(-1);
                const comparable = !!(
                  best &&
                  first &&
                  last &&
                  points.length > 1 &&
                  Date.parse(last.at) > Date.parse(first.at) &&
                  last.hourly === best.hourly
                );
                const change = comparable
                  ? (last!.hourly / first!.hourly - 1) * 100
                  : null;
                const duration = comparable
                  ? elapsed(Date.parse(last!.at) - Date.parse(first!.at))
                  : "";
                const direction =
                  change === null || change === 0
                    ? "neutral"
                    : change < 0
                      ? "down"
                      : "up";
                const color =
                  direction === "down"
                    ? "var(--success)"
                    : direction === "up"
                      ? "var(--destructive)"
                      : "var(--muted-foreground)";
                const changeLabel =
                  change === null
                    ? "—"
                    : `${change > 0 ? "+" : change < 0 ? "−" : ""}${Math.abs(change).toFixed(2)}%`;
                const price = best
                  ? `${best.priceType === "Starting at" ? "from " : ""}${money(best.hourly, currency)}`
                  : "—";
                const detail = best
                  ? `${providerMap.get(best.providerId)?.name ?? best.providerId}: ${hardwareLabel(best)}, ${best.billing}, ${best.gpuCount ?? "unspecified"} GPUs per configuration. ${comparable ? `${changeLabel} over ${duration} of recorded observations for this exact offer, within the last 24h.` : "Not enough matching observations to calculate a change."}`
                  : "No fresh matching offer.";
                return (
                  <Button
                    key={model}
                    variant="ghost"
                    size="sm"
                    className="ticker-quote h-9 min-w-56 flex-1 shrink-0 justify-center gap-3 px-5"
                    tabIndex={duplicate ? -1 : undefined}
                    onClick={() => onFamilyChange(model)}
                    aria-label={`Explore ${model}`}
                    aria-description={`${price} ${currency} per GPU-hour; ${count} providers. ${detail}`}
                    aria-current={family === model ? "true" : undefined}
                    title={`${count} providers · Family floor across hardware variants, not an equivalent-GPU index · ${currency}/GPU-hour. ${detail}`}
                    data-family={model}
                    data-direction={direction}
                  >
                    <span aria-hidden="true" className="ticker-marker" />
                    <span className="text-sm text-muted-foreground">
                      {model}
                    </span>
                    <span className="text-sm tabular-nums">{price}</span>
                    <span className="text-xs tabular-nums" style={{ color }}>
                      {changeLabel}
                    </span>
                  </Button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="market-ticker-toggle shrink-0"
        aria-label={paused ? "Resume GPU ticker" : "Pause GPU ticker"}
        title={paused ? "Resume ticker" : "Pause ticker"}
        onClick={() => setPaused((value) => !value)}
      >
        {paused ? <Play /> : <Pause />}
      </Button>
    </nav>
  );
}
