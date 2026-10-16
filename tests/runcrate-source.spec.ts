import { expect, test } from "@playwright/test";
import type { Snapshot } from "../src/lib/types";

test("Runcrate's public price feed reaches the dashboard and history", async ({
  request,
}, info) => {
  const response = await request.get("/api/prices");
  expect(response.ok()).toBeTruthy();
  const snapshot: Snapshot = await response.json();
  const provider = snapshot.providers.find((entry) => entry.id === "runcrate");
  expect(provider?.status).toBe("ok");
  expect(provider?.rates.length).toBeGreaterThan(10);
  for (const rate of provider!.rates) {
    expect(rate.collectionMethod).toBe("Provider API");
    expect(rate.sourceUrl).toBe("https://www.runcrate.ai/api/gpu-pricing");
    expect(rate.priceType).toBe("Starting at");
    expect(rate.gpuCount).toBeNull();
    expect(rate.vcpus).toBeNull();
    expect(rate.ramGb).toBeNull();
    expect(JSON.parse(rate.evidence).min_price_hr).toBe(rate.hourly);
  }
  const h200 = provider!.rates.find((rate) => rate.gpu === "H200");
  expect(h200).toBeTruthy();
  const history = await request.get(
    `/api/history?provider=runcrate&id=${h200!.id}`,
  );
  expect(history.ok()).toBeTruthy();
  const points = (await history.json()).points;
  expect(points.some((point: { hourly: number }) => point.hourly === h200!.hourly))
    .toBeTruthy();
  await info.attach("runcrate-collection.json", {
    body: JSON.stringify(
      {
        observedAt: provider!.observedAt,
        rateCount: provider!.rates.length,
        h200: { id: h200!.id, hourly: h200!.hourly, vramGb: h200!.vramGb },
        historyPoints: points.length,
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
});
