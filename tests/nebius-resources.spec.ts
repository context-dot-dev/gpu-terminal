import { expect, test } from "@playwright/test";
import type { Snapshot } from "../src/lib/types";

test("Nebius B200 exposes GPU memory and published host resources", async ({ page, request }, info) => {
  const response = await request.get("/api/prices");
  expect(response.ok()).toBeTruthy();
  const snapshot: Snapshot = await response.json();
  const b200 = snapshot.providers
    .find((provider) => provider.id === "nebius")!
    .rates.find((rate) => rate.gpu === "NVIDIA HGX B200" && rate.billing === "On-demand")!;
  expect(b200.vcpus).toBe(20);
  expect(b200.ramGb).toBe(224);

  await page.goto("/?family=B200&provider=nebius");
  const row = page.getByTestId("price-row").filter({ hasText: "NVIDIA HGX B200" }).first();
  await expect(row).toBeVisible();
  await row.click();
  await info.attach("nebius-resources.png", {
    body: await page.screenshot(), contentType: "image/png",
  });
  const selected = page.getByTestId("selected-offer-panel");
  await expect(selected).toContainText("20 vCPUs");
  await expect(selected).toContainText("224 GB host RAM");
  await expect(selected).toContainText("180 GB / GPU");
  expect(b200.vramGb).toBe(180);
});
