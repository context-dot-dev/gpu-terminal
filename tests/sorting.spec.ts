import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { Rate, Snapshot } from "../src/lib/types";

// Exercise numeric vs lexical order, missing values, ties, pagination, saved
// offers, merged directory entries, keyboard toggles and comparison columns.
const rates: Rate[] = Array.from({ length: 32 }, (_, i) => ({
  id: (i + 1).toString(16).padStart(24, "0"),
  providerId: i % 2 ? "lambda" : "runpod",
  gpu: `H100 Fixture ${i + 1}`,
  vramGb: i === 31 ? null : i + 1,
  gpuCount: i === 31 ? null : (i % 8) + 1,
  region: i % 2 ? "Europe" : "US",
  plan: `Plan ${i + 1}`,
  billing: i % 2 ? "Spot" : "On-demand",
  currency: "USD",
  amount: i + 1,
  unit: "gpu-hour",
  hourly: i + 1,
  priceType: "Exact",
  availability: "Not verified",
  evidence: `H100 Fixture ${i + 1} $${i + 1}/GPU/hour`,
  notes: "Sorting test fixture",
  sourceUrl: "https://www.runpod.io/pricing",
  observedAt: new Date(Date.now() - i * 60_000).toISOString(),
}));
const fixture: Snapshot = {
  loadedAt: new Date().toISOString(),
  providers: ["runpod", "lambda"].map((id, i) => ({
    id,
    status: "ok",
    message: i ? "Alpha evidence" : "Zeta evidence",
    observedAt: rates[i].observedAt,
    checkedAt: rates[i].observedAt,
    rates: rates.filter((r) => r.providerId === id),
  })),
};
async function openFixture(page: Page) {
  await page.route("**/api/prices", (route) =>
    route.fulfill({ json: fixture }),
  );
  await page.route("**/api/*history?*", (route) =>
    route.fulfill({ json: { points: [], series: [] } }),
  );
  await page.goto("/?family=H100&fresh=false");
  await expect(page.getByTestId("price-row").first()).toContainText("Fixture");
}

test("offer headers sort the whole result, reset pagination and keep rows in view", async ({
  page,
}, info) => {
  await openFixture(page);
  const table = page.getByRole("region", { name: "GPU offers", exact: true });
  const first = page.getByTestId("price-row").first();
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await table
    .getByRole("button", { name: "Sort by Rate /GPU/hr", exact: true })
    .click();
  await expect(first).toContainText("H100 Fixture 32");
  await expect(page.getByText("Page 1 of 2", { exact: true })).toBeVisible();
  await expect(
    table.getByRole("columnheader", { name: /Rate/ }),
  ).toHaveAttribute("aria-sort", "descending");
  const rateSort = table.getByRole("button", {
    name: "Sort by Rate /GPU/hr",
    exact: true,
  });
  await rateSort.focus();
  await page.keyboard.press("Enter");
  await expect(first).toContainText("H100 Fixture 1");
  await table
    .getByRole("button", { name: "Sort by GPU VRAM", exact: true })
    .click();
  await expect(first).toContainText("H100 Fixture 1");
  await table
    .getByRole("button", { name: "Sort by GPU VRAM", exact: true })
    .click();
  await expect(first).toContainText("H100 Fixture 31");
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.getByTestId("price-row").last()).toContainText(
    "H100 Fixture 32",
  );
  await table
    .getByRole("button", { name: "Sort by Provider", exact: true })
    .click();
  await expect(first).toContainText("Lambda");
  await table.getByRole("button", { name: "Sort by GPU", exact: true }).click();
  await expect(first).toContainText("H100 Fixture 1");
  await table
    .getByRole("button", { name: "Sort by Configuration", exact: true })
    .click();
  await expect(first).toContainText("On-demand");
  await table
    .getByRole("button", { name: "Sort by Checked", exact: true })
    .click();
  await expect(first).toContainText("H100 Fixture 32");
  await expect(first).toBeInViewport();
  await info.attach("sorted-offers.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});

test("the sort menu exposes secondary fields and CSV follows the complete sorted result", async ({
  page,
}) => {
  await openFixture(page);
  await page
    .getByRole("combobox", { name: "Sort prices", exact: true })
    .click();
  await page
    .getByRole("option", { name: "Required GPUs: high to low", exact: true })
    .click();
  await expect(page.getByTestId("price-row").first()).toContainText(
    "8 GPUs required",
  );
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV", exact: true }).click();
  const download = await downloadPromise;
  const csv = await readFile((await download.path())!, "utf8");
  const lines = csv.trim().split("\n");
  expect(lines).toHaveLength(33);
  expect(lines[1]).toContain("H100 Fixture 8");
  expect(lines.at(-1)).toContain("H100 Fixture 32");
});

test("saved offers retain header sorting", async ({ page }) => {
  await page.addInitScript(
    (ids) => localStorage.setItem("gpu-atlas-saved", JSON.stringify(ids)),
    [rates[0].id, rates[10].id, rates[31].id],
  );
  await openFixture(page);
  await page.getByRole("tab", { name: "Saved (3)" }).click();
  await page
    .getByRole("region", { name: "GPU offers", exact: true })
    .getByRole("button", { name: "Sort by Rate /GPU/hr", exact: true })
    .click();
  await expect(page.getByTestId("price-row").first()).toContainText(
    "H100 Fixture 32",
  );
});

test("coverage sorts every column including unverified directory entries", async ({
  page,
}, info) => {
  await openFixture(page);
  await page.getByRole("tab", { name: "Coverage", exact: true }).click();
  const table = page.getByRole("region", { name: "Provider coverage table" });
  const rows = table.locator("tbody tr");
  await table
    .getByRole("button", { name: "Sort by Provider", exact: true })
    .click();
  const firstName = await rows.first().locator("td").first().innerText();
  await table
    .getByRole("button", { name: "Sort by Provider", exact: true })
    .click();
  expect(await rows.first().locator("td").first().innerText()).not.toBe(
    firstName,
  );
  await table
    .getByRole("button", { name: "Sort by Rates", exact: true })
    .click();
  await table
    .getByRole("button", { name: "Sort by Rates", exact: true })
    .click();
  await expect(rows.first().locator("td").nth(2)).toHaveText("16");
  await expect(rows.last().locator("td").nth(2)).toHaveText("—");
  await table
    .getByRole("button", { name: "Sort by Last attempt", exact: true })
    .click();
  await expect(rows.first()).toContainText("Lambda");
  await table
    .getByRole("button", { name: "Sort by Last attempt", exact: true })
    .click();
  await expect(rows.first()).toContainText("Runpod");
  await expect(rows.last()).toContainText(/Not collected|Not checked/);
  await table
    .getByRole("button", { name: "Sort by Collection", exact: true })
    .click();
  await expect(
    table.getByRole("columnheader", { name: /Collection/ }),
  ).toHaveAttribute("aria-sort", "ascending");
  await table
    .getByRole("button", { name: "Sort by Details", exact: true })
    .click();
  await expect(rows.first()).toContainText("Alpha evidence");
  await info.attach("sorted-coverage.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});

test("comparison attributes order offers without mixing numeric units", async ({
  page,
}, info) => {
  await openFixture(page);
  await page.getByTestId("price-row").nth(0).getByRole("checkbox").check();
  await page.getByTestId("price-row").nth(1).getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Compare selected", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Sort by Per GPU /hr", exact: true })
    .click();
  await expect(dialog.locator("thead th").nth(1)).toContainText("Runpod");
  await dialog
    .getByRole("button", { name: "Sort by Per GPU /hr", exact: true })
    .click();
  await expect(dialog.locator("thead th").nth(1)).toContainText("Lambda");
  await expect(
    dialog.getByRole("button", { name: "Sort by Per GPU /hr", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await info.attach("sorted-comparison.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});

test("comparison money sorting groups currencies in both directions", async ({
  page,
}, info) => {
  const mixed: Snapshot = {
    ...fixture,
    providers: fixture.providers.map((p) => ({
      ...p,
      rates: p.rates
        .slice(0, 1)
        .map((r) => ({ ...r, currency: p.id === "lambda" ? "EUR" : "USD" })),
    })),
  };
  await page.route("**/api/prices", (route) => route.fulfill({ json: mixed }));
  await page.route("**/api/*history?*", (route) =>
    route.fulfill({ json: { points: [], series: [] } }),
  );
  await page.goto("/?family=H100&fresh=false");
  await expect(page.getByTestId("price-row")).toHaveCount(1);
  await expect(page.getByTestId("price-row").first()).toContainText(
    "Fixture 1",
  );
  await page.getByTestId("price-row").getByRole("checkbox").check();
  await page.getByRole("combobox", { name: "Currency", exact: true }).click();
  await page.getByRole("option", { name: "EUR", exact: true }).click();
  await expect(page.getByTestId("price-row").first()).toContainText(
    "Fixture 2",
  );
  await page.getByTestId("price-row").getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Compare selected", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  for (let i = 0; i < 2; i++) {
    await dialog
      .getByRole("button", { name: "Sort by Per GPU /hr", exact: true })
      .click();
    const row = dialog
      .getByRole("row")
      .filter({
        has: page.getByRole("button", {
          name: "Sort by Per GPU /hr",
          exact: true,
        }),
      });
    await expect(row.locator("td").nth(1)).toContainText("€2.00");
    await expect(row.locator("td").nth(2)).toContainText("$1.00");
  }
  await info.attach("currency-grouped-comparison.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});
