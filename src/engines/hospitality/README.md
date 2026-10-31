# Hospitality engine

Nuriel Hospitality (zimmers, compounds, boutique hotels). Independent of the Ecommerce
engine: it imports only its own code and the shared platform (`src/platform`). The
boundaries are enforced by ESLint (`eslint.config.js`) and by
`tests/architecture/boundaries.test.ts`.

## Platform contract used

| Platform piece | Use |
|---|---|
| `@/platform/engines/contract` | `Engine`, `SiteRef`, `EdgeRequest` — implemented in `engine.ts` |
| `@/platform/feature-flags/flags.server` | `featureEnabled(key, siteId)` — `hospitality_backend_enabled` |
| `@/platform/tenancy/current-site.server` | the request's site (`SiteRef`) for database calls |
| `@/platform/supabase/api-client.server` | Supabase client for the `hospitality` schema, with the site's `x-tenant-id` |
| `@/platform/auth/session.server` | the signed-in user (no store-membership rule: guests may be staff elsewhere) |

The engine is registered in the composition root `src/app/engines.ts`.

## Layout (Stage 1)

| Path | Contents |
|---|---|
| `engine.ts` | the engine: owns `src/engines/hospitality/**` server functions; enabled = env `HOSPITALITY_ENGINE=on` **and** the site's `hospitality_backend_enabled` flag; edge gate |
| `config.ts` | flag keys, schema name, environment switch |
| `edge/gate.ts` | Hospitality hosts: `robots.txt` → `Disallow: /`; every page → 404 (the website renderer arrives in Stage 4) |
| `types/domain.ts` | what the database functions return (bookings, quotes, policies, entitlements) |
| `validation/input.ts` | input checks of every server function (mirror the database checks) |
| `server/*.functions.ts` | server functions: `public` (guests without an account), `guest` (signed-in guests), `owner` (owner / manager) |
| `server/rpc.server.ts` | calls the `hospitality` schema functions; database messages (Hebrew) are shown to the user, technical errors are not |

Business rules live in the engine's own migrations (`supabase/migrations/*_hosp_*`): the
TypeScript layer validates input and calls them. There is no UI yet (Stage 2+).

## Runtime gates
1. **Dispatcher** (`@/platform/engines/engine-guard`): a Hospitality server function runs
   only on a Hospitality site, and only when the engine is enabled for that site; otherwise
   HTTP 404. Store functions never run on a Hospitality site.
2. **Database:** every function checks the site (`request_tenant()` / `current_tenant_id()`),
   the permission (`hospitality.can()`), the flags and the subscription.
