import { getMarketHistory } from "@/lib/market-history";
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
    const history = await getMarketHistory([id], [provider], "30d", "", "");
    return Response.json(
      { points: history.series[0].points },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Price history temporarily unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
