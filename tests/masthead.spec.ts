import { test, expect } from "@playwright/test";

// Failure cases: stale CSS leaves an unstyled masthead; navigation overlaps
// search; a taller header clips the terminal; project links disappear at short
// heights; moving tabs breaks deep links.
for (const viewport of [
  { width: 1440, height: 1100 },
  { width: 1024, height: 768 },
  { width: 1024, height: 640 },
  { width: 390, height: 844 },
  { width: 320, height: 640 },
]) {
  test(`masthead stays readable and usable at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const header = page.locator("header.terminal-masthead");
    await expect(header).toHaveCSS("display", "flex");
    const brand = header.getByRole("link", {
      name: "gpu-terminal COMPUTE MARKETS",
      exact: true,
    });
    await expect(page).toHaveTitle("gpu-terminal — GPU Cloud Price Monitor");
    await expect(brand).toContainText("gpu-terminal");
    await expect(brand).toHaveCSS("font-family", /Georgia/);
    const projectLinks = page.getByRole("navigation", { name: "Project links" });
    const visibleLinks = projectLinks.filter({ visible: true });
    await expect(visibleLinks).toHaveCount(1);
    await expect(visibleLinks.getByRole("link", { name: "Powered by Context.dev" }))
      .toHaveAttribute("href", "https://context.dev/");
    await expect(visibleLinks.getByRole("link", { name: "Open source" }))
      .toHaveAttribute("href", "https://github.com/context-dot-dev/gpu-terminal");
    await expect(visibleLinks.locator("img")).toBeVisible();
    await expect(visibleLinks.locator("svg")).toBeVisible();
    const elements = [
      brand,
      header.getByRole("button", { name: /Search GPUs, providers/ }),
      header.getByRole("tablist"),
      header.getByRole("button", { name: "Methodology" }),
    ];
    const boxes = [];
    for (const element of elements) {
      await expect(element).toBeVisible();
      const box = (await element.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      boxes.push(box);
    }
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i],
          b = boxes[j];
        expect(
          a.x + a.width <= b.x + 1 ||
            b.x + b.width <= a.x + 1 ||
            a.y + a.height <= b.y + 1 ||
            b.y + b.height <= a.y + 1,
        ).toBeTruthy();
      }
    await header.getByRole("tab", { name: "Coverage", exact: true }).click();
    await expect(page).toHaveURL(/tab=coverage/);
    await expect(page.getByLabel("Find a provider")).toBeVisible();
    await header
      .getByRole("button", { name: /Search GPUs, providers/ })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight),
    ).toBeGreaterThan(viewport.height);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(viewport.width);
    await info.attach("masthead.png", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  });
}
