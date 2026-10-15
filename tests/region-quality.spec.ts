import { expect, test } from "@playwright/test";
import { normalizeRegion } from "../src/lib/quality";
import type { Snapshot } from "../src/lib/types";

test("published regions omit parser debris and retain source labels", async ({
  request,
}, info) => {
  const response = await request.get("/api/prices");
  expect(response.ok()).toBeTruthy();
  const snapshot: Snapshot = await response.json();
  const rates = snapshot.providers.flatMap((provider) => provider.rates);
  expect(rates.length).toBeGreaterThan(100);

  const invalidRegion =
    /^(?:[\p{P}\p{S}\s]+|[\p{P}\s]*(?:null|undefined|none|unknown|n\/a|not available)[\p{P}\s]*|\D*\d+\s*区)$/iu;
  for (const rate of rates) {
    expect(rate.region).not.toMatch(invalidRegion);
    expect(typeof rate.rawRegion).toBe("string");
    expect(normalizeRegion(rate.rawRegion!)).toBe(rate.region);
    expect(normalizeRegion(rate.region)).toBe(rate.region);
    expect(rate.id).toMatch(/^[a-f0-9]{24}$/);
    expect(rate.evidence.length).toBeGreaterThan(7);
  }

  const virginiaAliases = rates.filter((rate) =>
    ["Virginia · us-east-1", "US East · Virginia"].includes(rate.rawRegion!),
  );
  expect(
    virginiaAliases.every((rate) => rate.region === "US East (Virginia)"),
  ).toBeTruthy();
  for (const rate of rates.filter(
    (rate) => rate.rawRegion === "ams-1 (Amsterdam)",
  ))
    expect(rate.region).toBe("Amsterdam");

  await info.attach("region-quality.json", {
    body: JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        rates: rates.length,
        distinctRegions: new Set(rates.map((rate) => rate.region)).size,
        withheldParserValues: rates
          .filter((rate) => rate.rawRegion !== rate.region)
          .map((rate) => ({
            id: rate.id,
            rawRegion: rate.rawRegion,
            region: rate.region,
          })),
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
});

test("region selector exposes readable choices and preserves unknown locations", async ({
  page,
}, info) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Region", exact: true }).click();
  await expect(
    page.getByRole("option", { name: "Not specified", exact: true }),
  ).toBeVisible();
  const options = await page.getByRole("option").allTextContents();
  expect(options).toContain("Not specified");
  expect(options).not.toEqual(
    expect.arrayContaining([
      ",",
      ":",
      ":null",
      ":null,",
      "13区",
      "16区",
      "17区",
      "1区",
    ]),
  );
  await info.attach("clean-region-selector", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await page
    .getByRole("option", { name: "Not specified", exact: true })
    .click();
  await expect(page).toHaveURL(/region=Not\+specified/);
  await expect(page.getByTestId("price-row").first()).toBeVisible();
});
