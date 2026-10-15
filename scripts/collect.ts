import { providers } from "../src/lib/catalog";
import { collectProvider } from "../src/lib/collector";
async function main() {
  const ids = process.argv.slice(2);
  const selected = ids.length
    ? providers.filter((p) => ids.includes(p.id))
    : providers;
  for (let i = 0; i < selected.length; i += 4) {
    const started = Date.now();
    const results = await Promise.all(
      selected.slice(i, i + 4).map(collectProvider),
    );
    for (const r of results) console.log(JSON.stringify(r));
    if (results.some((r) => r.status === "error")) process.exitCode = 1;
    if (
      results.some((r) => "message" in r && r.message?.includes("HTTP 429"))
    ) {
      console.error(
        "Source rate limit reached; stopped collection without retrying remaining providers.",
      );
      break;
    }
    if (i + 4 < selected.length)
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, 30000 - (Date.now() - started))),
      );
  }
}
main().catch(() => {
  console.error("Collection could not access the database");
  process.exitCode = 1;
});
