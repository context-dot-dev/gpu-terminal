import { test, expect } from "@playwright/test";
import type { Rate, Snapshot } from "../src/lib/types";

test("observed monitor switches ranges and exact offers without inventing history", async ({
  page,
}, info) => {
  const now = Date.now();
  const at = new Date(now).toISOString();
  const rates: Rate[] = ["runpod", "lambda"].map((providerId, index) => ({
    id: String(index + 1).padStart(24, "0"),
    providerId,
    gpu: "NVIDIA H100 SXM",
    vramGb: 80,
    gpuCount: 1,
    region: "US",
    plan: "E2E fixture",
    billing: "On-demand",
    currency: "USD",
    amount: 2 + index,
    unit: "gpu-hour",
    hourly: 2 + index,
    priceType: "Starting at",
    availability: "Not verified",
    evidence: "Synthetic E2E browser data, not a provider quote.",
    notes: "",
    sourceUrl: "https://www.runpod.io/pricing",
    observedAt: at,
  }));
  const snapshot: Snapshot = {
    loadedAt: at,
    providers: rates.map((rate) => ({
      id: rate.providerId,
      checkedAt: at,
      observedAt: at,
      status: "ok",
      message: "E2E fixture",
      rates: [rate],
    })),
  };
  const requests: string[] = [];
  await page.route("**/api/prices", (route) =>
    route.fulfill({ json: snapshot }),
  );
  await page.route("**/provider-logos/lambda.webp", (route) => route.abort());
  await page.route("**/api/market-history?*", (route) => {
    const range = new URL(route.request().url()).searchParams.get("range")!;
    requests.push(range);
    return route.fulfill({
      json: {
        loadedAt: at,
        series: rates.map((r, index) => ({
          id: r.id,
          points:
            range === "30d"
              ? []
              : [
                  ...(range === "7d"
                    ? [
                        {
                          at: new Date(now - 86_400_000).toISOString(),
                          hourly: index === 0 ? 4 : 1,
                          currency: "USD",
                        },
                      ]
                    : []),
                  { at, hourly: r.hourly, currency: "USD" },
                ],
        })),
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  const card = page.locator('[aria-label="GPU price monitoring"]');
  await card.getByRole("button", { name: "Last 24 hours" }).click();
  await card
    .getByRole("button", { name: "Compare providers", exact: true })
    .click();
  await expect(
    card.getByText("2 stored observations", { exact: false }),
  ).toBeVisible();
  await expect(
    card.getByText("More observations are needed to measure a trend.", {
      exact: false,
    }),
  ).toBeVisible();
  const stats = card.locator('[aria-label="Selected offer statistics"]');
  await expect(stats).toContainText("$2.00");
  await expect(stats).toContainText("—");
  await card.getByRole("button", { name: "Last 7 days" }).click();
  await expect(
    card.getByText("4 stored observations", { exact: false }),
  ).toBeVisible();
  await expect(stats).toContainText("-50.00%");
  await expect(stats).toContainText("$4.00");
  await expect(card.locator(".recharts-line-curve").first()).toHaveAttribute(
    "stroke",
    "var(--success)",
  );
  const runpodLogo = page.locator(
    '[data-testid="price-row"] [data-provider-id="runpod"] img',
  );
  await expect(runpodLogo).toBeVisible();
  await expect
    .poll(() =>
      runpodLogo.evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect(
    page.locator(
      '[data-testid="price-row"] [data-provider-id="lambda"] [data-slot="avatar-fallback"]',
    ),
  ).toBeVisible();
  await expect(
    page.locator(
      '[data-testid="price-row"] [data-provider-id="lambda"] [aria-label="Logo unavailable"]',
    ),
  ).toBeVisible();
  await card.getByRole("button", { name: /Lambda.*\$3.00/ }).click();
  await expect(stats).toContainText("+200.00%");
  await expect(
    card.locator('.recharts-line-curve[stroke="var(--destructive)"]'),
  ).toHaveCount(1);
  await expect(stats).toContainText("$1.00");
  const providerChart = page
    .locator('[data-testid="provider-price-chart"]:visible')
    .first();
  await expect(providerChart.locator(".recharts-bar-rectangle")).toHaveCount(2);
  await expect(providerChart).toContainText("from $3.00");
  await providerChart.getByRole("button", { name: /^Inspect Runpod:/ }).click();
  await expect(card).toHaveAttribute("data-selected-offer", rates[0].id);
  await expect(stats).toContainText("-50.00%");
  await info.attach("observed-price-monitor.png", {
    body: await page.screenshot({ fullPage: false }),
    contentType: "image/png",
  });
  await card.getByRole("button", { name: "Last 30 days" }).click();
  await expect(
    card.getByText("History is starting", { exact: true }),
  ).toBeVisible();
  await expect(
    card.getByText("0 stored observations", { exact: false }),
  ).toBeVisible();
  expect(requests).toContain("24h");
  expect(requests).toContain("7d");
  expect(requests).toContain("30d");
  await info.attach("history-requests.json", {
    body: JSON.stringify(requests),
    contentType: "application/json",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Show price history" }).click();
  await expect(
    page.locator('[data-testid="provider-price-chart"]:visible'),
  ).toHaveCount(1);
  await expect(
    card.getByRole("button", { name: "Last 24 hours" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await info.attach("monitor-mobile.png", {
    body: await page.screenshot({ fullPage: false }),
    contentType: "image/png",
  });
});

test("terminal selection synchronizes offer evidence, history and shared GPU filters", async ({
  page,
}, info) => {
  await page.goto("/?family=H100");
  await expect(page.locator("html")).toHaveClass(/dark/);
  const row = page.getByTestId("price-row").nth(1);
  await expect(row).toBeVisible();
  const id = await row.getAttribute("data-offer-id");
  await row.getByRole("button").first().click();
  await expect(row).toHaveAttribute("data-focused", "true");
  const panel = page.getByTestId("selected-offer-panel");
  await expect(panel).toHaveAttribute("data-offer-id", id!);
  const monitor = page.locator('[aria-label="GPU price monitoring"]');
  await expect(monitor).toHaveAttribute("data-selected-offer", id!);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    monitor.getByRole("button", { name: "All providers", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "Pause GPU ticker", exact: true })
    .click();
  await page.getByRole("button", { name: "Explore H200", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "GPU family", exact: true }),
  ).toContainText("H200");
  for (const offer of await page.getByTestId("price-row").all())
    await expect(offer.getByRole("button").first()).toContainText(/H200/);
  await expect(monitor).toContainText("H200 price history");
  await page
    .getByTestId("price-row")
    .first()
    .getByRole("button", { name: /^Source details for/ })
    .click();
  await expect(
    page.getByRole("dialog").getByText("Source evidence", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight),
    ).toBeGreaterThan(viewport.height);
    await page.mouse.move(4, 4);
    await page.mouse.wheel(0, 800);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    for (const chart of [page.getByTestId("price-history-chart")]) {
      await chart.scrollIntoViewIfNeeded();
      const box = await chart.boundingBox();
      expect(box).not.toBeNull();
      await expect(chart).toBeInViewport();
      const panelBounds = await page.getByRole("tabpanel").boundingBox();
      expect(box!.y + box!.height).toBeLessThanOrEqual(
        panelBounds!.y + panelBounds!.height,
      );
    }
    await info.attach(`terminal-${viewport.width}x${viewport.height}.png`, {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  }
  await info.attach("terminal-selection.png", {
    body: await page.screenshot({ fullPage: false }),
    contentType: "image/png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight),
  ).toBeGreaterThan(844);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "Show price history" }).click();
  await expect(
    page.getByRole("dialog").getByTestId("price-history-chart"),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await info.attach("terminal-mobile.png", {
    body: await page.screenshot({ fullPage: false }),
    contentType: "image/png",
  });
});
