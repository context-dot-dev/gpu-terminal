import { test, expect } from "@playwright/test";

// Failure cases: the first chart waits for a browser request; a shared market
// receives H100 history; unavailable revalidation removes recorded points.
for (const path of ["/", "/?family=H200&provider=nebius&fresh=false"]) {
  test(`recorded history is already present when the history API fails: ${path}`, async ({
    page,
  }, info) => {
    await page.route("**/api/market-history?*", (route) =>
      route.fulfill({
        status: 503,
        json: { error: "Held offline for first-chart proof" },
      }),
    );
    await page.route("**/api/prices", (route) => route.abort());
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const start = performance.now();
    await page.goto(path);
    const chart = page.locator('[aria-label="GPU price monitoring"]');
    await expect(
      chart
        .getByTestId("price-history-chart")
        .locator("[data-price-line]")
        .first(),
    ).toHaveAttribute("d", /^M/);
    await expect(chart.getByTestId("price-history-chart")).toBeVisible();
    await expect(
      chart.getByText("Loading price history…", { exact: true }),
    ).toHaveCount(0);
    if (path.includes("H200"))
      await expect(chart).toContainText("H200 price history");
    await expect(chart).toContainText(/\d+ stored observations/);
    if (path === "/") {
      expect(
        await chart.getByTestId("provider-history-row").count(),
      ).toBeGreaterThan(4);
      expect(await chart.locator("[data-price-line]").count()).toBeGreaterThan(
        4,
      );
    }
    await chart.getByRole("button", { name: "Last 24 hours" }).click();
    await expect(chart).toContainText(/\d+ stored observations/);
    if ((await chart.locator("[data-price-line]").count()) === 0) {
      const hasSingleObservation =
        (await chart.locator("[data-price-point]").count()) > 0;
      await expect(chart).toContainText(
        hasSingleObservation
          ? "More observations are needed to measure a trend"
          : "No observations",
      );
    }
    await expect(chart.getByTestId("price-history-chart")).toBeVisible();
    await expect(
      chart.getByText("Loading price history…", { exact: true }),
    ).toHaveCount(0);
    await info.attach("chart-without-history-network.png", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    await info.attach("first-chart.json", {
      body: JSON.stringify({
        path,
        chartVisibleMs: performance.now() - start,
        selectedOffer: await chart.getAttribute("data-selected-offer"),
      }),
      contentType: "application/json",
    });
    expect(pageErrors).toEqual([]);
    await chart.getByRole("button", { name: "Last 30 days" }).click();
    await expect(
      chart
        .getByRole("alert")
        .getByText("History unavailable", { exact: true }),
    ).toBeVisible();
    await chart.getByLabel("Choose providers").click();
    await expect(
      chart.getByTestId("provider-history-row").first(),
    ).toBeVisible();
    await expect(
      chart.getByTestId("provider-history-row").first(),
    ).toContainText("History unavailable");
    await expect(
      chart.getByTestId("provider-history-row").first(),
    ).toContainText("$");
  });
}

test("provider history lines are included in the static HTML", async ({
  browser,
  baseURL,
}, info) => {
  const context = await browser.newContext({ javaScriptEnabled: false, extraHTTPHeaders: info.project.use.extraHTTPHeaders });
  const page = await context.newPage();
  await page.goto(`${baseURL}/`);
  const chart = page.locator('[aria-label="GPU price monitoring"]');
  await expect(chart.locator("[data-price-line]").first()).toHaveAttribute(
    "d",
    /^M/,
  );
  await chart.getByLabel("Choose providers").click();
  await expect(chart.getByTestId("provider-history-row").first()).toBeVisible();
  await expect(chart).toContainText(/\d+ stored observations/);
  await expect(
    chart.getByText("Loading price history…", { exact: true }),
  ).toHaveCount(0);
  await context.close();
});

test("the mobile history sheet reuses the initial recorded history", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/market-history?*", (route) => route.abort());
  await page.route("**/api/prices", (route) => route.abort());
  await page.goto("/");
  await page
    .getByRole("button", { name: "Show price history", exact: true })
    .click();
  const chart = page.locator('[aria-label="GPU price monitoring"]');
  await expect(chart.getByTestId("price-history-chart")).toBeVisible();
  await expect(chart).toContainText(/\d+ stored observations/);
  await expect(
    chart.getByText("Loading price history…", { exact: true }),
  ).toHaveCount(0);
  await info.attach("mobile-initial-history.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});
