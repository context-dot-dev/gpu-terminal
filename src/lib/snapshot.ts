import { cacheLife, cacheTag } from "next/cache";
import { getSnapshot } from "./db";

export async function cachedSnapshot() {
  "use cache";
  cacheTag("gpu-market");
  cacheLife({ stale: 300, revalidate: 1800, expire: 86400 });
  const snapshot = await getSnapshot();
  if (snapshot.error) throw new Error(snapshot.error);
  return snapshot;
}
