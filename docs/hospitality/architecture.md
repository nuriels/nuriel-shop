# Engine architecture (Stage 1f)

How Nuriel Ecommerce and Nuriel Hospitality live in one codebase without depending on
each other. Implements plan §B1, §B2 and §B11 (`stage-1-plan.md`).

## Layers

```
                 ┌──────────────────────────────┐
                 │  Composition root  src/app/  │  the ONLY code that knows both engines
                 └──────┬─────────────────┬─────┘  (registers and wires; no business logic)
          ┌─────────────▼──────┐   ┌──────▼──────────────────┐
          │  Ecommerce engine  │   │  Hospitality engine     │
          │  existing code +   │   │  src/engines/hospitality│
          │  src/engines/      │   │                         │
          │    ecommerce/      │   │                         │
          └─────────┬──────────┘   └──────────┬──────────────┘
                    └──────────┬───────────────┘  contracts / adapters only
                     ┌─────────▼──────────┐
                     │  Shared platform   │  no product business logic,
                     │  src/platform/     │  imports no engine
                     └────────────────────┘
```

| From → to | platform | Ecommerce | Hospitality | composition root |
|---|---|---|---|---|
| **platform** | ✓ | ✗ (only listed adapters: `integrations/supabase/tenant.server`) | ✗ | ✗ |
| **Ecommerce** (all existing code + its engine descriptor) | ✓ | ✓ | ✗ | ✗ |
| **Hospitality** | ✓ | ✗ | ✓ | ✗ |
| **composition root** (`src/app`) | ✓ | ✓ (engine descriptor) | ✓ | ✓ |
| **entry files** (`src/start.ts`, `src/server.ts`) | ✓ | ✓ | ✗ (through `src/app` only) | ✓ |

Enforced twice:
- **ESLint** (`eslint.config.js`): `no-restricted-imports` per layer (static imports,
  `export … from`, relative paths) and `no-restricted-syntax` for dynamic `import()`.
- **Architecture test** (`tests/architecture/boundaries.test.ts`, runs in `bun run test`):
  parses every file in `src` (static, type, re-export, dynamic, relative imports) and
  checks the table above; only `src/app` imports the engines; the composition root has no
  business logic; every server-function file has exactly one owner; and the ESLint rules
  really fire on forbidden imports (15 cases) and stay quiet on allowed ones (5 cases).

## Engine structure

```
src/
  app/
    engines.ts                      composition root: registry, dispatcher, edge gate, server-function inclusion
  platform/
    engines/contract.ts             Engine, SiteRef, EdgeRequest, SiteType, ServerFnOwner
    engines/registry.ts             createEngineRegistry(), ownerOf(filename), default owner = ecommerce
    engines/shared-functions.ts     16 existing shared server-function files owned by the platform
    engines/engine-guard.ts         dispatcher: decision table + global function middleware (HTTP 404)
    engines/edge.ts                 page / file gate by site type (Ecommerce sites untouched)
    tenancy/site-type.server.ts     tenants.site_type, cached 15 s, any failure → 'ecommerce'
    tenancy/current-site.server.ts  adapter: the request's site as a SiteRef
    feature-flags/flags.server.ts   platform_feature_enabled(key, site), cached 15 s, failure → off
    supabase/env.server.ts          Supabase settings for the platform layer
    supabase/api-client.server.ts   Supabase client for an engine schema with x-tenant-id (+ user token)
    auth/session.server.ts          the signed-in user (no store-membership rule)
  engines/
    ecommerce/engine.ts             thin descriptor — no Ecommerce code moved or changed
    hospitality/                    see src/engines/hospitality/README.md
      engine.ts config.ts edge/gate.ts types/domain.ts validation/input.ts
      server/public.functions.ts guest.functions.ts owner.functions.ts rpc.server.ts index.ts
```

Existing files changed (minimal): `src/start.ts` (+3 lines: the dispatcher as global
function middleware), `src/server.ts` (+6 lines: the engine edge gate after the site is
resolved), `eslint.config.js` (boundary rules), `vitest.config.ts` (architecture tests),
`.github/workflows/tests.yml` (strict lint of the new layers), `e2e/scripts/app-up.sh`
(`HOSPITALITY_ENGINE=on` for the test app only). No Ecommerce route, component, server
function or business rule was moved or changed.

## Server functions and the dispatcher
- Ownership by source file (`serverFnMeta.filename`): `src/engines/hospitality/**` →
  Hospitality; `src/platform/**` and the 16 listed shared files → platform; everything
  else → Ecommerce (today's behaviour).
- Decision: platform → always; Ecommerce function → only on an Ecommerce site (or with no
  site, e.g. the platform panel); Hospitality function → only on a Hospitality site whose
  engine is enabled (`HOSPITALITY_ENGINE=on` **and** `hospitality_backend_enabled`).
  Otherwise **HTTP 404** (and a `notFound` for the client), and the function does not run.
- Ecommerce sites: one cached site-type lookup (15 s); Ecommerce is always enabled.
- Hospitality server functions have no UI yet; the composition root includes them in the
  build so the dispatcher is tested end-to-end. In production they answer 404 until the
  environment switch and the site's flags are turned on (separately approved).

## Edge (pages and files)
- Ecommerce sites: unchanged (`storeGate`, feeds, Zap pages).
- Hospitality sites: `robots.txt` → `Disallow: /`; every page and feed → 404 with
  `x-robots-tag: noindex`; server functions → dispatcher. The website renderer arrives in
  Stage 4 behind `hospitality_frontend_enabled`.

## Not changed (documented couplings, plan §B1)
Tenant resolution still embeds the Ecommerce subscription; `storeGate` uses it;
`tenants_seed_settings` seeds Ecommerce rows; `site_settings` mixes generic and Ecommerce
columns; generic helpers live in `src/lib`. The Hospitality engine never touches them:
only the platform adapters do, and only the listed ones.
