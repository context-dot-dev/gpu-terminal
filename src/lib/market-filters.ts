import {
  createLoader,
  createSerializer,
  parseAsBoolean,
  parseAsString,
  parseAsStringLiteral,
} from "nuqs/server";

export const initialFilters = {
  query: "",
  gpu: "all",
  provider: "all",
  kind: "all",
  billing: "all",
  method: "all",
  region: "all",
  memory: "0",
  exactMemory: "all",
  variant: "all",
  community: "all",
  interruption: "all",
  storage: "all",
  execution: "all",
  priority: "all",
  budget: "",
  currency: "USD",
  exact: false,
  fresh: true,
  available: false,
  count: "all",
  totalBudget: "",
  family: "H100",
};
export type Filters = typeof initialFilters;
export const filterParsers = {
  query: parseAsString.withDefault(initialFilters.query),
  gpu: parseAsString.withDefault(initialFilters.gpu),
  provider: parseAsString.withDefault(initialFilters.provider),
  kind: parseAsString.withDefault(initialFilters.kind),
  billing: parseAsString.withDefault(initialFilters.billing),
  method: parseAsString.withDefault(initialFilters.method),
  region: parseAsString.withDefault(initialFilters.region),
  memory: parseAsString.withDefault(initialFilters.memory),
  exactMemory: parseAsString.withDefault(initialFilters.exactMemory),
  variant: parseAsString.withDefault(initialFilters.variant),
  community: parseAsString.withDefault(initialFilters.community),
  interruption: parseAsString.withDefault(initialFilters.interruption),
  storage: parseAsString.withDefault(initialFilters.storage),
  execution: parseAsString.withDefault(initialFilters.execution),
  priority: parseAsString.withDefault(initialFilters.priority),
  budget: parseAsString.withDefault(initialFilters.budget),
  currency: parseAsString.withDefault(initialFilters.currency),
  exact: parseAsBoolean.withDefault(initialFilters.exact),
  fresh: parseAsBoolean.withDefault(initialFilters.fresh),
  available: parseAsBoolean.withDefault(initialFilters.available),
  count: parseAsString.withDefault(initialFilters.count),
  totalBudget: parseAsString.withDefault(initialFilters.totalBudget),
  family: parseAsString.withDefault(initialFilters.family),
};
export const viewParsers = {
  tab: parseAsStringLiteral(["explore", "saved", "coverage"]).withDefault(
    "explore",
  ),
  coverageQuery: parseAsString.withDefault(""),
  coverageStatus: parseAsStringLiteral([
    "all",
    "ok",
    "no-rates",
    "error",
    "pending",
    "not-applicable",
    "unverified",
  ]).withDefault("all"),
};
export const marketParsers = { ...filterParsers, ...viewParsers };
export const readFilters = createLoader(filterParsers);
export const readMarket = createLoader(marketParsers);
export const serializeMarket = createSerializer(marketParsers);

export function marketQuery(params: URLSearchParams): string {
  return serializeMarket(readMarket(params)).slice(1);
}
