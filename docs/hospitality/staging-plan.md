# Staging on the existing Ubuntu server — recommendation (plan only)

Status: **proposal — nothing done on the server.** Every step below needs approval first.

## 1. Goal and rules

Show the Hospitality work (management area, later the website) on a real address, on the
same Ubuntu server, **without touching Production**:
- own containers, own Supabase stack (own Postgres, Auth, Storage, keys), own volumes, own
  ports, own domain names — nothing shared with Production except the Docker daemon, the
  machine and the reverse proxy;
- no Production data, no Production secrets, no real customer emails, no real payments;
- not indexed, not public (password in front);
- removable in minutes without leaving anything behind.

The server already runs several isolated Supabase stacks side by side (`deploy/DEPLOY.md`:
nuri 8000, Moments 8100, inv 8200, kobi 8300 …), and `deploy/setup-selfhost.sh` already
creates a fully separate stack from parameters (`PROJECT`, `SB_DIR`, `KONG_HTTP_PORT`,
`APP_PORT`, domains). Staging uses **that same pattern** — no new mechanism.

## 2. Layout

| Part | Staging value (proposal) | Production (not touched) |
|---|---|---|
| Compose project / container prefix | `nuriel-stg` (`nuriel-stg-db`, `-kong`, `-auth`, `-rest`, `-storage`, `-meta`) | existing projects |
| Supabase directory and secrets | `/root/nuriel-stg-supabase/docker/.env` — new JWT secret and keys (`deploy/gen-keys.mjs`) | existing `.env` files |
| Ports (bound to 127.0.0.1 only) | e.g. Kong `8600` / `8645`, app `3800` — **not** `8500` / `3700` (the installer's defaults, used by Nuriel Production) and not 8000–8300 (other stacks); final numbers after a read-only check of free ports | existing |
| Code | separate clone `/root/nuriel-stg-git`, branch `hospitality/stage-2` | existing clone / Coolify app |
| App container | `nuriel-stg-app`, same Dockerfile, its own compose project | existing |
| Domains | platform `stg.nuri1.fit`, API `api-stg.nuri1.fit`, sites `<slug>.stg.nuri1.fit` (`TENANT_BASE_DOMAIN=stg.nuri1.fit`) | existing |
| Email | the app sends through the Resend HTTP API, whose address is configurable (`RESEND_API_URL`). **Recommended:** the small Resend-compatible catcher the E2E tests already use (`e2e/scripts/mock-services.mjs`: stores every email, nothing leaves the server; read via an SSH tunnel to `127.0.0.1`). Option: a separate Resend key with a staging sender, only if demo users must get real codes in their inbox | Resend |
| Payments | none / Grow sandbox only | Grow |
| Google login | not configured (OAuth finding open) | existing |
| Engine | `HOSPITALITY_ENGINE=on`; flags enabled only for the demo sites | off |
| Data | demo sites only (e.g. "צימר לדוגמה", "מתחם לדוגמה"), test accounts | real |

## 2a. Isolation from Production — point by point

| Area | Staging | How it is kept apart |
|---|---|---|
| Database | its own Postgres container and volume (`nuriel-stg-db`) | different compose project, port bound to 127.0.0.1, different superuser password; no replication, no dump / restore from Production |
| Files (Storage) | its own Storage container and volume | separate buckets on a separate volume; the Production backup script is not pointed at it |
| Keys and secrets | new JWT secret, anon / service keys (`deploy/gen-keys.mjs`), new `LOGIN_CODE_SECRET`, `GROW_SECRETS_KEY` | its own `.env` under `/root/nuriel-stg-supabase` and `/root/nuriel-stg-git`; a Production token is invalid on Staging and vice versa (different JWT secret) |
| Emails | the local Resend-compatible catcher (`RESEND_API_URL` → 127.0.0.1) | no Resend key on Staging at all → nothing can reach a real inbox |
| Payments | none / Grow sandbox | no Production Grow credentials |
| Network | its own Docker network (compose project) | containers of the two environments are not on a shared network; Staging talks only to its own Kong |
| Domains | `stg`, `api-stg`, `*.stg` | separate vhosts / Coolify resources; Production vhosts untouched |
| Accounts | Staging super-admin and test accounts | created in Staging only; Production accounts do not exist there |
| Super-admin panel | links only (`platform-admin-hospitality-plan.md`) | the Production panel never reads Staging's data |

**Read-only check first:** `sudo bash deploy/staging/infra-check.sh` prints the proxy, RAM,
disk, ports, domains, certificates and whether the Staging names resolve — and changes
nothing.

## 3. Reverse proxy, TLS and access

First a **read-only check** of who owns ports 80/443 today (Nginx as in `DEPLOY.md`, or
Coolify's proxy):
- **Nginx:** add new vhost files only (`stg`, `api-stg`, `*.stg`), `nginx -t` before a
  reload; existing files untouched.
- **Coolify:** a separate Coolify *project* "Nuriel Staging" with its own resources and
  domains; Production resources untouched.

TLS: `*.stg.nuri1.fit` needs a wildcard certificate (DNS-01 with the DNS provider) **or** a
short fixed list of demo hosts with ordinary certificates (simpler, recommended to start).
Access: HTTP basic auth (or an IP allow-list) on every staging host, plus
`X-Robots-Tag: noindex` — the app already serves `Disallow: /` on Hospitality sites.
NetFree: check that the existing `*.nuri1.fit` approval also covers `*.stg.nuri1.fit`.

## 4. Resources and safety

- Before anything: `free -h`, `df -h`, `docker stats --no-stream` (read-only). A Supabase
  stack + app needs roughly 2–3 GB RAM. If the server has less than ~4 GB free, use a small
  separate VPS instead (same steps, zero risk to Production).
- Staging containers get `mem_limit` / `cpus` limits so they cannot starve Production.
- Every command names the project explicitly (`docker compose -p nuriel-stg …`); never
  `docker system prune`, never `down` without `-p`, never a Production `.env` or volume.
- Separate backups are not needed (disposable data); the Production backup script is not
  pointed at staging, and vice versa.

## 5. Order (when approved)

0. Read-only survey (proxy, free ports, RAM, disk, existing stacks).
1. DNS records for `stg`, `api-stg` (+ demo hosts or wildcard).
2. Clone the branch to `/root/nuriel-stg-git`.
3. `PROJECT=nuriel-stg SB_DIR=/root/nuriel-stg-supabase KONG_HTTP_PORT=… APP_PORT=… …
   bash deploy/setup-selfhost.sh` — runs all migrations (1–n) on the empty staging DB.
4. Expose the `hospitality` schema to that stack's PostgREST only.
5. Build and start the app (`HOSPITALITY_ENGINE=on`, `RESEND_API_URL` → the local email
   catcher).
6. Proxy, certificates, basic auth.
7. Seed demo sites and accounts; enable flags for them only.
8. Smoke tests: management login by email code (code read in the email catcher), settings, team,
   units (after 2c); Ecommerce demo store unchanged.
9. **Try the upgraded SSR health check here first** (go-live requirement P-1).

Removal: `docker compose -p nuriel-stg down -v` (staging only), delete the staging vhosts /
Coolify project, DNS records and the clone.

## 6. Questions before starting

1. Nginx or Coolify in front today? (decides §3)
2. Free RAM / disk on the server (decides same server vs small VPS).
3. Domain names: `stg.nuri1.fit` acceptable? wildcard or a fixed list of demo hosts?
4. Who should be able to open staging (basic-auth users / IPs)?
