import { test, expect } from "@playwright/test";

test("snapshot uses shared caching and the dashboard states its update cadence", async ({
  page,
  request,
}, info) => {
  const response = await request.get("/api/prices");
  expect(response.ok()).toBeTruthy();
  expect(response.headers()["cache-control"]).toBe("no-store");
  await page.goto("/");
  await expect(page.locator("footer")).toContainText("Collection every 30m · Auto-sync 10m");
  await info.attach("snapshot-cache-policy.json", {
    body: JSON.stringify({ status: response.status(), headers: response.headers() }, null, 2),
    contentType: "application/json",
  });
});

// Failure cases: CDN caches only a spinner; prices require streamed JavaScript;
// shared URLs reuse another market's HTML; filter clicks refetch the whole page.
test("root prices are visible with JavaScript disabled and no loading shell", async ({
  browser,
  baseURL,
}, info) => {
  const context = await browser.newContext({
    extraHTTPHeaders: info.project.use.extraHTTPHeaders,
    javaScriptEnabled: false,
    viewport: { width: 1440, height: 1100 },
  });
  const page = await context.newPage();
  const started = performance.now();
  const response = await page.goto(`${baseURL}/`);
  await expect(page.getByTestId("price-row").first()).toBeVisible();
  await expect(
    page.getByText("Loading your market…", { exact: true }),
  ).toHaveCount(0);
  await info.attach("static-first-render.json", {
    body: JSON.stringify(
      {
        elapsedMs: performance.now() - started,
        headers: response?.headers(),
        navigation: await page.evaluate(() =>
          performance.getEntriesByType("navigation").map((e) => e.toJSON()),
        ),
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
  await info.attach("static-first-render.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await context.close();
});

test("shared filters produce isolated static HTML and repeat CDN hits", async ({
  browser,
  request,
  baseURL,
}, info) => {
  const paths = [
    "/",
    "/?family=H200",
    "/?provider=nebius&family=H200&fresh=false",
  ];
  const measurements = [];
  for (const path of paths) {
    await request.get(path);
    const start = performance.now();
    const response = await request.get(path);
    const html = await response.text();
    expect(response.ok()).toBeTruthy();
    expect(html).not.toContain("Loading your market");
    if (baseURL?.includes("vercel.app"))
      await expect.poll(async () =>
        (await request.get(path)).headers()["x-vercel-cache"],
        { timeout: 15000 },
      ).toMatch(/HIT|STALE/);
    measurements.push({
      path,
      elapsedMs: performance.now() - start,
      bytes: Buffer.byteLength(html),
      headers: response.headers(),
    });
  }
  const context = await browser.newContext({
    javaScriptEnabled: false,
    extraHTTPHeaders: info.project.use.extraHTTPHeaders,
  });
  const page = await context.newPage();
  await page.goto(`${baseURL}${paths[2]}`);
  await expect(page.getByTestId("price-row").first()).toBeVisible();
  for (const row of await page.getByTestId("price-row").all()) {
    await expect(row).toContainText("H200");
    await expect(row).toContainText("Nebius");
  }
  await info.attach("cdn-responses.json", {
    body: JSON.stringify(measurements, null, 2),
    contentType: "application/json",
  });
  await context.close();
});

test("market filtering reuses the snapshot without page or RSC fetches", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Refresh", exact: true }),
  ).toBeEnabled();
  const requests: string[] = [];
  page.on("request", (request) => {
    if (
      request.isNavigationRequest() ||
      new URL(request.url()).searchParams.has("_rsc")
    )
      requests.push(request.url());
  });
  await page.getByRole("combobox", { name: "GPU family", exact: true }).click();
  await page.getByRole("option", { name: "H200", exact: true }).click();
  await expect(
    page.locator('[aria-label="GPU price monitoring"]'),
  ).toContainText("H200 price history");
  await page.goBack();
  await expect(
    page.locator('[aria-label="GPU price monitoring"]'),
  ).toContainText("H100 price history");
  expect(requests).toEqual([]);
});

test("encoded tracking parameters do not reset table pagination", async ({
  page,
}) => {
  await page.goto("/?family=all&utm_source=shared%20link");
  await expect(page.getByTestId("price-row").first()).toBeVisible();
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.getByText(/^26–50 of /)).toBeVisible();
});

test("filtered coverage hydrates without repeated document navigation", async ({ page }, info) => {
  const navigations: string[] = [];
  page.on("request", (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations.push(request.url());
  });
  await page.goto("/?tab=coverage");
  await expect(page.getByRole("heading", { name: "Provider coverage", exact: true })).toBeVisible();
  await page.getByLabel("Find a provider", { exact: true }).fill("Nebius");
  await expect(page.getByRole("region", { name: "Provider coverage table" })).toContainText("Nebius");
  expect(navigations).toHaveLength(1);
  await info.attach("filtered-navigation.json", {
    body: JSON.stringify({ navigations, url: page.url() }),
    contentType: "application/json",
  });
});
