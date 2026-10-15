import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { Snapshot } from "../src/lib/types";

test("stored live data has defensible price arithmetic, evidence and provider policies", async ({
  request,
}, info) => {
  const response = await request.get("/api/prices");
  expect(response.ok()).toBeTruthy();
  const data: Snapshot = await response.json();
  const rates = data.providers.flatMap((p) => p.rates);
  expect(rates.length).toBeGreaterThan(100);
  expect(new Set(rates.map((r) => r.providerId)).size).toBeGreaterThan(10);
  expect(new Set(rates.map((r) => r.id)).size).toBe(rates.length);
  for (const r of rates) {
    expect(r.id).toMatch(/^[a-f0-9]{24}$/);
    expect(r.hourly).toBeGreaterThan(0);
    if (r.providerId === "google") {
      expect(r.billing).toBe("On-demand");
      expect(r.collectionMethod).toBe("Table parser");
      expect(r.gpu).not.toContain("B200");
    }
    if (
      [
        "gcore",
        "baseten",
        "replicate",
        "canopy",
        "nebius",
        "lambda",
        "verda",
      ].includes(r.providerId)
    )
      expect(r.collectionMethod).toBe("Table parser");
    if (r.providerId === "gcore") {
      expect(r.unit).toBe("instance-hour");
      if (r.gpu === "L40S") expect(r.vramGb).toBe(48);
    }
    expect(`${r.gpu} ${r.plan}`).not.toMatch(/\bMIG\b/);
    if (r.providerId === "huggingface")
      expect(r.collectionMethod).toBe("Table parser");
    expect(r.sourceUrl).toMatch(/^https:\/\//);
    expect(r.evidence.length).toBeGreaterThan(7);
    expect(Number.isFinite(Date.parse(r.observedAt))).toBeTruthy();
    const hourly =
      r.unit === "instance-second"
        ? (r.amount * 3600) / r.gpuCount!
        : r.unit === "gpu-minute"
          ? r.amount * 60
          : r.unit === "gpu-second"
            ? r.amount * 3600
            : r.unit === "instance-hour"
              ? r.amount / r.gpuCount!
              : r.amount;
    expect(r.hourly).toBeCloseTo(hourly, 6);
    if (r.unit === "instance-hour") expect(r.gpuCount).toBeGreaterThan(0);
    if (r.providerId === "akash") expect(r.gpu).toMatch(/B[23]00/);
    if (r.providerId === "salad") expect(r.billing).toBe("Spot");
    if (r.providerId === "io") expect(r.gpuCount).not.toBeNull();
    expect(r.region).not.toMatch(/^\//);
  }
  const historical = rates.find(
    (r) => r.providerId === "replicate" && r.gpuCount === 8,
  )!;
  const historyResponse = await request.get(
    `/api/history?id=${historical.id}&provider=replicate`,
  );
  expect(historyResponse.ok()).toBeTruthy();
  const history = await historyResponse.json();
  expect(history.points.length).toBeGreaterThan(0);
  expect(history.points.at(-1).hourly).toBeCloseTo(historical.hourly, 6);
  await info.attach("live-price-validation.json", {
    body: JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        rates: rates.length,
        providers: data.providers.map((p) => ({
          id: p.id,
          status: p.status,
          count: p.rates.length,
          observedAt: p.observedAt,
        })),
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
});

test("desktop loads, filters by GPU family and preserves URL on reload", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByTestId("price-row").first()).toBeVisible();
  await page.getByRole("combobox", { name: "GPU family", exact: true }).click();
  await page.getByRole("option", { name: "H100", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  for (const row of await page.getByTestId("price-row").all())
    await expect(row.getByRole("button").first()).toContainText(/H100/i);
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "GPU family", exact: true }),
  ).toContainText("H100");
  await info.attach("desktop.png", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  expect(errors).toEqual([]);
});

test("source detail shows quote, unit, original timestamp and real history", async ({
  page,
}) => {
  await page.goto("/?family=H100");
  await page
    .getByTestId("price-row")
    .first()
    .getByRole("button", { name: /^Source details for/ })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText("Source evidence", { exact: true }),
  ).toBeVisible();
  await expect(dialog.locator("blockquote")).not.toBeEmpty();
  await expect(
    dialog.getByRole("link", { name: "Open provider pricing" }),
  ).toHaveAttribute("href", /^https:/);
  await expect(
    dialog.getByText("Observed price history · 30 days"),
  ).toBeVisible();
  await dialog.getByLabel("Estimate runtime (hours)").fill("-1");
  await expect(
    dialog.getByText("Enter between 1 and 8,760 hours."),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.route("**/api/history?*", () => {});
  await page
    .getByTestId("price-row")
    .nth(1)
    .getByRole("button", { name: /^Source details for/ })
    .click();
  await expect(dialog.locator('[data-slot="skeleton"]')).toBeVisible();
  await expect(dialog.locator(".recharts-wrapper")).toHaveCount(0);
});

test("comparison preserves configuration and billing details", async ({
  page,
}) => {
  await page.goto("/?family=H100");
  await page.getByTestId("price-row").nth(0).getByRole("checkbox").check();
  await page.getByTestId("price-row").nth(1).getByRole("checkbox").check();
  await page.getByRole("button", { name: "Compare selected" }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Compare selected offers" }),
  ).toBeVisible();
  expect((await dialog.boundingBox())!.width).toBeGreaterThanOrEqual(700);
  await expect(
    dialog.getByRole("button", { name: "Sort by Required GPUs", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Sort by Minimum /hr", exact: true }),
  ).toBeVisible();
});

test("saved shortlist persists in browser and empty state works", async ({
  page,
}) => {
  await page.goto("/?family=H100");
  await page
    .getByTestId("price-row")
    .first()
    .getByRole("button", { name: /^Save / })
    .click();
  await page.reload();
  await page.getByRole("tab", { name: "Saved (1)" }).click();
  await expect(page.getByTestId("price-row")).toHaveCount(1);
  await page.getByRole("button", { name: /^Unsave / }).click();
  await expect(page.getByText("Your shortlist starts here")).toBeVisible();
});

test("CSV exports filtered values and provenance", async ({ page }) => {
  await page.goto("/?family=H100");
  await expect(page.getByTestId("price-row").first()).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  const csv = await readFile(path!, "utf8");
  expect(csv).toContain("observedAt,sourceUrl,notes,evidence");
  expect(csv).toContain("H100");
  expect(csv).not.toContain("ctxt_secret_");
});

test("combined budget and impossible search give honest empty state", async ({
  page,
}) => {
  await page.goto("/?family=H100&totalBudget=0.01");
  await expect(
    page.getByText("No fresh matching rates", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search GPU prices" })
    .fill("no-such-provider-94352");
  await expect(page.getByTestId("price-row")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Export CSV" })).toBeDisabled();
});

test("refresh failures preserve last-known rows without claiming new data", async ({
  page,
}) => {
  await page.goto("/?family=H100");
  await expect(page.getByTestId("price-row").first()).toBeVisible();
  const before = await page.getByTestId("price-row").count();
  await page.route("**/api/prices", (route) =>
    route.fulfill({ status: 503, body: '{"error":"test outage"}' }),
  );
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByText("Data connection interrupted")).toBeVisible();
  await expect(page.getByTestId("price-row")).toHaveCount(before);
});

test("coverage distinguishes rates, no public rates and failures", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Coverage", exact: true }).click();
  await page.getByLabel("Find a provider").fill("Hosted");
  await expect(page.getByRole("link", { name: "Hosted.ai" })).toBeVisible();
  await expect(
    page.getByText("No public rates", { exact: true }),
  ).toBeVisible();
});

test("mobile filter sheet is usable and page does not overflow", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?family=H100");
  await expect(page.getByTestId("price-row").first()).toBeVisible();
  const width = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    window: window.innerWidth,
  }));
  expect(width.doc).toBeLessThanOrEqual(width.window);
  await page.getByRole("button", { name: "Configure filters" }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("heading", { name: "Filter GPU prices" }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByLabel("Max /GPU/hr", { exact: true })
    .fill("2");
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/budget=2/);
  await info.attach("mobile.png", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});

test("cron refuses unauthenticated and forged calls and validates history inputs", async ({
  request,
}) => {
  expect((await request.get("/api/cron/refresh")).status()).toBe(401);
  expect(
    (
      await request.get("/api/cron/refresh", {
        headers: { authorization: "Bearer invalid" },
      })
    ).status(),
  ).toBe(401);
  expect((await request.post("/api/cron/refresh")).status()).toBe(405);
  expect(
    (await request.get("/api/history?id=bad&provider=azure")).status(),
  ).toBe(400);
});

test("collection-method filter preserves source certainty in shared URLs", async ({
  page,
}) => {
  await page.goto("/?method=Provider+API");
  await expect(
    page.getByRole("combobox", { name: "Collection method", exact: true }),
  ).toContainText("Provider API");
  const rows = page.getByTestId("price-row");
  await expect(rows.first()).toBeVisible();
  for (const row of await rows.all())
    await expect(row).toContainText(/AWS|Microsoft Azure/);
});

test("expanded sources preserve native currency, original billing units and source qualifiers", async ({
  request,
}, info) => {
  const response = await request.get("/api/prices");
  expect(response.ok()).toBeTruthy();
  const snapshot: Snapshot = await response.json();
  const sourceRates = (id: string) =>
    snapshot.providers.find((p) => p.id === id)?.rates ?? [];
  const audit: Record<string, unknown> = {};
  for (const [id, currency, unit] of [
    ["biznetgio", "IDR", "instance-hour"],
    ["neevcloud", "INR", "instance-hour"],
    ["openbayes", "CNY", "instance-hour"],
    ["edgevana", "USD", "instance-hour"],
    ["novacloud", "USD", "instance-hour"],
    ["cloudrift", "USD", "gpu-hour"],
  ]) {
    const rates = sourceRates(id);
    expect(rates.length, `${id} must have real collected rows`).toBeGreaterThan(
      0,
    );
    for (const rate of rates) {
      expect(rate.currency).toBe(currency);
      expect(rate.unit).toBe(unit);
      expect(rate.collectionMethod).toBe("Table parser");
      expect(rate.availability).toBe("Not verified");
      if (unit === "instance-hour") expect(rate.gpuCount).toBeGreaterThan(0);
    }
    audit[id] = rates.map((r) => ({
      id: r.id,
      gpu: r.gpu,
      amount: r.amount,
      unit: r.unit,
      count: r.gpuCount,
      hourly: r.hourly,
      currency: r.currency,
      billing: r.billing,
      commitment: r.commitment,
      evidence: r.evidence,
    }));
  }
  for (const rate of sourceRates("edgevana")) {
    expect(rate.priceType).toBe("Starting at");
    expect(rate.evidence).toContain("Starting at$");
    expect(rate.evidence).toContain("Hourly Usage Billing");
    if (rate.gpuCount! > 1) expect(rate.vramGb).toBeNull();
    const rawTotal = rate.evidence.match(/\/GPU\/hr\$([\d,.]+)\/hr total/);
    if (rawTotal)
      expect(rate.amount).toBe(Number(rawTotal[1].replaceAll(",", "")));
  }
  for (const rate of sourceRates("cloudrift")) {
    if (rate.billing === "On-demand") expect(rate.commitment).toBe("None");
    else {
      expect(rate.billing).toBe("Committed");
      expect(rate.commitment).toMatch(/^(1 month|3 months)$/);
    }
    expect(rate.gpuCount).toBeNull();
  }
  const compute = sourceRates("computegpu");
  expect(compute).toEqual([]);
  expect(snapshot.providers.find((p) => p.id === "computegpu")?.message).toContain("per-GPU basis");
  const gpuai = sourceRates("gpuai");
  expect(gpuai.length).toBeGreaterThan(10);
  expect(gpuai.some((r) => r.evidence.includes("community"))).toBeTruthy();
  for (const rate of gpuai) {
    expect(rate.gpu).not.toMatch(/community/i);
    expect(rate.priceType).toBe("Starting at");
    expect(rate.unit).toBe("gpu-hour");
    if (/community/i.test(rate.evidence)) {
      expect(rate.plan).toMatch(/^Community · /);
      expect(rate.notes).toContain("Community tier");
    }
  }
  expect(
    sourceRates("matpool").some((r) => /\bA16\b/i.test(r.gpu)),
  ).toBeFalsy();
  await info.attach("expanded-source-semantics.json", {
    body: JSON.stringify(audit, null, 2),
    contentType: "application/json",
  });
});
