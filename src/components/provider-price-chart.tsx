"use client";

import { Bar, BarChart, Cell, XAxis, YAxis } from "recharts";
import { ProviderLogo } from "@/components/provider-logo";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ChartContainer } from "@/components/ui/chart";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { providers } from "@/lib/catalog";
import {
  hardwareLabel,
  offerCharacteristics,
} from "@/lib/offer-characteristics";
import type { Rate } from "@/lib/types";

const names = new Map(
  providers.map((provider) => [provider.id, provider.name]),
);

export function ProviderPriceChart({
  rates,
  activeId,
  onFocus,
  currency,
  emptyState = "ready",
}: {
  emptyState?: "loading" | "unavailable" | "ready";
  rates: Rate[];
  activeId: string;
  onFocus: (rate: Rate) => void;
  currency: string;
}) {
  const cheapest = new Map<string, Rate>();
  for (const rate of rates) {
    if (
      rate.currency !== currency ||
      rate.availability === "Unavailable" ||
      !Number.isFinite(rate.hourly) ||
      rate.hourly <= 0
    )
      continue;
    const previous = cheapest.get(rate.providerId);
    if (!previous || rate.hourly < previous.hourly)
      cheapest.set(rate.providerId, rate);
  }
  const activeProvider = rates.find((rate) => rate.id === activeId)?.providerId;
  const ranked = [...cheapest.values()].sort(
    (a, b) => a.hourly - b.hourly || a.id.localeCompare(b.id),
  );
  const shown = ranked.slice(0, 6);
  const active = activeProvider ? cheapest.get(activeProvider) : undefined;
  if (active && !shown.some((rate) => rate.providerId === activeProvider)) {
    shown[shown.length - 1] = active;
    shown.sort((a, b) => a.hourly - b.hourly || a.id.localeCompare(b.id));
  }
  const money = (rate: Rate) =>
    `${rate.priceType === "Starting at" ? "from " : ""}${new Intl.NumberFormat(
      "en-US",
      {
        style: "currency",
        currency,
        maximumFractionDigits: rate.hourly < 0.1 ? 4 : 2,
      },
    ).format(rate.hourly)}`;

  return (
    <Card size="sm" data-testid="provider-price-chart">
      <CardHeader>
        <CardTitle>Provider prices</CardTitle>
        <CardDescription>
          Lowest matching offer · {currency}/GPU-hour
        </CardDescription>
      </CardHeader>
      <CardContent>
        {shown.length ? (
          <>
            <div className="grid grid-cols-[112px_minmax(0,1fr)_auto] items-start gap-2">
              <div className="flex min-w-0 flex-col">
                {shown.map((rate) => (
                  <Button
                    key={rate.id}
                    size="xs"
                    variant={rate.id === activeId ? "secondary" : "ghost"}
                    className="w-full justify-start px-0"
                    onClick={() => onFocus(rate)}
                    data-provider-id={rate.providerId}
                    aria-label={`Inspect ${names.get(rate.providerId) ?? rate.providerId}: ${money(rate)} per GPU-hour, ${hardwareLabel(rate)}, ${rate.billing}, ${offerCharacteristics(rate).supply}, ${offerCharacteristics(rate).priority} priority`}
                    title={`${names.get(rate.providerId) ?? rate.providerId} · ${hardwareLabel(rate)} · ${rate.billing} · ${rate.plan}`}
                  >
                    <ProviderLogo providerId={rate.providerId} />
                    <span className="truncate">
                      {names.get(rate.providerId) ?? rate.providerId}
                    </span>
                  </Button>
                ))}
              </div>
              <ChartContainer
                config={{
                  hourly: { label: "Per GPU-hour", color: "var(--foreground)" },
                }}
                className="w-full aspect-auto"
                style={{ height: shown.length * 24 }}
                aria-hidden="true"
              >
                <BarChart
                  data={shown}
                  layout="vertical"
                  accessibilityLayer={false}
                  margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
                  barSize={12}
                >
                  <XAxis type="number" hide domain={[0, "dataMax"]} />
                  <YAxis type="category" dataKey="id" hide />
                  <Bar
                    dataKey="hourly"
                    radius={[0, 3, 3, 0]}
                    isAnimationActive={false}
                  >
                    {shown.map((rate) => (
                      <Cell
                        key={rate.id}
                        fill={
                          rate.id === activeId
                            ? "var(--foreground)"
                            : "var(--muted-foreground)"
                        }
                        fillOpacity={rate.id === activeId ? 1 : 0.45}
                        cursor="pointer"
                        data-provider-id={rate.providerId}
                        onClick={() => onFocus(rate)}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
              <div
                className="flex flex-col text-right text-xs tabular-nums"
                aria-hidden="true"
              >
                {shown.map((rate) => (
                  <span
                    key={rate.id}
                    className="flex h-6 items-center justify-end"
                  >
                    {money(rate)}
                  </span>
                ))}
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              GPU variants, configurations and billing may differ.
            </p>
          </>
        ) : (
          <Empty className="py-4">
            <EmptyHeader>
              <EmptyTitle>
                {emptyState === "loading"
                  ? "Checking provider prices…"
                  : emptyState === "unavailable"
                    ? "Provider prices unavailable"
                    : "No matching prices"}
              </EmptyTitle>
              <EmptyDescription>
                {emptyState === "loading"
                  ? "Waiting for the latest snapshot."
                  : emptyState === "unavailable"
                    ? "Retry with Refresh."
                    : "Adjust the filters to compare providers."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </CardContent>
    </Card>
  );
}
