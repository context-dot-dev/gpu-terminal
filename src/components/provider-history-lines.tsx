"use client";

import { useMemo, useState, type PointerEvent } from "react";
import { ProviderLogo } from "@/components/provider-logo";
import { Checkbox } from "@/components/ui/checkbox";
import type { HistoryPoint, Rate } from "@/lib/types";

function providerColor(id: string) {
  const hash = Array.from(id).reduce(
    (value, char) => (Math.imul(value, 31) + char.charCodeAt(0)) >>> 0,
    0,
  );
  return `oklch(var(--provider-line-lightness) 0.14 ${hash % 360})`;
}

export function ProviderHistoryLines({
  series,
  domain,
  currency,
  selected,
  onSelect,
  onClear,
  onOpen,
  formatTime,
  status,
}: {
  series: { offer: Rate; name: string; points: HistoryPoint[] }[];
  domain: [number, number];
  currency: string;
  status: "loading" | "unavailable" | "ready";
  selected: string[];
  onSelect: (id: string) => void;
  onClear: () => void;
  onOpen: (offer: Rate) => void;
  formatTime: (at: number) => string;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("price");
  const [hideUnchanged, setHideUnchanged] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [observation, setObservation] = useState<{
    id: string;
    name: string;
    point: HistoryPoint;
    providerId: string;
    startingAt: boolean;
    left: number;
    top: number;
  } | null>(null);
  const money = (value: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: value < 0.1 ? 4 : 2,
    }).format(value);
  const { maximum, ticks, lines } = useMemo(() => {
    const prepared = series.map((s) => ({
      ...s,
      changed:
        s.points.length > 1 &&
        s.points.some((point) => point.hourly !== s.points[0].hourly),
    }));
    const displayed = prepared.filter(
      (s) => !hideUnchanged || s.changed || selected.includes(s.offer.id),
    );
    const scaleSeries = displayed.some((s) => s.points.length)
      ? displayed
      : prepared;
    const highest = scaleSeries.reduce(
      (max, s) => s.points.reduce((value, p) => Math.max(value, p.hourly), max),
      0.01,
    );
    const magnitude = 10 ** Math.floor(Math.log10(highest / 6));
    const step =
      [1, 2, 5, 10].find((n) => n * magnitude >= highest / 6)! * magnitude;
    const maximum = Math.ceil(highest / step) * step;
    const x = (at: string) =>
      10 + ((Date.parse(at) - domain[0]) / (domain[1] - domain[0])) * 980;
    const y = (price: number) => 290 - (price / maximum) * 280;
    const lines = prepared.map((s) => ({
      ...s,
      path: s.points
        .map(
          (p, i) =>
            `${i ? "L" : "M"}${x(p.at).toFixed(2)},${y(p.hourly).toFixed(2)}`,
        )
        .join(""),
      single:
        s.points.length === 1
          ? { x: x(s.points[0].at), y: y(s.points[0].hourly) }
          : null,
      color: providerColor(s.offer.providerId),
      change:
        s.points.length > 1 && s.points[0].hourly > 0
          ? (s.points.at(-1)!.hourly / s.points[0].hourly - 1) * 100
          : null,
    }));
    return {
      maximum,
      ticks: Array.from(
        { length: Math.round(maximum / step) + 1 },
        (_, i) => i * step,
      ),
      lines,
    };
  }, [series, domain, hideUnchanged, selected]);
  const hasObservations = lines.some((s) => s.points.length);
  const changedCount = lines.filter((s) => s.changed).length;
  const unchangedCount = lines.filter(
    (s) => s.points.length > 1 && !s.changed,
  ).length;
  const unknownCount = lines.length - changedCount - unchangedCount;
  const plottedLines = lines.filter(
    (s) => !hideUnchanged || s.changed || selected.includes(s.offer.id),
  );
  const legendLines = lines.filter((s) =>
    selected.length ? selected.includes(s.offer.id) : s.changed,
  );
  const focusedId = plottedLines.some((s) => s.offer.id === hovered)
    ? hovered
    : null;
  const visibleObservation =
    observation &&
    plottedLines.some(
      (s) =>
        s.offer.id === observation.id && s.points.includes(observation.point),
    )
      ? observation
      : null;
  const emptyLabel =
    status === "loading"
      ? "Loading history"
      : status === "unavailable"
        ? "History unavailable"
        : "No observations";
  const visibleLines = lines
    .filter((s) => s.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "change") {
        const difference =
          (b.change === null ? -1 : Math.abs(b.change)) -
          (a.change === null ? -1 : Math.abs(a.change));
        if (difference) return difference;
      }
      return a.offer.hourly - b.offer.hourly || a.name.localeCompare(b.name);
    });
  const emphasis = (line: (typeof lines)[number]) =>
    focusedId === line.offer.id
      ? 3
      : selected.includes(line.offer.id)
        ? 2
        : line.changed
          ? 1
          : 0;
  const orderedLines = [...plottedLines].sort(
    (a, b) => emphasis(a) - emphasis(b),
  );

  function inspectLine(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const x = (p: HistoryPoint) =>
      ((10 + ((Date.parse(p.at) - domain[0]) / (domain[1] - domain[0])) * 980) /
        1000) *
      rect.width;
    const y = (p: HistoryPoint) =>
      ((290 - (p.hourly / maximum) * 280) / 300) * rect.height;
    let distance = (event.pointerType === "touch" ? 20 : 8) ** 2;
    let closest: (typeof lines)[number] | undefined;
    for (const line of orderedLines) {
      for (let i = 0; i < line.points.length; i++) {
        const a = line.points[Math.max(0, i - 1)],
          b = line.points[i];
        const ax = x(a),
          ay = y(a),
          dx = x(b) - ax,
          dy = y(b) - ay;
        const length = dx * dx + dy * dy;
        const t = length
          ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length))
          : 0;
        const d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
        if (d <= distance) {
          distance = d;
          closest = line;
        }
      }
    }
    if (!closest) {
      setHovered(null);
      setObservation(null);
      return;
    }
    if (
      event.type === "pointerdown" &&
      event.pointerType === "mouse" &&
      event.button === 0
    )
      onSelect(closest.offer.id);
    const at =
      domain[0] +
      (((px / rect.width) * 1000 - 10) / 980) * (domain[1] - domain[0]);
    const point = closest.points.reduce((nearest, p) =>
      Math.abs(Date.parse(p.at) - at) < Math.abs(Date.parse(nearest.at) - at)
        ? p
        : nearest,
    );
    const plotRect = event.currentTarget.parentElement!.getBoundingClientRect();
    setHovered(closest.offer.id);
    setObservation({
      id: closest.offer.id,
      name: closest.name,
      providerId: closest.offer.providerId,
      startingAt: closest.offer.priceType === "Starting at",
      point,
      left: Math.max(
        4,
        Math.min(event.clientX - plotRect.left + 14, plotRect.width - 244),
      ),
      top: Math.max(
        4,
        Math.min(event.clientY - plotRect.top + 14, plotRect.height - 108),
      ),
    });
  }

  return (
    <div className="provider-history-lines">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs">
        <p
          aria-label="Price movement summary"
          title="A provider counts as changed if any recorded price differs in this period, even if it later returns to the starting price. Changing lines are brighter."
          className="text-muted-foreground"
        >
          {status !== "ready" ? (
            emptyLabel
          ) : (
            <>
              <span className={changedCount ? "text-foreground" : undefined}>
                {changedCount} changed
              </span>
              {" · "}
              {unchangedCount} unchanged
              {unknownCount > 0 && <> · {unknownCount} need more history</>}
              {" in this period"}
            </>
          )}
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-pressed={hideUnchanged}
            title="Show recorded price changes. Pinned providers remain visible."
            className={`rounded-md border border-input px-2 py-1.5 hover:bg-accent focus-visible:outline-ring ${hideUnchanged ? "bg-accent text-foreground" : "text-muted-foreground"}`}
            onClick={() => {
              setHideUnchanged(!hideUnchanged);
              setHovered(null);
              setObservation(null);
            }}
          >
            Changes only
          </button>
          {(selected.length > 0 || hideUnchanged) && (
            <button
              type="button"
              className="rounded-sm underline underline-offset-4 focus-visible:outline-ring"
              onClick={() => {
                setHideUnchanged(false);
                setQuery("");
                setHovered(null);
                setObservation(null);
                onClear();
              }}
            >
              Show all
            </button>
          )}
        </div>
      </div>
      <div className="provider-chart-layout">
        <div className="min-w-0">
          <div className="mb-2 flex justify-between gap-2 text-xs text-muted-foreground">
            <span>{currency}/GPU/hour</span>
            <span>{plottedLines.length} providers · one price scale</span>
          </div>
          <div
            className="provider-line-plot"
            data-testid="provider-line-plot"
            onPointerLeave={() => {
              setHovered(null);
              setObservation(null);
            }}
          >
            {(hasObservations ? ticks : []).map((tick, i) => (
              <span
                key={i}
                className="provider-y-tick"
                style={{ top: `${(10 + (i / (ticks.length - 1)) * 280) / 3}%` }}
              >
                {money(maximum - tick)}
              </span>
            ))}
            <svg
              onPointerMove={inspectLine}
              onPointerDown={inspectLine}
              viewBox="0 0 1000 300"
              preserveAspectRatio="none"
              role="img"
              aria-label={
                hasObservations
                  ? `${hideUnchanged ? "Changed and pinned" : "All"} provider price histories, ${money(0)} to ${money(maximum)} per GPU hour`
                  : emptyLabel
              }
            >
              <title>{`Recorded provider prices from ${formatTime(domain[0])} to ${formatTime(domain[1])}. Straight lines connect observations.`}</title>
              {(hasObservations ? ticks : []).map((tick, i) => (
                <path
                  key={i}
                  d={`M10,${10 + (i / (ticks.length - 1)) * 280}H990`}
                  pointerEvents="none"
                  stroke="var(--border)"
                  strokeDasharray="3 5"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {orderedLines.map((s) => {
                const emphasized = focusedId
                  ? focusedId === s.offer.id
                  : selected.includes(s.offer.id);
                const common = {
                  stroke: s.color,
                  strokeWidth: emphasized ? 2.5 : s.changed ? 1.8 : 1,
                  opacity: emphasized
                    ? 1
                    : focusedId || selected.length
                      ? 0.12
                      : s.changed
                        ? 0.95
                        : changedCount
                          ? 0.24
                          : 0.55,
                  vectorEffect: "non-scaling-stroke" as const,
                  "data-provider-id": s.offer.providerId,
                  "data-emphasized": emphasized,
                  "data-changed": s.changed,
                };
                return s.points.length ? (
                  <g key={s.offer.id}>
                    {s.single ? (
                      <path
                        {...common}
                        d={`M${s.single.x},${s.single.y - 0.5}v1`}
                        strokeWidth="5"
                        strokeLinecap="round"
                        data-price-point
                      />
                    ) : (
                      <path
                        {...common}
                        d={s.path}
                        fill="none"
                        data-price-line
                      />
                    )}
                  </g>
                ) : null;
              })}
            </svg>
            {visibleObservation && (
              <div
                role="tooltip"
                className="provider-chart-tooltip"
                style={{
                  left: visibleObservation.left,
                  top: visibleObservation.top,
                }}
              >
                <div className="flex items-center gap-2 font-medium">
                  <ProviderLogo providerId={visibleObservation.providerId} />
                  <span className="min-w-0 truncate">
                    {visibleObservation.name}
                  </span>
                </div>
                <p className="mt-2 font-mono text-base tabular-nums">
                  {visibleObservation.startingAt ? "from " : ""}
                  {money(visibleObservation.point.hourly)}
                  <span className="text-xs text-muted-foreground">/GPU/hr</span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {new Date(visibleObservation.point.at).toLocaleString(
                    "en-US",
                    { timeZone: "UTC" },
                  )}{" "}
                  UTC
                </p>
              </div>
            )}
            {!plottedLines.some((s) => s.points.length) && (
              <span className="provider-chart-empty">
                {hideUnchanged && hasObservations
                  ? "No recorded price changes in this period. Choose Show all to see every price."
                  : emptyLabel}
              </span>
            )}
            <div className="provider-x-ticks">
              {[0, 1, 2, 3].map((i) => (
                <span key={i}>
                  {formatTime(domain[0] + ((domain[1] - domain[0]) * i) / 3)}
                </span>
              ))}
            </div>
          </div>
          <div
            className="min-h-10 pt-1 text-xs text-muted-foreground"
            data-testid="provider-history-observation"
          >
            {visibleObservation ? (
              `${visibleObservation.name} · ${money(visibleObservation.point.hourly)}/GPU/hr · ${new Date(visibleObservation.point.at).toLocaleString("en-US", { timeZone: "UTC" })} UTC`
            ) : !hasObservations ? (
              emptyLabel
            ) : legendLines.length > 0 ? (
              <div
                className="flex items-center gap-3 overflow-x-auto whitespace-nowrap"
                aria-label={
                  selected.length
                    ? "Pinned providers"
                    : "Providers with price changes"
                }
              >
                <span>{selected.length ? "Pinned:" : "Changed:"}</span>
                {legendLines.map((s) => (
                  <button
                    key={s.offer.id}
                    type="button"
                    aria-label={`Pin ${s.name}`}
                    aria-pressed={selected.includes(s.offer.id)}
                    className="flex shrink-0 items-center gap-1.5 rounded-sm py-1 text-foreground hover:underline focus-visible:outline-ring"
                    onMouseEnter={() => setHovered(s.offer.id)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered(s.offer.id)}
                    onBlur={() => setHovered(null)}
                    onClick={() => onSelect(s.offer.id)}
                  >
                    <span
                      className="h-0.5 w-3"
                      style={{ background: s.color }}
                      aria-hidden="true"
                    />
                    <ProviderLogo providerId={s.offer.providerId} />
                    {s.name}
                  </button>
                ))}
              </div>
            ) : (
              "Hover to identify a provider · click a line to pin."
            )}
          </div>
        </div>
        <details className="provider-chart-legend">
          <summary
            aria-label="Choose providers"
            className="w-fit cursor-pointer rounded-sm py-2 text-xs focus-visible:outline-ring"
          >
            Choose providers{" "}
            <span className="ml-1 text-muted-foreground">
              ({lines.length})
              {selected.length > 0 ? ` · ${selected.length} pinned` : ""}
            </span>
          </summary>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <input
              type="search"
              aria-label="Search chart providers"
              placeholder="Find a provider…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div>
              <select
                aria-label="Sort chart providers"
                value={sort}
                onChange={(event) => setSort(event.target.value)}
                className="min-w-0 rounded-md border border-input bg-background px-1.5 py-1 text-xs focus-visible:outline-ring"
              >
                <option value="price">Lowest price</option>
                <option value="change">Largest net change</option>
                <option value="name">Name A–Z</option>
              </select>
            </div>
          </div>
          <div
            className="provider-history-scroll"
            role="group"
            aria-label="Provider histories"
          >
            {visibleLines.map((s) => (
              <div
                key={s.offer.id}
                className="provider-history-row"
                data-testid="provider-history-row"
                onMouseEnter={() => setHovered(s.offer.id)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(s.offer.id)}
                onBlur={() => setHovered(null)}
              >
                <Checkbox
                  className="border-muted-foreground/50"
                  aria-label={`Pin ${s.name}`}
                  checked={selected.includes(s.offer.id)}
                  onCheckedChange={() => onSelect(s.offer.id)}
                />
                <button
                  type="button"
                  className="flex min-w-0 items-center gap-2 text-left text-xs hover:underline"
                  aria-label={`View ${s.name} history`}
                  onClick={() => onOpen(s.offer)}
                >
                  <span
                    className="h-4 w-0.5 shrink-0 rounded-full"
                    style={{ background: s.color }}
                    aria-hidden="true"
                  />
                  <ProviderLogo providerId={s.offer.providerId} />
                  <span className="min-w-0">
                    <span className="block truncate" title={s.name}>
                      {s.name}
                    </span>
                    {!s.points.length && (
                      <span className="block text-muted-foreground">
                        {emptyLabel}
                      </span>
                    )}
                  </span>
                </button>
                <div className="text-right font-mono text-xs tabular-nums">
                  <div>
                    {s.offer.priceType === "Starting at" ? "from " : ""}
                    {money(s.offer.hourly)}
                  </div>
                  <div
                    className="mt-0.5 text-[10px] text-muted-foreground"
                    title="Change from first to latest observation in this period"
                  >
                    {s.change === null
                      ? "—"
                      : `${s.change > 0 ? "+" : ""}${s.change.toFixed(1)}%`}
                  </div>
                </div>
              </div>
            ))}
            {!visibleLines.length && (
              <p className="py-3 text-xs text-muted-foreground">
                No matching providers
              </p>
            )}
          </div>
          <p className="pt-1 text-xs text-muted-foreground">
            Check to pin · name opens details · prices show current quote and
            first-to-latest change
          </p>
        </details>
      </div>
    </div>
  );
}
