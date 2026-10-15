import { test, expect } from "@playwright/test";

test("coverage separates collected sources, inference APIs, aliases and unverified directory entries", async ({
  page,
  request,
}, info) => {
  const snapshot = await (await request.get("/api/prices")).json();
  const inference = snapshot.providers.find(
    (p: { id: string }) => p.id === "anthropic",
  );
  expect(inference).toMatchObject({
    status: "not-applicable",
    checkedAt: null,
    observedAt: null,
    rates: [],
  });
  await page.goto("/");
  await page.getByRole("tab", { name: "Coverage", exact: true }).click();
  const search = page.getByRole("textbox", { name: "Find a provider" });
  await search.fill("Anthropic");
  await expect(
    page.getByRole("region", { name: "Provider coverage table" }),
  ).toContainText("Inference only");
  await expect(
    page.getByRole("region", { name: "Provider coverage table" }),
  ).toContainText("Not collected");
  await search.fill("Lium.io");
  await expect(page.getByRole("link", { name: /Lium/ })).toBeVisible();
  await search.fill("Velokey");
  const row = page
    .getByRole("region", { name: "Provider coverage table" })
    .locator("tbody tr");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Unverified");
  await expect(row.getByRole("link")).toHaveCount(0);
  await info.attach("directory-statuses.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await info.attach("inference-status.json", {
    body: JSON.stringify(inference),
    contentType: "application/json",
  });
});
