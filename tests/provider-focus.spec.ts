import { test, expect } from "@playwright/test";
import type { Rate, Snapshot } from "../src/lib/types";

// Selecting a row or sidebar provider must emphasize its history line; a flat
// focused line must survive Changes only, and hovering must not erase the focus.
test("provider selection stays visible in the history chart", async ({ page }, info) => {
  const now = new Date().toISOString();
  const earlier = new Date(Date.now() - 86400000).toISOString();
  const rates: Rate[] = [
    { id: "1".padStart(24, "0"), providerId: "runpod", gpu: "H100 SXM", hourly: 2 },
    { id: "2".padStart(24, "0"), providerId: "lambda", gpu: "H100 SXM", hourly: 3 },
  ].map((rate) => ({
    ...rate, vramGb: 80, gpuCount: 1, region: "US", plan: "Browser fixture",
    billing: "On-demand", currency: "USD", amount: rate.hourly,
    unit: "gpu-hour", priceType: "Exact", availability: "Not verified",
    evidence: "Browser fixture", notes: "", sourceUrl: "https://gpu.context.dev/",
    observedAt: now,
  }));
  const snapshot: Snapshot = {
    loadedAt: now,
    providers: rates.map((rate) => ({
      id: rate.providerId, checkedAt: now, observedAt: now,
      status: "ok", message: "Fixture", rates: [rate],
    })),
  };
  await page.route("**/api/prices", (route) => route.fulfill({ json: snapshot }));
  await page.route("**/api/market-history?*", (route) => {
    const ids = new URL(route.request().url()).searchParams.get("ids")!.split(",");
    return route.fulfill({ json: {
      loadedAt: now,
      window: { start: new Date(Date.now() - 7 * 86400000).toISOString(), end: now },
      series: ids.map((id) => ({ id, truncated: false, points: [
        { at: earlier, hourly: id === rates[1].id ? 4 : 2, currency: "USD" },
        { at: now, hourly: rates.find((rate) => rate.id === id)?.hourly ?? 2, currency: "USD" },
      ] })),
    } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  const chart = page.locator('[aria-label="GPU price monitoring"]');
  const plot = chart.getByTestId("provider-line-plot");
  await expect(plot.locator("[data-price-line]")).toHaveCount(2);
  await expect(plot.locator('[data-emphasized="true"]')).toHaveCount(0);

  await page.getByTestId("price-row").filter({ hasText: "Lambda" }).click();
  await info.attach("provider-selected-before-or-after.png", {
    body: await page.screenshot(), contentType: "image/png",
  });
  await expect(plot.locator('[data-provider-id="lambda"]')).toHaveAttribute("data-emphasized", "true");
  await expect(plot.locator('[data-provider-id="runpod"]')).toHaveAttribute("data-emphasized", "false");
  await expect(chart).toContainText("Lambda selected");

  await page.getByTestId("provider-price-chart").getByRole("button", { name: /Inspect Runpod:/ }).click();
  await expect(plot.locator('[data-provider-id="runpod"]')).toHaveAttribute("data-emphasized", "true");
  await chart.getByRole("button", { name: "Changes only" }).click();
  await expect(plot.locator('[data-provider-id="runpod"]')).toHaveCount(1);
});
