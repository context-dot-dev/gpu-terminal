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
  expect(provider.message).toMatch(/^(Isolated E2E fixture|Shared cache E2E )/);
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

  await sql`UPDATE provider_state SET checked_at=now()`;
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
  expect(snapshot.providers.find((p) => p.id === "upcloud")?.message).toBe("Isolated E2E fixture");
  const offers = snapshot.providers.find((p) => p.id === "upcloud")!.rates.slice(0, 20);
  expect(offers).toHaveLength(20);
  const points = offers.map(({ id, hourly, currency }) => ({ id, hourly, currency }));
  await sql`INSERT INTO observations(provider_id, observed_at, rates, source_hash)
    SELECT 'upcloud', now() - n * interval '30 seconds', ${JSON.stringify(points)}::jsonb, 'bounded-history-e2e'
    FROM generate_series(1, 2001) AS n`;
  await sql`UPDATE provider_state SET checked_at=now()`;
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

test("the scheduler respects collection windows and overlapping leases", async ({ request, baseURL }, info) => {
  test.skip(!process.env.E2E_DATABASE_URL || !process.env.E2E_CRON_SECRET,
    "Requires an isolated database and its matching deployment");
  expect(baseURL).not.toContain("gpu.context.dev");
  const sql = neon(process.env.E2E_DATABASE_URL!);
  const snapshot: Snapshot = await (await request.get("/api/prices")).json();
  expect(snapshot.providers.find((p) => p.id === "upcloud")?.message).toBe("Isolated E2E fixture");
  const empty = snapshot.providers.find((p) => p.status === "no-rates")!;
  await sql`UPDATE provider_state SET checked_at=now(), lease_until=now() + interval '1 hour'`;
  try {
    await sql`UPDATE provider_state SET checked_at=now() - interval '50 minutes' WHERE provider_id='replicate'`;
    await sql`UPDATE provider_state SET checked_at=now() - interval '16 minutes' WHERE provider_id='runpod'`;
    await sql`UPDATE provider_state SET checked_at=now() - interval '2 hours' WHERE provider_id=${empty.id}`;
    await sql`UPDATE provider_state SET checked_at=now(), status='error', parser_version='old' WHERE provider_id='edgevana'`;
    const response = await request.get("/api/cron/refresh", {
      headers: { authorization: `Bearer ${process.env.E2E_CRON_SECRET}` },
    });
    expect(response.ok()).toBeTruthy();
    const collection = await response.json();
    expect(collection.results.map((r: { id: string }) => r.id).sort()).toEqual(["replicate", "runpod"]);
    expect(collection.results.every((r: { status: string }) => r.status === "busy")).toBe(true);
    expect(collection.remaining).toBe(2);
    await info.attach("collection-windows.json", {
      body: JSON.stringify(collection, null, 2),
      contentType: "application/json",
    });
  } finally {
    await sql`UPDATE provider_state SET checked_at=now(), lease_until=NULL,
      parser_version=CASE WHEN provider_id='nebius' THEN '2026-10-16-nebius-vram' ELSE '2026-10-07-v3' END`;
  }
});

test("failed background database reads retain cached prices and history", async ({ request, baseURL }, info) => {
  test.skip(!process.env.E2E_DATABASE_URL || !process.env.E2E_CRON_SECRET,
    "Requires an isolated database and its matching deployment");
  expect(baseURL).not.toContain("gpu.context.dev");
  const sql = neon(process.env.E2E_DATABASE_URL!);
  const snapshot: Snapshot = await (await request.get("/api/prices")).json();
  const provider = snapshot.providers.find((p) => p.id === "replicate")!;
  expect(provider.message).toMatch(/^Shared cache E2E /);
  const path = `/api/history?id=${provider.rates[0].id}&provider=replicate`;
  const history = await (await request.get(path)).json();
  await sql`UPDATE provider_state SET checked_at=now()`;
  const refresh = await request.get("/api/cron/refresh", {
    headers: { authorization: `Bearer ${process.env.E2E_CRON_SECRET}` },
  });
  expect(refresh.ok()).toBeTruthy();
  await sql.transaction([
    sql`ALTER TABLE provider_state RENAME TO provider_state_unavailable`,
    sql`ALTER TABLE observations RENAME TO observations_unavailable`,
  ]);
  try {
    for (let i = 0; i < 3; i++) {
      const prices = await request.get("/api/prices");
      expect(prices.ok()).toBeTruthy();
      expect((await prices.json()).providers.find((p: { id: string }) => p.id === "replicate"))
        .toEqual(provider);
      const response = await request.get(path);
      expect(response.ok()).toBeTruthy();
      expect(await response.json()).toEqual(history);
    }
    await info.attach("database-outage.json", {
      body: JSON.stringify({ requests: 6, pricesStatus: 200, historyStatus: 200, retainedOriginalTimestamps: true }),
      contentType: "application/json",
    });
  } finally {
    await sql.transaction([
      sql`ALTER TABLE provider_state_unavailable RENAME TO provider_state`,
      sql`ALTER TABLE observations_unavailable RENAME TO observations`,
    ]);
  }
});
