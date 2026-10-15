import { test, expect } from "@playwright/test";

// Failure cases: root rewrites itself; shared links first render H100;
// home changes the URL without resetting filters; Back/Forward changes only
// the address bar; slow refresh renders a false no-results state.
test("root stays canonical and home, Back and Forward restore matching markets", async ({
  page,
}, info) => {
  await page.goto("/");
  await expect(page.getByTestId("price-row").first()).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  const family = page.getByRole("combobox", {
    name: "GPU family",
    exact: true,
  });
  await expect(family).toContainText("H100");
  await family.click();
  await page.getByRole("option", { name: "H200", exact: true }).click();
  await expect(page).toHaveURL(/family=H200/);
  await expect(
    page.locator('[aria-label="GPU price monitoring"]'),
  ).toContainText("H200 price history");
  await page
    .getByRole("link", { name: "gpu-terminal COMPUTE MARKETS", exact: true })
    .click();
  await expect(page).toHaveURL(/\/$/);
  await expect(family).toContainText("H100");
  await expect(
    page.locator('[aria-label="GPU price monitoring"]'),
  ).toContainText("H100 price history");
  await page.goBack();
  await expect(page).toHaveURL(/family=H200/);
  await expect(family).toContainText("H200");
  await page.goForward();
  await expect(family).toContainText("H100");
  await info.attach("home-url-and-market.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});

test("shared filters are rendered correctly before hydration without a default-H100 flash", async ({
  browser,
  baseURL,
}, info) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
  });
  await context.route("**/_next/static/**/*.js", (route) => route.abort());
  const page = await context.newPage();
  await page.goto(`${baseURL}/?family=H200&provider=nebius&fresh=false`);
  await expect(page.getByTestId("price-row").first()).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "GPU family", exact: true }),
  ).toContainText("H200");
  await expect(
    page.locator('[aria-label="GPU price monitoring"]'),
  ).toContainText("H200 price history");
  for (const row of await page.getByTestId("price-row").all())
    await expect(row).toContainText("H200");
  await expect(
    page.getByText("No matching rates", { exact: true }),
  ).toHaveCount(0);
  await info.attach("shared-link-before-javascript.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await context.close();
});

test("pending unmatched refresh does not claim there are no matching offers", async ({
  page,
}, info) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/prices", async (route) => {
    await held;
    await route.fulfill({ status: 503, json: { error: "Fixture outage" } });
  });
  await page.goto("/?family=H100&budget=0.000000000001");
  await expect(
    page.getByRole("button", { name: "Updating", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Checking matching prices…", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No matching rates", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("No matching prices", { exact: true }),
  ).toHaveCount(0);
  await info.attach("pending-results.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  release();
  await expect(
    page.getByText(/Could not load the latest snapshot/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Include older observations",
      exact: true,
    }),
  ).toBeVisible();
});
