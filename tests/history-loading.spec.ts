import { test, expect, type Page } from "@playwright/test";
import type { Rate, Snapshot } from "../src/lib/types";

// Pending is not empty; errors are not zero observations. Returning to a cached
// range must stay visible, and late responses must not replace another offer.
const now = new Date().toISOString();
const rates: Rate[] = [1, 2].map((n) => ({
  id: String(n).padStart(24, "0"),
  providerId: "runpod",
  gpu: `H100 Test ${n}`,
  vramGb: 80,
  gpuCount: 1,
  region: "US",
  plan: "History loading fixture",
  billing: "On-demand",
  currency: "USD",
  amount: n + 1,
  unit: "gpu-hour",
  hourly: n + 1,
  priceType: "Exact",
  availability: "Not verified",
  evidence: "Browser test fixture",
  notes: "",
  sourceUrl: "https://www.runpod.io/pricing",
  observedAt: now,
}));
const snapshot: Snapshot = {
  loadedAt: now,
  providers: [
    {
      id: "runpod",
      status: "ok",
      message: "Fixture",
      observedAt: now,
      checkedAt: now,
      rates,
    },
  ],
};
async function setup(page: Page) {
  let revision = 0;
  await page.route("**/api/prices", (route) =>
    route.fulfill({
      json: {
        ...snapshot,
        loadedAt: new Date(Date.parse(now) + revision++ * 1000).toISOString(),
      },
    }),
  );
}
const history = (ids: string) => ({
  loadedAt: now,
  series: ids
    .split(",")
    .filter((id) => rates.some((rate) => rate.id === id))
    .map((id) => ({
      id,
      points: [
        {
          at: now,
          hourly: rates.find((r) => r.id === id)!.hourly,
          currency: "USD",
        },
      ],
    })),
});

test("slow history shows the known quote and loading, never a false empty state", async ({
  page,
}, info) => {
  await setup(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requests: string[] = [];
  await page.route("**/api/market-history?*", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get("range") === "7d") requests.push(params.get("ids")!);
    await gate;
    const ids = new URL(route.request().url()).searchParams.get("ids")!;
    await route.fulfill({ json: history(ids) });
  });
  await page.goto("/?family=H100");
  const card = page.locator('[aria-label="GPU price monitoring"]');
  await expect(card.getByTestId("provider-history-row").first()).toContainText(
    "$2.00",
  );
  await expect(card.getByTestId("provider-history-row").first()).toContainText(
    "Loading history",
  );
  await card
    .getByRole("button", { name: "Selected offer", exact: true })
    .click();
  await expect(
    card.getByRole("button", { name: "Last 7 days" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    card.getByText("Loading price history…", { exact: true }),
  ).toBeVisible();
  await expect(card.getByText("Current quote", { exact: true })).toBeVisible();
  await expect(card).toContainText("$2.00");
  await expect(card).not.toContainText("0 stored observations");
  await expect(card).not.toContainText("More observations are needed");
  await expect(card).not.toContainText("Waiting for observations");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await info.attach("history-pending", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  release();
  await expect(card).toContainText("1 stored observations");
  expect(requests.filter((ids) => ids === rates[0].id)).toHaveLength(1);
  await expect(
    card.getByText("Loading price history…", { exact: true }),
  ).toHaveCount(0);
});

test("cached ranges survive a failed refresh and new ranges never borrow their points", async ({
  page,
}, info) => {
  await setup(page);
  let fail = false;
  await page.route("**/api/market-history?*", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (fail)
      return route.fulfill({ status: 503, json: { error: "Unavailable" } });
    return route.fulfill({
      json:
        params.get("range") === "30d"
          ? { loadedAt: now, series: [{ id: rates[0].id, points: [] }] }
          : history(params.get("ids")!),
    });
  });
  await page.goto("/?family=H100");
  const card = page.locator('[aria-label="GPU price monitoring"]');
  await card
    .getByRole("button", { name: "Selected offer", exact: true })
    .click();
  await expect(card).toContainText("1 stored observations");
  await card.getByRole("button", { name: "Last 30 days" }).click();
  await expect(
    card.getByText("History is starting", { exact: true }),
  ).toBeVisible();
  fail = true;
  await card.getByRole("button", { name: "Last 7 days" }).click();
  await expect(card).toContainText("1 stored observations");
  await expect(card).toContainText("History refresh failed");
  await expect(
    card.getByTestId("price-history-chart").locator(".recharts-wrapper"),
  ).toBeVisible();
  await card.getByRole("button", { name: "Last 24 hours" }).click();
  await expect(
    card.getByRole("alert").getByText("History unavailable", { exact: true }),
  ).toBeVisible();
  await expect(card).not.toContainText("0 stored observations");
  await expect(card).not.toContainText("More observations are needed");
  await expect(card).toContainText("Current quote");
  await info.attach("history-failure-with-current-quote", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});

test("late history cannot replace the newly selected offer", async ({
  page,
}, info) => {
  await setup(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/market-history?*", async (route) => {
    const ids = new URL(route.request().url()).searchParams.get("ids")!;
    if (ids === rates[0].id) await gate;
    await route.fulfill({ json: history(ids) });
  });
  await page.goto("/?family=H100");
  const card = page.locator('[aria-label="GPU price monitoring"]');
  await card
    .getByRole("button", { name: "Selected offer", exact: true })
    .click();
  await expect(card).toHaveAttribute("data-selected-offer", rates[0].id);
  await page
    .getByTestId("price-row")
    .nth(1)
    .getByRole("button")
    .first()
    .click();
  await expect(card).toHaveAttribute("data-selected-offer", rates[1].id);
  await expect(card).toContainText("1 stored observations");
  const late = page.waitForResponse(
    (response) =>
      response.url().includes("/api/market-history?") &&
      response.url().includes(rates[0].id),
  );
  release();
  await late;
  await expect(card).toHaveAttribute("data-selected-offer", rates[1].id);
  await expect(
    card.locator('[aria-label="Selected offer statistics"]'),
  ).toContainText("$3.00");
  await expect(
    card.locator('[aria-label="Selected offer statistics"]'),
  ).not.toContainText("$2.00");
  await info.attach("late-response-keeps-selected-offer", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});

test("truncated history cannot stand in for a complete shorter interval", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/api/market-history?*", (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get("range") !== "7d")
      return route.fulfill({ status: 503, json: { error: "Unavailable" } });
    const result = history(params.get("ids")!);
    return route.fulfill({
      json: {
        ...result,
        window: {
          start: new Date(Date.parse(now) - 7 * 86400000).toISOString(),
          end: now,
        },
        series: result.series.map((series) => ({ ...series, truncated: true })),
      },
    });
  });
  await page.goto("/");
  const card = page.locator('[aria-label="GPU price monitoring"]');
  await card
    .getByRole("button", { name: "Selected offer", exact: true })
    .click();
  await expect(card).toContainText("1 stored observations");
  await card.getByRole("button", { name: "Last 24 hours" }).click();
  await expect(
    card.getByRole("alert").getByText("History unavailable", { exact: true }),
  ).toBeVisible();
});

test("history recovers from a transient request and can be retried after a persistent failure", async ({ page }, info) => {
  await setup(page);
  let attempts24h = 0;
  let fail30d = true;
  await page.route("**/api/market-history?*", (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get("ids") === rates[0].id && params.get("range") === "24h" && attempts24h++ === 0)
      return route.fulfill({ status: 503, json: { error: "Temporary outage" } });
    if (params.get("range") === "30d" && fail30d)
      return route.fulfill({ status: 503, json: { error: "Temporary outage" } });
    return route.fulfill({ json: history(params.get("ids")!) });
  });
  await page.goto("/?family=H100");
  const card = page.locator('[aria-label="GPU price monitoring"]');
  await card.getByRole("button", { name: "Selected offer", exact: true }).click();
  await card.getByRole("button", { name: "Last 24 hours" }).click();
  await expect(card).toContainText("1 stored observations");
  expect(attempts24h).toBe(2);
  await expect(card.getByRole("alert")).toHaveCount(0);

  await card.getByRole("button", { name: "Last 30 days" }).click();
  await expect(card.getByRole("alert")).toContainText("History unavailable");
  await expect(card.getByRole("button", { name: "Retry history" })).toBeVisible();
  await info.attach("history-retry-available.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  fail30d = false;
  await card.getByRole("button", { name: "Retry history" }).click();
  await expect(card).toContainText("1 stored observations");
  await expect(card.getByRole("alert")).toHaveCount(0);
  await info.attach("history-recovered.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});
