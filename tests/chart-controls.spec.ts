import { test, expect } from "@playwright/test";
import type { Rate, Snapshot } from "../src/lib/types";

test("history periods, custom bounds and GPU overlays preserve exact offers", async ({
  page,
}, info) => {
  const at = new Date().toISOString();
  const rates: Rate[] = ["H100", "H200", "A100"].map((gpu, i) => ({
    id: String(i + 1).padStart(24, "0"),
    providerId: "runpod",
    gpu: `NVIDIA ${gpu}`,
    vramGb: 80,
    gpuCount: 1,
    region: "US",
    plan: "Browser fixture",
    billing: "On-demand",
    currency: "USD",
    amount: i + 2,
    unit: "gpu-hour",
    hourly: i + 2,
    priceType: "Exact",
    availability: "Not verified",
    evidence: "Synthetic browser fixture",
    notes: "",
    sourceUrl: "https://www.runpod.io/pricing",
    observedAt: at,
  }));
  const snapshot: Snapshot = {
    loadedAt: at,
    providers: [
      {
        id: "runpod",
        checkedAt: at,
        observedAt: at,
        status: "ok",
        message: "Fixture",
        rates,
      },
    ],
  };
  const queries: string[] = [];
  await page.route("**/api/prices", (route) =>
    route.fulfill({ json: snapshot }),
  );
  await page.route("**/api/market-history?*", (route) => {
    const url = new URL(route.request().url());
    queries.push(url.search);
    return route.fulfill({
      json: {
        loadedAt: at,
        series: url.searchParams
          .get("ids")!
          .split(",")
          .filter((id) => rates.some((rate) => rate.id === id))
          .map((id) => ({
            id,
            points: [
              {
                at,
                hourly: rates.find((r) => r.id === id)!.hourly,
                currency: "USD",
              },
            ],
          })),
      },
    });
  });
  await page.goto("/?family=H100");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  const chart = page.locator('[aria-label="GPU price monitoring"]');
  for (const [label, range] of [
    ["Last 90 days", "90d"],
    ["Last year", "1y"],
    ["All retained history", "all"],
  ]) {
    await chart.getByRole("button", { name: label, exact: true }).click();
    await expect.poll(() => queries.at(-1)).toContain(`range=${range}`);
  }
  await chart
    .getByRole("button", { name: "Custom dates", exact: true })
    .click();
  await page.getByLabel("Start date (UTC)").fill("2026-01-01");
  await page.getByLabel("End date (UTC)").fill("2026-01-03");
  await page.getByRole("button", { name: "Apply dates" }).click();
  await expect
    .poll(() => queries.at(-1))
    .toContain("start=2026-01-01&end=2026-01-03");
  await chart
    .getByRole("button", { name: "Compare GPUs", exact: true })
    .click();
  await chart.getByRole("button", { name: "Choose GPUs", exact: true }).click();
  await page.getByRole("checkbox", { name: /NVIDIA H200/ }).check();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect.poll(() => queries.at(-1)).toContain(rates[1].id);
  await expect(chart).toContainText("NVIDIA H200");
  await expect(chart).toContainText("On-demand");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await info.attach("chart-controls.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await info.attach("history-requests.json", {
    body: JSON.stringify(queries),
    contentType: "application/json",
  });
});

test("custom history rejects invalid, reversed and future dates before querying data", async ({
  request,
}, info) => {
  const queries = [
    "range=custom",
    "range=custom&start=2026-02-30&end=2026-03-01",
    "range=custom&start=2026-02-02&end=2026-02-01",
    "range=custom&start=2999-01-01&end=2999-01-02",
  ];
  const results = [];
  for (const query of queries) {
    const response = await request.get(
      `/api/market-history?ids=${"1".padStart(24, "0")}&${query}`,
    );
    expect(response.status()).toBe(400);
    results.push({ query, status: response.status() });
  }
  await info.attach("date-validation.json", {
    body: JSON.stringify(results),
    contentType: "application/json",
  });
});
