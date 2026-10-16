# GPU Terminal

Source-backed GPU hourly price monitoring, with the gpu-terminal interface. Next.js 16.4, React 19, TypeScript, shadcn/ui (Base UI), EvilCharts, Neon Postgres and Vercel.

## Run

Copy `.env.example` to `.env.local`, then set your own Neon `DATABASE_URL`, `CONTEXT_API_KEY`, and a randomly generated `CRON_SECRET` (for example, `openssl rand -hex 32`). Never use `NEXT_PUBLIC_` for these credentials. The repository contains no production credentials or database contents.

```sh
cp .env.example .env.local
npm ci
npm run db:setup
npm run collect -- vast runpod azure aws
npm run dev
```

`npm run collect` without provider IDs checks the full catalog. It incurs Context API credits. AWS downloads a bounded full regional CSV (~303 MB) to verify completeness; its coverage is US East (N. Virginia), Linux on-demand, documented GPU SKUs only. Azure covers supported full-GPU Linux SKUs across published regions. See the Coverage tab for the actual successful integrations, rather than treating the configured provider count as successful coverage.

## Collection

Vercel invokes `/api/cron/refresh` every thirty minutes with `Authorization: Bearer $CRON_SECRET`. The endpoint fails closed if the secret is absent or incorrect. Database leases prevent overlapping work. Each invocation processes up to eighty due providers in batches of four, with batch starts at least thirty seconds apart. It stops starting batches after 560 seconds or after a source rate-limit response, leaving four minutes for in-flight work within Vercel's 800-second execution window. This duration requires Vercel Pro or Enterprise with Fluid compute. Remaining providers stay due for the next invocation and are reported in the cron response.

Vast.ai, Runpod, io.net, Spheron and Runcrate target thirty-minute checks; other providers publishing rates target hourly checks. Sources with no rates are rechecked every six hours. The scheduler allows fifteen minutes of timing tolerance so work completed partway through one invocation is eligible in the intended future slot. Failed reads preserve the original successful observation timestamp, and failing parsers cannot monopolize the queue. Collection targets are not guarantees of upstream price or inventory changes. The UI hides observations beyond their target interval plus twenty minutes by default. Bulk CLI collection spaces batches and stops on source rate limits.

AWS/Azure use their official feeds. Other providers use Context to capture fresh Markdown. Unchanged documents reuse validated extraction while recording a new genuine observation. Changed documents use structured extraction with source-passage and numeric checks. Providers including Google, Hugging Face, Gcore, Baseten, Canopy, Nebius, Lambda, Verda, Replicate and Runpod use explicit table parsers; Baseten also verifies the active time-unit toggle from source HTML. Known ambiguous source data is withheld by publication policies. Price rows retain original currency, units, configuration count, evidence, source URL and timestamp. This is an advertised-price catalog, not an inventory service or a transaction index.

Prices are stored in shared Next.js Data Cache entries in batches of twenty-five providers, keeping the current dataset below Vercel's 2 MB per-entry limit. Offer histories use separate bounded cache entries shared by the chart and offer details; preset date ranges and provider selections reuse these entries. Successful collection invalidates a shared tag scoped to the database with stale-while-revalidate behavior. Thirty-minute time-based revalidation is the fallback, and failed revalidation keeps the last successful cached result. Cache eviction or a cold cache still requires Neon. The database queries use `unstable_cache` because the newer remote cache did not retain warm entries reliably during deployed fault-injection tests. Public JSON responses use `no-store` so independent browser/CDN caches cannot conceal tag invalidation. Open dashboards poll every ten minutes; polling never triggers paid scraping. Historical offers remain queryable after they leave the current snapshot. The default H100 chart shows all matching providers, emphasizes recorded price changes, and supports provider pinning and a Changes only view. The separate comparison monitor compares up to four matching providers or exact GPU models. Ranges cover 24 hours, one week, one month, three months, one year, all retained history and custom UTC dates. It uses actual timestamps and prices, with at most 2,000 recent points per offer, 30,000 per chart response, and an explicit truncation notice; no history is backfilled. GPU variants and required configuration sizes can differ and remain visible. Snapshots and source documents persist in Postgres across deployments. Storage grows with history; no destructive retention policy is enabled.

## Verify

```sh
npm run lint
npm run build
npm run test:e2e
PLAYWRIGHT_BASE_URL=https://your-production.vercel.app npm run test:e2e
```

The production build and live-data E2E checks require a configured, initialized database. The E2E suite requires populated real observations. It covers source/arithmetic invariants, filters and URLs, comparison, source details/history, saved offers, CSV, mobile layout, failed refreshes and cron authentication. Repeatable evidence is in `playwright-report/index.html`, with validation JSON, screenshots and failure traces attached to tests. No test invokes paid collection through the public UI.

Import `context-dot-dev/gpu-terminal` into your Vercel team and configure the three server-side production environment variables before deploying. Use a separate database and credentials for preview deployments; do not expose production credentials to untrusted contributions. Apply `scripts/schema.sql` with `npm run db:setup` before collecting data. Configure Neon sizing and autosuspend for your workload. Context credits, database storage/compute, Vercel execution and AWS catalog bandwidth are ongoing operating costs.

## License

Apache-2.0; see [LICENSE](LICENSE). Vendored EvilCharts components retain their [MIT license](src/components/evilcharts/LICENSE). Provider names and logos identify third-party services and remain the property of their respective owners; they are not covered by the code license. Logo provenance is recorded in `public/provider-logos/sources.json`.
