// NURIEL AI SEO ENGINE — Google Search Console API (read-only), per business, by the owner's own consent.
// • OAuth 2.0 web flow with the narrowest scope: webmasters.readonly. The business owner signs in to Google and
//   picks the property; we never sign in on anyone's behalf and never ask for edit scopes.
// • The refresh token is stored encrypted only (AES-256-GCM, the platform's existing AI-key mechanism with its
//   own derivation label — no new master key). Access tokens live in memory for one sync.
// • Configuration: GSC_OAUTH_CLIENT_ID / GSC_OAUTH_CLIENT_SECRET (a Google Cloud OAuth client with the Search
//   Console API enabled; it can be the same client the Google login already uses) and the redirect URI
//   https://<platform host>/api/seo/gsc/callback. Without them the screen shows "not configured" — nothing breaks.
// No new packages: plain fetch to Google's documented endpoints.
import { decryptWithSecret, encryptWithSecret, serverSecret } from "@/platform/ai/secrets.server";
import type { GscRow } from "./csv";

export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://searchconsole.googleapis.com/webmasters/v3";

export interface GscConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export class GscError extends Error {
  constructor(
    message: string,
    readonly code: "not_configured" | "auth" | "forbidden" | "quota" | "network" | "bad_response",
  ) {
    super(message);
  }
}

export function gscConfig(env: Record<string, string | undefined> = process.env): GscConfig | null {
  const clientId = env["GSC_OAUTH_CLIENT_ID"]?.trim();
  const clientSecret = env["GSC_OAUTH_CLIENT_SECRET"]?.trim();
  const host = (env["GSC_OAUTH_REDIRECT_HOST"] ?? env["PLATFORM_ADMIN_HOST"] ?? "").trim();
  if (!clientId || !clientSecret || !host) return null;
  const origin = /^https?:\/\//.test(host) ? host.replace(/\/$/, "") : `https://${host}`;
  return { clientId, clientSecret, redirectUri: `${origin}/api/seo/gsc/callback` };
}

const tokenSecret = () => `${serverSecret()}|nuriel-seo-gsc-refresh-token|v1`;
export const encryptRefreshToken = (plain: string) => encryptWithSecret(tokenSecret(), plain);
export const decryptRefreshToken = (blob: string) => decryptWithSecret(tokenSecret(), blob);

export function authorizeUrl(cfg: GscConfig, state: string): string {
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: GSC_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
  });
  return `${AUTH_URL}?${q.toString()}`;
}

type FetchLike = typeof fetch;

async function postForm(
  f: FetchLike,
  url: string,
  body: Record<string, string>,
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await f(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new GscError("Google is not reachable right now", "network");
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = String(json["error"] ?? res.status);
    throw new GscError(
      `Google token error: ${err}`,
      err === "invalid_grant" ? "auth" : "bad_response",
    );
  }
  return json;
}

export async function exchangeCode(
  cfg: GscConfig,
  code: string,
  f: FetchLike = fetch,
): Promise<{ refreshToken: string; accessToken: string; scope: string }> {
  const j = await postForm(f, TOKEN_URL, {
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    grant_type: "authorization_code",
  });
  const refreshToken = typeof j["refresh_token"] === "string" ? j["refresh_token"] : "";
  const accessToken = typeof j["access_token"] === "string" ? j["access_token"] : "";
  const scope = typeof j["scope"] === "string" ? j["scope"] : "";
  if (!refreshToken || !accessToken)
    throw new GscError("Google did not return a refresh token", "auth");
  if (!scope.split(" ").includes(GSC_SCOPE))
    throw new GscError("Search Console read access was not granted", "forbidden");
  return { refreshToken, accessToken, scope };
}

export async function refreshAccessToken(
  cfg: GscConfig,
  refreshToken: string,
  f: FetchLike = fetch,
): Promise<string> {
  const j = await postForm(f, TOKEN_URL, {
    refresh_token: refreshToken,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: "refresh_token",
  });
  const token = typeof j["access_token"] === "string" ? j["access_token"] : "";
  if (!token) throw new GscError("Google did not return an access token", "auth");
  return token;
}

async function api(
  f: FetchLike,
  accessToken: string,
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await f(`${API}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new GscError("Search Console is not reachable right now", "network");
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 401) throw new GscError("Search Console access expired — reconnect", "auth");
  if (res.status === 403)
    throw new GscError("No access to this Search Console property", "forbidden");
  if (res.status === 429) throw new GscError("Search Console quota reached — try later", "quota");
  if (!res.ok) throw new GscError(`Search Console error ${res.status}`, "bad_response");
  return json;
}

/** the properties this Google account can see, with its permission level */
export async function listSites(
  accessToken: string,
  f: FetchLike = fetch,
): Promise<{ siteUrl: string; permission: string }[]> {
  const j = await api(f, accessToken, "/sites");
  const entries = Array.isArray(j["siteEntry"])
    ? (j["siteEntry"] as Record<string, unknown>[])
    : [];
  return entries
    .map((e) => ({
      siteUrl: String(e["siteUrl"] ?? ""),
      permission: String(e["permissionLevel"] ?? ""),
    }))
    .filter((e) => e.siteUrl && e.permission !== "siteUnverifiedUser");
}

/** the property that covers a business's public origin (domain property or URL-prefix property) */
export function matchProperty(origin: string, sites: { siteUrl: string }[]): string | null {
  let host: string;
  try {
    host = new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
  const exact = sites.find(
    (s) => s.siteUrl.replace(/\/$/, "").toLowerCase() === origin.replace(/\/$/, "").toLowerCase(),
  );
  if (exact) return exact.siteUrl;
  const domain = sites.find((s) => {
    if (!s.siteUrl.startsWith("sc-domain:")) return false;
    const d = s.siteUrl.slice("sc-domain:".length).toLowerCase();
    return host === d || host.endsWith(`.${d}`);
  });
  return domain?.siteUrl ?? null;
}

/** Search Analytics for one dimension and date range (Google keeps 16 months; data lags ~2–3 days) */
export async function searchAnalytics(
  accessToken: string,
  siteUrl: string,
  q: {
    startDate: string;
    endDate: string;
    dimension: "query" | "page" | "date";
    rowLimit?: number;
    pagePrefix?: string;
  },
  f: FetchLike = fetch,
): Promise<GscRow[]> {
  const body: Record<string, unknown> = {
    startDate: q.startDate,
    endDate: q.endDate,
    dimensions: [q.dimension],
    rowLimit: Math.min(q.rowLimit ?? 1000, 25_000),
    dataState: "final",
  };
  if (q.pagePrefix)
    body["dimensionFilterGroups"] = [
      { filters: [{ dimension: "page", operator: "contains", expression: q.pagePrefix }] },
    ];
  const j = await api(
    f,
    accessToken,
    `/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    body,
  );
  const rows = Array.isArray(j["rows"]) ? (j["rows"] as Record<string, unknown>[]) : [];
  return rows.map((r) => ({
    key: String((Array.isArray(r["keys"]) ? r["keys"][0] : "") ?? ""),
    clicks: Number(r["clicks"] ?? 0),
    impressions: Number(r["impressions"] ?? 0),
    ctr: Number(r["ctr"] ?? 0),
    position: Number(r["position"] ?? 0),
  }));
}
