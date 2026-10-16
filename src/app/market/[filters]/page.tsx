import { notFound } from "next/navigation";
import { Dashboard } from "@/components/dashboard";
import { cachedSnapshot } from "@/lib/snapshot";
import { marketQuery } from "@/lib/market-filters";
import { initialMarketHistory } from "@/lib/market-history";

export const ensureStatic = "navigation";
export const instant = false;

export function generateStaticParams() {
  return [
    "H200",
    "B200",
    "A100",
    "RTX 5090",
    "RTX 4090",
    "L40S",
    "RTX A6000",
    "all",
  ].map((family) => ({
    filters: Buffer.from(marketQuery(new URLSearchParams({ family }))).toString(
      "base64url",
    ),
  }));
}

export default async function Page({
  params,
}: {
  params: Promise<{ filters: string }>;
}) {
  const { filters } = await params;
  const query = Buffer.from(filters, "base64url").toString("utf8");
  if (
    !query ||
    query.length > 4096 ||
    Buffer.from(query).toString("base64url") !== filters ||
    marketQuery(new URLSearchParams(query)) !== query
  )
    notFound();
  const snapshot = await cachedSnapshot();
  return (
    <Dashboard
      initial={snapshot}
      initialQuery={query}
      initialHistory={await initialMarketHistory(snapshot, query)}
    />
  );
}
