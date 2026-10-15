import { Dashboard } from "@/components/dashboard";
import { cachedSnapshot } from "@/lib/snapshot";
import { initialMarketHistory } from "@/lib/market-history";

export const ensureStatic = "navigation";

export default async function Page() {
  const snapshot = await cachedSnapshot();
  return (
    <Dashboard
      initial={snapshot}
      initialHistory={await initialMarketHistory(snapshot)}
    />
  );
}
