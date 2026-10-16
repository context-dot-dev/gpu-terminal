import { cacheLife } from "next/cache";
import { getSnapshot } from "./db";

export async function cachedSnapshot() {
  "use cache";
  cacheLife({ stale: 300, revalidate: 900, expire: 86400 });
  const snapshot = await getSnapshot();
  if (snapshot.error) throw new Error(snapshot.error);
  return snapshot;
}
