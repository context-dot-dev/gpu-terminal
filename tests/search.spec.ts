import { test, expect, type Page, type Route } from "@playwright/test";
import type { Snapshot } from "../src/lib/types";

async function openDashboard(page: Page) {
  const at = new Date().toISOString();
  const snapshot: Snapshot = {
    loadedAt: at,
    providers: [
      {
        id: "runpod",
        checkedAt: at,
        observedAt: at,
        status: "ok",
        message: "E2E fixture",
        rates: [
          {
            id: "000000000000000000000001",
            providerId: "runpod",
            gpu: "NVIDIA H100",
            vramGb: 80,
            gpuCount: 1,
            region: "US",
            plan: "E2E fixture",
            billing: "On-demand",
            currency: "USD",
            amount: 2,
            unit: "gpu-hour",
            hourly: 2,
            priceType: "Exact",
            availability: "Available",
            evidence: "Synthetic E2E fixture.",
            notes: "",
            sourceUrl: "https://www.runpod.io/pricing",
            observedAt: at,
          },
        ],
      },
    ],
  };
  await page.route("**/api/prices", (route: Route) =>
    route.fulfill({ json: snapshot }),
  );
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText(/\d+ fresh sources/)).toBeVisible();
}

test("global Cmd/Ctrl+K opens search and Escape closes it", async ({
  page,
}) => {
  await openDashboard(page);
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("visible search button opens the GPU search dialog", async ({ page }) => {
  await openDashboard(page);
  await page.getByRole("button", { name: /Search GPUs, providers/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("combobox", {
      name: "Search GPUs, providers, or enter a query",
    }),
  ).toBeFocused();
});

test("selecting a provider applies its filter and closes search", async ({
  page,
}) => {
  await openDashboard(page);
  await page.getByRole("button", { name: /Search GPUs, providers/ }).click();
  await page.getByRole("option", { name: /Runpod/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Provider", exact: true }),
  ).toContainText("Runpod");
});

test("an empty query keeps the searchable providers, GPU families, and tabs available", async ({
  page,
}) => {
  await openDashboard(page);
  await page.getByRole("button", { name: /Search GPUs, providers/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("combobox", {
      name: "Search GPUs, providers, or enter a query",
    }),
  ).toHaveValue("");
  await expect(dialog.getByRole("option", { name: /Runpod/ })).toBeVisible();
  await expect(dialog.getByRole("option", { name: /H100/ })).toBeVisible();
  await expect(dialog.getByRole("option", { name: /Saved/ })).toBeVisible();
});

test("Enter submits a free-text search query", async ({ page }) => {
  await openDashboard(page);
  await page.getByRole("button", { name: /Search GPUs, providers/ }).click();
  const input = page.getByRole("combobox", {
    name: "Search GPUs, providers, or enter a query",
  });
  await input.fill("no matching gpu phrase");
  await input.press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("#search-explore")).toHaveValue(
    "no matching gpu phrase",
  );
});
