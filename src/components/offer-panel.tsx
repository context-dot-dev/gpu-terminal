"use client";
import { ArrowUpRight, Bookmark, Check, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { OfferCaveats } from "@/components/offer-caveats";
import { hardwareVariant } from "@/lib/offer-characteristics";
import { ProviderLogo } from "@/components/provider-logo";
import { providers } from "@/lib/catalog";
import type { ProviderState, Rate } from "@/lib/types";
const names = new Map(providers.map((p) => [p.id, p.name]));
export function OfferPanel({
  rate,
  states,
  now,
  saved,
  onSave,
  onInspect,
  emptyState = "ready",
}: {
  emptyState?: "loading" | "unavailable" | "ready";
  rate: Rate | undefined;
  states: ProviderState[];
  now: number;
  saved: boolean;
  onSave: () => void;
  onInspect: () => void;
}) {
  const money = (n: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: rate?.currency ?? "USD",
      maximumFractionDigits: n < 0.1 ? 4 : 2,
    }).format(n);
  const state = states.find((s) => s.id === rate?.providerId);
  const age = (at: string | null) =>
    at
      ? `${Math.max(0, Math.floor((now - Date.parse(at)) / 60000))}m ago`
      : "Not checked";
  return (
    <div className="space-y-2">
      <Card
        size="sm"
        data-testid="selected-offer-panel"
        data-offer-id={rate?.id}
      >
        <CardHeader>
          <CardTitle className="text-xs">Selected offer</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {rate ? (
            <>
              <div>
                <a
                  href={rate.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  title="Open provider pricing in a new tab"
                  className={buttonVariants({
                    variant: "link",
                    className:
                      "h-auto max-w-full justify-start gap-2 px-0 text-xs whitespace-normal",
                  })}
                >
                  <ProviderLogo providerId={rate.providerId} />
                  <span>
                    {names.get(rate.providerId)} · {rate.gpu}
                  </span>
                  <ArrowUpRight className="size-3" />
                </a>
                <p className="mt-1 text-xs text-muted-foreground">
                  {rate.region}
                </p>
                <p className="mt-2 font-mono text-2xl tracking-tight">
                  {rate.priceType === "Starting at" && (
                    <span className="mr-1 text-xs text-muted-foreground">
                      from
                    </span>
                  )}
                  {money(rate.hourly)}
                  <span className="ml-1 text-xs text-muted-foreground">
                    /GPU/hr
                  </span>
                </p>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                {[
                  [
                    "GPU VRAM",
                    rate.vramGb ? `${rate.vramGb} GB / GPU` : "Unknown",
                  ],
                  ["vCPUs", rate.vcpus ? `${rate.vcpus} vCPUs` : "Unknown"],
                  [
                    "Host RAM",
                    rate.ramGb ? `${rate.ramGb} GB host RAM` : "Unknown",
                  ],
                  [
                    "Configuration",
                    rate.gpuCount
                      ? `${rate.gpuCount} GPU${rate.gpuCount > 1 ? "s" : ""}`
                      : "Count unspecified",
                  ],
                  ["Billing", rate.billing],
                  ["Hardware variant", hardwareVariant(rate)],

                  ["Availability", rate.availability],
                  ["Observed", age(rate.observedAt)],
                ].map(([label, value]) => (
                  <div key={label} className="contents">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd
                      className={`text-right break-words ${label === "Availability" ? (value === "Available" ? "text-success" : value === "Unavailable" ? "text-destructive" : "") : ""}`}
                    >
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
              <OfferCaveats rate={rate} />
              <div className="rounded-sm bg-background py-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    Configuration / hr
                  </p>
                  <p className="font-mono text-sm">
                    {rate.gpuCount
                      ? `${rate.priceType === "Starting at" ? "from " : ""}${money(rate.hourly * rate.gpuCount)}`
                      : "Unknown"}
                  </p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Compute only · storage, egress and tax may be extra
                </p>
              </div>
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  {rate.collectionMethod ?? "Source extraction"} ·{" "}
                  <span
                    className={
                      state?.status === "error" ? "text-destructive" : undefined
                    }
                  >
                    {state?.status === "error"
                      ? "Check failed"
                      : (state?.status ?? "pending")}
                  </span>
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={onInspect}
                  >
                    Source details
                    <Info data-icon="inline-end" />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={saved ? "Saved offer" : "Save offer"}
                    onClick={onSave}
                  >
                    {saved ? <Check /> : <Bookmark />}
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              {emptyState === "loading"
                ? "Checking the latest offers…"
                : emptyState === "unavailable"
                  ? "Pricing could not be loaded. Retry with Refresh."
                  : "Choose a GPU or adjust requirements to inspect a matching offer."}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
