import { test, expect } from "@playwright/test";

test("GPU ticker moves left, loops, pauses and keeps navigation usable", async ({
  page,
}, info) => {
  await page.goto("/?family=H100");
  const ticker = page.getByTestId("market-ticker");
  const track = ticker.locator(".market-ticker-track");
  await expect(
    page.getByRole("button", { name: "Pause GPU ticker" }),
  ).toBeVisible();
  await page.mouse.move(700, 200);
  const x = () =>
    track.evaluate(
      (element) => new DOMMatrix(getComputedStyle(element).transform).m41,
    );
  const before = await x();
  await expect.poll(x).toBeLessThan(before - 3);
  await ticker.hover();
  await expect(track).toHaveCSS("animation-play-state", "paused");
  await track.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.ready)).then(() => undefined));
  const animationTime = () =>
    track.evaluate((element) => element.getAnimations()[0].currentTime);
  const stopped = await animationTime();
  await page.waitForTimeout(200);
  expect(await animationTime()).toBe(stopped);
  await page.mouse.move(700, 200);
  const groups = track.locator(".market-ticker-group");
  const widths = await groups.evaluateAll((nodes) =>
    nodes.map((node) => node.getBoundingClientRect().width),
  );
  expect(widths).toHaveLength(2);
  expect(widths[0]).toBeCloseTo(widths[1], 1);
  await track.evaluate((element) => {
    const animation = element.getAnimations()[0];
    animation.pause();
    animation.currentTime = 99_999;
  });
  const end = await x();
  expect(end).toBeCloseTo(-widths[0], 0);
  const copy = groups.nth(1).locator('[data-family="H200"]');
  await copy.click();
  await expect(page).toHaveURL(/family=H200/);
  await expect(ticker.getByRole("button", { name: /^Explore / })).toHaveCount(
    8,
  );
  await page.getByRole("button", { name: "Pause GPU ticker" }).click();
  await expect(track).toHaveCSS("animation-name", "none");
  await expect(groups.nth(1)).toBeHidden();
  await page.getByRole("button", { name: "Resume GPU ticker" }).click();
  await expect(track).toHaveCSS("animation-name", "gpu-ticker-drift");
  await page.keyboard.press("Tab");
  await ticker
    .getByRole("button", { name: "Explore RTX A6000", exact: true })
    .focus();
  await expect(track).toHaveCSS("animation-name", "none");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/family=RTX\+A6000/);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(1440);
  await info.attach("ticker-navigation.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});

test("reduced motion leaves a static, horizontally accessible GPU ticker", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?family=H100");
  const ticker = page.getByTestId("market-ticker");
  await expect(ticker.locator(".market-ticker-track")).toHaveCSS(
    "animation-name",
    "none",
  );
  await expect(
    ticker.locator('[aria-hidden="true"].market-ticker-group'),
  ).toBeHidden();
  await ticker
    .getByRole("button", { name: "Explore RTX A6000", exact: true })
    .click();
  await expect(page).toHaveURL(/family=RTX\+A6000/);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await info.attach("ticker-reduced-motion-mobile.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});
