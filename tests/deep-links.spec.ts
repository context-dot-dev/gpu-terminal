import { test, expect } from "@playwright/test";

// Failure cases: shared tabs render Explore; Coverage filters disappear on reload;
// Back/Forward only updates the address bar; rapid text edits lose other filters;
// tab links cannot open independently; nuqs suspends the cached first render.
test("tabs and Coverage filters survive reload and Back/Forward without navigation fetches", async ({
  page,
}, info) => {
  await page.goto("/?family=H200&fresh=false");
  await expect(page.getByTestId("price-row").first()).toBeVisible();
  const navigations: string[] = [];
  page.on("request", (request) => {
    if (
      request.isNavigationRequest() ||
      new URL(request.url()).searchParams.has("_rsc")
    )
      navigations.push(request.url());
  });
  await page.getByRole("tab", { name: "Coverage", exact: true }).click();
  await expect(page).toHaveURL(/tab=coverage/);
  await page.getByLabel("Find a provider").fill("Runpod");
  await expect(page).toHaveURL(/coverageQuery=Runpod/);
  await page.getByRole("combobox", { name: "Collection status" }).click();
  await page.getByRole("option", { name: "ok", exact: true }).click();
  await expect(page).toHaveURL(/coverageStatus=ok/);
  await expect(
    page.getByRole("region", { name: "Provider coverage table" }),
  ).toContainText("Runpod");
  await page.getByRole("tab", { name: /^Saved/ }).click();
  await expect(page).toHaveURL(/tab=saved/);
  await page.goBack();
  await expect(
    page.getByRole("tab", { name: "Coverage", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Find a provider")).toHaveValue("Runpod");
  await expect(
    page.getByRole("combobox", { name: "Collection status" }),
  ).toContainText("ok");
  await page.goForward();
  await expect(page.getByRole("tab", { name: /^Saved/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(navigations).toEqual([]);
  await page.reload();
  await expect(page.getByRole("tab", { name: /^Saved/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page.getByRole("combobox", { name: "GPU family", exact: true }),
  ).toContainText("H200");
  await page.getByRole("tab", { name: "Coverage", exact: true }).click();
  await expect(page.getByLabel("Find a provider")).toHaveValue("Runpod");
  await info.attach("restored-coverage.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});

test("Coverage deep links render filtered content before JavaScript and tabs have real hrefs", async ({
  browser,
  baseURL,
}, info) => {
  const context = await browser.newContext({ javaScriptEnabled: false, extraHTTPHeaders: info.project.use.extraHTTPHeaders });
  const page = await context.newPage();
  await page.goto(
    `${baseURL}/?tab=coverage&coverageQuery=Runpod&coverageStatus=ok`,
  );
  await expect(
    page.getByRole("tab", { name: "Coverage", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Find a provider")).toHaveValue("Runpod");
  await expect(
    page.getByRole("region", { name: "Provider coverage table" }),
  ).toContainText("Runpod");
  await expect(page.getByRole("tab", { name: /^Saved/ })).toHaveAttribute(
    "href",
    /tab=saved/,
  );
  await expect(
    page.getByText("Loading your market…", { exact: true }),
  ).toHaveCount(0);
  await info.attach("coverage-without-javascript.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await context.close();
});

test("shared market filters and booleans remain intact when switching tabs", async ({
  page,
}, info) => {
  const params = new URLSearchParams({
    family: "all",
    provider: "runpod",
    kind: "all",
    billing: "On-demand",
    method: "all",
    region: "all",
    memory: "48",
    exactMemory: "80",
    variant: "SXM",
    community: "exclude",
    interruption: "all",
    storage: "all",
    execution: "all",
    priority: "all",
    budget: "5",
    currency: "USD",
    exact: "true",
    fresh: "false",
    available: "true",
    count: "1",
    totalBudget: "8",
    query: "H100",
  });
  await page.goto(`/?${params}`);
  await page.getByRole("tab", { name: "Coverage", exact: true }).click();
  await expect(page).toHaveURL(/tab=coverage/);
  const actual = new URL(page.url()).searchParams;
  for (const [key, value] of params) expect(actual.get(key)).toBe(value);
  await page.getByRole("tab", { name: "Explore prices", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Within refresh window" }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Exclude “starting at” prices" }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Explicitly in stock only" }),
  ).toBeChecked();
  await info.attach("filter-url.json", {
    body: JSON.stringify(
      Object.fromEntries(new URL(page.url()).searchParams),
      null,
      2,
    ),
    contentType: "application/json",
  });
});

test("typing, sharing, reset and modified tab clicks preserve the intended URL", async ({
  page,
  context,
}, info) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/?family=H200&tab=coverage");
  const search = page.getByLabel("Find a provider");
  await search.fill("Lambda Labs");
  await page.getByRole("button", { name: "Share filters" }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(new URL(copied).searchParams.get("coverageQuery")).toBe("Lambda Labs");
  expect(new URL(copied).searchParams.get("tab")).toBe("coverage");
  const popupPromise = context.waitForEvent("page");
  await page
    .getByRole("tab", { name: /^Saved/ })
    .click({ modifiers: ["ControlOrMeta"] });
  const popup = await popupPromise;
  await popup.waitForLoadState();
  await expect(popup.getByRole("tab", { name: /^Saved/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page.getByRole("tab", { name: "Coverage", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await popup.close();
  await page
    .getByRole("link", { name: "gpu-terminal COMPUTE MARKETS", exact: true })
    .click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("tab", { name: "Explore prices", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.goBack();
  await expect(search).toHaveValue("Lambda Labs");
  await info.attach("shared-url.txt", {
    body: copied,
    contentType: "text/plain",
  });
});
