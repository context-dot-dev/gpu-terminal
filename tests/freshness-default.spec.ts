import { test, expect } from "@playwright/test";
import type { Rate, Snapshot } from "../src/lib/types";

test("default includes older offers while freshness stays opt-in across links and reset", async ({
  page,
}, info) => {
  const at = new Date().toISOString();
  const older = new Date(Date.now() - 7 * 86400000).toISOString();
  const rates: Rate[] = ["runpod", "lambda"].map((providerId, i) => ({
    id: String(i + 1).padStart(24, "0"),
    providerId,
    gpu: "H100 SXM",
    vramGb: 80,
    gpuCount: 1,
    region: "US",
    plan: "Synthetic browser fixture",
    billing: "On-demand",
    currency: "USD",
    amount: i + 2,
    unit: "gpu-hour",
    hourly: i + 2,
    priceType: "Exact",
    availability: "Not verified",
    evidence: "Synthetic browser fixture, not a provider quote",
    notes: "",
    sourceUrl: "https://www.runpod.io/pricing",
    observedAt: i ? older : at,
  }));
  const snapshot: Snapshot = {
    loadedAt: at,
    providers: rates.map((rate) => ({
      id: rate.providerId,
      checkedAt: at,
      observedAt: rate.observedAt,
      status: "ok",
      message: "Fixture",
      rates: [rate],
    })),
  };
  await page.route("**/api/prices", (route) => route.fulfill({ json: snapshot }));
  await page.route("**/api/market-history?*", (route) =>
    route.fulfill({ json: { loadedAt: at, series: [] } }),
  );
  const rows = page.getByTestId("price-row");
  const fresh = page.getByRole("checkbox", { name: "Within refresh window" });
  for (const path of ["/", "/?fresh=false", "/?fresh=true"]) {
    await page.goto(path);
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    if (path.endsWith("true")) {
      await expect(fresh).toBeChecked();
      await expect(rows).toHaveCount(1);
    } else {
      await expect(fresh).not.toBeChecked();
      await expect(rows).toHaveCount(2);
      await expect(rows.filter({ hasText: "Lambda" })).toContainText("Stale");
      await expect(rows.filter({ hasText: "Runpod" })).toContainText("Recent");
    }
  }
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(fresh).not.toBeChecked();
  await expect(rows).toHaveCount(2);
  await expect(page).toHaveURL(/\/$/);
  await fresh.check();
  await expect(page).toHaveURL(/fresh=true/);
  await expect(rows).toHaveCount(1);
  await fresh.uncheck();
  await expect(page).toHaveURL(/\/$/);
  await expect(rows).toHaveCount(2);
  await info.attach("all-observations-default.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await info.attach("observation-timestamps.json", {
    body: JSON.stringify(rates.map(({ id, observedAt }) => ({ id, observedAt }))),
    contentType: "application/json",
  });
});
