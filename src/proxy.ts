import { trackAgents } from "@databuddy/sdk/agents";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { marketQuery } from "@/lib/market-filters";

export function proxy(request: NextRequest, event: NextFetchEvent) {
  event.waitUntil(trackAgents(request));
  if (request.nextUrl.pathname !== "/") return NextResponse.next();
  const query = marketQuery(request.nextUrl.searchParams);
  if (!query) return NextResponse.next();
  if (query.length > 4096)
    return new NextResponse("Filter URL is too long", { status: 414 });
  const url = request.nextUrl.clone();
  url.pathname = `/market/${Buffer.from(query).toString("base64url")}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: "/((?!api(?:/|$)|_next/|favicon.ico).*)",
};
