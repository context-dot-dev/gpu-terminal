export type Rate = {
  collectionMethod?: "Provider API" | "Table parser" | "Source extraction";
  vcpus?: number | null;
  ramGb?: number | null;
  commitment?: string;
  id: string;
  providerId: string;
  gpu: string;
  vramGb: number | null;
  gpuCount: number | null;
  region: string;
  rawRegion?: string;
  plan: string;
  billing: "On-demand" | "Spot" | "Committed" | "Serverless" | "Unspecified";
  currency: string;
  amount: number;
  unit:
    | "gpu-hour"
    | "instance-hour"
    | "gpu-second"
    | "gpu-minute"
    | "instance-second";
  hourly: number;
  priceType: "Exact" | "Starting at";
  availability: "Available" | "Unavailable" | "Not verified";
  evidence: string;
  notes: string;
  sourceUrl: string;
  observedAt: string;
};
export type ProviderState = {
  id: string;
  checkedAt: string | null;
  observedAt: string | null;
  status: "ok" | "no-rates" | "error" | "pending" | "not-applicable";
  message: string;
  rates: Rate[];
};
export type Snapshot = {
  providers: ProviderState[];
  loadedAt: string;
  error?: string;
};
export type HistoryPoint = { at: string; hourly: number; currency: string };
export function isFresh(at: string, minutes: number, now = Date.now()) {
  return now - Date.parse(at) <= minutes * 60_000 + 20 * 60_000;
}

export type MarketHistory = {
  window?: { start: string; end: string };
  series: { id: string; points: HistoryPoint[]; truncated?: boolean }[];
  loadedAt: string;
};
