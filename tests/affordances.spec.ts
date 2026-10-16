import { test, expect } from "@playwright/test";

// Guard against navigation selecting a row, button roles on anchors, lost
// keyboard selection, invisible hover/focus, and links on unverified names.
test("provider links navigate while GPU buttons select without moving the workspace", async ({
  page,
}, info) => {
  await page.goto("/?family=H100&fresh=false");
  const rows = page.getByTestId("price-row");
  await expect(rows.nth(1)).toBeVisible();
  const row = rows.nth(1);
  const gpu = row.getByRole("button").first();
  await gpu.focus();
  await page.keyboard.press("Enter");
  await expect(row).toHaveAttribute("data-focused", "true");
  await expect(gpu).toHaveAttribute("aria-pressed", "true");
  const provider = rows.first().getByRole("link");
  await expect(provider).toHaveAttribute("href", /^https:\/\//);
  await expect(provider).toHaveAttribute("target", "_blank");
  expect(await provider.evaluate((el) => el.tagName)).toBe("A");
  await provider.hover();
  await expect(provider).toHaveCSS("text-decoration-line", "underline");
  await expect(provider).toHaveCSS("cursor", "pointer");
  const id = await page
    .getByTestId("selected-offer-panel")
    .getAttribute("data-offer-id");
  // Observe activation without requesting the external provider.
  await provider.evaluate((el) =>
    el.addEventListener("click", (event) => event.preventDefault(), {
      once: true,
    }),
  );
  await provider.click();
  await expect(page.getByTestId("selected-offer-panel")).toHaveAttribute(
    "data-offer-id",
    id!,
  );
  await expect(
    page.getByTestId("selected-offer-panel").getByRole("link"),
  ).toHaveAttribute("href", /^https:\/\//);
  await page
    .getByRole("button", { name: "Source details", exact: true })
    .click();
  const source = page.getByRole("link", { name: "Open provider pricing" });
  expect(await source.evaluate((el) => el.tagName)).toBe("A");
  expect(await source.getAttribute("role")).not.toBe("button");
  await page.keyboard.press("Escape");
  await gpu.focus();
  await expect(gpu).toBeFocused();
  expect(await gpu.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe(
    "none",
  );
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await info.attach("provider-links-and-keyboard-focus", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});

test("controls give hover feedback and coverage uses native provider links", async ({
  page,
}, info) => {
  await page.goto("/?family=H100");
  const refresh = page.getByRole("button", { name: "Refresh", exact: true });
  await expect(refresh).toBeEnabled();
  await page.mouse.move(0, 0);
  const before = await refresh.evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const bounds = await refresh.boundingBox();
  await refresh.hover();
  await expect
    .poll(() => refresh.evaluate((el) => getComputedStyle(el).backgroundColor))
    .not.toBe(before);
  expect(await refresh.boundingBox()).toEqual(bounds);
  await expect(refresh).toHaveCSS("cursor", "pointer");
  await page.getByRole("tab", { name: "Coverage", exact: true }).click();
  const table = page.getByRole("region", { name: "Provider coverage table" });
  const provider = table.getByRole("link").first();
  expect(await provider.evaluate((el) => el.tagName)).toBe("A");
  expect(await provider.getAttribute("role")).toBeNull();
  await provider.hover();
  await expect(provider).toHaveCSS("text-decoration-line", "underline");
  await info.attach("coverage-provider-hover", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});
