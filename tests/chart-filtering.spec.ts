import { test, expect } from "@playwright/test";
import type { Rate, Snapshot } from "../src/lib/types";

// Sparse observations must not collapse time windows. Comparisons may relax
// GPU identity only; provider, region, budget, billing and freshness still apply.
const at = new Date().toISOString();
const rates: Rate[] = [
  ["H100", "runpod", "US", 2],
  ["H200", "runpod", "US", 3],
  ["A100", "runpod", "EU", 1],
  ["B200", "lambda", "US", 2],
  ["L40S", "runpod", "US", 8],
  ["H800", "runpod", "US", 1],
].map(([gpu, providerId, region, amount], i) => ({
  id: String(i + 1).padStart(24, "0"),
  gpu: String(gpu),
  providerId: String(providerId),
  region: String(region),
  hourly: Number(amount),
  amount: Number(amount),
  currency: "USD",
  unit: "gpu-hour",
  gpuCount: 1,
  vramGb: 80,
  billing: i === 5 ? "Spot" : "On-demand",
  priceType: "Exact",
  availability: "Not verified",
  plan: "Chart filter fixture",
  notes: "",
  evidence: "Synthetic browser fixture",
  sourceUrl: "https://www.runpod.io/pricing",
  observedAt: at,
}));
const snapshot: Snapshot = {
  loadedAt: at,
  providers: ["runpod", "lambda"].map((id) => ({
    id,
    observedAt: at,
    checkedAt: at,
    status: "ok",
    message: "Fixture",
    rates: rates.filter((r) => r.providerId === id),
  })),
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/prices", (route) =>
    route.fulfill({ json: snapshot }),
  );
  await page.route("**/api/market-history?*", (route) => {
    const params = new URL(route.request().url()).searchParams;
    const windows: Record<string, number> = {
      "24h": 1,
      "7d": 7,
      "30d": 30,
      "90d": 90,
      "1y": 365,
    };
    const until =
      params.get("range") === "custom"
        ? new Date(`${params.get("end")}T00:00:00Z`).getTime() + 86400000
        : Date.parse(at);
    const since =
      params.get("range") === "custom"
        ? Date.parse(params.get("start")!)
        : until - (windows[params.get("range")!] ?? 30) * 86400000;
    return route.fulfill({
      json: {
        loadedAt: at,
        window: {
          start: new Date(since).toISOString(),
          end: new Date(until).toISOString(),
        },
        series: params
          .get("ids")!
          .split(",")
          .filter((id) => rates.some((r) => r.id === id))
          .map((id) => ({
            id,
            points: [
              {
                at: new Date(until - 60000).toISOString(),
                hourly: rates.find((r) => r.id === id)!.hourly,
                currency: "USD",
              },
            ],
          })),
      },
    });
  });
});

test("time windows and custom bounds stay visible even with a single point", async ({
  page,
}, info) => {
  await page.goto("/?family=H100");
  const chart = page.locator('[aria-label="GPU price monitoring"]');
  const plot = chart.getByTestId("price-history-chart");
  await expect(chart).toHaveAttribute("data-selected-offer", rates[0].id);
  await expect(chart).toContainText("1 stored observations");
  for (const [label, days] of [
    ["Last 24 hours", 1],
    ["Last 7 days", 7],
    ["Last 30 days", 30],
  ] as const) {
    const button = chart.getByRole("button", { name: label, exact: true });
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(
        async () =>
          Number(await plot.getAttribute("data-window-end")) -
          Number(await plot.getAttribute("data-window-start")),
      )
      .toBe(days * 86400000);
    const box = await plot.locator("svg").first().boundingBox();
    const dot = await plot.locator("[data-price-point]").first().boundingBox();
    expect(dot!.x).toBeGreaterThan(box!.x + box!.width * 0.8);
  }
  await chart
    .getByRole("button", { name: "Custom dates", exact: true })
    .click();
  await page.getByLabel("Start date (UTC)").fill("2026-01-01");
  await page.getByLabel("End date (UTC)").fill("2026-01-03");
  await page.getByRole("button", { name: "Apply dates" }).click();
  await expect(
    chart.getByRole("button", { name: "Custom dates", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(plot).toHaveAttribute(
    "data-window-start",
    String(Date.parse("2026-01-01")),
  );
  await expect(plot).toHaveAttribute(
    "data-window-end",
    String(Date.parse("2026-01-04")),
  );
  await info.attach("custom-window.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});

test("GPU comparison respects the provider, region and budget and clears excluded overlays", async ({
  page,
}, info) => {
  await page.goto(
    "/?family=H100&provider=runpod&region=US&budget=4&billing=On-demand",
  );
  const chart = page.locator('[aria-label="GPU price monitoring"]');
  await expect(chart).toHaveAttribute("data-selected-offer", rates[0].id);
  await chart
    .getByRole("button", { name: "Compare GPUs", exact: true })
    .click();
  await chart.getByRole("button", { name: "Choose GPUs", exact: true }).click();
  const picker = page.getByRole("dialog");
  await expect(picker.getByRole("checkbox")).toHaveCount(2);
  await picker.getByRole("checkbox", { name: /H200/ }).check();
  await picker.getByRole("button", { name: "Done", exact: true }).click();
  await expect(chart).toContainText("H200");
  await page
    .getByRole("spinbutton", { name: "Max /GPU/hr", exact: true })
    .fill("2.5");
  await expect(chart).not.toContainText("H200");
  await chart.getByRole("button", { name: "Choose GPUs", exact: true }).click();
  await expect(picker.getByRole("checkbox")).toHaveCount(1);
  await expect(picker).toContainText("No other GPU models match");
  await picker.getByRole("button", { name: "Done", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Billing model", exact: true })
    .click();
  await page
    .getByRole("option", { name: "All billing models", exact: true })
    .click();
  await chart.getByRole("button", { name: "Choose GPUs", exact: true }).click();
  await expect(picker.getByRole("checkbox", { name: /H800/ })).toBeVisible();
  await info.attach("constrained-gpu-comparison.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});
