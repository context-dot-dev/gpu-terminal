import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { Rate, Snapshot } from "../src/lib/types";

test("GPU families, original fractional prices and CSV remain unambiguous", async ({
  page,
}, info) => {
  const observedAt = new Date().toISOString();
  const models = [
    "NVIDIA B200",
    "NVIDIA GB200 NVL72",
    "NVIDIA H200",
    "NVIDIA GH200",
    "RTX A6000",
    "NVIDIA A10G",
  ];
  const rates: Rate[] = models.map((gpu, i) => ({
    id: String(i + 1).padStart(24, "0"),
    providerId: "runpod",
    gpu,
    vramGb: 80,
    gpuCount: 1,
    region: "Not specified",
    plan: gpu,
    billing: "On-demand",
    currency: "USD",
    amount: i === 0 ? 0.00001234 : i === 1 ? 0.01 : 2,
    unit: i === 0 ? "gpu-second" : "gpu-hour",
    hourly: i === 0 ? 0.00001234 * 3600 : i === 1 ? 0.01 : 2,
    priceType: "Exact",
    availability: "Not verified",
    evidence:
      "Synthetic browser regression scenario; no published provider quote.",
    notes: "\t=1+1",
    sourceUrl: "https://www.runpod.io/pricing",
    observedAt,
  }));
  const snapshot: Snapshot = {
    loadedAt: observedAt,
    providers: [
      {
        id: "runpod",
        checkedAt: observedAt,
        observedAt,
        status: "ok",
        message: "Browser regression fixture",
        rates,
      },
    ],
  };
  await page.goto("/?family=all");
  await page.route("**/api/prices", (route) =>
    route.fulfill({ json: snapshot }),
  );
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByTestId("price-row")).toHaveCount(6);
  const family = page.getByRole("combobox", {
    name: "GPU family",
    exact: true,
  });
  await family.click();
  for (const name of ["B200", "GB200", "H200", "GH200", "RTX A6000", "A10G"])
    await expect(page.getByRole("option", { name, exact: true })).toBeVisible();
  await page.getByRole("option", { name: "B200", exact: true }).click();
  await expect(page.getByTestId("price-row")).toHaveCount(1);
  await expect(page.getByTestId("price-row")).not.toContainText("GB200");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const csv = await readFile((await (await download).path())!, "utf8");
  expect(csv).toContain('"\'\t=1+1"');
  await page
    .getByTestId("price-row")
    .getByRole("button", { name: /^Source details for/ })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText("$0.00001234 /gpu-second", { exact: true }),
  ).toBeVisible();
  await dialog.getByLabel("Estimate runtime (hours)").fill("0.5");
  await expect(
    dialog.getByText("Enter between 1 and 8,760 hours."),
  ).toBeVisible();
  await info.attach("dashboard-regression.png", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  await info.attach("escaped-export.csv", {
    body: csv,
    contentType: "text/csv",
  });
});
