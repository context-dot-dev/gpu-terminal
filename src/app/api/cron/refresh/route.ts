import { timingSafeEqual } from "node:crypto";
import { collectDue } from "@/lib/collector";
import { revalidateTag } from "next/cache";
export const maxDuration = 800;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  if (
    !secret ||
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  )
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const collection = await collectDue();
    revalidateTag("gpu-market", "max");
    return Response.json(
      collection,
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Refresh could not access the data store" },
      { status: 503 },
    );
  }
}
