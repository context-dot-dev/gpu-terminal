import { connection } from "next/server";
import { cachedSnapshot } from "@/lib/snapshot";
import { unavailableSnapshot } from "@/lib/db";
export async function GET() {
  await connection();
  const snapshot = await cachedSnapshot().catch(() => unavailableSnapshot());
  return Response.json(snapshot, {
    status: snapshot.error ? 503 : 200,
    headers: {
      "CDN-Cache-Control": snapshot.error
        ? "no-store"
        : "public, s-maxage=60, stale-while-revalidate=60",
      "Cache-Control": snapshot.error
        ? "no-store"
        : "public, max-age=0, must-revalidate",
    },
  });
}
