"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Activity,
  ArrowDownUp,
  ArrowUp,
  ArrowDown,
  ArrowUpRight,
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Download,
  Info,
  RefreshCw,
  Search,
  Share2,
  SlidersHorizontal,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { track } from "@databuddy/sdk";
import { useQueryStates } from "nuqs";
import { NuqsAdapter } from "nuqs/adapters/react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { providers, unverifiedProviders } from "@/lib/catalog";
import {
  initialFilters,
  filterParsers,
  viewParsers,
  serializeMarket,
  type Filters,
} from "@/lib/market-filters";
import {
  hardwareVariant,
  hardwareLabel,
  offerCharacteristics,
} from "@/lib/offer-characteristics";
import { OfferCaveats } from "@/components/offer-caveats";
import { matchesMarketRequirements } from "@/lib/market-selection";
import { gpuFamily as family } from "@/lib/gpu-family";
import { ProviderPriceChart } from "@/components/provider-price-chart";
import { OfferPanel } from "@/components/offer-panel";
import { ProviderLogo } from "@/components/provider-logo";
import { PriceMonitor } from "@/components/price-monitor";
import {
  isFresh,
  type HistoryPoint,
  type MarketHistory,
  type Rate,
  type Snapshot,
} from "@/lib/types";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sidebar,
  SidebarProvider,
  SidebarHeader,
  SidebarContent,
} from "@/components/ui/sidebar";
import { useMediaQuery } from "@/hooks/use-mobile";
import { MarketSearch } from "@/components/market-search";
import { MarketTicker } from "@/components/market-ticker";
import { cn } from "@/lib/utils";
import {
  compareRates,
  compareValues,
  nextSort,
  rateSortOptions,
  type RateSortKey,
  type SortState,
} from "@/lib/table-sorting";

function SortButton({
  label,
  active,
  direction,
  onClick,
}: {
  label: string;
  active: boolean;
  direction: "asc" | "desc";
  onClick: () => void;
}) {
  const Icon = active
    ? direction === "asc"
      ? ArrowUp
      : ArrowDown
    : ArrowDownUp;
  return (
    <Button
      variant="ghost"
      size="xs"
      className="-ml-1"
      aria-label={`Sort by ${label}`}
      aria-pressed={active}
      aria-description={
        active
          ? `Sorted ${direction === "asc" ? "ascending" : "descending"}`
          : undefined
      }
      title={`${label}: ${active && direction === "asc" ? "descending" : "ascending"}`}
      onClick={onClick}
    >
      {label}
      <Icon data-icon="inline-end" aria-hidden="true" />
    </Button>
  );
}
function sortAria<K extends string>(sort: SortState<K>, ...keys: K[]) {
  return keys.includes(sort.key)
    ? sort.direction === "asc"
      ? ("ascending" as const)
      : ("descending" as const)
    : undefined;
}
const coverageLabels: Record<string, string> = {
  ok: "Rates collected",
  "no-rates": "No public rates",
  error: "Check failed",
  pending: "Pending",
  "not-applicable": "Inference only",
  unverified: "Unverified",
};
type CoverageSortKey = "name" | "status" | "rates" | "checked" | "message";
const comparisonFields: { key: RateSortKey; label: string }[] = [
  { key: "gpu", label: "GPU" },
  { key: "memory", label: "GPU VRAM" },
  { key: "vcpus", label: "vCPUs" },
  { key: "ram", label: "Host RAM" },
  { key: "billing", label: "Billing" },
  { key: "price", label: "Per GPU /hr" },
  { key: "count", label: "Required GPUs" },
  { key: "total", label: "Minimum /hr" },
  { key: "region", label: "Region" },
  { key: "availability", label: "Stock" },
  { key: "priceType", label: "Price type" },
  { key: "checked", label: "Observed" },
];

const providerMap = new Map(providers.map((p) => [p.id, p]));
function money(value: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: value < 0.01 ? 8 : value < 0.1 ? 4 : 2,
  }).format(value);
}
function ago(at: string | null, now: number) {
  if (!at) return "Not checked";
  const minutes = Math.max(0, Math.floor((now - Date.parse(at)) / 60000));
  return minutes < 1
    ? "Just now"
    : minutes < 60
      ? `${minutes}m ago`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)}h ago`
        : `${Math.floor(minutes / 1440)}d ago`;
}
function Dropdown({
  id,
  label,
  value,
  values,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  values: { value: string; label: string }[];
  onChange: (s: string) => void;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        value={value}
        onValueChange={(v) => onChange(v ?? "all")}
        items={values}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {values.map((v) => (
              <SelectItem key={v.value} value={v.value}>
                {v.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
}
const options = (all: string, values: string[]) => [
  { value: "all", label: all },
  ...values.map((value) => ({ value, label: value })),
];
function AttributionLinks({ className }: { className: string }) {
  return (
    <nav className={`attribution-links ${className}`} aria-label="Project links">
      <a
        className="context-attribution"
        href="https://context.dev/"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Powered by Context.dev"
      >
        <Image src="/context-dev-symbol-white.svg" alt="" width={18} height={18} unoptimized />
        <span>Context.dev</span>
      </a>
      <a
        className="source-attribution"
        href="https://github.com/context-dot-dev/gpu-terminal"
        target="_blank"
        rel="noopener noreferrer"
      >
        <svg aria-hidden="true" viewBox="0 0 32 32" fill="currentColor">
          <path fillRule="evenodd" d="M16 0C7.16 0 0 7.16 0 16c0 7.08 4.58 13.06 10.94 15.18.8.14 1.1-.34 1.1-.76 0-.38-.02-1.64-.02-2.98-4.02.74-5.06-.98-5.38-1.88-.18-.46-.96-1.88-1.64-2.26-.56-.3-1.36-1.04-.02-1.06 1.26-.02 2.16 1.16 2.46 1.64 1.44 2.42 3.74 1.74 4.66 1.32.14-1.04.56-1.74 1.02-2.14-3.56-.4-7.28-1.78-7.28-7.9 0-1.74.62-3.18 1.64-4.3-.16-.4-.72-2.04.16-4.24 0 0 1.34-.42 4.4 1.64 1.28-.36 2.64-.54 4-.54s2.72.18 4 .54c3.06-2.08 4.4-1.64 4.4-1.64.88 2.2.32 3.84.16 4.24 1.02 1.12 1.64 2.54 1.64 4.3 0 6.14-3.74 7.5-7.3 7.9.58.5 1.08 1.46 1.08 2.96 0 2.14-.02 3.86-.02 4.4 0 .42.3.92 1.1.76C27.42 29.06 32 23.06 32 16 32 7.16 24.84 0 16 0Z" />
        </svg>
        <span>Open source</span>
      </a>
    </nav>
  );
}
export function Dashboard({
  initial,
  initialQuery = "",
  initialHistory,
}: {
  initial: Snapshot;
  initialQuery?: string;
  initialHistory?: MarketHistory;
}) {
  // The proxy supplies a stable query for each cached page. The React adapter
  // hydrates that query without suspending the terminal behind useSearchParams.
  return (
    <NuqsAdapter serverSearch={initialQuery}>
      <MarketDashboard initial={initial} initialHistory={initialHistory} />
    </NuqsAdapter>
  );
}

function MarketDashboard({
  initial,
  initialHistory,
}: {
  initial: Snapshot;
  initialHistory?: MarketHistory;
}) {
  const [snapshot, setSnapshot] = useState(initial);
  const [filters, updateFilters] = useQueryStates(filterParsers, {
    history: "push",
    shallow: true,
    scroll: false,
  });
  const [view, updateView] = useQueryStates(viewParsers, {
    history: "push",
    shallow: true,
    scroll: false,
  });
  const { tab, coverageQuery, coverageStatus } = view;
  const query = serializeMarket({ ...filters, ...view });
  function setTab(tab: typeof view.tab) {
    void updateView({ tab });
  }
  function setCoverageQuery(coverageQuery: string) {
    void updateView({ coverageQuery }, { history: "replace" });
  }
  function setCoverageStatus(coverageStatus: string) {
    void updateView({
      coverageStatus: viewParsers.coverageStatus.parse(coverageStatus) ?? "all",
    });
  }
  const [now, setNow] = useState(Date.parse(initial.loadedAt));
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const refreshInFlight = useRef(false);
  const marketPane = useRef<HTMLElement>(null);
  const [sort, setSort] = useState<SortState<RateSortKey>>({
    key: "price",
    direction: "asc",
  });
  const [coverageSort, setCoverageSort] = useState<SortState<CoverageSortKey>>({
    key: "name",
    direction: "asc",
  });
  const [comparisonSort, setComparisonSort] = useState<SortState<RateSortKey>>({
    key: "provider",
    direction: "asc",
  });
  const [pagination, setPagination] = useState({
    query,
    page: 0,
  });
  const page = pagination.query === query ? pagination.page : 0;
  function setPage(page: number) {
    setPagination({
      query,
      page,
    });
  }
  const [focusedOffer, setFocusedOffer] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [mounted, setMounted] = useState(false);
  const [detail, setDetail] = useState<Rate | null>(null);
  const [compare, setCompare] = useState(false);
  const [method, setMethod] = useState(false);
  const [chartOpen, setChartOpen] = useState(false);
  const compactCharts = useMediaQuery("(max-width: 767px)");
  const wideLayout = useMediaQuery("(min-width: 1280px)");
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [hours, setHours] = useState("100");
  const [shareNotice, setShareNotice] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const stored = JSON.parse(
          localStorage.getItem("gpu-atlas-saved") ?? "[]",
        );
        if (Array.isArray(stored))
          setSaved(stored.filter((x) => typeof x === "string"));
      } catch {
        /* Storage may be disabled by browser policy. */
      }
      setMounted(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  function setFilters(
    update: Filters | ((current: Filters) => Filters),
    mode: "push" | "replace" = "push",
  ) {
    void updateFilters(update, { history: mode });
    setPage(0);
  }

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setRefreshing(true);
    try {
      const response = await fetch("/api/prices", {
        signal: AbortSignal.timeout(25000),
      });
      if (!response.ok) throw new Error();
      const data: Snapshot = await response.json();
      if (data.error || !Array.isArray(data.providers)) throw new Error();
      setSnapshot(data);
      setNow(Date.now());
      setRefreshError("");
    } catch {
      setRefreshError(
        "Could not load the latest snapshot. The last received data remains visible with its original timestamps.",
      );
    } finally {
      refreshInFlight.current = false;
      setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    const sync = () => {
      setNow(Date.now());
      if (document.visibilityState === "visible") void refresh();
    };
    const initialSync = setTimeout(sync, 0);
    const timer = setInterval(sync, 600000);
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("online", sync);
    return () => {
      clearTimeout(initialSync);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("online", sync);
    };
  }, [refresh]);
  useEffect(() => {
    if (!detail) return;
    const controller = new AbortController();
    fetch(`/api/history?provider=${detail.providerId}&id=${detail.id}`, {
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const data = await r.json();
        setHistory(data.points);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setHistoryError(
            "History could not be loaded. Please reopen this offer to retry.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setHistoryLoading(false);
      });
    return () => controller.abort();
  }, [detail]);

  const rates = useMemo(
    () => snapshot.providers.flatMap((p) => p.rates),
    [snapshot],
  );
  const healthy = snapshot.providers.filter(
    (p) =>
      p.status === "ok" &&
      p.observedAt &&
      isFresh(p.observedAt, providerMap.get(p.id)!.intervalMinutes, now),
  );
  const liveRates = rates.filter((r) =>
    isFresh(r.observedAt, providerMap.get(r.providerId)!.intervalMinutes, now),
  );
  const matchingRates = useMemo(
    () =>
      rates.filter(
        (r) =>
          matchesMarketRequirements(r, filters, now) &&
          (tab !== "saved" || saved.includes(r.id)),
      ),
    [rates, filters, tab, saved, now],
  );
  const filtered = useMemo(
    () =>
      matchingRates
        .filter(
          (r) =>
            (filters.gpu === "all" || r.gpu === filters.gpu) &&
            (filters.family === "all" || family(r.gpu) === filters.family),
        )
        .sort((a, b) => compareRates(a, b, sort)),
    [matchingRates, filters.gpu, filters.family, sort],
  );
  const emptyState = refreshing
    ? "loading"
    : snapshot.error || (refreshError && !rates.length)
      ? "unavailable"
      : "ready";
  const pageCount = Math.max(1, Math.ceil(filtered.length / 25));
  const actualPage = Math.min(page, pageCount - 1);
  const shown = filtered.slice(actualPage * 25, (actualPage + 1) * 25);
  const focusedRate =
    filtered.find((r) => r.id === focusedOffer) ??
    [...filtered]
      .filter((r) => r.availability !== "Unavailable")
      .sort((a, b) => a.hourly - b.hourly)[0] ??
    filtered[0];
  const chartFocusedId =
    filtered.some((rate) => rate.id === focusedOffer)
      ? focusedOffer
      : filters.provider !== "all"
        ? (focusedRate?.id ?? "")
        : "";
  const compared = rates
    .filter((r) => selected.includes(r.id))
    .sort((a, b) => compareRates(a, b, comparisonSort));
  const coverageRows = [
    ...providers.map((p) => {
      const state = snapshot.providers.find((s) => s.id === p.id);
      return {
        id: p.id,
        name: p.name,
        aliases: p.aliases ?? [],
        provider: p,
        status: state?.status ?? "pending",
        rates: state?.rates.length ?? 0,
        checked:
          p.trackingScope === "inference-api"
            ? null
            : (state?.checkedAt ?? null),
        message: state?.message ?? "First check pending",
      };
    }),
    ...unverifiedProviders.map((p) => ({
      id: p.name,
      name: p.name,
      aliases: [],
      provider: null,
      status: "unverified",
      rates: null,
      checked: null,
      message: p.reason,
    })),
  ]
    .filter(
      (p) =>
        [p.name, ...p.aliases]
          .join(" ")
          .toLowerCase()
          .includes(coverageQuery.toLowerCase()) &&
        (coverageStatus === "all" || p.status === coverageStatus),
    )
    .sort((a, b) => {
      const value = (p: typeof a) =>
        coverageSort.key === "status"
          ? coverageLabels[p.status]
          : coverageSort.key === "checked"
            ? p.checked
              ? Date.parse(p.checked)
              : null
            : p[coverageSort.key];
      return (
        compareValues(value(a), value(b), coverageSort.direction) ||
        a.id.localeCompare(b.id)
      );
    });
  const gpuNames = [...new Set(rates.map((r) => r.gpu))].sort();
  const regions = [...new Set(rates.map((r) => r.region))].sort();
  const counts = [
    ...new Set(
      rates.map((r) => r.gpuCount).filter((n): n is number => n !== null),
    ),
  ].sort((a, b) => a - b);
  const activeCount = Object.entries(filters).filter(
    ([key, v]) => v !== initialFilters[key as keyof Filters],
  ).length;
  function changeSort(key: RateSortKey) {
    setSort((current) => nextSort(current, key));
    setPage(0);
  }
  function offerSortButton(label: string, key: RateSortKey) {
    return (
      <SortButton
        label={label}
        active={sort.key === key}
        direction={sort.direction}
        onClick={() => changeSort(key)}
      />
    );
  }
  function setFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters(
      (f) => ({ ...f, [key]: value }),
      ["query", "budget", "totalBudget"].includes(key) ? "replace" : "push",
    );
  }
  function changePage(nextPage: number) {
    setPage(nextPage);
    marketPane.current
      ?.querySelector('[data-slot="table-container"]')
      ?.scrollIntoView({ block: "start" });
  }
  function inspectRate(rate: Rate) {
    setHistory([]);
    setHistoryLoading(true);
    setHistoryError("");
    setDetail(rate);
  }
  function toggleSaved(id: string) {
    const isSaved = saved.includes(id);
    const next = isSaved
      ? saved.filter((s) => s !== id)
      : [...saved, id];
    setSaved(next);
    if (!isSaved) track("offer_saved");
    try {
      localStorage.setItem("gpu-atlas-saved", JSON.stringify(next));
    } catch {
      setShareNotice(
        "Browser storage is unavailable; saved offers will last for this visit.",
      );
    }
  }
  function exportCsv() {
    const keys: (keyof Rate)[] = [
      "providerId",
      "gpu",
      "vramGb",
      "gpuCount",
      "region",
      "plan",
      "billing",
      "currency",
      "hourly",
      "amount",
      "unit",
      "priceType",
      "availability",
      "observedAt",
      "sourceUrl",
      "notes",
      "evidence",
    ];
    const cell = (v: unknown) =>
      `"${String(v ?? "")
        .replace(/^[\s]*[=+@-]/, "'$&")
        .replaceAll('"', '""')}"`;
    const csv = [
      [
        ...keys,
        "hardwareVariant",
        "capacity",
        "deployment",
        "interruptionPolicy",
        "localStorage",
        "priority",
        "caveats",
        "caveatSources",
      ].join(","),
      ...filtered.map((r) => {
        const traits = offerCharacteristics(r);
        return [
          ...keys.map((k) => r[k]),
          hardwareVariant(r),
          traits.supply,
          traits.execution,
          traits.interruptible ? "Interruptible" : "Not specified",
          traits.ephemeral ? "Ephemeral" : "Not specified",
          traits.priority,
          traits.caveats.join("; "),
          traits.sources.map((s) => s.url).join("; "),
        ]
          .map(cell)
          .join(",");
      }),
    ].join("\r\n");
    const url = URL.createObjectURL(
      new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `gpu-terminal-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    track("csv_exported");
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function share() {
    try {
      const url = new URL(window.location.href);
      url.search = serializeMarket(new URLSearchParams(url.search), {
        ...filters,
        ...view,
      });
      await navigator.clipboard.writeText(url.href);
      setShareNotice("Filter link copied");
    } catch {
      setShareNotice(
        "Your filters are saved in the address bar. Copy the URL to share.",
      );
    }
  }

  const filtersUI = (prefix: string) => (
    <FieldGroup className="gap-3">
      <Dropdown
        id={prefix + "-family-filter"}
        label="GPU family"
        value={filters.family}
        values={options(
          "All families",
          [...new Set(rates.map((r) => family(r.gpu)))].sort(
            (a, b) =>
              a === "H100" ? -1 : b === "H100" ? 1 : a.localeCompare(b),
          ),
        )}
        onChange={(v) => {
          setFilters((f) => ({ ...f, family: v, gpu: "all" }));
        }}
      />
      <Dropdown
        id={prefix + "-gpu-filter"}
        label="GPU model"
        value={filters.gpu}
        values={options("All GPUs", gpuNames)}
        onChange={(v) => setFilter("gpu", v)}
      />
      <Dropdown
        id={prefix + "-variant-filter"}
        label="Hardware variant"
        value={filters.variant}
        values={options("All variants", [
          "SXM",
          "SXM4",
          "SXM5",
          "PCIe",
          "NVL",
          "Not specified",
        ])}
        onChange={(v) => setFilter("variant", v)}
      />
      <Dropdown
        id={prefix + "-exact-memory-filter"}
        label="Exact VRAM"
        value={filters.exactMemory}
        values={[
          { value: "all", label: "Any memory size" },
          ...Array.from(
            new Set(
              rates.flatMap((r) => (r.vramGb === null ? [] : [r.vramGb])),
            ),
          )
            .sort((a, b) => a - b)
            .map((n) => ({ value: String(n), label: `${n} GB exactly` })),
          { value: "unknown", label: "Not specified" },
        ]}
        onChange={(v) => setFilter("exactMemory", v)}
      />
      <Dropdown
        id={prefix + "-community-filter"}
        label="Community capacity"
        value={filters.community}
        values={[
          { value: "all", label: "Include all capacity" },
          { value: "exclude", label: "Exclude known community" },
          { value: "only", label: "Community only" },
        ]}
        onChange={(v) => setFilter("community", v)}
      />
      <Dropdown
        id={prefix + "-interruption-filter"}
        label="Interruption risk"
        value={filters.interruption}
        values={[
          { value: "all", label: "All interruption policies" },
          { value: "exclude", label: "Exclude known interruptible" },
          { value: "only", label: "Interruptible only" },
          { value: "unknown", label: "Not specified" },
        ]}
        onChange={(v) => setFilter("interruption", v)}
      />
      <Dropdown
        id={prefix + "-execution-filter"}
        label="Deployment"
        value={filters.execution}
        values={options("All deployment types", [
          "Container",
          "Serverless",
          "Not specified",
        ])}
        onChange={(v) => setFilter("execution", v)}
      />
      <Dropdown
        id={prefix + "-storage-filter"}
        label="Local storage"
        value={filters.storage}
        values={[
          { value: "all", label: "All storage policies" },
          { value: "exclude", label: "Exclude known ephemeral" },
        ]}
        onChange={(v) => setFilter("storage", v)}
      />
      <Dropdown
        id={prefix + "-priority-filter"}
        label="Priority tier"
        value={filters.priority}
        values={options("All priority tiers", [
          "High",
          "Medium",
          "Low",
          "Lowest",
          "Not specified",
        ])}
        onChange={(v) => setFilter("priority", v)}
      />
      <p className="text-xs text-muted-foreground">
        Exclusions remove known caveats. Unspecified policies are not
        guarantees.
      </p>
      <Dropdown
        id={prefix + "-method-filter"}
        label="Collection method"
        value={filters.method}
        values={options("All methods", [
          "Provider API",
          "Table parser",
          "Source extraction",
        ])}
        onChange={(v) => setFilter("method", v)}
      />
      <Dropdown
        id={prefix + "-memory-filter"}
        label="Memory per GPU"
        value={filters.memory}
        values={[0, 16, 24, 48, 80, 96, 141, 192].map((n) => ({
          value: String(n),
          label: n ? `${n} GB or more` : "Any memory",
        }))}
        onChange={(v) => setFilter("memory", v)}
      />
      <Dropdown
        id={prefix + "-provider-filter"}
        label="Provider"
        value={filters.provider}
        values={[
          { value: "all", label: "All providers" },
          ...providers
            .map((p) => ({ value: p.id, label: p.name }))
            .sort((a, b) => a.label.localeCompare(b.label)),
        ]}
        onChange={(v) => setFilter("provider", v)}
      />
      <Dropdown
        id={prefix + "-kind-filter"}
        label="Platform type"
        value={filters.kind}
        values={options("All platforms", [
          "GPU cloud",
          "Marketplace",
          "Hyperscaler",
          "Serverless",
        ])}
        onChange={(v) => setFilter("kind", v)}
      />
      <Dropdown
        id={prefix + "-billing-filter"}
        label="Billing model"
        value={filters.billing}
        values={options("All billing models", [
          "On-demand",
          "Spot",
          "Committed",
          "Serverless",
          "Unspecified",
        ])}
        onChange={(v) => setFilter("billing", v)}
      />
      <Dropdown
        id={prefix + "-region-filter"}
        label="Region"
        value={filters.region}
        values={options("Any region", regions)}
        onChange={(v) => setFilter("region", v)}
      />
      <Dropdown
        id={prefix + "-count-filter"}
        label="Required GPU count"
        value={filters.count}
        values={options("Any configuration", counts.map(String))}
        onChange={(v) => setFilter("count", v)}
      />
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel htmlFor={prefix + "-budget-filter"}>
            Max /GPU/hr
          </FieldLabel>
          <Input
            id={prefix + "-budget-filter"}
            type="number"
            min="0"
            step="0.1"
            placeholder="No limit"
            value={filters.budget}
            onChange={(e) => setFilter("budget", e.target.value)}
          />
        </Field>
        <Dropdown
          id={prefix + "-currency-filter"}
          label="Currency"
          value={filters.currency}
          values={Array.from(
            new Set(["USD", ...rates.map((rate) => rate.currency)]),
          )
            .sort()
            .map((v) => ({
              value: v,
              label: v,
            }))}
          onChange={(v) => setFilter("currency", v)}
        />
      </div>
      <Field>
        <FieldLabel htmlFor={prefix + "-total-budget"}>
          Max configuration /hr
        </FieldLabel>
        <Input
          id={prefix + "-total-budget"}
          type="number"
          min="0"
          step="1"
          placeholder="No limit"
          value={filters.totalBudget}
          onChange={(e) => setFilter("totalBudget", e.target.value)}
        />
      </Field>
      <Field orientation="horizontal">
        <Checkbox
          id={prefix + "-fresh"}
          aria-label="Within refresh window"
          checked={filters.fresh}
          onCheckedChange={(v) => setFilter("fresh", v === true)}
        />
        <FieldLabel htmlFor={prefix + "-fresh"}>
          Within refresh window
        </FieldLabel>
      </Field>
      <Field orientation="horizontal">
        <Checkbox
          id={prefix + "-exact"}
          aria-label="Exclude starting at prices"
          checked={filters.exact}
          onCheckedChange={(v) => setFilter("exact", v === true)}
        />
        <FieldLabel htmlFor={prefix + "-exact"}>
          Exclude “starting at” prices
        </FieldLabel>
      </Field>
      <Field orientation="horizontal">
        <Checkbox
          id={prefix + "-available"}
          aria-label="Explicitly in stock only"
          checked={filters.available}
          onCheckedChange={(v) => setFilter("available", v === true)}
        />
        <FieldLabel htmlFor={prefix + "-available"}>
          Explicitly in stock only
        </FieldLabel>
      </Field>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Unknown memory, region and stock stay unknown. Currency is never
        silently converted.
      </p>
    </FieldGroup>
  );

  return (
    <Tabs
      className="terminal gap-0"
      value={tab}
      onValueChange={(v) => {
        setTab(viewParsers.tab.parse(String(v)) ?? "explore");
        setPage(0);
      }}
    >
      <MarketTicker
        snapshot={snapshot}
        rates={liveRates}
        family={filters.family}
        currency={filters.currency}
        onFamilyChange={(value) => {
          setFilters((f) => ({ ...f, family: value, gpu: "all" }));
        }}
      />

      <header className="terminal-masthead">
        <Link
          href="/"
          aria-label="gpu-terminal COMPUTE MARKETS"
          prefetch={false}
          onClick={(event) => {
            if (
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            )
              return;
            event.preventDefault();
            void updateFilters(null);
            void updateView(null);
            setPage(0);
            setFocusedOffer("");
            setSelected([]);
          }}
          className={cn(buttonVariants({ variant: "ghost" }), "masthead-brand")}
        >
          <Cpu data-icon="inline-start" strokeWidth={1.2} />
          <span>gpu-terminal</span>
        </Link>
        <MarketSearch
          rates={rates}
          onSearch={(query) => {
            setFilters({ ...initialFilters, family: "all", query });
            setTab("explore");
            setPage(0);
          }}
          onProvider={(provider) => {
            if (providerMap.get(provider)?.trackingScope === "inference-api") {
              setCoverageQuery(providerMap.get(provider)!.name);
              setCoverageStatus("all");
              setTab("coverage");
              return;
            }
            setFilters({ ...initialFilters, family: "all", provider });
            setTab("explore");
            setPage(0);
          }}
          onGpu={(family) => {
            setFilters({ ...initialFilters, family });
            setTab("explore");
            setPage(0);
          }}
          onNavigate={setTab}
        />
        <TabsList className="masthead-nav" aria-label="Main navigation">
          {(
            [
              ["explore", "Explore prices"],
              ["saved", saved.length ? `Saved (${saved.length})` : "Saved"],
              ["coverage", "Coverage"],
            ] as const
          ).map(([value, label]) => (
            <TabsTrigger
              key={value}
              value={value}
              nativeButton={false}
              render={
                <a
                  href={serializeMarket("/", {
                    ...filters,
                    ...view,
                    tab: value,
                  })}
                />
              }
              onClick={(event) => {
                event.preventBaseUIHandler();
                if (
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                )
                  return;
                event.preventDefault();
                setTab(value);
                setPage(0);
              }}
            >
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="masthead-actions flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            aria-label="Methodology"
            onClick={() => setMethod(true)}
          >
            <Info data-icon="inline-start" />
            <span className="hidden sm:inline">Methodology</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={refresh}
            disabled={refreshing}
            aria-label={refreshing ? "Updating" : "Refresh"}
          >
            <RefreshCw
              data-icon="inline-start"
              className={refreshing ? "animate-spin" : ""}
            />
            <span className="hidden sm:inline">
              {refreshing ? "Updating" : "Refresh"}
            </span>
          </Button>
        </div>
        <AttributionLinks className="masthead-attribution" />
      </header>
      <main className="terminal-main flex flex-col gap-2 px-2 pb-2 pt-2">
        <h1 className="sr-only">GPU market monitor</h1>
        {(snapshot.error || refreshError) && (
          <Alert variant="destructive">
            <AlertTitle>Data connection interrupted</AlertTitle>
            <AlertDescription>
              {snapshot.error || refreshError}
            </AlertDescription>
          </Alert>
        )}
        <div className="terminal-workspace flex flex-col gap-2">
          <div className="market-utilities flex flex-wrap items-center justify-between gap-2">
            <Badge variant="secondary" className="market-freshness">
              <span
                className={cn(
                  "size-1.5 rounded-full bg-muted-foreground",
                  mounted && healthy.length && "bg-success",
                )}
              />
              {mounted ? `${healthy.length} fresh sources` : "Cached snapshot"}
            </Badge>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={share}>
                Share filters
                <Share2 data-icon="inline-end" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={exportCsv}
                disabled={!filtered.length}
              >
                <Download data-icon="inline-start" />
                Export CSV
              </Button>
            </div>
          </div>
          {shareNotice && (
            <p role="status" className="mt-2 text-xs text-muted-foreground">
              {shareNotice}
            </p>
          )}
          {["explore", "saved"].map((view) => (
            <TabsContent key={view} value={view} className="market-tab mt-2">
              <SidebarProvider className="market-layout min-h-0">
                <Sidebar collapsible="none" className="filter-sidebar">
                  <SidebarHeader className="flex-row items-center justify-between">
                    <h2 className="flex items-center gap-2 text-sm font-medium">
                      <SlidersHorizontal className="size-4" />
                      Filters
                      {activeCount > 0 && (
                        <Badge variant="secondary">{activeCount}</Badge>
                      )}
                    </h2>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => {
                        setFilters(initialFilters);
                        setPage(0);
                      }}
                    >
                      Reset
                    </Button>
                  </SidebarHeader>
                  <SidebarContent
                    role="region"
                    aria-label="Filter options"
                    tabIndex={0}
                    className="filter-pane hidden xl:flex px-3 pb-3"
                  >
                    {filtersUI(view + "-desktop")}
                  </SidebarContent>
                </Sidebar>
                <div className="terminal-content">
                  <Sidebar
                    collapsible="none"
                    side="right"
                    className="offer-sidebar hidden xl:flex"
                  >
                    <SidebarContent
                      role="region"
                      aria-label="Selected offer and provider prices"
                      tabIndex={0}
                      className="offer-rail"
                    >
                      <OfferPanel
                        rate={focusedRate}
                        emptyState={emptyState}
                        states={snapshot.providers}
                        now={now}
                        saved={!!focusedRate && saved.includes(focusedRate.id)}
                        onSave={() => {
                          if (focusedRate) toggleSaved(focusedRate.id);
                        }}
                        onInspect={() => {
                          if (focusedRate) inspectRate(focusedRate);
                        }}
                      />
                      {wideLayout && (
                        <ProviderPriceChart
                          emptyState={emptyState}
                          rates={filtered}
                          activeId={focusedRate?.id ?? ""}
                          onFocus={(rate) => setFocusedOffer(rate.id)}
                          currency={filters.currency}
                        />
                      )}
                    </SidebarContent>
                  </Sidebar>

                  <section
                    ref={tab === view ? marketPane : undefined}
                    role="region"
                    aria-label="Market workspace"
                    tabIndex={0}
                    className="market-pane"
                  >
                    <div className="history-pane">
                      {tab === view && !compactCharts && (
                        <PriceMonitor
                          initialHistory={initialHistory}
                          rates={filtered}
                          comparisonRates={matchingRates}
                          emptyState={emptyState}
                          loadedAt={snapshot.loadedAt}
                          gpu={
                            filters.gpu !== "all" ? filters.gpu : filters.family
                          }
                          currency={filters.currency}
                          activeId={focusedRate?.id ?? ""}
                          highlightedId={chartFocusedId}
                          onFocus={(rate) => setFocusedOffer(rate.id)}
                        />
                      )}
                    </div>
                    <div className="workspace-tools">
                      <Sheet open={chartOpen} onOpenChange={setChartOpen}>
                        <Button
                          className="compact-chart-trigger"
                          variant="secondary"
                          size="sm"
                          render={<SheetTrigger />}
                        >
                          <Activity /> Show price history
                        </Button>
                        <SheetContent className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-3xl [&>[data-slot=card]]:shrink-0">
                          <SheetHeader>
                            <SheetTitle>GPU price history</SheetTitle>
                            <SheetDescription>
                              Recorded prices and comparisons.
                            </SheetDescription>
                          </SheetHeader>
                          {chartOpen && tab === view && (
                            <PriceMonitor
                              initialHistory={initialHistory}
                              rates={filtered}
                              comparisonRates={matchingRates}
                              emptyState={emptyState}
                              loadedAt={snapshot.loadedAt}
                              gpu={
                                filters.gpu !== "all"
                                  ? filters.gpu
                                  : filters.family
                              }
                              currency={filters.currency}
                              activeId={focusedRate?.id ?? ""}
                              highlightedId={chartFocusedId}
                              onFocus={(rate) => setFocusedOffer(rate.id)}
                            />
                          )}
                          {chartOpen && tab === view && (
                            <ProviderPriceChart
                              emptyState={emptyState}
                              rates={filtered}
                              activeId={focusedRate?.id ?? ""}
                              onFocus={(rate) => setFocusedOffer(rate.id)}
                              currency={filters.currency}
                            />
                          )}
                        </SheetContent>
                      </Sheet>
                      <div className="mobile-filter-trigger">
                        <Sheet>
                          <Button variant="outline" render={<SheetTrigger />}>
                            Configure filters
                            <SlidersHorizontal data-icon="inline-end" />
                          </Button>
                          <SheetContent side="left" className="overflow-y-auto">
                            <SheetHeader>
                              <SheetTitle>Filter GPU prices</SheetTitle>
                              <SheetDescription>
                                Find the configuration that fits your workload.
                              </SheetDescription>
                            </SheetHeader>
                            <div className="px-4 pb-6">
                              {filtersUI(view + "-mobile")}
                            </div>
                          </SheetContent>
                        </Sheet>
                      </div>
                    </div>
                    <div className="offers-heading flex flex-wrap items-center justify-between gap-2">
                      <h2 className="scroll-mt-3 text-sm font-semibold">
                        Matching offers
                      </h2>
                      <span className="text-[10px] text-muted-foreground">
                        {
                          providers.filter(
                            (p) => p.trackingScope === "gpu-hourly",
                          ).length
                        }{" "}
                        sources tracked · {liveRates.length} recent rates
                      </span>
                    </div>
                    <div className="offers-toolbar flex flex-wrap items-center justify-between gap-3">
                      <Field className="max-w-md">
                        <FieldLabel
                          htmlFor={`search-${view}`}
                          className="sr-only"
                        >
                          Search GPU prices
                        </FieldLabel>
                        <Input
                          id={`search-${view}`}
                          placeholder="Search GPUs, providers, regions…"
                          value={filters.query}
                          onChange={(e) => setFilter("query", e.target.value)}
                        />
                      </Field>
                      <div className="flex items-center gap-2">
                        <ArrowDownUp className="size-4 text-muted-foreground" />
                        <Select
                          value={`${sort.key}:${sort.direction}`}
                          onValueChange={(value) => {
                            const option = rateSortOptions.find(
                              (o) => o.value === value,
                            );
                            if (option) {
                              setSort({
                                key: option.key,
                                direction: option.direction,
                              });
                              setPage(0);
                            }
                          }}
                          items={rateSortOptions}
                        >
                          <SelectTrigger aria-label="Sort prices">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {rateSortOptions.map((option) => (
                                <SelectItem
                                  key={option.value}
                                  value={option.value}
                                >
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                      <p aria-live="polite" data-testid="result-count">
                        {!filtered.length && emptyState !== "ready"
                          ? emptyState === "loading"
                            ? "Checking prices…"
                            : "Pricing unavailable"
                          : `${filtered.length} rates · ${new Set(filtered.map((r) => r.providerId)).size} providers`}
                      </p>
                      <span>
                        {filters.currency} per GPU per hour · compute only
                      </span>
                    </div>
                    <Card
                      role="region"
                      aria-label="GPU offers"
                      className="offers-table table-frame py-0"
                    >
                      <CardHeader className="sr-only">
                        <CardTitle>GPU hourly prices</CardTitle>
                        <CardDescription>
                          Normalized rates with original source evidence.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="px-0">
                        {shown.length ? (
                          <Table key={actualPage}>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-10">
                                  <span className="sr-only">Compare</span>
                                </TableHead>
                                <TableHead
                                  aria-sort={sortAria(sort, "gpu", "provider")}
                                >
                                  {offerSortButton("GPU", "gpu")}
                                  {offerSortButton("Provider", "provider")}
                                </TableHead>
                                <TableHead aria-sort={sortAria(sort, "memory")}>
                                  {offerSortButton("GPU VRAM", "memory")}
                                </TableHead>
                                <TableHead
                                  aria-sort={sortAria(sort, "billing")}
                                >
                                  {offerSortButton("Configuration", "billing")}
                                </TableHead>
                                <TableHead aria-sort={sortAria(sort, "price")}>
                                  {offerSortButton("Rate /GPU/hr", "price")}
                                </TableHead>
                                <TableHead
                                  aria-sort={sortAria(sort, "checked")}
                                >
                                  {offerSortButton("Checked", "checked")}
                                </TableHead>
                                <TableHead className="w-10">
                                  <span className="sr-only">Save</span>
                                </TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {shown.map((r) => {
                                const p = providerMap.get(r.providerId)!;
                                const fresh = isFresh(
                                  r.observedAt,
                                  p.intervalMinutes,
                                  now,
                                );
                                return (
                                  <TableRow
                                    key={r.id}
                                    data-testid="price-row"
                                    data-offer-id={r.id}
                                    onClick={() => setFocusedOffer(r.id)}
                                    data-focused={focusedRate?.id === r.id}
                                    className="cursor-pointer data-[focused=true]:bg-accent/60"
                                  >
                                    <TableCell>
                                      <Checkbox
                                        aria-label={`Compare ${p.name} ${r.gpu} ${r.plan}`}
                                        checked={selected.includes(r.id)}
                                        disabled={
                                          selected.length >= 4 &&
                                          !selected.includes(r.id)
                                        }
                                        onCheckedChange={(v) =>
                                          setSelected((s) =>
                                            v
                                              ? [...s, r.id]
                                              : s.filter((id) => id !== r.id),
                                          )
                                        }
                                      />
                                    </TableCell>
                                    <TableCell>
                                      <div className="flex items-center gap-2">
                                        <ProviderLogo
                                          providerId={r.providerId}
                                        />
                                        <div>
                                          <Button
                                            variant="ghost"
                                            className="h-5 justify-start px-1 text-xs"
                                            aria-pressed={
                                              focusedRate?.id === r.id
                                            }
                                            title="Select offer and view price history"
                                            onClick={() => {
                                              setFocusedOffer(r.id);
                                            }}
                                          >
                                            {r.gpu}
                                          </Button>
                                          <a
                                            href={r.sourceUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            onClick={(event) =>
                                              event.stopPropagation()
                                            }
                                            title={`Open ${p.name} pricing in a new tab`}
                                            className={cn(
                                              buttonVariants({
                                                variant: "link",
                                                size: "xs",
                                              }),
                                              "flex h-4 w-fit justify-start gap-1 px-1 text-[10px] font-normal text-muted-foreground hover:text-foreground",
                                            )}
                                          >
                                            {p.name}
                                            <ArrowUpRight className="size-2.5" />
                                          </a>
                                          <div
                                            className="font-mono text-xs font-medium text-foreground sm:hidden"
                                            data-testid="mobile-offer-price"
                                          >
                                            {r.priceType === "Starting at"
                                              ? "from "
                                              : ""}
                                            {money(r.hourly, r.currency)}/GPU/hr
                                          </div>
                                        </div>
                                      </div>
                                    </TableCell>
                                    <TableCell>
                                      <span className="font-mono text-xs">
                                        {r.vramGb
                                          ? `${r.vramGb} GB`
                                          : "Unknown"}
                                      </span>
                                      {(r.vcpus || r.ramGb) && (
                                        <div className="mt-1 text-xs text-muted-foreground">
                                          {[
                                            r.vcpus && `${r.vcpus} vCPUs`,
                                            r.ramGb && `${r.ramGb} GB RAM`,
                                          ]
                                            .filter(Boolean)
                                            .join(" · ")}
                                        </div>
                                      )}
                                      <div className="mt-1 text-xs text-muted-foreground">
                                        {r.gpuCount
                                          ? `${r.gpuCount} GPU${r.gpuCount > 1 ? "s" : ""} required`
                                          : "Count unspecified"}
                                      </div>
                                    </TableCell>
                                    <TableCell>
                                      <Badge variant="secondary">
                                        {r.billing}
                                      </Badge>
                                      <OfferCaveats rate={r} compact />
                                      <div
                                        className="mt-1 max-w-44 truncate text-[10px] text-muted-foreground"
                                        title={`${r.plan} · ${r.region}`}
                                      >
                                        {r.region === "Not specified"
                                          ? r.plan || p.kind
                                          : r.region}
                                      </div>
                                    </TableCell>
                                    <TableCell>
                                      <div className="font-mono text-sm font-medium tabular-nums">
                                        {r.priceType === "Starting at" && (
                                          <span className="mr-1 text-xs font-normal text-muted-foreground">
                                            from
                                          </span>
                                        )}
                                        {money(r.hourly, r.currency)}
                                      </div>
                                      <div className="mt-1 text-xs text-muted-foreground">
                                        {r.gpuCount
                                          ? `${r.priceType === "Starting at" ? "from " : ""}${money(r.hourly * r.gpuCount, r.currency)}/hr configuration`
                                          : "Minimum spend unknown"}
                                      </div>
                                    </TableCell>
                                    <TableCell>
                                      <span
                                        className="text-xs"
                                        title={new Date(
                                          r.observedAt,
                                        ).toUTCString()}
                                      >
                                        {ago(r.observedAt, now)}
                                      </span>
                                      <div className="mt-1">
                                        <Badge
                                          variant={
                                            fresh ? "outline" : "secondary"
                                          }
                                          className={
                                            fresh ? "text-success" : undefined
                                          }
                                        >
                                          {fresh ? "Recent" : "Stale"}
                                        </Badge>
                                      </div>
                                    </TableCell>
                                    <TableCell>
                                      <Button
                                        variant="ghost"
                                        size="icon-xs"
                                        aria-label={`Source details for ${p.name} ${r.gpu}`}
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          setFocusedOffer(r.id);
                                          inspectRate(r);
                                        }}
                                      >
                                        <Info />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label={`${saved.includes(r.id) ? "Unsave" : "Save"} ${p.name} ${r.gpu}`}
                                        onClick={() => toggleSaved(r.id)}
                                      >
                                        {saved.includes(r.id) ? (
                                          <Check />
                                        ) : (
                                          <Bookmark />
                                        )}
                                      </Button>
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        ) : (
                          <Empty className="market-empty p-3">
                            <EmptyHeader>
                              <Search className="size-7 text-muted-foreground" />
                              <EmptyTitle>
                                {view === "saved" && !saved.length
                                  ? "Your shortlist starts here"
                                  : emptyState === "loading"
                                    ? "Checking matching prices…"
                                    : emptyState === "unavailable"
                                      ? "Pricing is temporarily unavailable"
                                      : filters.fresh
                                        ? "No fresh matching rates"
                                        : "No matching rates"}
                              </EmptyTitle>
                              <EmptyDescription>
                                {view === "saved" && !saved.length
                                  ? "Save offers while you compare. Your shortlist stays in this browser."
                                  : emptyState === "loading"
                                    ? "Checking the latest snapshot before reporting results. Your filters are unchanged."
                                    : emptyState === "unavailable"
                                      ? "We could not load pricing data. Retry the snapshot request; this does not mean providers have no offers."
                                      : filters.fresh
                                        ? "No offers in the current snapshot match these filters within their refresh window. You can include older observations with their original timestamps."
                                        : "Try a different GPU, a higher budget, or fewer filters. Unknown stock is excluded when in-stock only is enabled."}
                              </EmptyDescription>
                            </EmptyHeader>
                            {emptyState === "unavailable" && (
                              <Button onClick={() => void refresh()}>
                                Retry loading prices
                              </Button>
                            )}
                            {emptyState === "ready" && filters.fresh && (
                              <Button
                                variant="outline"
                                onClick={() => setFilter("fresh", false)}
                              >
                                Include older observations
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              onClick={() => {
                                setFilters({
                                  ...initialFilters,
                                  family: "all",
                                });
                                setTab("explore");
                              }}
                            >
                              Explore all prices
                            </Button>
                          </Empty>
                        )}
                      </CardContent>
                    </Card>
                    <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                      <p>
                        {filtered.length
                          ? `${actualPage * 25 + 1}–${Math.min((actualPage + 1) * 25, filtered.length)} of ${filtered.length}`
                          : emptyState === "loading"
                            ? "Checking prices…"
                            : emptyState === "unavailable"
                              ? "Results unavailable"
                              : "0 results"}
                      </p>
                      <div className="flex items-center gap-3">
                        <Button
                          variant="outline"
                          size="icon-sm"
                          aria-label="Previous page"
                          disabled={actualPage === 0}
                          onClick={() => changePage(actualPage - 1)}
                        >
                          <ChevronLeft />
                        </Button>
                        <span>
                          Page {actualPage + 1} of {pageCount}
                        </span>
                        <Button
                          variant="outline"
                          size="icon-sm"
                          aria-label="Next page"
                          disabled={actualPage >= pageCount - 1}
                          onClick={() => changePage(actualPage + 1)}
                        >
                          <ChevronRight />
                        </Button>
                      </div>
                    </div>

                    <p className="market-disclaimer max-w-3xl text-xs leading-relaxed text-muted-foreground">
                      Published rates are not a reservation or a guarantee of
                      stock. “From” prices, commitments and serverless usage are
                      different offers. Open a rate for its original quote,
                      exclusions and minimum configuration.
                    </p>
                    {selected.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs">
                          {selected.length} of 4 offers selected
                        </span>
                        <Button
                          size="sm"
                          onClick={() => {
                            setCompare(true);
                            track("comparison_opened");
                          }}
                        >
                          Compare selected
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setSelected([])}
                        >
                          Clear selection
                        </Button>
                      </div>
                    )}
                  </section>
                </div>
              </SidebarProvider>
            </TabsContent>
          ))}
          <TabsContent value="coverage" className="coverage-tab">
            <div className="coverage-layout">
              <div>
                <h2 className="text-xl font-semibold tracking-tight">
                  Provider coverage
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Successful checks, missing public rates and collection
                  failures are all visible here.
                </p>
              </div>
              <FieldGroup className="grid max-w-2xl gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="coverage-search">
                    Find a provider
                  </FieldLabel>
                  <Input
                    id="coverage-search"
                    value={coverageQuery}
                    onChange={(e) => setCoverageQuery(e.target.value)}
                    placeholder="Provider name…"
                  />
                </Field>
                <Dropdown
                  id="coverage-status"
                  label="Collection status"
                  value={coverageStatus}
                  onChange={setCoverageStatus}
                  values={options("All statuses", [
                    "ok",
                    "no-rates",
                    "error",
                    "pending",
                    "not-applicable",
                    "unverified",
                  ])}
                />
              </FieldGroup>
              <Card
                role="region"
                aria-label="Provider coverage table"
                className="table-frame py-0"
              >
                <CardHeader className="sr-only">
                  <CardTitle>Provider coverage</CardTitle>
                </CardHeader>
                <CardContent className="px-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {(
                          [
                            ["name", "Provider"],
                            ["status", "Collection"],
                            ["rates", "Rates"],
                            ["checked", "Last attempt"],
                            ["message", "Details"],
                          ] as const
                        ).map(([key, label]) => (
                          <TableHead
                            key={key}
                            aria-sort={sortAria(coverageSort, key)}
                          >
                            <SortButton
                              label={label}
                              active={coverageSort.key === key}
                              direction={coverageSort.direction}
                              onClick={() =>
                                setCoverageSort((current) =>
                                  nextSort(current, key),
                                )
                              }
                            />
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {coverageRows.map((row) => {
                        const p = row.provider;
                        return (
                          <TableRow key={row.id}>
                            <TableCell>
                              {p ? (
                                <a
                                  href={p.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  title={`Open ${p.name} in a new tab`}
                                  className={buttonVariants({
                                    variant: "link",
                                  })}
                                >
                                  <ProviderLogo providerId={p.id} />
                                  {p.name}
                                  <ArrowUpRight data-icon="inline-end" />
                                </a>
                              ) : (
                                <span className="font-medium">{row.name}</span>
                              )}
                              <div
                                className={cn(
                                  "text-xs text-muted-foreground",
                                  p && "pl-2.5",
                                )}
                              >
                                {p
                                  ? p.trackingScope === "inference-api"
                                    ? "Inference API"
                                    : p.kind
                                  : "Directory entry"}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  row.status === "error"
                                    ? "destructive"
                                    : row.status === "unverified"
                                      ? "outline"
                                      : "secondary"
                                }
                              >
                                {coverageLabels[row.status]}
                              </Badge>
                            </TableCell>
                            <TableCell>{row.rates ?? "—"}</TableCell>
                            <TableCell>
                              <span className="text-xs">
                                {!p || p.trackingScope === "inference-api"
                                  ? "Not collected"
                                  : ago(row.checked, now)}
                              </span>
                              {p && (
                                <div className="text-xs text-muted-foreground">
                                  {p.trackingScope === "inference-api"
                                    ? "Directory entry"
                                    : row.status === "no-rates" && !row.rates
                                      ? "Target: every 6h"
                                      : `Target: every ${p.intervalMinutes < 60 ? `${p.intervalMinutes}m` : `${p.intervalMinutes / 60}h`}`}
                                </div>
                              )}
                            </TableCell>
                            <TableCell>
                              <p className="max-w-lg whitespace-normal text-xs leading-relaxed text-muted-foreground">
                                {row.message}
                              </p>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-3 pt-2 text-xs text-muted-foreground">
          <span>
            Collection every 30m · Auto-sync 10m · Snapshot{" "}
            {mounted
              ? ago(snapshot.loadedAt, now)
              : snapshot.loadedAt.replace("T", " ").slice(0, 19) + " UTC"}
          </span>
        </footer>
      </main>
      <Sheet
        open={!!detail}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
      >
        <SheetContent className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
          {detail && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <ProviderLogo providerId={detail.providerId} />
                  {detail.gpu}
                </SheetTitle>
                <SheetDescription>
                  {providerMap.get(detail.providerId)!.name} · {detail.plan}
                </SheetDescription>
              </SheetHeader>
              <div className="flex flex-col gap-6 px-4 pb-8">
                <div>
                  <p className="font-mono text-4xl tracking-tight">
                    {money(detail.hourly, detail.currency)}
                    <span className="ml-2 text-sm text-muted-foreground">
                      /GPU/hr
                    </span>
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant="secondary">{detail.billing}</Badge>
                    <Badge variant="outline">{detail.priceType}</Badge>
                    <Badge variant="outline">
                      {detail.collectionMethod ?? "Source extraction"}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={
                        detail.availability === "Available"
                          ? "text-success"
                          : detail.availability === "Unavailable"
                            ? "text-destructive"
                            : undefined
                      }
                    >
                      Stock: {detail.availability}
                    </Badge>
                  </div>
                </div>
                <Card>
                  <CardHeader>
                    <CardTitle>What this rate means</CardTitle>
                    <CardDescription>
                      Observed {new Date(detail.observedAt).toUTCString()}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                      <dt className="text-muted-foreground">
                        Published amount
                      </dt>
                      <dd>
                        {money(detail.amount, detail.currency)} /{detail.unit}
                      </dd>
                      <dt className="text-muted-foreground">GPU VRAM per GPU</dt>
                      <dd>
                        {detail.vramGb
                          ? `${detail.vramGb} GB`
                          : "Not specified"}
                      </dd>
                      <dt className="text-muted-foreground">vCPUs</dt>
                      <dd>{detail.vcpus ?? "Not specified"}</dd>
                      <dt className="text-muted-foreground">Host RAM</dt>
                      <dd>
                        {detail.ramGb ? `${detail.ramGb} GB` : "Not specified"}
                      </dd>
                      <dt className="text-muted-foreground">
                        Minimum GPU count
                      </dt>
                      <dd>{detail.gpuCount ?? "Not specified"}</dd>
                      <dt className="text-muted-foreground">
                        Configuration /hr
                      </dt>
                      <dd>
                        {detail.gpuCount
                          ? money(
                              detail.hourly * detail.gpuCount,
                              detail.currency,
                            )
                          : "Unknown"}
                      </dd>
                      <dt className="text-muted-foreground">Region</dt>
                      <dd>{detail.region}</dd>
                      {detail.rawRegion !== undefined &&
                        detail.rawRegion !== detail.region && (
                          <>
                            <dt className="text-muted-foreground">
                              Source region label
                            </dt>
                            <dd className="break-words">
                              {detail.rawRegion || "Not provided"}
                            </dd>
                          </>
                        )}
                    </dl>
                  </CardContent>
                </Card>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="estimate-hours">
                      Estimate runtime (hours)
                    </FieldLabel>
                    <Input
                      id="estimate-hours"
                      type="number"
                      min="1"
                      max="8760"
                      value={hours}
                      onChange={(e) => setHours(e.target.value)}
                    />
                  </Field>
                  <p className="text-sm">
                    {Number(hours) >= 1 && Number(hours) <= 8760
                      ? `${money(detail.hourly * (detail.gpuCount ?? 1) * Number(hours), detail.currency)} for ${detail.gpuCount ? "the minimum configuration" : "one GPU (configuration unknown)"}`
                      : "Enter between 1 and 8,760 hours."}
                  </p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Compute estimate only. Excludes taxes and any separately
                    billed storage, CPU, network or minimum commitments.
                    Serverless estimates assume continuous billable GPU use.
                  </p>
                </FieldGroup>
                <div>
                  <h3 className="mb-2 font-medium">Source evidence</h3>
                  <blockquote className="whitespace-pre-wrap break-words rounded-lg bg-muted p-4 text-xs leading-relaxed">
                    {detail.evidence}
                  </blockquote>
                  <OfferCaveats rate={detail} />
                  {detail.notes && (
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                      {detail.notes}
                    </p>
                  )}
                  <a
                    href={detail.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(buttonVariants(), "mt-4")}
                  >
                    Open provider pricing
                    <ArrowUpRight data-icon="inline-end" />
                  </a>
                </div>
                <div>
                  <h3 className="mb-3 font-medium">
                    Observed price history · 30 days
                  </h3>
                  {historyLoading ? (
                    <Skeleton className="h-36 w-full" />
                  ) : historyError ? (
                    <p className="text-sm text-muted-foreground">
                      {historyError}
                    </p>
                  ) : history.length > 1 ? (
                    <ChartContainer
                      config={{
                        hourly: {
                          label: `${detail.currency} /GPU/hr`,
                          color: "var(--chart-1)",
                        },
                      }}
                      className="h-48 w-full"
                    >
                      <LineChart
                        accessibilityLayer
                        data={history.map((h) => ({
                          ...h,
                          time: new Date(h.at).toLocaleString(),
                        }))}
                      >
                        <CartesianGrid vertical={false} />
                        <XAxis dataKey="time" hide />
                        <YAxis domain={[0, "auto"]} />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Line
                          type="stepAfter"
                          dataKey="hourly"
                          stroke="var(--color-hourly)"
                          strokeWidth={2}
                          dot={history.length < 20}
                        />
                      </LineChart>
                    </ChartContainer>
                  ) : (
                    <Empty>
                      <EmptyHeader>
                        <EmptyTitle>
                          History starts with real observations
                        </EmptyTitle>
                        <EmptyDescription>
                          {history.length} observation recorded. A chart appears
                          after the next successful collection. No synthetic
                          backfill.
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
      <Sheet open={compare} onOpenChange={setCompare}>
        <SheetContent className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-3xl">
          <SheetHeader>
            <SheetTitle>Compare selected offers</SheetTitle>
            <SheetDescription>
              Check hardware, terms and minimum spend together. Different
              currencies are not directly comparable. Click an attribute to sort
              offers; prices are grouped by currency.
            </SheetDescription>
          </SheetHeader>
          <div className="px-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Attribute</TableHead>
                  {compared.map((r) => (
                    <TableHead key={r.id}>
                      <SortButton
                        label={providerMap.get(r.providerId)!.name}
                        active={comparisonSort.key === "provider"}
                        direction={comparisonSort.direction}
                        onClick={() =>
                          setComparisonSort((current) =>
                            nextSort(current, "provider"),
                          )
                        }
                      />
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {comparisonFields.map(({ label, key }, i) => (
                  <TableRow key={key}>
                    <TableCell>
                      <SortButton
                        label={label}
                        active={comparisonSort.key === key}
                        direction={comparisonSort.direction}
                        onClick={() =>
                          setComparisonSort((current) => nextSort(current, key))
                        }
                      />
                    </TableCell>
                    {compared.map((r) => (
                      <TableCell key={r.id}>
                        {
                          [
                            hardwareLabel(r),
                            r.vramGb ? `${r.vramGb} GB` : "Unknown",
                            r.vcpus ?? "Unknown",
                            r.ramGb ? `${r.ramGb} GB` : "Unknown",
                            `${r.billing} · ${offerCharacteristics(r).supply === "Community" ? "Community · " : ""}${offerCharacteristics(r).priority !== "Not specified" ? `${offerCharacteristics(r).priority} priority` : r.plan}`,
                            money(r.hourly, r.currency),
                            r.gpuCount ?? "Unknown",
                            r.gpuCount
                              ? money(r.hourly * r.gpuCount, r.currency)
                              : "Unknown",
                            r.region,
                            r.availability,
                            r.priceType,
                            ago(r.observedAt, now),
                          ][i]
                        }
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </SheetContent>
      </Sheet>
      <Sheet open={method} onOpenChange={setMethod}>
        <SheetContent className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>How gpu-terminal compares prices</SheetTitle>
            <SheetDescription>
              Transparent inputs. Explicit limits.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-6 px-4 pb-8 text-sm leading-relaxed">
            {[
              [
                "First-party sources",
                "We read AWS and Azure official price feeds directly. Other provider pages are collected through Context.dev. Complex rate tables use provider-specific parsers that check column headers, units, GPU quantities and effective dates. AI-assisted structured extraction is checked against a matching source passage and numeric price before publication. Each observation and source document is retained. AI-assisted extraction can still misinterpret page structure; the original quote is always available for inspection.",
              ],
              [
                "An hourly price, with its conditions",
                "Whole-instance rates are divided only by an explicitly specified GPU count. Per-second GPU prices are multiplied by 3,600; per-minute prices by 60. Monthly plans, tokens, credits and ambiguous configurations are excluded. Original currency is preserved; USD is the default filter. GPU memory is per device, never host RAM.",
              ],
              [
                "Published rates versus stock",
                "These are advertised rates, not an executed-trade index. They cannot reproduce Ornn’s negotiated transaction dataset. A published price does not prove availability. Starting prices, spot, committed and serverless rates are labeled separately. Availability remains unverified unless the source explicitly establishes it.",
              ],
              [
                "Freshness and collection failures",
                "AWS currently covers US East (N. Virginia) only; other providers may have partial regional coverage. Vast.ai, Runpod, io.net and Spheron target 15-minute checks; other marketplaces target hourly checks and other rate cards every six hours. A protected scheduler runs every five minutes in bounded batches, so targets can be delayed. Rates become stale after the target interval plus twenty minutes and are hidden by default. Failed checks retain the original observation time; a failure never makes old data fresh. The dashboard polls stored observations every 30 seconds without triggering paid scraping.",
              ],
              [
                "Coverage has boundaries",
                "The coverage tab includes every configured provider, including sales-only, login-only, missing-price and failed sources. Provider count is not the count of working integrations. Public pages may omit regions, inventory, discounts or additional GPU models. No tool can guarantee every private or negotiated offer.",
              ],
              [
                "Compare total cost",
                "Storage, CPU, RAM, egress, taxes, minimum billing periods and commitments may add to the compute rate. The configuration price is shown only when the minimum GPU count is known. Saved offers are local to this browser; filter links and CSV exports are portable.",
              ],
            ].map(([title, text]) => (
              <section key={title}>
                <h3 className="mb-2 font-medium">{title}</h3>
                <p className="text-muted-foreground">{text}</p>
              </section>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </Tabs>
  );
}
