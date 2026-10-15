import { test, expect } from "@playwright/test";
import { providers } from "../src/lib/catalog";

test("every catalog provider has a locally stored, decodable logo", async ({
  page,
}, info) => {
  await page.route("https://logos.context.dev/**", (route) => route.abort());
  await page.goto("/");
  const results = await page.evaluate(
    async (ids) => {
      const results: { id: string; width: number; height: number }[] = [];
      for (let i = 0; i < ids.length; i += 12) {
        results.push(
          ...(await Promise.all(
            ids.slice(i, i + 12).map(
              (id) =>
                new Promise<{ id: string; width: number; height: number }>(
                  (resolve) => {
                    const image = new Image();
                    image.onload = () =>
                      resolve({
                        id,
                        width: image.naturalWidth,
                        height: image.naturalHeight,
                      });
                    image.onerror = () => resolve({ id, width: 0, height: 0 });
                    image.src = `/provider-logos/${id}.webp`;
                  },
                ),
            ),
          )),
        );
      }
      return results;
    },
    providers.map((p) => p.id),
  );
  expect(results.filter((r) => r.width < 24 || r.height < 24)).toEqual([]);
  const firstLogo = page
    .getByTestId("price-row")
    .first()
    .getByTestId("provider-logo")
    .locator("img");
  await expect(firstLogo).toBeVisible();
  await expect(firstLogo).toHaveAttribute("src", /^\/provider-logos\//);
  await info.attach("catalog-logo-decode.json", {
    body: JSON.stringify(results),
    contentType: "application/json",
  });
  await info.attach("local-provider-logos.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});
