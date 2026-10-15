import { test, expect } from "@playwright/test";
import type { Snapshot } from "../src/lib/types";

test("monitor history rejects invalid requests and returns only recorded prices for current offers", async ({
  request,
}, info) => {
  for (const query of [
    "",
    "ids=bad",
    `ids=${"a".repeat(24)}&range=invalid`,
    `ids=${Array(5).fill("a".repeat(24)).join(",")}`,
  ]) {
    const response = await request.get(`/api/market-history?${query}`);
    expect(response.status()).toBe(400);
  }
  const snapshot: Snapshot = await (await request.get("/api/prices")).json();
  const offers = snapshot.providers
    .flatMap((p) => p.rates)
    .filter((r) => r.providerId === "replicate")
    .slice(0, 4);
  expect(offers.length).toBe(4);
  const response = await request.get(
    `/api/market-history?ids=${offers.map((r) => r.id).join(",")}&range=24h`,
  );
  expect(response.ok()).toBeTruthy();
  const history = await response.json();
  expect(
    Date.parse(history.window.end) - Date.parse(history.window.start),
  ).toBe(86_400_000);
  expect(history.series.map((s: { id: string }) => s.id).sort()).toEqual(
    offers.map((r) => r.id).sort(),
  );
  for (const series of history.series) {
    const offer = offers.find((r) => r.id === series.id)!;
    expect(series.points.length).toBeGreaterThan(0);
    expect(series.points.length).toBeLessThanOrEqual(2000);
    const single = await (
      await request.get(
        `/api/history?id=${offer.id}&provider=${offer.providerId}`,
      )
    ).json();
    for (const point of series.points) {
      expect(point.currency).toBe(offer.currency);
      expect(point.hourly).toBeGreaterThan(0);
      expect(Date.parse(point.at)).toBeGreaterThan(
        Date.now() - 86400000 - 10000,
      );
      expect(Date.parse(point.at)).toBeLessThanOrEqual(Date.now());
      expect(
        single.points.some(
          (p: { at: string; hourly: number }) =>
            Date.parse(p.at) === Date.parse(point.at) &&
            p.hourly === point.hourly,
        ),
      ).toBeTruthy();
    }
  }
  await info.attach("recorded-market-history.json", {
    body: JSON.stringify(history, null, 2),
    contentType: "application/json",
  });
});
