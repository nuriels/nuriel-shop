# Performance & Dependency Audit (interim)

Branch `audit/platform-review-2026-11`, read-only. Auditor: performance & dependencies.

**Method and limits.** Static reading plus AST scripts (N+1, unbounded selects, server `fetch` without a timeout).
I inspected the existing build in `.output/` (built from this tree: nitro 3.0.260603-beta, 362 JS chunks, 5.8 MB raw JS).
Per-route payload figures are the static import closure of each chunk (entry + route preloads), gzip -9.
DB checks used the local e2e DB, read-only. **The local DB is empty (0 rows)**, so only plans, catalogs and per-call
function costs were measured, not table-scale timings. `vite build` was not run. No installs, no server started.
Status: VERIFIED = proven from code, plan or artifact. SUSPECTED = mechanism proven, magnitude estimated.

## Summary

| Sev | # | Items |
|---|---|---|
| High | 3 | P1 entry bundle · P2 product page pulls whole catalog · P3 RLS per-row helper calls |
| Medium | 9 | P4 zap · P5 no fetch timeouts · P6 tenant cache · P7 bp-site DB per view · P8 unbounded admin lists · P9 admin chunk · P10 SSR fan-out · P11 compression/caching · D1 xlsx |
| Low | 13 | P12–P21, D2–D4 |
| Info | 4 | P22, P23, D5, D6 |

## Dependency table (direct deps; "used?" = import found in src/, scripts/, e2e/, tests/ or config)

| package | current | latest | kind | used? | advisory? | action |
|---|---|---|---|---|---|---|
| xlsx | 0.18.5 | 0.18.5 (npm stale since 2022) | none | **NO** (only a string `case "xlsx"` in `src/lib/site-forms.ts:87`) | 2 high (proto-pollution, ReDoS), no fix on npm | **remove** |
| date-fns | 4.1.0 (4.4.0 installed) | 4.4.0 | n/a | **NO** (code uses Intl) | no | remove |
| @hookform/resolvers | 5.5.7 | 7.0.6 | n/a | **NO** | no | remove |
| html5-qrcode | 2.3.8 | 2.3.8 (last publish 2023-04) | n/a | **NO** (scanner uses native BarcodeDetector, `src/lib/barcode-scan.ts`) | no | remove (or wire as the Safari/Firefox fallback) |
| react-image-crop | 11.1.2 | 11.1.2 | n/a | **NO** | no | remove |
| @tanstack/router-plugin | 1.168.42 | 1.169.0 | minor | no direct import (pulled by react-start) | no | move to devDeps or remove |
| react-hook-form, react-day-picker, embla-carousel-react, vaul, react-resizable-panels | 7.83 / 9.14 / 8.6 / 1.1.2 / 4.12 | 7.92 / 10.0 / 8.6 / 1.1.2 / 4.24 | patch-minor | only inside **dead** shadcn wrappers (below) | no | remove with the wrappers |
| @radix-ui/react-{accordion,aspect-ratio,avatar,collapsible,context-menu,hover-card,menubar,navigation-menu,scroll-area,toggle-group} | ^1.x | minor ahead | minor | only inside dead wrappers | no | remove with the wrappers |
| zod | 3.25.76 (+4.6.7 transitive) | 4.6.7 | **major** | yes, 2 files (`engines/business-profile/document/{schema,blocks}.ts`), in the SSR bundle | 1 high (<4.6.6) | see D3 |
| dompurify | 3.4.14 (pinned) | 3.4.18 | patch | yes (`lib/rich-text.ts`, jspdf optional) | 5 (lead assessed) | bump pin, safe |
| vite | 8.1.5 (pinned) | 8.3.8 | minor | build only | 5 dev-server advisories | bump (D4) |
| @anthropic-ai/sdk | 1.3.0 (pinned) | 1.9.0 | minor | yes (lazy, server) | no | bump when convenient |
| @supabase/supabase-js | 2.112.4 | 2.119.0 | minor | yes | no | safe bump |
| @tanstack/react-router / react-start | 1.170.41 / 1.168.60 (pinned) | 1.170.46 / 1.169.5 | patch / minor | yes | no | track; pinned deliberately |
| nitro | 3.0.260603-beta | 3.0.261103-rc | pre-release | build | no | D5 |
| recharts | 2.15.4 | 3.10.1 | **major** | admin only | no | stay on 2.x; lazy-load (P9) |
| lucide-react | 0.575.0 | 1.73.0 | **major** | yes | no | stay; check icon renames first |
| eslint / @eslint/js | 9.39.5 | 10.15.0 / 10.0.1 | major | dev | via minimatch chain | stay until plugins support 10 |
| eslint-plugin-react-hooks | 5.2.0 | 7.1.1 | major | dev | no | stay |
| typescript | 5.9.3 | 7.0.2 | major | dev | no | stay |
| @vitejs/plugin-react | 5.2.0 | 6.3.0 | major | dev | no | stay |
| @types/node | 22.20.1 | 26.6.6 | major | dev | no | keep 22 (Dockerfile is node:22) |
| canvas | 3.2.3 | 3.2.3 | n/a | used by one script only (`scripts/label-visual-check.ts`) | no | optional; native module slows `bun install` in the Docker build |
| everything else (react 19.2.8→19.3.1, @tanstack/react-query, tailwind 4.3.3→4.3.5, radix used ones, sonner, jspdf 4.2.1, jsbarcode, sharp 0.35.5, playwright, vitest 5.0.5→5.1.0, prettier 3.9.6→3.10.1) | in range | | patch-minor | yes | no | routine bumps |

No direct dependency is marked deprecated on npm (`npm view <pkg> deprecated` was empty for all 81 direct deps and devDeps).

**Dead shadcn wrappers (VERIFIED, 0 importers in src/tests/e2e):** `src/components/ui/{accordion,aspect-ratio,avatar,breadcrumb,calendar,carousel,collapsible,context-menu,drawer,form,hover-card,menubar,navigation-menu,pagination,resizable,scroll-area,sidebar,toggle-group}.tsx` (and `alert` is only reached through `alert-dialog`).
Tree-shaking keeps them out of the bundles. They cost install surface and audit noise only.

**Duplicate libraries.**
- Two zod majors in the lockfile (3.25.76 direct, 4.6.7 via TanStack build tooling).
- `date-fns` + `react-day-picker` + `react-hook-form` + `@hookform/resolvers` form a dead form/date stack.
- `html5-qrcode` is installed but unused (native BarcodeDetector is used instead).
- jsPDF drags `html2canvas` (199 KB) and `canvg` (151 KB) as optional deps. The app never calls `.html()` or `addSvgAsImage`, so these are never loaded, but they are bundled in `.output/server/_libs`.
- Single chart lib, single icon lib, single toast lib: fine.

## Advisory triage (`docs/audit/interim/bun-audit.txt`, 27 advisories)

Evidence: `bun pm why`, plus a search of `.output/server/{_libs,_ssr}`. Runtime = in the shipped server bundle or `.output/server/node_modules` (only sharp, tslib, semver, detect-libc, @img/*).

| advisory pkg (sev) | dependency path | runtime-reachable? | action |
|---|---|---|---|
| brace-expansion 1.1.16 / 5.0.8 (6 high, 2 mod) | eslint → @eslint/config-array → minimatch@3; typescript-eslint → typescript-estree → minimatch@10 | **dev only** (lint). Not in `.output`. | bump eslint / `overrides`; low urgency |
| minimatch 3.1.5 / 10.2.6 (mod) | same chains | dev only | same |
| js-yaml 4.3.0 (2 high) | eslint → @eslint/eslintrc; react-start → start-plugin-core → xmlbuilder2 | dev / build-time only (not in `.output`) | bump |
| nanoid 3.3.16 (high) | vite → postcss | build only | via vite bump |
| source-map-js 1.2.1 (high) | postcss, @tailwindcss/node | build only | via vite / tailwind bump |
| vite 8.1.5 (1 low, 2 mod, launch-editor ×3) | direct, plus vitest, plugins | **dev-server only** (`vite dev` middleware / open-in-editor). Prod runs `node .output`; Docker builds with `vite build`. | bump to ≥8.1.6 |
| xlsx 0.18.5 (2 high) | direct | **not imported anywhere** | remove (D1) |
| zod 3.25.76 (high) | direct; also optional peer of @anthropic-ai/sdk | **YES, runtime** (`_libs/zod.mjs`) | D3 |
| dompurify 3.4.14 (1 crit, 1 high, 3 low) | direct; jspdf optional | yes (`rich-text.ts`; also SSR via jspdf). Lead already assessed. | bump pin to 3.4.18 |

---

## Findings: performance

### [HIGH] P1. Every visitor downloads a 441 KB-gzip entry closure that includes the /stay site, the bp-site renderer, zod and supabase-js
- **Severity:** High. **Status:** VERIFIED (build artifact). Share estimates are SUSPECTED.
- **File:line:** `src/start.ts:4-5` (static `attachSupabaseAuth` → `integrations/supabase/client` → supabase-js; static `app/engines`); `src/app/site-shell.tsx:5-6`, `src/app/site-head.ts:6-10`; `src/routes/stay*.tsx` (14 files, `createFileRoute(..)(siteLayoutRoute)` with options imported from `engines/hospitality/website/routes.ts:8-29`, which statically imports every page); `src/routes/bp-site.$.tsx:4-7`, `bp-site.tsx:4-7` (loader/head use `BusinessPage` → `SiteView` + zod `normalize`).
- **Proof:** I crawled the static imports of `.output/public/assets/index-DK5uAFYD.js`. The closure is 77 files, 1,423,640 B raw / 440,578 B gzip. It includes:
  - `index` (759 KB raw / 225 KB gz). It contains `data-site-photo`, `data-wide-nav` and `A11Y_BOOTSTRAP`, i.e. the hospitality public site UI. TanStack cannot split non-inline `component:` options, so no `stay-*.js` chunk exists. The hospitality website source is ~325 KB (pages 175 KB, sections 53 KB, components 53 KB, lib 44 KB); estimated 120–200 KB raw in the entry.
  - `dist-DaJn4FfQ.js` supabase-js (208 KB / 53 KB gz).
  - `normalize-*.js` zod + business-profile schema (66 KB / 16 KB gz).
  - `SiteView-*.js` (44 KB / 14 KB gz) and `copy-*.js` hospitality copy (25 KB).
  - Per-route JS (raw/gz): `/` 1.78 MB / 559 KB; `/product/$id` 1.59 MB / 500 KB; `/login` 1.50 MB / 467 KB; `/bp-site` 1.42 MB / 441 KB; `/stay` = the entry alone, 441 KB.
- **Impact:** every storefront, /stay and /bp-site visitor, and every admin. A small-business marketing site pays ~440 KB gz of JS (about 2.5× a typical 170 KB budget). Parse and execute time on mid-range mobile is multiple seconds.
- **Fix:**
  1. Make `/stay` components lazy (`lazyRouteComponent(() => import(...))` or `createLazyFileRoute`).
  2. Move `requirePage`, `businessPageHead` and `pageBySlug` into a tiny module with no zod or SiteView, and `await import()` the renderer inside the component.
  3. Import `supabase` lazily in `attachSupabaseAuth` for engine sites, or keep it only for ecommerce.
  4. Re-run the closure script after each change.
- **Effort:** M.

### [HIGH] P2. Product page downloads the whole catalog; the product SSR loader computes the whole feed to return one row
- **Severity:** High. **Status:** VERIFIED (code and plans). Magnitude SUSPECTED (needs a real catalog).
- **File:line:** `src/routes/product.$productId.tsx:136-146` (`fetchAllRows(rpc("get_catalog")…)` in the browser just to find one product plus recommendations); `src/lib/seo.functions.ts:64` (`rpc("storefront_feed_products").eq("id", id).limit(1)`); same pattern in `src/routes/index.tsx:310-318` and `src/routes/sitemap.tsx:24-26` (HTML sitemap pulls the full catalog only to count categories).
- **Proof:**
  - `EXPLAIN select * from storefront_feed_products() where id=…` gives `Function Scan … Filter`. `get_catalog()` is the same, and `… order by id limit 1000 offset 1000` gives `Sort → Function Scan`. Both are SECURITY DEFINER SQL SRFs, so they are never inlined. Every page of `fetchAllRows` (1000 rows/page, serial) re-materialises the entire catalog, so cost is O(pages × N).
  - `get_catalog` returns full `description` (up to 20,000 chars, CHECK `global_products_description_length`), `images[]`, `variants` jsonb and a lateral `categories` per row.
  - `anon` has `statement_timeout=3s`, `authenticated` 8s (`pg_roles`), so a big catalog fails for guests, not just slows down.
- **Impact:** every product-page visit (WhatsApp, Google, shared links) downloads and parses the whole catalog (megabytes at a few thousand SKUs). The server-side SEO loader burns DB CPU proportional to catalog size per crawl hit.
- **Fix:**
  - Add `get_catalog_item(_id)` and `storefront_feed_product(_id)` single-row RPCs.
  - Give `get_catalog` real pagination arguments, or a list view without `description`.
  - Cache the guest result per tenant server-side. Make the HTML sitemap use a `category_counts` RPC.
- **Effort:** M.

### [HIGH] P3. Ecommerce RLS calls SECURITY DEFINER helpers per row (~0.15–0.2 ms each); "My orders" has no customer filter
- **Severity:** High. **Status:** VERIFIED mechanism and per-call cost. Row-count impact SUSPECTED (empty DB).
- **File:line:** `src/components/account/CustomerOrdersTab.tsx:79-82` (orders with embedded `order_items`, no `.eq("customer_id")`); `src/components/OrderManagementPanel.tsx:197-205`; policies in `public` (`orders select`, `order items *`, `products readable by staff`, …).
- **Proof:**
  - 89 of 160 `public` policies call `is_admin/is_staff/staff_can/can_view_order/auth.uid()` **without** the `(SELECT …)` InitPlan wrapper; 0 are wrapped. (`hospitality`: all 68 are wrapped.)
  - Measured as `authenticated` over 20,000 calls: `is_admin(auth.uid())` 2.92 s (146 µs/call), `can_view_order()` 2.84 s, `is_staff()` 4.09 s, bare `auth.uid()` 17 ms. The helpers re-enter plpgsql `current_tenant_id()` (a few queries) each time.
  - `EXPLAIN` as `authenticated` shows `Index Scan orders_tenant_created_idx … Filter: can_view_order(customer_id, agent_id)`: per-row, and `orders_customer_idx` cannot be used.
  - For `order_items`: `Filter: order_id = X AND (ANY (order_id = (hashed SubPlan).col1))` where the SubPlan scans **all** tenant orders and runs `can_view_order` twice per order. (Plan chosen on empty-table stats; real stats may change it.)
- **Impact:** every customer opening "My orders" walks every order of the tenant (about 150 µs × tenant orders). The admin orders list embeds items (about 3× that). At ~8 s `authenticated` timeout, roughly 18k–50k orders per tenant breaks these screens with `statement timeout`. The same per-row cost hits the admin product list (`is_staff`/`is_admin` per `global_products` row) and customers/user_roles lists.
- **Fix:**
  1. Rewrite as `(select is_admin(auth.uid()))`, `customer_id = (select auth.uid())`, `agent_id = (select auth.uid())`. This turns the cost into one InitPlan.
  2. Add `.eq("customer_id", uid)` client-side so the customer index is usable.
  3. Cache `current_tenant_id()` per statement.
  4. Re-run `EXPLAIN ANALYZE` on a seeded DB.
- **Effort:** M (about 90 policies; mechanical, needs the RLS test suite).

### [MEDIUM] P4. Zap crawler pages recompute the full catalog on every request, with no server cache
- **Severity:** Medium. **Status:** VERIFIED.
- **File:line:** `src/lib/zap-pages.server.ts:55-77` (`loadFeedProducts()` + categories + links), `:122-130`; contrast `src/lib/feeds.server.ts:353-380` (sitemap has TTL cache and single-flight).
- **Proof:** `renderZapPage` calls `loadZapCatalog` per request. `loadFeedProducts` pages `storefront_feed_products` (full catalog per page, see P2). Only `Cache-Control: public, max-age=1800` is set, which crawlers and shared caches may ignore. `/zap/cat/{id}` is hit once per category.
- **Impact:** Zap add-on stores: N categories × full catalog per crawl, unauthenticated, no rate limit seen.
- **Fix:** reuse `cachedFeed` (TTL plus single-flight) keyed by tenant.
- **Effort:** S.

### [MEDIUM] P5. Server-side Supabase fetches have no timeout (30 call sites, including the per-request tenant lookup)
- **Severity:** Medium. **Status:** VERIFIED (AST scan: 30 `fetch(` without `signal`, 6 with).
- **File:line:** `src/integrations/supabase/tenant.server.ts:71,95,147` (runs on every uncached request); `src/integrations/supabase/client.server.ts:41` (all `supabaseAdmin` calls); `src/platform/supabase/api-client.server.ts:28`; `engines/hospitality/server/rpc.server.ts:71`; `website/seo.server.ts:34`; `platform/feature-flags/flags.server.ts`; `platform/tenancy/site-type.server.ts`; `lib/portal-landing.server.ts:38`; `lib/email.server.ts:295`; and others.
- **Impact:** if PostgREST or the DB stalls, requests hang until undici's default (~5 min headers timeout) or nginx `proxy_read_timeout 120s`, holding sockets. Combined with the health check (P15) a DB blip becomes an outage. The hospitality rate limiter already uses `AbortSignal.timeout(2500)`, the correct pattern.
- **Fix:** shared `fetchWithTimeout` (5–10 s) used by the central clients.
- **Effort:** S.

### [MEDIUM] P6. Tenant host cache is keyed by the raw Host header, never evicted, and a miss costs two serial uncached HTTP calls
- **Severity:** Medium. **Status:** VERIFIED code.
- **File:line:** `src/integrations/supabase/tenant.server.ts:33-35, 64-82`.
- **Proof:** `cache.set(host, …)` for any `x-forwarded-host`. `tenant_for_host` falls back to the default tenant, so every random hostname creates a persistent entry. Only `invalidateTenantCache` removes entries, and only for the matching tenant or default ones. There is no single-flight, so concurrent cold requests each issue `tenant_for_host` and then `loadTenantById`. The same pattern exists in `redirectCache`. nginx forwards `$host` unvalidated for unlisted names unless `default_server` rejects them.
- **Impact:** memory growth plus DB amplification from a hostile-Host flood.
- **Fix:** cap size (LRU, e.g. 2,000), single-flight per host, reject unknown hosts earlier.
- **Effort:** S.

### [MEDIUM] P7. bp-site public pages: 2–4 serial uncached RPCs per page view, zod normalisation per view, no HTML caching
- **Severity:** Medium. **Status:** VERIFIED code.
- **File:line:** `src/engines/business-profile/data/public-site.server.ts:16-30` (`bp_public_site`, then `bp_media_public` awaited serially, though independent); `access.server.ts:22-35` (`siteEnabled` loads the whole public doc just to test non-null, cached 15 s, then the loader loads it again); `api/site.functions.ts:19-28`; `routes/bp-site.tsx:12-17`.
- **Impact:** every anonymous page view of a Nuriel Websites site costs ≥2 sequential Supabase round trips plus `normalizeDocument` (zod). The published document changes only on publish. HTML has no `Cache-Control`, and nginx has no `proxy_cache`.
- **Fix:** `Promise.all` the two RPCs; cache the normalised document per site keyed by `version`; give public pages a short `s-maxage`; drop the duplicate load in `siteEnabled`.
- **Effort:** S–M.

### [MEDIUM] P8. Admin lists are unbounded and silently truncated at PostgREST `max_rows` (1000)
- **Severity:** Medium. **Status:** VERIFIED code. Limit from `e2e/.supabase/supabase/config.toml:18` (`max_rows = 1000`, also the Supabase default).
- **File:line:** `OrderManagementPanel.tsx:197-205` (all orders + embedded items + all `customer_profiles` + all `user_roles`), `CustomerOrdersTab.tsx:79`, `AdminUsersPanel.tsx:234-240`, `CreateOrderDialog.tsx:94-97`, `SendMessagePanel.tsx:40-41`, `AgentPerformancePanel.tsx:137`, and others (46 unbounded `from().select()` chains in the AST scan). Products and categories correctly use `fetchAllRows`.
- **Impact:** tenants with >1000 orders, customers or staff silently lose rows. Every open re-downloads the full set (orders with ~60 columns plus items), and each row pays P3's RLS cost.
- **Fix:** server-side pagination with `.range()` and a `count`; search RPCs for customer pickers.
- **Effort:** M.

### [MEDIUM] P9. `/admin` ships ~45 panels plus recharts in one route chunk
- **Severity:** Medium. **Status:** VERIFIED.
- **File:line:** `src/routes/admin.tsx:10-47` (static imports; only `EcommerceAssistant` is lazy at `:141`).
- **Proof:** `admin-DMK16gDF.js` 970 KB raw / 244 KB gz, plus `EditUserDialog-*.js` 509 KB / 134 KB (recharts + lodash, shared with `/agent`). `/admin` total is 3.23 MB raw / 952 KB gz.
- **Impact:** staff first load is ~1 MB gz regardless of which tab they open.
- **Fix:** `lazy()` per tab panel (especially Agent/Picking stats using recharts, BarcodeLabels, HomeDesign, StockCount, POS).
- **Effort:** M.

### [MEDIUM] P10. Duplicate and uncached DB work on public SSR pages
- **Severity:** Medium. **Status:** VERIFIED code.
- **File:line:**
  - `src/routes/__root.tsx:130` and `src/routes/index.tsx:99` both call `getSiteSeo()` on the same SSR of `/`. Each is `site_settings` select plus the serial `site_tag_manager` RPC (`platform.functions.ts:~315`), so 4 DB calls where 2 would do.
  - `lib/portal-landing.server.ts:57-99`: the portal landing page does 3–5 calls per view, uncached.
  - `engines/hospitality/api/website.functions.ts:86-120`: `/stay` does 5 RPCs plus a `rate_check` **write** RPC per page view; each RPC builds a fresh supabase-js client (`api-client.server.ts:17`).
- **Impact:** DB round trips per page view grow linearly with traffic. These are the pages with the most anonymous traffic.
- **Fix:** read root data from the parent match instead of re-calling; 15–60 s per-tenant memo for `getSiteSeo`, GTM and portal landing; `Promise.all` for the two serial calls; reuse one client.
- **Effort:** S.

### [MEDIUM] P11. No evidence of compression or long-lived caching for static assets (SUSPECTED)
- **Severity:** Medium. **Status:** SUSPECTED. Needs a check at the edge.
- **File:line:** `vite.config.ts:31-52` (nitro config has no `compressPublicAssets`); `.output/public/assets/*.{gz,br}` = 0 files; `deploy/nginx/*.conf` has no gzip, brotli or `gzip_types`; `Dockerfile`/compose go to Traefik with no compress middleware shown.
- **Proof:** only `/assets/**` gets `max-age=31536000, immutable` (`.output/server/index.mjs:3089`). `/fonts/**` (22 woff2 plus `base.css`), `/landing/**` and `/brand/**` get only ETag/Last-Modified.
- **Impact:** if the edge does not compress JS/CSS/JSON, the 1.4 MB entry closure ships ~3× larger. Fonts revalidate on each visit. Dynamic SSR HTML is compressed only if the proxy does it.
- **Fix:** confirm nginx/Traefik `gzip on` with `gzip_types`, preferably brotli; add `routeRules` for `/fonts/**` (immutable) and `/landing/**`.
- **Effort:** S.

### [LOW] P12. Render-blocking Google Fonts on ecommerce pages although the same fonts are self-hosted
- `src/routes/__root.tsx:224-228` loads Heebo + Frank Ruhl Libre from `fonts.googleapis.com` as a blocking stylesheet on every store page. `public/fonts/hosp/base.css` plus `heebo-*.woff2` already serve them (engine sites use them). Cost: 2 extra origins on the critical path, and a third-party request for every store visitor. Fix: point the root head at `/fonts/hosp/base.css` (+ preload hebrew woff2). VERIFIED. Effort S.

### [LOW] P13. In-memory rate limiter sweeps O(n) per call and has no hard cap
- `src/lib/rate-limit.server.ts:15-17,28`: once `buckets.size >= 5000` every `allowAction` scans the whole Map (deleting only expired entries). Windows are 10–60 min and ~60 call sites use IP keys, so 5,000 live keys is reachable. With many source addresses (IPv6) the scan grows with n and nothing bounds memory. The hospitality limiter does it right (`LOCAL_MAX_KEYS`, `rate-limit.server.ts:28-31`). Fix: LRU cap or time-bucketed sweep. VERIFIED code. Effort S.

### [LOW] P14. `logoCache` keeps raw logo Buffers per tenant forever
- `src/lib/store-icons.server.ts:14,60`: entries (up to `IMAGE_MAX_BYTES` = 10 MB for an https `logo_path`) are replaced but never evicted; `iconCache` is capped at 200, `logoCache` is not. Memory is bounded by tenant count × logo size; stores are self-service (`portal-create`). Fix: store only a hash/key and cap entries. SUSPECTED impact. Effort S.

### [LOW] P15. Container health check depends on tenant resolution, contrary to its comment
- `Dockerfile:53-54` and `docker-compose.yml:75` probe `/robots.txt`. The Dockerfile comment says it is independent of SSR or Supabase, but `src/server.ts:39-40,155-159` excludes `/robots.txt` from the static bypass and calls `resolveTenant` (2 uncached HTTP calls every 15 s, no timeout, P5). A Supabase hiccup marks the container unhealthy. Fix: dedicated `/healthz` before tenant resolution. VERIFIED. Effort S.

### [LOW] P16. Index hygiene (DB catalog)
- 13 redundant single-column indexes covered by a composite or unique index: `orders_tenant_id_idx` (4 covering indexes), `global_products_tenant_id_idx`, `user_roles_tenant_id_idx`, `product_variants_tenant_idx`, `categories_tenant_id_idx`, `customer_profiles_tenant_id_idx`, `site_settings_tenant_id_idx`, `email_settings_tenant_id_idx`, `stock_counts_tenant_id_idx`, `location_transfers_tenant_id_idx`, `cart_promotions_tenant_idx`, `product_duplicate_dismissals_tenant_idx`, `stock_count_lines_count_idx`. Also `global_products_hidden_idx (is_hidden)` (boolean, useless). `orders` carries 19 indexes (write amplification on order placement).
- ~70 FKs without a supporting index, mostly `created_by`/`updated_by` → `auth.users ON DELETE SET NULL` (e.g. `hospitality.bookings.created_by`, `public.abandoned_carts.recovered_order_id`) and `tenants ON DELETE CASCADE` children. Deleting a user, order or tenant seq-scans those tables. Low until rows are large.
- Good: every tenant-scoped table has a leading `tenant_id`/`site_id` index, and `get_catalog`'s laterals are indexed. Fix: drop the 13, add FK indexes only on tables that will grow. VERIFIED. Effort S.

### [LOW] P17. N+1 loops (bounded, admin-only)
- `src/lib/scan.functions.ts:99-150`: up to 500 lines, serial `UPDATE` per matched product, and per missing barcode a `select` + write + `memberIdOrNull` DB lookup inside the loop (up to ~1,500 round trips, ~5–15 s).
- `src/server/services/source-apply.ts:74-161`: per update, an image download+sharp plus barcode-check query, serially.
- `OrderEditDialog.tsx:141-148`: serial item updates. `abandoned-carts.server.ts:140-166`: ≤25 carts × (select + RPC + email + update) with a 600 ms spacing inside a held HTTP request (paced on purpose).
- Fix: batch RPC / `upsert`, hoist `memberIdOrNull`. VERIFIED. Effort S–M.

### [LOW] P18. Storefront product thumbnails reuse the 1000 px upload, no `srcset` or intrinsic size
- `CatalogGrid.tsx:40-47`, `ProductGrid.tsx:218-226` render `image_url` (a ≤1000 px WebP from `lib/image.ts:38`) into 128–176 px boxes with `loading=lazy` but no `srcset`/`width`/`height`. Fixed-height boxes avoid layout shift, but mobile over-fetches several-fold (40–120 KB per card). Hospitality and bp-site images are done right (480/960 variants, AVIF, dimensions, `fetchPriority`). Fix: generate a 400 px variant at upload; add `srcset`. VERIFIED. Effort M.

### [LOW] P19. Admin badge polling, not paused when the tab is hidden
- `AdminNav.tsx:147,167,187,210` run four independent 60 s polls (pending products, support, inbox, reviews) per open admin tab, plus `StaffNotificationsBell`, each paying P3's RLS cost. Fix: one `admin_badge_counts` RPC, pause on `document.hidden`. VERIFIED. Effort S.

### [LOW] P20. Hospitality image upload decodes the source four times
- `engines/hospitality/server/media.server.ts:109-124`: `source()` re-creates `sharp(bytes)` for main, 960, 480 and thumb, sequentially (up to 50 MP, 15 MB). Use one decode with `.clone()` for the variants. Limits (15 MB, 50 MP, rate limit 120/10 min) are good. Effort S.

### [LOW] P21. Hospitality hero video: `preload="auto"`, raw upload up to 50 MB, no transcode
- `website/components/HeroVideo.tsx:188-193`; `media.server.ts:~76` (only metadata is stripped). On mobile this competes with the LCP image. SUSPECTED (depends on uploaded files). Fix: poster, `preload="metadata"` on mobile, a size or bitrate cap. Effort S.

### [INFO] P22. Server-only code shipped as client assets
- `.output/public/assets/{worker.server,rate-limit.server,client.server,env.server,send.server,seo.server,…}-*.js` (19 files). They are referenced from the entry's `mapDeps` via `engine.startWorkers()` and the gate (`src/app/engines.ts`), so `startWorkers`/`gate` dynamic imports are bundled for the browser. No secret values (env is read as `{}`), but it exposes internal logic: the rate-limit rule table, email templates, and the `supabaseAdmin` factory. Dead weight, and a cross-reference for the security audit.

### [INFO] P23. Hydration/SSR hygiene is good
- The only render-path time source is `RestStateProvider.tsx:43` (`useState(() => new Date())`), which can mismatch only within seconds of a Shabbat boundary (React recovers). Cart, a11y and consent use effects or `useSyncExternalStore`; /stay and /bp-site touch `window` only in effects.

---

## Findings: dependencies

### [MEDIUM] D1. `xlsx` is an unused direct dependency with two high advisories and no fix on npm
- **Status:** VERIFIED. `grep` across src, scripts, e2e, tests, vite/vitest/eslint configs, Dockerfile and `.github` finds only the string literal at `src/lib/site-forms.ts:87`; no import or dynamic import. It is not in `.output`. npm still serves 0.18.5 (SheetJS ships fixed builds only from its own CDN). **Fix:** remove it. Effort S.

### [LOW] D2. ~20 other unused direct deps and 18 dead UI wrappers
- Unused: `date-fns`, `@hookform/resolvers`, `html5-qrcode`, `react-image-crop`; transitively dead after removing the wrappers: `react-hook-form`, `react-day-picker`, `embla-carousel-react`, `vaul`, `react-resizable-panels`, and 10 `@radix-ui/*` packages (see tables). `@tanstack/router-plugin` is not imported directly.
- No bundle impact (tree-shaken). Benefit is install time, audit noise and supply-chain surface. Effort S. Delete the 18 `ui/*.tsx` files first and run typecheck.

### [LOW] D3. zod 3.25.76 advisory is runtime-reachable but narrow
- zod is in the SSR bundle (`_libs/zod.mjs`) and the studio chunk. It validates owner-supplied site documents (`business-profile/api/studio.functions.ts:80`, `normalizeDocument` on every public render). The advisory (`<4.6.6`, memory on oversized constrained collections) needs an oversized array; authenticated owners only, body capped by nginx at 25 MB. No 3.x fix exists.
- **Fix:** bump the direct dep to 4.x (2 files, `.catch/.max/.regex` only; effort S–M), or cap body and array sizes before `normalizeDocument`.

### [LOW] D4. vite pinned at 8.1.5 (dev-server advisories only)
- Exact pin plus `overrides.rolldown 1.2.1`; advisories are dev-server middleware and open-in-editor (not used in production). Bump to ≥8.1.6/8.3.8 and re-test the SSR build. Also bumps postcss/nanoid/source-map-js. Effort S–M (pinned for stability).

### [INFO] D5. Production server stack is pre-release
- `nitro 3.0.260603-beta` (latest is `-rc`), `h3 2.0.1-rc.20/26`, `srvx 0.11/0.12`, plus `@emnapi/runtime 2.0.0-alpha.3`. TanStack Start currently requires this, so pin exactly (already done) and keep the `_tanstack-start-runtime` chunk workaround in `vite.config.ts:36-47` under test.

### [INFO] D6. dompurify pin
- Bump `3.4.14 → 3.4.18` (patch, safe; lead already assessed reachability).

---

## Checked and found fine
- **Sitemap/robots/llms:** TTL cache + single-flight + stale-on-error (`feeds.server.ts:353-380`), `Cache-Control: public, max-age=3600`, bounded to 50,000 URLs. Hospitality sitemap has a 500-entry cache cap.
- **`select('*')`:** only 3 uses, all single-row or bounded. No supabase call inside `.map(async…)` over DB rows on public paths. Server concurrency uses `settledPool`.
- **Hospitality indexes** (`bookings`, `booking_nights`, `unit_occupancy` GiST, `blocks`, `notifications_due_idx`) and `tenant_for_host` (indexed domain, custom_domain, slug) are well-formed. Rate-limit buckets are UNLOGGED with advisory locks.
- **Function volatility:** all read paths used in RLS or the storefront (`get_catalog`, `storefront_feed_products`, `tenant_for_host`, `public_site`, `bp_public_site`, `product_stock_sellable` IMMUTABLE, `current_tenant_id` …) are STABLE/IMMUTABLE. Only writers are VOLATILE. `hospitality` policies already use `(SELECT …)` wrappers.
- **Uploads and downloads:** license/agreement files use signed upload URLs; downloads stream (`api.license-download.file.ts`); Range reads for signature checks. Images are processed with `limitInputPixels`.
- **PDF generation:** benchmarked jsPDF with the embedded Heebo fonts: 2–9 ms font setup and ~7 ms (20 lines) to ~17 ms (200 lines) per document, so no event-loop concern.
- **Timers:** all server `setInterval` timers are `unref`'d; AI-renewal, inquiry and outbox workers have re-entrancy guards. Client-side `staleTime`/`refetchOnWindowFocus` are tuned in the hospitality manager.
- **Dashboard** uses one aggregate RPC. Caches in `site-type`, `feature-flags`, `access` and `brand` are bounded by tenant count or have `trimCache`.
- **Static assets:** hashed assets are immutable; `/brand/*-original.png` (1.27 MB) is not referenced by any page (only resized variants are served).

## Top 15 client chunks (`.output/public/assets`, raw / gzip)

| # | chunk | raw | gz | loaded by |
|---|---|---|---|---|
| 1 | admin-DMK16gDF.js | 970,707 | 243,616 | /admin |
| 2 | index-DK5uAFYD.js (entry) | 759,239 | 224,681 | every route |
| 3 | EditUserDialog-BKVCS7gj.js (recharts+lodash) | 509,086 | 133,636 | /admin, /agent |
| 4 | jspdf.es.min-CvTGA2E5.js | 399,068 | 126,995 | lazy: label printing |
| 5 | styles-BO6vXvjI.css | 233,461 | 34,787 | every route |
| 6 | dist-DaJn4FfQ.js (supabase-js) | 208,060 | 53,089 | **entry closure** |
| 7 | html2canvas-CA7kyov8.js | 199,494 | 45,460 | never (jsPDF optional) |
| 8 | index.es-CNHAvOs8.js (canvg) | 151,427 | 48,232 | never (jsPDF optional) |
| 9 | routes-B4nQfjSm.js (storefront `/`) | 129,647 | 33,850 | `/` |
| 10 | manage.client-documents | 87,424 | 20,550 | /manage |
| 11 | HospitalityAssistant | 78,934 | 19,064 | lazy |
| 12 | normalize-BHQnJ3W4.js (zod+bp schema) | 66,588 | 16,388 | **entry closure** |
| 13 | JsBarcode | 64,142 | 11,190 | lazy |
| 14 | manage.website | 58,453 | 16,616 | /manage/website |
| 15 | platform_.hospitality | 55,989 | 15,149 | /platform |

## Not done
- `vite build` (skipped as instructed; I used the existing `.output`).
- No data-scale `EXPLAIN ANALYZE` (local DB empty). P2/P3 magnitudes should be confirmed on a seeded DB (e.g. 5k products, 20k orders).
- Edge compression/caching (P11) cannot be verified from the repo.
