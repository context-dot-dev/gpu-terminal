import { test, expect } from "@playwright/test";
import type { Snapshot } from "../src/lib/types";

// Failure cases: initial rows wait for the API; refresh clears a chart; a failed
// response is cached; a new offer accidentally displays the previous offer's history.
test("cached HTML shows prices while the background refresh is held", async ({
  page,
}, info) => {
  let requested = false;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/prices", async (route) => {
    requested = true;
    await held;
    await route.fulfill({ status: 503, json: { error: "E2E unavailable" } });
  });
  const started = performance.now();
  await page.goto("/?family=H100", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("price-row").first()).toBeVisible();
  const rowsMs = performance.now() - started;
  await expect.poll(() => requested).toBe(true);
  await expect(page.getByRole("button", { name: /Updating/ })).toBeVisible();
  await info.attach("cached-first-render.json", {
    body: JSON.stringify(
      {
        rowsMs,
        navigation: await page.evaluate(() =>
          performance
            .getEntriesByType("navigation")
            .map((entry) => entry.toJSON()),
        ),
        paints: await page.evaluate(() =>
          performance.getEntriesByType("paint").map((entry) => entry.toJSON()),
        ),
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
  release();
  await expect(
    page.getByText(/Could not load the latest snapshot/),
  ).toBeVisible();
  await expect(page.getByTestId("price-row").first()).toBeVisible();
  await info.attach("cached-prices-during-outage.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});

test("public data relies on shared server caching and errors are never HTTP cached", async ({
  request,
}, info) => {
  const prices = await request.get("/api/prices");
  expect(prices.ok()).toBeTruthy();
  const snapshot: Snapshot = await prices.json();
  const rate = snapshot.providers.flatMap((p) => p.rates)[0];
  expect(rate).toBeTruthy();
  const headers: Record<string, string> = {};
  for (const path of [
    "/api/prices",
    `/api/market-history?ids=${rate.id}&range=24h`,
    `/api/history?provider=${rate.providerId}&id=${rate.id}`,
  ]) {
    const response = await request.get(path);
    expect(response.ok()).toBeTruthy();
    const cache = response.headers()["cache-control"];
    expect(cache).toBe("no-store");
    headers[path] = cache;
  }
  const invalid = await request.get("/api/market-history?ids=invalid");
  expect(invalid.status()).toBe(400);
  expect(invalid.headers()["cache-control"]).toBe("no-store");
  await info.attach("cache-policy.json", {
    body: JSON.stringify(headers, null, 2),
    contentType: "application/json",
  });
});

test("snapshot refresh preserves the same chart while history revalidates", async ({
  page,
  request,
}, info) => {
  const snapshot: Snapshot = await (await request.get("/api/prices")).json();
  let count = 0;
  let holdHistory = false;
  let heldRequests = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/prices", (route) =>
    route.fulfill({
      json: {
        ...snapshot,
        loadedAt: new Date(Date.now() + ++count * 1000).toISOString(),
      },
    }),
  );
  await page.route("**/api/market-history?*", async (route) => {
    if (holdHistory) {
      heldRequests++;
      await held;
    }
    const ids = new URL(route.request().url()).searchParams
      .get("ids")!
      .split(",");
    await route.fulfill({
      json: {
        loadedAt: snapshot.loadedAt,
        series: ids.map((id) => ({
          id,
          points: [
            {
              at: new Date(Date.now() - 3600000).toISOString(),
              hourly: 2,
              currency: "USD",
            },
            { at: new Date().toISOString(), hourly: 1, currency: "USD" },
          ],
        })),
      },
    });
  });
  await page.goto("/?family=H100");
  const chart = page.getByTestId("price-history-chart");
  await expect(chart.locator("[data-price-line]").first()).toHaveAttribute(
    "d",
    /^M/,
  );
  await expect(
    page.getByRole("button", { name: "Refresh", exact: true }),
  ).toBeEnabled();
  holdHistory = true;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect.poll(() => heldRequests).toBeGreaterThan(0);
  await expect(chart.locator("[data-price-line]").first()).toHaveAttribute(
    "d",
    /^M/,
  );
  await expect(chart.getByLabel("Loading observed prices")).toHaveCount(0);
  await info.attach("chart-during-revalidation.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await page
    .getByTestId("price-row")
    .nth(1)
    .getByRole("button")
    .first()
    .click();
  await expect(chart.getByLabel("Loading observed prices")).toHaveCount(0);
  await expect(chart.locator("[data-price-line]").first()).toHaveAttribute(
    "d",
    /^M/,
  );
  release();
  await expect(chart.locator("[data-price-line]").first()).toHaveAttribute(
    "d",
    /^M/,
  );
});

test("cached terminal renders actual prices before application hydration", async ({
  browser,
  baseURL,
}, info) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
  });
  await context.route("**/_next/static/**/*.js", (route) => route.abort());
  const page = await context.newPage();
  const response = await page.goto(`${baseURL}/?family=H100`, {
    waitUntil: "domcontentloaded",
  });
  expect(response?.ok()).toBeTruthy();
  await expect(page.getByTestId("price-row").first()).toBeVisible();
  await expect(page.getByText("Applying your filters…")).toHaveCount(0);
  await expect(
    page.getByText("Cached snapshot", { exact: true }),
  ).toBeVisible();
  await info.attach("terminal-before-javascript.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await context.close();
});
