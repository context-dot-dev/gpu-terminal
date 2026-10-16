import { connection } from "next/server";
import { getSnapshot } from "@/lib/db";
export async function GET() {
  await connection();
  const snapshot = await getSnapshot();
  return Response.json(snapshot, {
    status: snapshot.error ? 503 : 200,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
