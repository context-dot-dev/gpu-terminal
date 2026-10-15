import { test, expect } from "@playwright/test";
import type { Rate, Snapshot } from "../src/lib/types";

test("H100 opens with every matching provider, preserves focus and handles missing history", async ({
  page,
}, info) => {
  const now = Date.now();
  const at = new Date(now).toISOString();
  const rates: Rate[] = [
    "runpod",
    "lambda",
    "nebius",
    "vast",
    "hyperstack",
    "crusoe",
  ].map((providerId, i) => ({
    id: String(i + 1).padStart(24, "0"),
    providerId,
    gpu: i % 2 ? "H100 PCIe" : "H100 SXM",
    vramGb: 80,
    gpuCount: i + 1,
    region: "US",
    plan: "Synthetic browser fixture",
    billing: i % 2 ? "Spot" : "On-demand",
    currency: "USD",
    amount: i + 2,
    unit: "gpu-hour",
    hourly: i + 2,
    priceType: "Exact",
    availability: "Not verified",
    evidence: "Synthetic browser fixture, not a provider quote",
    notes: "",
    sourceUrl: "https://www.runpod.io/pricing",
    observedAt: at,
  }));
  const extra: Rate[] = [
    { ...rates[0], id: "a".repeat(24), hourly: 20 },
    { ...rates[1], id: "b".repeat(24), gpu: "H200", hourly: 1 },
    { ...rates[2], id: "c".repeat(24), availability: "Unavailable", hourly: 1 },
    { ...rates[3], id: "d".repeat(24), currency: "EUR", hourly: 1 },
    { ...rates[0], id: "e".repeat(24), gpu: "A100", hourly: 1 },
  ];
  const snapshot: Snapshot = {
    loadedAt: at,
    providers: rates.map((r) => ({
      id: r.providerId,
      checkedAt: at,
      observedAt: at,
      status: "ok",
      message: "Fixture",
      rates: [r, ...extra.filter((e) => e.providerId === r.providerId)],
    })),
  };
  const queries: string[] = [];
  await page.route("**/api/prices", (route) =>
    route.fulfill({ json: snapshot }),
  );
  await page.route("**/api/market-history?*", (route) => {
    const params = new URL(route.request().url()).searchParams;
    queries.push(params.toString());
    return route.fulfill({
      json: {
        loadedAt: at,
        series: params
          .get("ids")!
          .split(",")
          .map((id, index) => ({
            id,
            points:
              params.get("range") === "90d"
                ? [
                    {
                      at: new Date(now - 86400000).toISOString(),
                      hourly: 2,
                      currency: "USD",
                    },
                    { at, hourly: 2, currency: "USD" },
                  ]
                : params.get("range") === "30d"
                  ? []
                  : params.get("range") === "24h" && index === 0
                    ? []
                    : params.get("range") === "24h" && index === 1
                      ? [{ at, hourly: 3, currency: "USD" }]
                      : [
                          {
                            at: new Date(
                              now - (index + 2) * 43200000,
                            ).toISOString(),
                            hourly: index === 5 ? 20 : 1,
                            currency: "USD",
                          },
                          ...(index === 4
                            ? [
                                {
                                  at: new Date(now - 86400000).toISOString(),
                                  hourly: 2,
                                  currency: "USD",
                                },
                              ]
                            : []),
                          {
                            at: new Date(now - index * 3600000).toISOString(),
                            hourly:
                              index === 5
                                ? 20
                                : index === 4
                                  ? 1
                                  : (rates.find((r) => r.id === id)?.hourly ??
                                    20),
                            currency: "USD",
                          },
                        ],
          })),
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  const chart = page.locator('[aria-label="GPU price monitoring"]');
  await expect(
    page.getByRole("combobox", { name: "GPU family", exact: true }),
  ).toContainText("H100");
  await page.getByRole("combobox", { name: "GPU family", exact: true }).click();
  await expect(page.getByRole("listbox").getByRole("option").nth(1)).toHaveText(
    "H100",
  );
  await page.keyboard.press("Escape");
  await expect(
    chart.getByRole("button", { name: "All providers", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const rows = chart.getByTestId("provider-history-row");
  await expect(rows).toHaveCount(6);
  await expect(chart.getByLabel("Selected offer statistics")).toHaveCount(0);
  const plot = chart.getByTestId("provider-line-plot");
  await expect(plot).toHaveCount(1);
  const paths = plot.locator("path[data-price-line]");
  await expect(paths).toHaveCount(6);
  await expect(chart.getByLabel("Search chart providers")).not.toBeVisible();
  await expect(chart.getByLabel("Price movement summary")).toContainText(
    "5 changed",
  );
  await expect(chart.getByLabel("Price movement summary")).toContainText(
    "1 unchanged",
  );
  await expect(
    chart.getByLabel("Providers with price changes").getByRole("button"),
  ).toHaveCount(5);
  await expect(
    chart
      .getByLabel("Providers with price changes")
      .getByRole("button", { name: "Pin Hyperstack", exact: true }),
  ).toBeVisible();
  const flatLine = plot.locator('[data-provider-id="crusoe"]');
  const movingLine = plot.locator('[data-provider-id="runpod"]');
  expect(Number(await flatLine.getAttribute("opacity"))).toBeLessThan(
    Number(await movingLine.getAttribute("opacity")),
  );
  await expect(plot.locator("svg")).toHaveAttribute("aria-label", /to \$20.00/);
  await chart
    .getByRole("button", { name: "Changes only", exact: true })
    .click();
  await expect(paths).toHaveCount(5);
  await expect(plot.locator('[data-provider-id="hyperstack"]')).toHaveCount(1);
  await expect(plot.locator("svg")).toHaveAttribute("aria-label", /to \$5.00/);
  await info.attach("changed-prices-only.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await chart.getByLabel("Choose providers").click();
  await chart
    .getByRole("checkbox", { name: "Pin Crusoe", exact: true })
    .check();
  await expect(paths).toHaveCount(6);
  await expect(plot.locator("svg")).toHaveAttribute("aria-label", /to \$20.00/);
  await chart
    .getByRole("checkbox", { name: "Pin Crusoe", exact: true })
    .uncheck();
  await expect(paths).toHaveCount(5);
  await chart
    .getByRole("button", { name: "Changes only", exact: true })
    .click();
  await chart.getByRole("button", { name: "Last 90 days" }).click();
  await expect(chart.getByLabel("Price movement summary")).toContainText(
    "0 changed · 6 unchanged",
  );
  await chart
    .getByRole("button", { name: "Changes only", exact: true })
    .click();
  await expect(paths).toHaveCount(0);
  await expect(
    chart.getByText(
      "No recorded price changes in this period. Choose Show all to see every price.",
    ),
  ).toBeVisible();
  await chart
    .getByRole("button", { name: "Changes only", exact: true })
    .click();
  await expect(paths).toHaveCount(6);
  await chart.getByRole("button", { name: "Last 7 days" }).click();
  await page.mouse.move(10, 10);
  const initialColors: Record<string, string> = await paths.evaluateAll(
    (lines) =>
      Object.fromEntries(
        lines.map((line) => [
          line.getAttribute("data-provider-id"),
          line.getAttribute("stroke"),
        ]),
      ),
  );
  expect(
    Object.values(initialColors).every(
      (color) => color && !color.includes("muted"),
    ),
  ).toBeTruthy();
  expect(new Set(Object.values(initialColors)).size).toBe(6);
  await expect(plot.locator('[data-emphasized="true"]')).toHaveCount(0);
  await chart.getByLabel("Sort chart providers").selectOption("name");
  await expect(rows.first()).toContainText("Crusoe");
  await chart.getByLabel("Sort chart providers").selectOption("change");
  await expect(rows.first()).toContainText("Vast.ai");
  await chart.getByLabel("Sort chart providers").selectOption("price");
  await expect(rows.first()).toContainText("Runpod");
  await expect(rows.first()).toContainText("+100.0%");
  const keyboardPin = chart.getByRole("checkbox", {
    name: "Pin Runpod",
    exact: true,
  });
  await keyboardPin.focus();
  await keyboardPin.press("Space");
  await expect(keyboardPin).toBeChecked();
  await keyboardPin.press("Space");
  await expect(keyboardPin).not.toBeChecked();
  await chart.getByLabel("Search chart providers").focus();
  const geometry = await paths.evaluateAll((lines) =>
    lines.map((line) => ({
      provider: line.getAttribute("data-provider-id"),
      path: line.getAttribute("d"),
      height: line.closest("svg")!.getAttribute("viewBox"),
    })),
  );
  expect(new Set(geometry.map((g) => g.height)).size).toBe(1);
  // Equal prices share one axis; lines connect observations without step or spline interpolation.
  const starts = geometry
    .filter((g) => g.provider !== "crusoe")
    .map((g) => Number(g.path!.match(/^M[\d.]+,([\d.]+)/)![1]));
  expect(new Set(starts).size).toBe(1);
  expect(
    geometry.every((g) => g.path!.includes("L") && !/[HVQC]/.test(g.path!)),
  ).toBeTruthy();
  await chart.getByLabel("Search chart providers").fill("Runpod");
  await expect(rows).toHaveCount(1);
  await expect(paths).toHaveCount(6);
  await rows.first().hover();
  await expect(plot.locator('[data-provider-id="runpod"]')).toHaveAttribute(
    "data-emphasized",
    "true",
  );
  await chart.getByLabel("Search chart providers").fill("");
  const endpoint = await plot
    .locator('[data-provider-id="runpod"]')
    .evaluate((line) => {
      const path = line as SVGPathElement;
      const point = path.getPointAtLength(path.getTotalLength());
      const screen = new DOMPoint(point.x, point.y).matrixTransform(
        path.getScreenCTM()!,
      );
      return { x: screen.x, y: screen.y };
    });
  await page.mouse.move(endpoint.x - 1, endpoint.y);
  await expect(chart.getByTestId("provider-history-observation")).toContainText(
    "Runpod · $2.00/GPU/hr",
  );

  const tooltip = plot.getByRole("tooltip");
  await expect(tooltip).toContainText("Runpod");
  await expect(tooltip).toContainText("$2.00/GPU/hr");
  await expect(tooltip).toContainText("UTC");
  await expect(tooltip.getByTestId("provider-logo")).toHaveAttribute(
    "data-provider-id",
    "runpod",
  );
  const tooltipBox = await tooltip.boundingBox();
  const plotBox = await plot.boundingBox();
  expect(tooltipBox!.x).toBeGreaterThanOrEqual(plotBox!.x);
  expect(tooltipBox!.x + tooltipBox!.width).toBeLessThanOrEqual(
    plotBox!.x + plotBox!.width,
  );
  await page.mouse.click(endpoint.x - 1, endpoint.y);
  await expect(
    chart.getByRole("checkbox", { name: "Pin Runpod", exact: true }),
  ).toBeChecked();
  await page.mouse.click(endpoint.x - 1, endpoint.y);
  await expect(
    chart.getByRole("checkbox", { name: "Pin Runpod", exact: true }),
  ).not.toBeChecked();
  await info.attach("provider-hover.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  for (const [id, name] of [
    ["runpod", "Runpod"],
    ["lambda", "Lambda"],
    ["nebius", "Nebius"],
  ]) {
    const position = await plot
      .locator(`[data-price-line][data-provider-id="${id}"]`)
      .evaluate((element) => {
        const line = element as SVGPathElement;
        const point = line.getPointAtLength(line.getTotalLength() * 0.6);
        const screen = new DOMPoint(point.x, point.y).matrixTransform(
          line.getScreenCTM()!,
        );
        return { x: screen.x, y: screen.y };
      });
    await page.mouse.move(position.x, position.y);
    await expect(tooltip).toContainText(name);
  }
  await plot.scrollIntoViewIfNeeded();
  const emptyPlotBox = await plot.boundingBox();
  await page.mouse.move(emptyPlotBox!.x + 100, emptyPlotBox!.y + 2);
  await expect(tooltip).toHaveCount(0);
  await page.mouse.move(10, 10);
  await expect(tooltip).toHaveCount(0);
  await expect(rows.first().getByTestId("provider-logo")).toHaveCount(1);

  await chart
    .getByRole("checkbox", { name: "Pin Runpod", exact: true })
    .check();
  await chart
    .getByRole("checkbox", { name: "Pin Lambda", exact: true })
    .check();
  await chart
    .getByRole("button", { name: "Selected providers (2)", exact: true })
    .click();
  await expect(paths).toHaveCount(2);
  await expect(plot.locator('[data-provider-id="runpod"]')).toHaveAttribute(
    "stroke",
    initialColors.runpod,
  );
  await chart
    .getByRole("button", { name: "All providers", exact: true })
    .click();
  await chart
    .getByRole("checkbox", { name: "Pin Nebius", exact: true })
    .check();
  await chart
    .getByRole("checkbox", { name: "Pin Vast.ai", exact: true })
    .check();
  await chart
    .getByRole("checkbox", { name: "Pin Hyperstack", exact: true })
    .check();
  await page.mouse.move(10, 10);
  await expect(plot.locator('[data-emphasized="true"]')).toHaveCount(5);
  await expect(
    chart.getByRole("button", { name: "Selected providers (5)", exact: true }),
  ).toBeVisible();
  await expect(plot.locator('[data-provider-id="runpod"]')).toHaveAttribute(
    "stroke",
    initialColors.runpod,
  );
  await info.attach("five-pinned-providers.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await info.attach("provider-colors.json", {
    body: JSON.stringify(initialColors),
    contentType: "application/json",
  });
  await chart.getByRole("button", { name: "Last 24 hours" }).click();
  await expect(rows.first()).toContainText("No observations");
  await expect(chart.getByLabel("Price movement summary")).toContainText(
    "2 need more history",
  );
  await expect(plot.locator("[data-price-point]")).toHaveCount(1);
  await expect(
    plot.locator('[data-provider-id="lambda"][data-price-line]'),
  ).toHaveCount(0);
  await chart.getByRole("button", { name: "Last 7 days" }).click();
  await expect(paths).toHaveCount(6);
  await expect(plot.locator('[data-provider-id="runpod"]')).toHaveAttribute(
    "stroke",
    initialColors.runpod,
  );
  const ids = new URLSearchParams(queries.at(-1)).get("ids")!.split(",");
  expect(ids.sort()).toEqual(rates.map((r) => r.id).sort());
  await chart
    .getByRole("button", { name: "View Lambda history", exact: true })
    .click();
  await expect(chart).toHaveAttribute("data-selected-offer", rates[1].id);
  await expect(chart.locator(".recharts-line-curve")).toHaveCount(1);
  await expect(chart.locator(".recharts-area-area")).toHaveAttribute(
    "d",
    /^M[^HV]+Z$/,
  );
  await chart
    .getByRole("button", { name: "All providers", exact: true })
    .click();
  await chart.getByRole("button", { name: "Last 30 days" }).click();
  await expect(chart.getByLabel("Price movement summary")).toContainText(
    "6 need more history",
  );
  await chart.getByLabel("Choose providers").click();
  await expect(rows.getByText("No observations", { exact: true })).toHaveCount(
    6,
  );
  await expect(paths).toHaveCount(0);
  await chart.getByRole("button", { name: "Last 7 days" }).click();
  await chart
    .getByRole("button", { name: "Selected providers (5)", exact: true })
    .click();
  await page.getByRole("combobox", { name: "Provider", exact: true }).click();
  await page.getByRole("option", { name: "Lambda", exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(chart).toHaveAttribute("data-history-scope", "providers");
  await chart
    .getByRole("button", { name: "All providers", exact: true })
    .click();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(rows).toHaveCount(6);
  await chart.getByRole("button", { name: "Show all", exact: true }).click();
  await page.mouse.move(10, 10);
  await expect(chart.getByRole("checkbox", { checked: true })).toHaveCount(0);
  await expect(paths).toHaveCount(6);
  await expect(plot.locator('[data-emphasized="true"]')).toHaveCount(0);
  await info.attach("all-providers-desktop.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Show price history", exact: true })
    .click();
  await expect(rows).toHaveCount(6);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  expect(
    await chart.evaluate(
      (element) => element.scrollHeight <= element.clientHeight,
    ),
  ).toBeTruthy();
  await chart.getByLabel("Choose providers").click();
  await rows.last().scrollIntoViewIfNeeded();
  await expect(rows.last()).toBeInViewport();
  await info.attach("all-providers-mobile.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await plot.scrollIntoViewIfNeeded();
  const mobilePoint = await plot
    .locator('[data-price-line][data-provider-id="runpod"]')
    .evaluate((element) => {
      const line = element as SVGPathElement;
      const point = line.getPointAtLength(line.getTotalLength());
      const screen = new DOMPoint(point.x, point.y).matrixTransform(
        line.getScreenCTM()!,
      );
      return { x: screen.x, y: screen.y };
    });
  await page.mouse.move(mobilePoint.x - 1, mobilePoint.y);
  await expect(tooltip).toContainText("Runpod");
  const mobileTooltip = await tooltip.boundingBox();
  expect(mobileTooltip!.x).toBeGreaterThanOrEqual(0);
  expect(mobileTooltip!.x + mobileTooltip!.width).toBeLessThanOrEqual(390);
  await info.attach("provider-hover-mobile.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await info.attach("history-requests.json", {
    body: JSON.stringify(queries),
    contentType: "application/json",
  });
});

test("history API accepts all matching providers in one request", async ({
  request,
}, info) => {
  const snapshot: Snapshot = await (await request.get("/api/prices")).json();
  const offers = snapshot.providers.flatMap((p) => {
    const rate = p.rates.find(
      (r) => /H100/i.test(r.gpu) && r.currency === "USD",
    );
    return rate ? [rate] : [];
  });
  expect(offers.length).toBeGreaterThan(4);
  const response = await request.get(
    `/api/market-history?ids=${offers.map((r) => r.id).join(",")}&range=7d`,
  );
  expect(response.ok()).toBeTruthy();
  const history = await response.json();
  expect(history.series.map((s: { id: string }) => s.id).sort()).toEqual(
    offers.map((r) => r.id).sort(),
  );
  await info.attach("all-provider-api.json", {
    body: JSON.stringify(history),
    contentType: "application/json",
  });
});
