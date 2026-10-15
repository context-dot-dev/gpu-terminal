import {
  cachedMarketHistory,
  historyWindows as windows,
} from "@/lib/market-history";
import { providers } from "@/lib/catalog";

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const ids = (params.get("ids") ?? "").split(",");
  const range = params.get("range") ?? "7d";
  if (
    ids.length > providers.length ||
    ids.some((id) => !/^[a-f0-9]{24}$/.test(id)) ||
    new Set(ids).size !== ids.length ||
    (!Object.hasOwn(windows, range) && range !== "all" && range !== "custom")
  )
    return Response.json(
      {
        error: `Choose up to ${providers.length} valid offers and a supported history window`,
      },
      { status: 400, headers: noStore },
    );

  const now = Date.now();
  if (range === "custom") {
    const start = params.get("start") ?? "";
    const end = params.get("end") ?? "";
    const validDate = (value: string) =>
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value;
    if (
      !validDate(start) ||
      !validDate(end) ||
      start < "1970-01-01" ||
      start > end ||
      end > new Date(now).toISOString().slice(0, 10)
    )
      return Response.json(
        {
          error:
            "Choose valid UTC dates from 1970 through today, with start on or before end",
        },
        { status: 400, headers: noStore },
      );
  }

  try {
    const history = await cachedMarketHistory(
      [...ids].sort(),
      range,
      range === "custom" ? params.get("start")! : "",
      range === "custom" ? params.get("end")! : "",
    );
    if (!history)
      return Response.json(
        { error: "An offer is no longer published; refresh prices" },
        { status: 400, headers: noStore },
      );
    return Response.json(history, {
      headers: {
        "Cache-Control": "public, max-age=15, stale-while-revalidate=60",
        "CDN-Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
      },
    });
  } catch {
    return Response.json(
      { error: "Price history temporarily unavailable" },
      { status: 503, headers: noStore },
    );
  }
}
