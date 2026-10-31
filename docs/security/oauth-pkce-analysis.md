# Security analysis — OAuth return addresses, implicit flow and PKCE

Status: **analysis only. No authentication code or configuration was changed.**
Any remediation is a separate change that needs explicit approval.

**Decision (Stage 2 approval): the finding stays open.** The remediation (central login host,
PKCE, allow-list change) is postponed to the final security and deployment preparation stage
and must be done before Google login is enabled anywhere in Hospitality. Until then:
Hospitality offers no Google login on any screen (owner area: portal / platform handoff,
email code, password — tested in `e2e/tests/manage.spec.ts`); Google OAuth, GoTrue
configuration, redirect allow-lists and the existing login flows are unchanged.

Environment: local disposable Supabase stack (GoTrue v2.197.0, supabase-js / auth-js
2.112.4), configured like production (`SITE_URL` + `https://*.<base domain>/**`
allow-list), two store addresses `legit.shop.localhost` and `evil.shop.localhost`.
The production GoTrue version was not checked (no production access).

## 1. The finding (from the Stage 1a report)

| # | Fact | Where | Status |
|---|---|---|---|
| F1 | Every store subdomain is an accepted return address | `deploy/setup-selfhost.sh`: `ADDITIONAL_REDIRECT_URLS=${SITE_URL}/**,https://*.${TENANT_BASE_DOMAIN}/**` | verified (config + local GoTrue) |
| F2 | Anyone can obtain a store subdomain (free store opening) | `src/lib/portal.functions.ts` `createPortalStore` | verified (code) |
| F3 | The browser client uses the implicit flow | `src/integrations/supabase/client.ts` (no `flowType`), auth-js default `'implicit'` | verified (code) |
| F4 | Access tokens are global (one account, all stores) | `auth.users` is global; RLS uses membership + `x-tenant-id` | verified (design) |

## 2. Experiments and results

Harness: a page served on both store addresses, using the real supabase-js client
with `flowType` `implicit` or `pkce`, driven by Playwright; magic-link emails captured
by a local SMTP sink. Kept outside the repository (scratch).

### A. Crafted request **without** a PKCE challenge (built by an attacker)
| Test | Result |
|---|---|
| A1 `GET /auth/v1/authorize?provider=…&redirect_to=<attacker store>` | GoTrue stores the flow with **no code challenge** (= implicit) and the attacker store as the return address |
| A2 the same request with `code_challenge` (what a PKCE client sends) | stored as `s256` flow |
| A3 public `POST /auth/v1/otp` (magic link) for the victim's email, `redirect_to=<attacker store>` | the email link redirects to the **attacker store with `#access_token=…` in the URL** |
| A4 victim opens that link; the attacker store runs a **PKCE** client | no session is created, **but the tokens stay in the address bar** after the client initialises (not removed) |
| A5 the same with today's **implicit** client | a session for the victim is created **on the attacker store's origin**; the URL is cleaned |

**Conclusion: switching our client to PKCE does not prevent the crafted direct
authorization attack.** The server chooses implicit vs PKCE from the incoming request,
not from our client configuration. An attacker simply omits `code_challenge`, and GoTrue
returns tokens to any allow-listed address. With a PKCE client the tokens are even left
in the URL on the attacker's page.

### B. Normal client-initiated PKCE flow
| Test | Result |
|---|---|
| B1 `signInWithOtp` from the legit store with a PKCE client | return URL carries `?code=…`, no tokens; the code verifier is stored only in the legit origin's storage |
| B2 the original browser context on the legit origin | code exchanged, session created, `code` removed from the URL |

### C. The authorization code elsewhere
| Test | Result |
|---|---|
| C1 same code opened on another store origin | no session (no verifier there) |
| C2 same code, same origin, different browser context | no session (no verifier) |
| C3 direct `/token?grant_type=pkce` with a wrong verifier | `400 bad_code_verifier` |
| C4 replay of a code after it was used | `404` (single use) |

**Conclusion:** a PKCE code is useless outside the browser and origin that started the
flow. That protects PKCE-initiated logins, but not crafted implicit ones (A).

### D. Compatibility of a PKCE client with existing logins
| Test | Result |
|---|---|
| D2 `setSession()` with server-issued tokens (the path used by password login, email-code login, portal and store-switch handoff) | works unchanged |
| D1 `/admin-handoff#code=…` (our own one-time handoff code) | with a leftover PKCE verifier (abandoned login), the PKCE client **tries to exchange the handoff code as a PKCE code** (harmless 404; the handoff code stays in the URL and the handoff still works). Ambiguous parameter name → should be renamed in the same change. |
| Google return pages (`/login?google=1`, portal `/?portal_google=1`) | work if the flow starts and ends on the same origin (B); would need the central flow below |

## 3. Verified vs theoretical

| Item | Status |
|---|---|
| Tokens can be delivered to an attacker-controlled store address (OAuth implicit, magic link) | **verified** locally (A1, A3) with production-like allow-list |
| Today's client creates the victim's session on the attacker store origin | **verified** (A5) |
| The attacker can actually **read** those tokens | **not verified / theoretical**: store owners cannot run their own scripts (owner HTML sanitised, tracking scripts only after consent, owner-set IDs validated). Becomes real if any owner-controlled script runs on a store origin in the future (feature or XSS) |
| Magic-link vector in production | **unverified**: requires GoTrue to send emails in production (SMTP configured in the `kobi` stack — not checked). The OAuth vector does not depend on SMTP |
| Impact if tokens are obtained | **high**: account takeover across every store where the victim is staff (F4) |

## 4. Remediation (proposed — separate approved change)

The root cause is F1 (attacker-controllable return addresses), not F3. Fix in two layers:

1. **Central login return host** (removes F1):
   - **Return host:** all OAuth/magic-link flows return to one Nuriel-controlled address
     that carries no store content and no third-party scripts. Either a dedicated
     `login.<base domain>` or the existing platform host; this is a decision.
   - **Store button:** the store's Google button navigates to
     `https://<login host>/auth/start?site=<store>`.
   - **Login on the central host:** the login host runs a **PKCE** client, completes the
     login, and asks the server for a one-time code bound to the **validated** target
     store. The store must exist (`tenant_for_host` / verified custom domain). This reuses
     the existing `platform_admin_handoffs` mechanism with a new kind.
   - **Handoff to the store:** redirect to `https://<store>/auth-handoff#handoff=<code>`.
     The store exchanges the code server-side (existing `sessionForEmail`) and signs the
     central host out.
   - **GoTrue configuration:** `ADDITIONAL_REDIRECT_URLS` contains only the login host,
     and `SITE_URL` is the login host. The store wildcard is removed, so crafted links
     fall back to the login host (verified behaviour: an unlisted address falls back to
     `SITE_URL`).
   - **Side benefit:** Google login also works on **custom domains**, which today it
     can't.
2. **PKCE on the login host** (defence in depth, verified C1–C4).
3. Rename the handoff fragment parameter from `#code=` to `#handoff=`, accepting both
   during the transition (D1).

### Compatibility
- **Unchanged:** password login, email-code login, portal code login, store switcher and
  admin handoff all use server-issued sessions (D2).
- **Moved to the central flow:** Google on stores and on the portal.
- **Existing sessions:** stay valid; no forced logout.

### Migration plan
1. Implement the central flow and the `#handoff=` rename behind a server setting
   (default off). Both old and new paths keep working. Full E2E plus new tests:
   - a crafted link to a store falls back to the login host;
   - the handoff only goes to registered stores;
   - a code is single use and expires;
   - a code can't be used on another store.
2. Deploy (no auth config change yet), enable the setting for one test store, verify
   with a real Google account.
3. Enable for all stores (Google buttons now use the central flow).
4. **Production config change (separate approval):** set `ADDITIONAL_REDIRECT_URLS` to
   the login host only and update `SITE_URL`, then restart the auth container. Verify the
   crafted-link tests against production.
5. Monitor login errors for 48 h.

### Rollback
- **Step 4:** restore the previous `ADDITIONAL_REDIRECT_URLS` / `SITE_URL` line and
  restart auth (≈1 minute).
- **Steps 1–3:** turn the server setting off and the buttons go back to the current
  flow.
- No database migration is involved. The handoff kind is additive.

### Not recommended
- **PKCE on the store client alone:** does not stop the attack (A4), and it leaves tokens
  in the URL on the attacker's page.
- **Listing every store in the allow-list:** needs an auth restart per store and still
  trusts attacker-opened stores.
