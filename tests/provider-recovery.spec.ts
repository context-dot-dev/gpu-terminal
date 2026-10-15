import { test, expect } from "@playwright/test";
import type { Snapshot } from "../src/lib/types";

test("recovered sources retain billing terms and real observation history", async ({ request }, info) => {
  const response = await request.get("/api/prices");
  expect(response.ok()).toBeTruthy();
  const snapshot: Snapshot = await response.json();
  const ids = ["cloudru", "computegpu", "gpubroker", "gpurenthub", "lium", "selectel", "valdi", "zcloud"];
  const recovered = snapshot.providers.filter((provider) => ids.includes(provider.id));
  expect(recovered).toHaveLength(ids.length);
  for (const provider of recovered) {
    expect(["ok", "no-rates"]).toContain(provider.status);
    expect(provider.observedAt).not.toBeNull();
  }
  for (const id of ["cloudru", "gpurenthub", "computegpu"]) {
    const provider = recovered.find((p) => p.id === id)!;
    expect(provider.status).toBe("no-rates");
    expect(provider.rates).toEqual([]);
    expect(provider.message).not.toMatch(/^0 /);
  }
  for (const id of ["selectel", "valdi"]) {
    const provider = recovered.find((p) => p.id === id)!;
    expect(provider.rates.length).toBeGreaterThan(0);
    for (const rate of provider.rates) {
      expect(rate.collectionMethod).toBe("Table parser");
      expect(rate.amount).toBeGreaterThan(0);
      expect(rate.evidence).not.toBe("");
      if (id === "selectel") {
        expect(rate.currency).toBe("RUB");
        expect(rate.unit).toBe("instance-hour");
        expect(rate.hourly).toBeCloseTo(rate.amount / rate.gpuCount!, 6);
      }
      if (id === "valdi") {
        expect(rate.billing).toBe("Committed");
        expect(rate.commitment).toMatch(/weeks/);
        expect(rate.sourceUrl).toMatch(/^https:\/\/gpulist\.valdi\.ai\//);
        expect(rate.gpuCount).toBeGreaterThan(0);
        expect(rate.vcpus).toBeNull();
        expect(rate.ramGb).toBeNull();
      }
    }
    const rate = provider.rates[0];
    const historyResponse = await request.get(`/api/history?id=${rate.id}&provider=${id}`);
    expect(historyResponse.ok()).toBeTruthy();
    const history = await historyResponse.json();
    expect(history.points.some((point: { hourly: number; currency: string }) =>
      Math.abs(point.hourly - rate.hourly) < 1e-6 && point.currency === rate.currency,
    )).toBeTruthy();
  }
  await info.attach("recovered-provider-evidence.json", {
    body: JSON.stringify({ checkedAt: new Date().toISOString(), providers: recovered }, null, 2),
    contentType: "application/json",
  });
});

test("coverage shows recovered rates and explains non-comparable sources", async ({ page }, info) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Coverage", exact: true }).click();
  const search = page.getByRole("textbox", { name: "Find a provider" });
  const table = page.getByRole("region", { name: "Provider coverage table" });
  await search.fill("Selectel");
  await expect(table).toContainText("Rates collected");
  await info.attach("selectel-recovered.png", { body: await page.screenshot(), contentType: "image/png" });
  await search.fill("GPU Rent Hub");
  await expect(table).toContainText("No public rates");
  await expect(table).toContainText(/weekly|monthly/i);
  await info.attach("monthly-pricing-excluded.png", { body: await page.screenshot(), contentType: "image/png" });
});
