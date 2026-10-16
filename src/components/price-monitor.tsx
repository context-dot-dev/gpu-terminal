"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, ArrowDownRight, ArrowUpRight, Clock3 } from "lucide-react";
import { Area, Tooltip } from "recharts";
import { ProviderLogo } from "@/components/provider-logo";
import { ProviderHistoryLines } from "@/components/provider-history-lines";
import { EvilLineChart } from "@/components/evilcharts/charts/recharts-line-chart";
import { ChartTooltipContent } from "@/components/evilcharts/ui/recharts-tooltip";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel, FieldGroup } from "@/components/ui/field";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { providers } from "@/lib/catalog";
import { providerHistoryOffers } from "@/lib/market-selection";
import {
  comparableOffers,
  comparisonKey,
  hardwareLabel,
  offerCharacteristics,
} from "@/lib/offer-characteristics";
import { OfferCaveats } from "@/components/offer-caveats";
import type { MarketHistory as History, Rate } from "@/lib/types";

const providerNames = new Map(providers.map((p) => [p.id, p.name]));
const providerIntervals = new Map(
  providers.map((p) => [p.id, p.intervalMinutes]),
);
const formatMoney = (value: number, currency: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: value < 0.1 ? 4 : 2,
  }).format(value);

const historyWindowDays: Record<string, number> = {
  "24h": 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "1y": 365,
};
const selectedControl =
  "[&_[aria-pressed=true]]:bg-foreground [&_[aria-pressed=true]]:text-background";
const pendingHistory = new Map<string, Promise<History>>();
const retryDelay = () => new Promise((resolve) => setTimeout(resolve, 750));
function loadHistory(query: string): Promise<History> {
  const pending = pendingHistory.get(query);
  if (pending) return pending;
  const request = (async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(`/api/market-history?${query}`, {
          signal: AbortSignal.timeout(40_000),
        });
        if (!response.ok) {
          if (attempt === 0 && response.status >= 500) {
            await retryDelay();
            continue;
          }
          throw new Error("Price history is temporarily unavailable.");
        }
        const data: History = await response.json();
        if (!Array.isArray(data.series))
          throw new Error("Price history returned an invalid response.");
        return data;
      } catch (error) {
        if (
          attempt === 0 &&
          (error instanceof TypeError ||
            (error instanceof DOMException && error.name === "TimeoutError"))
        ) {
          await retryDelay();
          continue;
        }
        throw error;
      }
    }
    throw new Error("Price history is temporarily unavailable.");
  })()
    .finally(() => pendingHistory.delete(query));
  pendingHistory.set(query, request);
  return request;
}

function resolveHistory(
  results: Record<string, { data?: History; error?: string }>,
  requestKey: string,
  ids: string,
  range: string,
) {
  if (results[requestKey]?.data) return results[requestKey];
  const days = historyWindowDays[range];
  if (!days || !ids) return results[requestKey];
  const requested = ids.split(",");
  for (const { data } of Object.values(results)) {
    if (!data?.window) continue;
    const end = Date.parse(data.window.end);
    const start = end - days * 86400000;
    const sourceStart = Date.parse(data.window.start);
    if (
      !Number.isFinite(end) ||
      !Number.isFinite(sourceStart) ||
      sourceStart > start
    )
      continue;
    const series = requested.map((id) => data.series.find((s) => s.id === id));
    if (series.some((s) => !s || s.truncated)) continue;
    return {
      error: results[requestKey]?.error,
      data: {
        ...data,
        window: {
          start: new Date(start).toISOString(),
          end: data.window.end,
        },
        series: series.map((s) => ({
          ...s!,
          points: s!.points.filter(
            (p) => Date.parse(p.at) >= start && Date.parse(p.at) < end,
          ),
        })),
      },
    };
  }
  return results[requestKey];
}

export function PriceMonitor({
  rates,
  loadedAt,
  gpu,
  currency,
  activeId,
  onFocus,
  comparisonRates,
  emptyState = "ready",
  initialHistory,
}: {
  emptyState?: "loading" | "unavailable" | "ready";
  initialHistory?: History;
  rates: Rate[];
  comparisonRates?: Rate[];
  loadedAt: string;
  gpu: string;
  currency: string;
  activeId: string;
  onFocus: (rate: Rate) => void;
}) {
  const [range, setRange] = useState("7d");
  const [optionsOpen, setOptionsOpen] = useState<"dates" | "gpus" | null>(null);
  const [dates, setDates] = useState({ start: "", end: "" });
  const [draftDates, setDraftDates] = useState({ start: "", end: "" });
  const [dateError, setDateError] = useState("");
  const [modelQuery, setModelQuery] = useState("");
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [comparisonFocus, setComparisonFocus] = useState("");
  const [selectedProviders, setSelectedProviders] = useState<string[]>([]);
  const [requestedChartMode, setChartMode] = useState("providers");
  const [results, setResults] = useState<
    Record<string, { data?: History; error?: string }>
  >(() =>
    initialHistory?.series.length
      ? {
          [`${initialHistory.series
            .map((s) => s.id)
            .sort()
            .join(",")}:7d::`]: { data: initialHistory },
        }
      : {},
  );
  const [retryCount, setRetryCount] = useState(0);
  const candidates = useMemo(
    () =>
      rates
        .filter((r) => r.availability !== "Unavailable" || r.id === activeId)
        .sort((a, b) => a.hourly - b.hourly || a.id.localeCompare(b.id)),
    [rates, activeId],
  );
  const offers = useMemo(() => {
    const chosen: Rate[] = [];
    const active = candidates.find((r) => r.id === activeId);
    for (const rate of candidates) {
      if (active && !comparableOffers(active, rate)) continue;
      if (!chosen.some((r) => r.providerId === rate.providerId))
        chosen.push(rate);
      if (chosen.length === 4) break;
    }
    if (active && !chosen.some((r) => r.id === active.id)) {
      const providerIndex = chosen.findIndex(
        (r) => r.providerId === active.providerId,
      );
      if (providerIndex >= 0) chosen[providerIndex] = active;
      else if (chosen.length === 4) chosen[3] = active;
      else chosen.push(active);
    }
    return chosen;
  }, [candidates, activeId]);
  const activeOffer = candidates.find((r) => r.id === activeId) ?? offers[0];
  const modelOffers = useMemo(() => {
    const cheapest = new Map<string, Rate>();
    for (const rate of comparisonRates ?? rates) {
      if (rate.currency !== currency || rate.availability === "Unavailable")
        continue;
      const previous = cheapest.get(comparisonKey(rate));
      if (
        !previous ||
        rate.hourly < previous.hourly ||
        (rate.hourly === previous.hourly && rate.id < previous.id)
      )
        cheapest.set(comparisonKey(rate), rate);
    }
    if (activeOffer) cheapest.set(comparisonKey(activeOffer), activeOffer);
    return [...cheapest.values()].sort((a, b) => a.gpu.localeCompare(b.gpu));
  }, [comparisonRates, rates, currency, activeOffer]);
  const providerOffers = useMemo(
    () => providerHistoryOffers(candidates, activeId),
    [candidates, activeId],
  );
  const selectedOffers = providerOffers.filter((r) =>
    selectedProviders.includes(r.id),
  );
  const chartMode =
    requestedChartMode === "selection" && selectedOffers.length < 2
      ? "providers"
      : requestedChartMode;
  const isProviderChart =
    chartMode === "providers" || chartMode === "selection";
  const plottedOffers = useMemo(() => {
    if (chartMode === "selection")
      return providerOffers.filter((r) => selectedProviders.includes(r.id));
    if (chartMode === "providers") return providerOffers;
    if (chartMode === "gpus")
      return [
        activeOffer,
        ...modelOffers.filter(
          (r) =>
            selectedModels.includes(comparisonKey(r)) &&
            (!activeOffer || comparisonKey(r) !== comparisonKey(activeOffer)),
        ),
      ]
        .filter((r): r is Rate => !!r)
        .slice(0, 4);
    if (chartMode === "compare") return offers;
    return activeOffer ? [activeOffer] : [];
  }, [
    offers,
    chartMode,
    activeOffer,
    modelOffers,
    selectedModels,
    providerOffers,
    selectedProviders,
  ]);
  const ids = plottedOffers
    .map((r) => r.id)
    .sort()
    .join(",");
  const requestKey = `${ids}:${range}:${dates.start}:${dates.end}`;
  const retryHistory = () => {
    setResults((previous) => {
      const next = { ...previous };
      delete next[requestKey];
      return next;
    });
    setRetryCount((count) => count + 1);
  };
  useEffect(() => {
    if (!ids) return;
    if (
      range === "7d" &&
      initialHistory?.window &&
      Date.parse(loadedAt) <= Date.parse(initialHistory.loadedAt) &&
      Date.now() - Date.parse(initialHistory.loadedAt) < 30_000 &&
      ids
        .split(",")
        .every((id) =>
          initialHistory.series.some((s) => s.id === id && !s.truncated),
        )
    )
      return;
    let active = true;
    const query = new URLSearchParams({
      ids,
      range,
      ...(range === "custom" ? dates : {}),
    }).toString();
    const update = (next: { data?: History; error?: string }) => {
      if (!active) return;
      setResults((previous) => ({
        ...Object.fromEntries(
          Object.entries(previous)
            .filter(([key]) => key !== requestKey)
            .slice(-49),
        ),
        [requestKey]: {
          data: next.data ?? previous[requestKey]?.data,
          error: next.error,
        },
      }));
    };
    loadHistory(query)
      .then((data) => update({ data }))
      .catch((error) =>
        update({
          error:
            error instanceof Error && error.name === "TimeoutError"
              ? "Price history took too long to respond. Try another interval or refresh."
              : "Price history is temporarily unavailable.",
        }),
      );
    return () => {
      active = false;
    };
  }, [ids, range, requestKey, dates, loadedAt, initialHistory, retryCount]);
  const currentResult = useMemo(
    () => resolveHistory(results, requestKey, ids, range),
    [results, requestKey, ids, range],
  );
  const historyLoading = !!ids && !currentResult;
  const hasHistory = !!currentResult?.data;
  const series = useMemo(
    () =>
      plottedOffers.map((offer, index) => {
        const points = (
          currentResult?.data?.series.find((s) => s.id === offer.id)?.points ??
          []
        )
          .filter(
            (p) =>
              p.currency === currency &&
              Number.isFinite(p.hourly) &&
              Number.isFinite(Date.parse(p.at)),
          )
          .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
        const delta =
          points.length > 1 ? points.at(-1)!.hourly - points[0].hourly : 0;
        return {
          offer,
          key: `offer${index}`,
          color:
            delta < 0
              ? "var(--success)"
              : delta > 0
                ? "var(--destructive)"
                : "var(--foreground)",
          direction:
            points.length < 2
              ? "Awaiting trend"
              : delta < 0
                ? "Price decreased"
                : delta > 0
                  ? "Price increased"
                  : "Unchanged",
          dash: [undefined, "7 3", "3 3", "9 3 2 3"][index],
          points,
        };
      }),
    [plottedOffers, currentResult, currency],
  );
  const focused =
    series.find(
      (s) => s.offer.id === (chartMode === "gpus" ? comparisonFocus : activeId),
    ) ?? series[0];
  const intervalMinutes = focused
    ? providerIntervals.get(focused.offer.providerId)
    : undefined;
  const points = focused?.points ?? [];
  const first = points[0];
  const latest = points.at(-1);
  const change =
    points.length > 1 && first.hourly > 0
      ? ((latest!.hourly - first.hourly) / first.hourly) * 100
      : null;
  const rows = useMemo(() => {
    const merged = new Map<number, Record<string, number>>();
    for (const s of series)
      for (const point of s.points) {
        const at = Date.parse(point.at);
        merged.set(at, { ...merged.get(at), at, [s.key]: point.hourly });
      }
    return Array.from(merged.values()).sort((a, b) => a.at - b.at);
  }, [series]);
  const config = Object.fromEntries(
    series.map((s) => [
      s.key,
      {
        label: `${providerNames.get(s.offer.providerId) ?? s.offer.providerId}${chartMode === "gpus" ? ` · ${hardwareLabel(s.offer)}` : ""}`,
        colors: { light: [s.color], dark: [s.color] },
      },
    ]),
  );
  const observationCount = series.reduce((n, s) => n + s.points.length, 0);
  const windowEnd = Date.parse(
    currentResult?.data?.window?.end ??
      currentResult?.data?.loadedAt ??
      loadedAt,
  );
  const domainEnd =
    range === "custom"
      ? Math.min(windowEnd, Date.parse(dates.end) + 86400000)
      : windowEnd;
  const domainStart =
    range === "custom"
      ? Date.parse(dates.start)
      : range === "all"
        ? (rows[0]?.at ?? domainEnd - 86400000)
        : domainEnd - (historyWindowDays[range] ?? 7) * 86400000;
  const chartDomain: [number, number] = [
    domainStart,
    Math.max(domainStart + 60000, domainEnd),
  ];
  const tickTime = (at: number) =>
    new Date(at).toLocaleString(
      "en-US",
      range === "24h"
        ? { hour: "numeric", minute: "2-digit", timeZone: "UTC" }
        : { month: "short", day: "numeric", timeZone: "UTC" },
    );

  return (
    <Card
      aria-label="GPU price monitoring"
      data-selected-offer={focused?.offer.id}
      data-history-scope={chartMode}
      className="price-monitor overflow-hidden [--card-spacing:--spacing(3)]"
    >
      <CardHeader className="gap-1">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-sm text-foreground">
              <Activity className="size-4 text-primary" />
              {gpu === "all" ? "GPU" : gpu} price history
            </CardTitle>
            <CardDescription>
              {isProviderChart
                ? `${plottedOffers.length} providers · one matching offer per provider`
                : focused
                  ? `${providerNames.get(focused.offer.providerId)} · ${focused.offer.billing} · ${focused.offer.priceType}`
                  : "Observed source prices"}{" "}
              · {currency}/GPU/hr
              {!isProviderChart && intervalMinutes
                ? ` · checks target every ${intervalMinutes < 60 ? `${intervalMinutes}m` : `${intervalMinutes / 60}h`}`
                : ""}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <ToggleGroup
              value={[range]}
              onValueChange={(values) => {
                if (values[0]) setRange(values[0]);
              }}
              variant="outline"
              spacing={0}
              size="sm"
              aria-label="History interval"
              className={selectedControl}
            >
              <ToggleGroupItem value="24h" aria-label="Last 24 hours">
                24h
              </ToggleGroupItem>
              <ToggleGroupItem value="7d" aria-label="Last 7 days">
                1W
              </ToggleGroupItem>
              <ToggleGroupItem value="30d" aria-label="Last 30 days">
                1M
              </ToggleGroupItem>
              <ToggleGroupItem value="90d" aria-label="Last 90 days">
                3M
              </ToggleGroupItem>
              <ToggleGroupItem value="1y" aria-label="Last year">
                1Y
              </ToggleGroupItem>
              <ToggleGroupItem value="all" aria-label="All retained history">
                ALL
              </ToggleGroupItem>
            </ToggleGroup>
            <Button
              variant={range === "custom" ? "default" : "outline"}
              size="sm"
              aria-pressed={range === "custom"}
              onClick={() => {
                setDraftDates(dates);
                setDateError("");
                setOptionsOpen("dates");
              }}
              aria-label="Custom dates"
            >
              Custom
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            value={[chartMode]}
            onValueChange={(values) => {
              if (values[0]) setChartMode(values[0]);
            }}
            size="sm"
            variant="outline"
            spacing={0}
            aria-label="History scope"
            className={`${selectedControl} flex-wrap`}
          >
            <ToggleGroupItem
              value="providers"
              onClick={() => setChartMode("providers")}
            >
              All providers
            </ToggleGroupItem>
            {selectedOffers.length >= 2 && (
              <ToggleGroupItem value="selection">
                Selected providers ({selectedOffers.length})
              </ToggleGroupItem>
            )}
            <ToggleGroupItem value="offer">Selected offer</ToggleGroupItem>
            <ToggleGroupItem value="compare">Compare providers</ToggleGroupItem>
            <ToggleGroupItem value="gpus">Compare GPUs</ToggleGroupItem>
          </ToggleGroup>
          {chartMode === "gpus" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOptionsOpen("gpus")}
            >
              Choose GPUs
            </Button>
          )}
          {range === "custom" && (
            <span className="text-xs text-muted-foreground">
              {dates.start} – {dates.end} UTC
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {!offers.length ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>
                {emptyState === "loading"
                  ? "Loading matching offers…"
                  : emptyState === "unavailable"
                    ? "Price data unavailable"
                    : "No matching offers to chart"}
              </EmptyTitle>
              <EmptyDescription>
                {emptyState === "loading"
                  ? "The latest snapshot is being checked. History loads once a matching offer is available."
                  : emptyState === "unavailable"
                    ? "Retry with Refresh. Missing data is not a zero price or proof of no supply."
                    : "Adjust your filters or include older observations to select an offer."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <div className="flex min-w-0 flex-col gap-3">
              <div className="min-w-0 space-y-2">
                {!isProviderChart && (
                  <div
                    className="grid grid-cols-2 gap-2 min-[360px]:grid-cols-4 sm:gap-3"
                    aria-label="Selected offer statistics"
                  >
                    {[
                      {
                        label: !hasHistory
                          ? "Current quote"
                          : "Latest observed",
                        value:
                          !hasHistory && focused
                            ? formatMoney(focused.offer.hourly, currency)
                            : latest
                              ? formatMoney(latest.hourly, currency)
                              : "—",
                      },
                      {
                        label: "Observed low",
                        value: points.length
                          ? formatMoney(
                              Math.min(...points.map((p) => p.hourly)),
                              currency,
                            )
                          : "—",
                      },
                      {
                        label: "Observed high",
                        value: points.length
                          ? formatMoney(
                              Math.max(...points.map((p) => p.hourly)),
                              currency,
                            )
                          : "—",
                      },
                      {
                        label: "First → latest",
                        value:
                          change === null
                            ? "—"
                            : `${change > 0 ? "+" : ""}${change.toFixed(2)}%`,
                      },
                    ].map((stat) => (
                      <div key={stat.label}>
                        <p className="text-xs text-muted-foreground">
                          {stat.label}
                        </p>
                        <div
                          style={
                            stat.label === "First → latest" &&
                            change !== null &&
                            change !== 0
                              ? {
                                  color:
                                    change < 0
                                      ? "var(--success)"
                                      : "var(--destructive)",
                                }
                              : undefined
                          }
                          className={
                            stat.label === "Latest observed" ||
                            stat.label === "Current quote"
                              ? "mt-1 text-3xl font-normal tracking-tight tabular-nums"
                              : "mt-1 font-mono text-lg font-medium tracking-tight sm:text-xl"
                          }
                        >
                          {historyLoading && stat.label !== "Current quote" ? (
                            <Skeleton
                              className="h-6 w-16"
                              aria-label={`Loading ${stat.label.toLowerCase()}`}
                            />
                          ) : (
                            stat.value
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div
                  className={
                    isProviderChart
                      ? "provider-history-plot"
                      : "history-plot h-[180px] sm:h-[240px]"
                  }
                  data-testid="price-history-chart"
                  data-window-start={chartDomain[0]}
                  data-window-end={chartDomain[1]}
                >
                  {isProviderChart ? (
                    <>
                      {!currentResult && (
                        <p
                          role="status"
                          className="text-xs text-muted-foreground"
                        >
                          Loading price history…
                        </p>
                      )}
                      {currentResult?.error && !currentResult.data && (
                        <Alert variant="destructive">
                          <AlertTitle>History unavailable</AlertTitle>
                          <AlertDescription>
                            {currentResult.error} Current prices remain
                            available.
                          </AlertDescription>
                          <Button size="sm" variant="outline" className="mt-2" onClick={retryHistory}>
                            Retry history
                          </Button>
                        </Alert>
                      )}
                      <ProviderHistoryLines
                        status={
                          !currentResult
                            ? "loading"
                            : !currentResult.data
                              ? "unavailable"
                              : "ready"
                        }
                        series={series.map((s) => ({
                          ...s,
                          name:
                            providerNames.get(s.offer.providerId) ??
                            s.offer.providerId,
                        }))}
                        domain={chartDomain}
                        currency={currency}
                        selected={selectedOffers.map((r) => r.id)}
                        onSelect={(id) =>
                          setSelectedProviders((previous) => {
                            const current = previous.filter((value) =>
                              providerOffers.some((r) => r.id === value),
                            );
                            return current.includes(id)
                              ? current.filter((value) => value !== id)
                              : [...current, id];
                          })
                        }
                        onClear={() => {
                          setSelectedProviders([]);
                          setChartMode("providers");
                        }}
                        onOpen={(offer) => {
                          onFocus(offer);
                          setChartMode("offer");
                        }}
                        formatTime={tickTime}
                      />
                    </>
                  ) : !currentResult ? (
                    <div
                      className="relative h-full"
                      role="status"
                      aria-label="Loading observed prices"
                    >
                      <Skeleton className="h-full w-full" />
                      <span className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                        Loading price history…
                      </span>
                    </div>
                  ) : currentResult.error && !currentResult.data ? (
                    <Alert variant="destructive">
                      <AlertTitle>History unavailable</AlertTitle>
                      <AlertDescription>
                        {currentResult.error} Current prices remain available.
                      </AlertDescription>
                      <Button size="sm" variant="outline" className="mt-2" onClick={retryHistory}>
                        Retry history
                      </Button>
                    </Alert>
                  ) : rows.length ? (
                    <EvilLineChart
                      data={rows}
                      config={config}
                      className="h-full w-full"
                      xDataKey="at"
                      curveType="linear"
                      animationType="none"
                      chartProps={{
                        margin: { top: 12, right: 16, bottom: 4, left: 0 },
                      }}
                    >
                      <EvilLineChart.Grid vertical strokeDasharray="0" />
                      <EvilLineChart.XAxis
                        dataKey="at"
                        type="number"
                        domain={chartDomain}
                        allowDataOverflow
                        tickFormatter={tickTime}
                        minTickGap={65}
                      />
                      <EvilLineChart.YAxis
                        width={65}
                        tickFormatter={(value) =>
                          new Intl.NumberFormat("en-US", {
                            style: "currency",
                            currency,
                            maximumFractionDigits: 4,
                          }).format(Number(value))
                        }
                        domain={[
                          (min: number) =>
                            Math.max(0, min - Math.max(min * 0.08, 0.01)),
                          (max: number) => max + Math.max(max * 0.08, 0.01),
                        ]}
                      />
                      <Tooltip
                        content={
                          <ChartTooltipContent
                            labelFormatter={(_, payload) =>
                              new Date(
                                Number(payload[0]?.payload.at),
                              ).toLocaleString()
                            }
                            formatter={(value, name) => (
                              <div className="flex w-full justify-between gap-5">
                                <span>{config[String(name)]?.label}</span>
                                <span className="font-mono">
                                  {new Intl.NumberFormat("en-US", {
                                    style: "currency",
                                    currency,
                                    maximumFractionDigits: 4,
                                  }).format(Number(value))}
                                  /GPU/hr
                                </span>
                              </div>
                            )}
                          />
                        }
                      />
                      {chartMode === "offer" &&
                        focused &&
                        focused.points.length > 1 && (
                          <Area
                            dataKey={focused.key}
                            type="linear"
                            baseValue="dataMin"
                            fill={focused.color}
                            fillOpacity={0.12}
                            stroke="none"
                            dot={false}
                            activeDot={false}
                            isAnimationActive={false}
                            connectNulls
                            legendType="none"
                            tooltipType="none"
                          />
                        )}
                      {series.map((s) => (
                        <EvilLineChart.Line
                          key={s.offer.id}
                          dataKey={s.key}
                          strokeWidth={focused?.key === s.key ? 2.5 : 1.5}
                          connectNulls
                          lineProps={{
                            stroke: s.color,
                            strokeDasharray:
                              chartMode === "compare" || chartMode === "gpus"
                                ? s.dash
                                : undefined,
                          }}
                        >
                          <EvilLineChart.Dot variant="border" />
                          <EvilLineChart.ActiveDot variant="colored-border" />
                        </EvilLineChart.Line>
                      ))}
                    </EvilLineChart>
                  ) : (
                    <Empty className="h-full">
                      <EmptyHeader>
                        <EmptyTitle>History is starting</EmptyTitle>
                        <EmptyDescription>
                          No stored observations in this interval yet.
                          Collection will add real price points.
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  )}
                </div>
                <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    {hasHistory
                      ? `${observationCount} stored observations · ${currency}/GPU/hour${chartMode === "offer" && focused ? ` · ${focused.direction}` : ""}`
                      : `Current quote · ${currency}/GPU/hour · observed ${focused ? `${new Date(focused.offer.observedAt).toLocaleString("en-US", { timeZone: "UTC" })} UTC` : "—"}`}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Clock3 className="size-3.5" />
                    {!hasHistory
                      ? historyLoading
                        ? "Fetching recorded history"
                        : "History unavailable"
                      : rows.length
                        ? `Observed ${new Date(rows[0].at).toLocaleDateString("en-US", { timeZone: "UTC" })} – ${new Date(rows.at(-1)!.at).toLocaleDateString("en-US", { timeZone: "UTC" })} UTC`
                        : "Waiting for observations"}
                  </span>
                </div>
              </div>
              {chartMode !== "offer" && !isProviderChart && (
                <div className="min-w-0 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    {chartMode === "gpus"
                      ? "GPU comparison · distinct hardware and rental configurations"
                      : "Provider focus · matching reported hardware and rental terms"}
                  </p>
                  {chartMode === "compare" && (
                    <p className="text-xs text-muted-foreground">
                      Only matching model, variant, VRAM, GPU count and known
                      rental terms are overlaid. Unknown hardware is not assumed
                      equivalent; CPU, network and performance can still differ.
                    </p>
                  )}
                  <ToggleGroup
                    value={focused ? [focused.offer.id] : []}
                    onValueChange={(values) => {
                      const selected = plottedOffers.find(
                        (r) => r.id === values[0],
                      );
                      if (selected) {
                        if (chartMode === "gpus")
                          setComparisonFocus(selected.id);
                        else onFocus(selected);
                      }
                    }}
                    variant="outline"
                    className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4"
                    aria-label="Focus provider"
                  >
                    {series.map((s) => (
                      <ToggleGroupItem
                        key={s.offer.id}
                        value={s.offer.id}
                        className="h-auto w-full justify-start whitespace-normal px-2 py-2 text-left"
                        title={`${providerNames.get(s.offer.providerId)} · ${hardwareLabel(s.offer)} · ${s.offer.billing} · ${s.offer.priceType}`}
                      >
                        <ProviderLogo providerId={s.offer.providerId} />
                        <span
                          className="mt-1 size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: s.color }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex justify-between gap-2 text-xs">
                            <span>{providerNames.get(s.offer.providerId)}</span>
                            <span className="font-mono">
                              {s.offer.priceType === "Starting at"
                                ? "from "
                                : ""}
                              {formatMoney(s.offer.hourly, currency)}
                            </span>
                          </span>
                          <span className="mt-1 block text-[10px] font-normal text-muted-foreground">
                            {hardwareLabel(s.offer)} ·{" "}
                            {s.offer.gpuCount === null
                              ? "GPU count unspecified"
                              : `${s.offer.gpuCount} GPU${s.offer.gpuCount === 1 ? "" : "s"}`}
                          </span>
                          <span className="block truncate text-[10px] font-normal text-muted-foreground">
                            {hasHistory
                              ? s.direction
                              : historyLoading
                                ? "Loading history"
                                : "History unavailable"}{" "}
                            · {s.offer.billing} ·{" "}
                            {s.offer.priceType === "Starting at"
                              ? "Starting at"
                              : s.offer.region}
                          </span>
                          <OfferCaveats rate={s.offer} compact />
                        </span>
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                  {change !== null && change !== 0 && (
                    <Badge
                      variant="secondary"
                      className={
                        change < 0 ? "text-success" : "text-destructive"
                      }
                    >
                      {change < 0 ? <ArrowDownRight /> : <ArrowUpRight />}
                      {Math.abs(change).toFixed(2)}%{" "}
                      {change < 0 ? "lower" : "higher"} since first observation
                    </Badge>
                  )}
                </div>
              )}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {isProviderChart
                ? "Hardware, configuration and rental terms may differ. "
                : ""}
              {currentResult?.error && currentResult.data
                ? "History refresh failed. Showing previously received observations. "
                : ""}
              {currentResult?.data?.series.some((s) => s.truncated)
                ? "Latest 2,000 observations per offer shown; earlier retained history omitted. "
                : ""}
              {!hasHistory
                ? "Current quote is from the latest source observation; no historical trend is inferred."
                : series.every((s) => s.points.length < 2)
                  ? "More observations are needed to measure a trend. No backfilled history."
                  : "Actual observations only; straight lines connect checks. Starting prices remain floors. No backfilled history."}
            </p>
          </>
        )}
      </CardContent>
      <Sheet
        open={optionsOpen !== null}
        onOpenChange={(open) => {
          if (!open) setOptionsOpen(null);
        }}
      >
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {optionsOpen === "dates"
                ? "Custom history dates"
                : "Compare GPU models"}
            </SheetTitle>
            <SheetDescription>
              {optionsOpen === "dates"
                ? "UTC calendar days, inclusive. Only actual retained observations are shown."
                : `Uses your current filters except GPU family and model. Memory, hardware variant, billing, capacity, region and priority stay separate. These are price comparisons, not equivalent performance. Choose up to three additional configurations.`}
            </SheetDescription>
          </SheetHeader>
          {optionsOpen === "dates" ? (
            <FieldGroup className="px-4">
              <Field>
                <FieldLabel htmlFor="history-start">
                  Start date (UTC)
                </FieldLabel>
                <Input
                  id="history-start"
                  type="date"
                  min="1970-01-01"
                  max={new Date().toISOString().slice(0, 10)}
                  value={draftDates.start}
                  onChange={(e) =>
                    setDraftDates({ ...draftDates, start: e.target.value })
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="history-end">End date (UTC)</FieldLabel>
                <Input
                  id="history-end"
                  type="date"
                  min={draftDates.start || "1970-01-01"}
                  max={new Date().toISOString().slice(0, 10)}
                  value={draftDates.end}
                  onChange={(e) =>
                    setDraftDates({ ...draftDates, end: e.target.value })
                  }
                />
              </Field>
              {dateError && (
                <p role="alert" className="text-sm text-destructive">
                  {dateError}
                </p>
              )}
              <Button
                onClick={() => {
                  if (
                    !draftDates.start ||
                    !draftDates.end ||
                    draftDates.start < "1970-01-01" ||
                    draftDates.start > draftDates.end ||
                    draftDates.end > new Date().toISOString().slice(0, 10)
                  ) {
                    setDateError(
                      "Choose dates from 1970 through today, with start on or before end.",
                    );
                    return;
                  }
                  setDates(draftDates);
                  setRange("custom");
                  setOptionsOpen(null);
                }}
              >
                Apply dates
              </Button>
            </FieldGroup>
          ) : (
            <FieldGroup className="px-4 pb-4">
              {modelOffers.length <= 1 && (
                <p className="text-sm text-muted-foreground">
                  No other GPU models match these constraints. Broaden the
                  provider, region or price filters to compare more models.
                </p>
              )}
              <Field>
                <FieldLabel htmlFor="comparison-model-search">
                  Find configurations
                </FieldLabel>
                <Input
                  id="comparison-model-search"
                  value={modelQuery}
                  onChange={(event) => setModelQuery(event.target.value)}
                  placeholder="GPU, memory, provider, plan…"
                />
              </Field>
              {modelOffers
                .filter((rate) =>
                  `${hardwareLabel(rate)} ${providerNames.get(rate.providerId)} ${rate.plan} ${rate.billing} ${rate.region}`
                    .toLowerCase()
                    .includes(modelQuery.toLowerCase()),
                )
                .map((rate) => (
                  <Field key={comparisonKey(rate)} orientation="horizontal">
                    <Checkbox
                      id={`model-${rate.id}`}
                      checked={
                        (!!activeOffer &&
                          comparisonKey(rate) === comparisonKey(activeOffer)) ||
                        selectedModels.includes(comparisonKey(rate))
                      }
                      disabled={
                        (!!activeOffer &&
                          comparisonKey(rate) === comparisonKey(activeOffer)) ||
                        (!selectedModels.includes(comparisonKey(rate)) &&
                          selectedModels.filter(
                            (gpu) =>
                              (!activeOffer ||
                                gpu !== comparisonKey(activeOffer)) &&
                              modelOffers.some(
                                (offer) => comparisonKey(offer) === gpu,
                              ),
                          ).length >= 3)
                      }
                      onCheckedChange={(checked) =>
                        setSelectedModels((current) =>
                          checked
                            ? [
                                ...current.filter(
                                  (gpu) =>
                                    (!activeOffer ||
                                      gpu !== comparisonKey(activeOffer)) &&
                                    modelOffers.some(
                                      (offer) => comparisonKey(offer) === gpu,
                                    ),
                                ),
                                comparisonKey(rate),
                              ]
                            : current.filter(
                                (gpu) => gpu !== comparisonKey(rate),
                              ),
                        )
                      }
                    />
                    <FieldLabel htmlFor={`model-${rate.id}`}>
                      <span className="space-y-1">
                        <span className="block">
                          {hardwareLabel(rate)} ·{" "}
                          {providerNames.get(rate.providerId)}
                        </span>
                        <span className="block text-xs font-normal text-muted-foreground">
                          {rate.billing} · {rate.gpuCount ?? "Unspecified"}{" "}
                          GPU(s) · {rate.region} · {rate.plan}
                          {offerCharacteristics(rate).priority !==
                          "Not specified"
                            ? ` · ${offerCharacteristics(rate).priority} priority`
                            : ""}
                          {offerCharacteristics(rate).supply === "Community"
                            ? " · Community · Interruptible"
                            : ""}
                        </span>
                        <span className="block">
                          {rate.priceType === "Starting at" ? "from " : ""}
                          {formatMoney(rate.hourly, currency)}/GPU/hr
                        </span>
                      </span>
                    </FieldLabel>
                  </Field>
                ))}
              <Button onClick={() => setOptionsOpen(null)}>Done</Button>
            </FieldGroup>
          )}
        </SheetContent>
      </Sheet>
    </Card>
  );
}
