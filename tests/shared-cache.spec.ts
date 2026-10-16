import { test, expect } from "@playwright/test";
import { neon } from "@neondatabase/serverless";
import type { Snapshot } from "../src/lib/types";

// Failure cases: each request rereads Neon; HTTP caches hide invalidation;
// offer combinations create independent histories; failed refresh loses data.
test("collection invalidates shared prices and history without HTTP cache delays", async ({
  request,
  baseURL,
}, info) => {
  test.skip(!process.env.E2E_DATABASE_URL || !process.env.E2E_CRON_SECRET,
    "Requires an isolated database and its matching deployment");
  expect(baseURL).not.toContain("gpu.context.dev");
  const sql = neon(process.env.E2E_DATABASE_URL!);
  const initial = await request.get("/api/prices");
  expect(initial.ok()).toBeTruthy();
  expect(initial.headers()["cache-control"]).toBe("no-store");
  const snapshot: Snapshot = await initial.json();
  const provider = snapshot.providers.find((p) => p.id === "replicate")!;
  const offer = provider.rates[0];
  expect(offer).toBeTruthy();
  const path = `/api/market-history?ids=${offer.id}&providers=replicate&range=30d`;
  const before = await (await request.get(path)).json();
  expect(before.series[0].points.length).toBeGreaterThan(0);
  const checkedAt = new Date().toISOString();
  const hourly = Number(before.series[0].points.at(-1).hourly) + 0.01;
  const message = `Shared cache E2E ${checkedAt}`;
  await sql`UPDATE provider_state SET checked_at=${checkedAt},
    message=${message} WHERE provider_id='replicate'`;
  await sql`INSERT INTO observations(provider_id, observed_at, rates, source_hash)
    VALUES ('replicate', ${checkedAt}, ${JSON.stringify([{ ...offer, hourly }])}::jsonb, 'shared-cache-e2e')`;

  for (let i = 0; i < 3; i++) {
    const response = await request.get(`/api/prices?cache-probe=${i}`);
    expect(response.headers()["cache-control"]).toBe("no-store");
    const cached: Snapshot = await response.json();
    expect(cached.providers.find((p) => p.id === "replicate")?.message)
      .toBe(provider.message);
  }
  const single = await (await request.get(
    `/api/history?id=${offer.id}&provider=replicate`,
  )).json();
  expect(single.points).toEqual(before.series[0].points);

  const refresh = await request.get("/api/cron/refresh", {
    headers: { authorization: `Bearer ${process.env.E2E_CRON_SECRET}` },
    timeout: 30000,
  });
  expect(refresh.ok()).toBeTruthy();
  const collection = await refresh.json();
  expect(collection.results).toEqual([]);
  await expect.poll(async () => {
    const latest: Snapshot = await (await request.get("/api/prices")).json();
    return latest.providers.find((p) => p.id === "replicate")?.message;
  }, { timeout: 30000 }).toBe(message);
  await expect.poll(async () => {
    const latest = await (await request.get(path)).json();
    return latest.series[0].points.at(-1)?.hourly;
  }, { timeout: 30000 }).toBe(hourly);
  await info.attach("shared-cache-invalidation.json", {
    body: JSON.stringify({
      offer: offer.id,
      cachedObservationCount: before.series[0].points.length,
      publishedHourly: hourly,
      collection,
      independentRequests: 3,
    }, null, 2),
    contentType: "application/json",
  });
});

// A broad chart must fit Vercel's response limit even when every offer has a long history.
test("broad history remains bounded and reports truncation", async ({ request, baseURL }, info) => {
  test.skip(!process.env.E2E_DATABASE_URL || !process.env.E2E_CRON_SECRET,
    "Requires an isolated database and its matching deployment");
  expect(baseURL).not.toContain("gpu.context.dev");
  const sql = neon(process.env.E2E_DATABASE_URL!);
  const snapshot: Snapshot = await (await request.get("/api/prices")).json();
  const offers = snapshot.providers.find((p) => p.id === "upcloud")!.rates.slice(0, 20);
  expect(offers).toHaveLength(20);
  const points = offers.map(({ id, hourly, currency }) => ({ id, hourly, currency }));
  await sql`INSERT INTO observations(provider_id, observed_at, rates, source_hash)
    SELECT 'upcloud', now() - n * interval '30 seconds', ${JSON.stringify(points)}::jsonb, 'bounded-history-e2e'
    FROM generate_series(1, 2001) AS n`;
  const refresh = await request.get("/api/cron/refresh", {
    headers: { authorization: `Bearer ${process.env.E2E_CRON_SECRET}` },
  });
  expect(refresh.ok()).toBeTruthy();
  const path = `/api/market-history?ids=${offers.map((r) => r.id).join(",")}&providers=upcloud&range=24h`;
  await expect.poll(async () => {
    const response = await request.get(path);
    expect(response.ok()).toBeTruthy();
    const history = await response.json();
    return history.series.every((series: { truncated: boolean }) => series.truncated);
  }, { timeout: 30000 }).toBe(true);
  const response = await request.get(path);
  const body = await response.body();
  const history = JSON.parse(body.toString());
  const count = history.series.reduce((sum: number, series: { points: unknown[] }) => sum + series.points.length, 0);
  expect(count).toBeLessThanOrEqual(30000);
  expect(body.byteLength).toBeLessThan(3_000_000);
  await info.attach("bounded-history.json", {
    body: JSON.stringify({ offers: offers.length, points: count, bytes: body.byteLength }),
    contentType: "application/json",
  });
});
