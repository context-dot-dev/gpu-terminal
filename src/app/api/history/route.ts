import { database } from "@/lib/db";
import { providers } from "@/lib/catalog";
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = params.get("id") ?? "";
  const provider = params.get("provider") ?? "";
  if (!/^[a-f0-9]{24}$/.test(id) || !providers.some((p) => p.id === provider))
    return Response.json(
      { error: "Invalid offer" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  try {
    const rows = await database().query(
      `SELECT * FROM (SELECT o.observed_at AS at, r->>'hourly' AS hourly, r->>'currency' AS currency FROM observations o CROSS JOIN LATERAL jsonb_array_elements(o.rates) r WHERE o.provider_id=$1 AND o.observed_at > now() - interval '30 days' AND o.observed_at <= now() AND r->>'id'=$2 ORDER BY o.observed_at DESC LIMIT 2000) points ORDER BY at`,
      [provider, id],
      { fetchOptions: { signal: AbortSignal.timeout(15000) } },
    );
    return Response.json(
      {
        points: rows.map((r) => ({
          at: r.at,
          hourly: Number(r.hourly),
          currency: r.currency,
        })),
      },
      {
        headers: {
          "Cache-Control": "public, max-age=15, stale-while-revalidate=60",
          "CDN-Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        },
      },
    );
  } catch {
    return Response.json(
      { error: "Price history temporarily unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
