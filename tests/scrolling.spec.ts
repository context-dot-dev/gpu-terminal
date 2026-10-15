import { test, expect } from "@playwright/test";

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1440, height: 600 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
]) {
  test(`fixed workspace and stable table header at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    await page.goto("/?family=H100");
    const frame = page.getByRole("region", { name: "GPU offers", exact: true });
    const table = frame.locator('[data-slot="table-container"]');
    const header = frame.locator("thead");
    await expect(page.getByTestId("price-row").first()).toBeVisible();
    const initial = await header.boundingBox();
    const frameBox = await frame.boundingBox();
    expect(frameBox!.height).toBeGreaterThan(100);
    await table.hover();
    await page.mouse.wheel(0, 350);
    await expect
      .poll(() => table.evaluate((e) => e.scrollTop))
      .toBeGreaterThan(50);
    const after = await header.boundingBox();
    expect(Math.abs(after!.y - initial!.y)).toBeLessThan(2);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(
      await page.locator(".market-pane").evaluate((e) => e.scrollTop),
    ).toBe(0);
    await expect(
      page.getByRole("button", { name: "Next page", exact: true }),
    ).toBeInViewport();
    await table.focus();
    const oldTop = await table.evaluate((e) => e.scrollTop);
    await page.keyboard.press("PageDown");
    await expect
      .poll(() => table.evaluate((e) => e.scrollTop))
      .toBeGreaterThan(oldTop);
    await page.getByRole("button", { name: "Next page", exact: true }).click();
    await expect
      .poll(() => table.evaluate((e) => e.scrollTop))
      .toBeLessThanOrEqual(2);
    await page.getByRole("tab", { name: "Coverage", exact: true }).click();
    const coverage = page.getByRole("region", {
      name: "Provider coverage table",
    });
    const coverageBox = await coverage.boundingBox();
    expect(coverageBox!.y + coverageBox!.height).toBeGreaterThan(
      viewport.height - 100,
    );
    const coverageHead = await coverage.locator("thead").boundingBox();
    await coverage.locator("tbody tr").last().scrollIntoViewIfNeeded();
    await expect(coverage.locator("tbody tr").last()).toBeInViewport();
    expect(
      Math.abs(
        (await coverage.locator("thead").boundingBox())!.y - coverageHead!.y,
      ),
    ).toBeLessThan(2);
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight),
    ).toBeLessThanOrEqual(viewport.height);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width);
    await info.attach("fixed-workspace.png", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    await info.attach("scroll-bounds.json", {
      body: JSON.stringify({
        viewport,
        initial,
        after,
        frameBox,
        coverageBox,
        documentScroll: await page.evaluate(() => window.scrollY),
      }),
      contentType: "application/json",
    });
  });
}

test("touch scrolls only table rows and columns", async ({ browser }, info) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3100",
  });
  const page = await context.newPage();
  await page.goto("/");
  const table = page
    .getByRole("region", { name: "GPU offers", exact: true })
    .locator('[data-slot="table-container"]');
  await expect(page.getByTestId("price-row").first()).toBeVisible();
  const box = (await table.boundingBox())!;
  const session = await context.newCDPSession(page);
  async function swipe(x: number, y: number, dx: number, dy: number) {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    for (let i = 1; i <= 8; i++) {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: x + (dx * i) / 8, y: y + (dy * i) / 8 }],
      });
      await page.waitForTimeout(25);
    }
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  }
  await swipe(180, box.y + box.height - 30, 0, -150);
  await expect
    .poll(() => table.evaluate((e) => e.scrollTop))
    .toBeGreaterThan(80);
  await swipe(330, box.y + 100, -230, 0);
  await expect
    .poll(() => table.evaluate((e) => e.scrollLeft))
    .toBeGreaterThan(80);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.locator(".market-pane").evaluate((e) => e.scrollTop)).toBe(
    0,
  );
  await info.attach("touch-table.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await context.close();
});

test("short windows retain filters, comparisons, and empty-state recovery", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 480 });
  await page.goto("/");
  await expect(
    page.getByRole("region", { name: "GPU offers", exact: true }),
  ).toBeInViewport();
  expect(
    (await page
      .getByRole("region", { name: "GPU offers", exact: true })
      .boundingBox())!.width,
  ).toBeGreaterThan(500);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.getByRole("button", { name: "Configure filters" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page
    .getByRole("textbox", { name: "Search GPU prices" })
    .fill("no-such-gpu-test-xyz");
  await page.getByRole("button", { name: "Explore all prices" }).click();
  await expect(page.getByTestId("price-row").first()).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page
    .getByRole("button", { name: "Compare providers", exact: true })
    .click();
  expect(
    (await page
      .getByRole("region", { name: "GPU offers", exact: true })
      .boundingBox())!.height,
  ).toBeGreaterThan(100);
});
