import { expect, test } from "@playwright/test";

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1440, height: 600 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
]) {
  test(`chart and offers use page scrolling at ${viewport.width}x${viewport.height}`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await page.goto("/?family=H100");
    const table = page.getByRole("region", { name: "GPU offers", exact: true })
      .locator('[data-slot="table-container"]');
    await expect(page.getByTestId("price-row").first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight))
      .toBeGreaterThan(viewport.height);
    expect(await table.evaluate((element) => element.scrollHeight - element.clientHeight))
      .toBeLessThan(2);

    if (viewport.width >= 768) {
      const history = page.locator(".history-pane");
      const providers = page.getByRole("group", { name: "Provider histories" });
      await expect(history).toBeVisible();
      await page.getByLabel("Choose providers").click();
      expect(await history.evaluate((element) => element.scrollHeight - element.clientHeight))
        .toBeLessThan(2);
      expect(await providers.evaluate((element) => element.scrollHeight - element.clientHeight))
        .toBeLessThan(2);
      await history.hover();
      await page.mouse.wheel(0, 450);
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(50);
      expect(await history.evaluate((element) => element.scrollTop)).toBe(0);
    }

    await table.scrollIntoViewIfNeeded();
    const beforeTableWheel = await page.evaluate(() => window.scrollY);
    await table.hover();
    await page.mouse.wheel(0, 350);
    await expect.poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(beforeTableWheel);
    expect(await table.evaluate((element) => element.scrollTop)).toBe(0);

    await page.getByRole("button", { name: "Next page", exact: true }).click();
    await expect(page.getByTestId("price-row").first()).toBeInViewport();
    await page.getByRole("tab", { name: "Coverage", exact: true }).click();
    const coverageTable = page.getByRole("region", { name: "Provider coverage table" })
      .locator('[data-slot="table-container"]');
    expect(await coverageTable.evaluate((element) => element.scrollHeight - element.clientHeight))
      .toBeLessThan(2);
    await coverageTable.scrollIntoViewIfNeeded();
    const beforeCoverageWheel = await page.evaluate(() => window.scrollY);
    await coverageTable.hover();
    await page.mouse.wheel(0, 350);
    await expect.poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(beforeCoverageWheel);
    await info.attach("page-scroll.json", {
      body: JSON.stringify({ viewport, pageHeight: await page.evaluate(() => document.documentElement.scrollHeight) }),
      contentType: "application/json",
    });
  });
}

test("mobile table keeps horizontal scrolling while vertical swipes move the page", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3100",
  });
  const page = await context.newPage();
  await page.goto("/?family=H100");
  const table = page.getByRole("region", { name: "GPU offers", exact: true })
    .locator('[data-slot="table-container"]');
  await expect(page.getByTestId("price-row").first()).toBeVisible();
  await table.scrollIntoViewIfNeeded();
  const box = (await table.boundingBox())!;
  const session = await context.newCDPSession(page);
  async function swipe(dx: number, dy: number) {
    const x = box.x + Math.min(180, box.width / 2);
    const y = Math.max(80, Math.min(box.y + 120, 700));
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (let i = 1; i <= 8; i++) {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: x + (dx * i) / 8, y: y + (dy * i) / 8 }],
      });
      await page.waitForTimeout(25);
    }
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }
  const beforeVertical = await page.evaluate(() => window.scrollY);
  await swipe(0, -150);
  await expect.poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(beforeVertical);
  expect(await table.evaluate((element) => element.scrollTop)).toBe(0);
  await swipe(-230, 0);
  await expect.poll(() => table.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(50);
  await context.close();
});

test("short windows retain filters, comparisons, and empty-state recovery", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 480 });
  await page.goto("/");
  await expect(page.getByRole("region", { name: "GPU offers", exact: true })).toBeVisible();
  await expect(page.getByTestId("price-history-chart")).toBeVisible();
  await page.setViewportSize({ width: 844, height: 390 });
  await page.getByRole("button", { name: "Configure filters" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "Search GPU prices" }).fill("no-such-gpu-test-xyz");
  await page.getByRole("button", { name: "Explore all prices" }).click();
  await expect(page.getByTestId("price-row").first()).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole("button", { name: "Compare providers", exact: true }).click();
  await expect(page.getByRole("region", { name: "GPU offers", exact: true })).toBeVisible();
});
