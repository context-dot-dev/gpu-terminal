import { test, expect, type Page } from "@playwright/test";
import type { Rate } from "../src/lib/types";

// Failure cases: same name with different VRAM, SXM/PCIe/NVL conflation,
// unspecified hardware treated as equivalent, community priority tiers collapsed,
// higher priority mistaken for guaranteed uptime, filters bypassed by overlays,
// and Dedicated mislabeled as Community simply because both are sold by Salad.
const at = new Date().toISOString();
const base: Rate = {
  id: "",
  providerId: "runpod",
  gpu: "H100 SXM",
  vramGb: 80,
  gpuCount: 1,
  region: "US",
  plan: "GPU rental",
  billing: "On-demand",
  currency: "USD",
  amount: 2,
  hourly: 2,
  unit: "gpu-hour",
  priceType: "Exact",
  availability: "Not verified",
  evidence: "Browser fixture",
  notes: "",
  sourceUrl: "https://www.runpod.io/pricing",
  observedAt: at,
};
const rates: Rate[] = [
  {},
  { providerId: "lambda", hourly: 3 },
  { providerId: "nebius", gpu: "H100 PCIe", hourly: 1 },
  { providerId: "vast", gpu: "H100", hourly: 0.8 },
  { gpu: "A100", vramGb: 40, hourly: 0.5 },
  { gpu: "A100", vramGb: 80, hourly: 1 },
  {
    providerId: "salad",
    gpu: "RTX 4090",
    vramGb: 24,
    plan: "RTX 4090 · Lowest",
    billing: "Spot",
    hourly: 0.16,
  },
  {
    providerId: "salad",
    gpu: "RTX 4090",
    vramGb: 24,
    plan: "RTX 4090 · High",
    billing: "Spot",
    hourly: 0.33,
  },
  {
    providerId: "salad",
    gpu: "RTX PRO 6000 Blackwell Server Edition",
    vramGb: 96,
    plan: "Salad Dedicated",
    billing: "Committed",
    hourly: 2,
  },
].map(
  (patch, i) =>
    ({ ...base, ...patch, id: String(i + 1).padStart(24, "0") }) as Rate,
);
async function select(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}
test.beforeEach(async ({ page }) => {
  await page.route("**/api/prices", (route) =>
    route.fulfill({
      json: {
        loadedAt: at,
        providers: [...new Set(rates.map((r) => r.providerId))].map((id) => ({
          id,
          checkedAt: at,
          observedAt: at,
          status: "ok",
          message: "Fixture",
          rates: rates.filter((r) => r.providerId === id),
        })),
      },
    }),
  );
  await page.route("**/api/market-history?*", (route) => {
    const ids = new URL(route.request().url()).searchParams
      .get("ids")!
      .split(",");
    return route.fulfill({
      json: {
        loadedAt: at,
        series: ids
          .filter((id) => rates.some((r) => r.id === id))
          .map((id) => ({
            id,
            points: [
              {
                at,
                hourly: rates.find((r) => r.id === id)!.hourly,
                currency: "USD",
              },
            ],
          })),
      },
    });
  });
});

test("hardware and exact memory filters constrain tables and automatic comparisons", async ({
  page,
}, info) => {
  await page.goto("/?family=H100");
  await expect(page.getByTestId("price-row")).toHaveCount(4);
  await page
    .getByTestId("price-row")
    .filter({
      has: page.getByRole("button", { name: "H100 SXM", exact: true }),
    })
    .first()
    .click();
  const chart = page.locator('[aria-label="GPU price monitoring"]');
  await chart
    .getByRole("button", { name: "Compare providers", exact: true })
    .click();
  await expect(
    chart.getByRole("group", { name: "Focus provider" }).getByRole("button"),
  ).toHaveCount(2);
  await select(page, "Hardware variant", "PCIe");
  await expect(page.getByTestId("price-row")).toHaveCount(1);
  await expect(page.getByTestId("price-row")).toContainText("H100 PCIe");
  await page.goto("/?family=A100&exactMemory=40");
  await expect(page.getByTestId("price-row")).toHaveCount(1);
  await expect(page.getByTestId("price-row")).toContainText("40 GB");
  await info.attach("exact-hardware-filter.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});

test("community caveats and priority stay visible and filterable without affecting Dedicated", async ({
  page,
}, info) => {
  await page.goto("/?family=RTX+4090&provider=salad");
  await expect(page.getByTestId("price-row")).toHaveCount(2);
  const panel = page.getByTestId("selected-offer-panel");
  await expect(panel).toContainText("Community");
  await expect(panel).toContainText("Ephemeral local storage");
  const chart = page.locator('[aria-label="GPU price monitoring"]');
  await chart
    .getByRole("button", { name: "Compare GPUs", exact: true })
    .click();
  await chart.getByRole("button", { name: "Choose GPUs", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("checkbox")).toHaveCount(3);
  await expect(page.getByRole("dialog")).toContainText("Lowest priority");
  await expect(page.getByRole("dialog")).toContainText("High priority");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await select(page, "Priority tier", "High");
  await expect(page.getByTestId("price-row")).toHaveCount(1);
  await expect(panel).toContainText("Interruptible");
  await expect(panel).toContainText("High priority");
  await info.attach("salad-high-priority-caveats.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await page.goto("/?family=all&provider=salad&community=exclude");
  await expect(page.getByTestId("price-row")).toHaveCount(1);
  await expect(page.getByTestId("price-row")).toContainText("Blackwell");
  await expect(panel).not.toContainText("Ephemeral local storage");
  await page.goto("/?family=all&interruption=exclude");
  await expect(page.getByTestId("price-row")).toHaveCount(7);
  await expect(
    page.getByTestId("price-row").filter({ hasText: "RTX 4090" }),
  ).toHaveCount(0);
});

test("RTX family filters preserve workstation and consumer SKU distinctions", async ({
  page,
}, info) => {
  const labels = [
    "RTX 4070S",
    "RTX 4070 Ti",
    "RTX 4070 Ti SUPER",
    "RTX 4080S",
    "RTX 4060ti",
    "RTX-4000-SFF-ADA",
    "A6000",
    "RTX A6000",
    "RTX A6000 / A40",
    "RTX 6000 Ada",
    "RTX 6000 PRO",
    "RTX6000PRO",
    "RTX 6000",
    "RTX PRO 6000D",
    "RTX PRO 6000 Blackwell Server Edition",
    "RTX 5090 Blackwell",
    "RTX 5090",
    "RTX PRO 6000 Blackwell Max-Q",
    "RTX 5090 Laptop",
    "6000 ADA",
    "PRO 6000 BLACKWELL",
  ];
  const fixtureRates = labels.map((gpu, i) => ({
    ...base,
    id: String(i + 101).padStart(24, "0"),
    providerId: "lambda",
    gpu,
    plan: `${gpu} fixture`,
  }));
  await page.route("**/api/prices", (route) =>
    route.fulfill({
      json: {
        loadedAt: at,
        providers: [
          {
            id: "lambda",
            checkedAt: at,
            observedAt: at,
            status: "ok",
            message: "Fixture",
            rates: fixtureRates,
          },
        ],
      },
    }),
  );
  await page.goto("/?family=all&provider=lambda");
  const family = page.getByRole("combobox", {
    name: "GPU family",
    exact: true,
  });
  const expectedFamilies = [
    "RTX 4070 SUPER",
    "RTX 4070 TI",
    "RTX 4070 TI SUPER",
    "RTX 4080 SUPER",
    "RTX 4060 TI",
    "RTX 4000 SFF ADA",
    "RTX A6000",
    "Other",
    "RTX 6000 ADA",
    "RTX PRO 6000",
    "RTX 6000",
    "RTX PRO 6000 D",
    "RTX PRO 6000 BLACKWELL SERVER",
    "RTX 5090",
    "RTX PRO 6000 BLACKWELL MAX-Q",
    "RTX 5090 LAPTOP",
    "RTX PRO 6000 BLACKWELL",
  ];
  for (const expected of expectedFamilies) {
    await family.click();
    await expect(
      page.getByRole("option", { name: expected, exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
  }
  for (const [expected, gpuLabel] of [
    ["RTX 4070 SUPER", "RTX 4070S"],
    ["RTX 4070 TI SUPER", "RTX 4070 Ti SUPER"],
    ["RTX 4080 SUPER", "RTX 4080S"],
    ["RTX 4060 TI", "RTX 4060ti"],
    ["RTX PRO 6000 BLACKWELL SERVER", "RTX PRO 6000 Blackwell Server Edition"],
  ]) {
    await select(page, "GPU family", expected);
    await expect(page.getByTestId("price-row")).toHaveCount(1);
    await expect(page.getByTestId("price-row")).toContainText(gpuLabel);
  }
  await select(page, "GPU family", "RTX A6000");
  await expect(page.getByTestId("price-row")).toHaveCount(2);
  await expect(page.getByTestId("price-row").first()).toContainText("A6000");
  await select(page, "GPU family", "RTX PRO 6000");
  await expect(page.getByTestId("price-row")).toHaveCount(2);
  await expect(
    page.getByTestId("price-row").filter({ hasText: "RTX6000PRO" }),
  ).toHaveCount(1);
  await select(page, "GPU family", "RTX 5090");
  await expect(page.getByTestId("price-row")).toHaveCount(2);
  await expect(
    page.getByTestId("price-row").filter({ hasText: "RTX 5090 Blackwell" }),
  ).toHaveCount(1);
  await expect(page.getByTestId("price-row").first()).toContainText("RTX 5090");
  await select(page, "GPU family", "RTX 6000 ADA");
  await expect(page.getByTestId("price-row")).toHaveCount(2);
  await info.attach("distinct-rtx-families.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});
