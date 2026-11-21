// NURIEL AI SEO ENGINE — the SEO center's server side (both engines). The business is always the one of the
// request's address (currentSite), never a value from the browser; every function runs in the database AS THE
// SIGNED-IN USER, where the role is checked again (seo_center / seo_settings_save … → public.seo_can_manage).
import { sessionFromRequest } from "../auth/session.server";
import { apiClient } from "../supabase/api-client.server";
import { currentSite, currentSiteHosts } from "../tenancy/current-site.server";
import { findOpportunities } from "./gsc/opportunities";
import { classifyIntent, normalizePhrase, ownKeywordKind } from "./keywords";
import { gscConfig } from "./gsc/api.server";
import { GscCsvError, parseGscCsv } from "./gsc/csv";
import { totals } from "./gsc/opportunities";
import { signTicket, startUrl } from "./gsc/oauth.server";
import type { SeoCenterData, SeoCenterView, SeoSettingsPatch, SeoSnapshot } from "./types";

export class SeoCenterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeoCenterError";
  }
}

const USER_FACING = /[֐-׿]/;

async function staffRpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  let s: { userId: string; accessToken: string } | null = null;
  try {
    s = await sessionFromRequest();
  } catch {
    s = null;
  }
  if (!s) throw new SeoCenterError("נדרשת התחברות");
  const site = await currentSite();
  if (!site) throw new SeoCenterError("העסק לא זוהה");
  const { data, error } = await apiClient({
    schema: "public",
    siteId: site.id,
    accessToken: s.accessToken,
  }).rpc(fn, args);
  if (error) {
    const userFacing = USER_FACING.test(error.message ?? "");
    if (!userFacing) console.error(`[seo] ${fn} failed`, error.code, error.message);
    throw new SeoCenterError(userFacing ? error.message : "הפעולה נכשלה — נסו שוב");
  }
  return data as T;
}

/** the newest query snapshot and the one for the period just before it (by dates, not by insert order) */
export function currentAndPrevious(snapshots: SeoSnapshot[]): {
  cur: SeoSnapshot | null;
  prev: SeoSnapshot | null;
} {
  const queries = snapshots
    .filter((s) => s.dimension === "query")
    .sort((a, b) => b.period_end.localeCompare(a.period_end));
  const cur = queries[0] ?? null;
  const prev = cur ? (queries.find((s) => s.period_end < cur.period_start) ?? null) : null;
  return { cur, prev };
}

export function centerViewOf(data: SeoCenterData, configured: boolean): SeoCenterView {
  const { cur, prev } = currentAndPrevious(data.gsc.snapshots ?? []);
  const known = data.keywords.filter((k) => k.status === "adopted").map((k) => k.phrase);
  return {
    ...data,
    gsc_configured: configured,
    opportunities: cur
      ? findOpportunities(cur.rows, {
          ...(prev ? { previous: prev.rows } : {}),
          knownKeywords: known,
          limit: 30,
        })
      : [],
    opportunities_period: cur ? { start: cur.period_start, end: cur.period_end } : null,
  };
}

export async function seoCenter(): Promise<SeoCenterView> {
  const data = await staffRpc<SeoCenterData>("seo_center");
  return centerViewOf(data, gscConfig() !== null);
}

export async function saveSeoSettings(patch: SeoSettingsPatch): Promise<SeoCenterView> {
  await staffRpc("seo_settings_save", { _patch: patch });
  return seoCenter();
}

export function requestSeoRun(
  kind: "audit" | "initial",
): Promise<{ queued: boolean; already: boolean }> {
  return staffRpc("seo_request", { _kind: kind });
}

export function setKeywordIdea(id: string, status: "new" | "adopted" | "dismissed") {
  return staffRpc<{ id: string; phrase: string; status: string }>("seo_keyword_idea_set", {
    _id: id,
    _status: status,
  });
}

/**
 * the owner's own phrase (a search they want to be found for) — "chosen" at once, an idea without numbers. Its
 * kind / intent come from its own words; Google's numbers appear only if Search Console reports that search.
 */
export async function addKeywordIdea(phrase: string): Promise<SeoCenterView> {
  const p = normalizePhrase(phrase);
  if (p.length < 2) throw new Error("כתבו ביטוי של 2 תווים לפחות");
  const { business_name: name } =
    await staffRpc<Pick<SeoCenterData, "business_name">>("seo_center");
  await staffRpc("seo_keyword_idea_add", {
    _phrase: p,
    _kind: ownKeywordKind(p, name),
    _intent: classifyIntent(p, { name: name ?? "", places: [] }),
  });
  return seoCenter();
}

/** a Search Console CSV export, parsed HERE (Google's own numbers) and stored as a snapshot of this business */
export async function importGscCsv(input: {
  csv: string;
  start: string;
  end: string;
}): Promise<SeoCenterView> {
  let parsed: ReturnType<typeof parseGscCsv>;
  try {
    parsed = parseGscCsv(input.csv);
  } catch (e) {
    throw new SeoCenterError(
      e instanceof GscCsvError ? e.message : "הקובץ לא נקרא — מייצאים מ-Search Console כ-CSV",
    );
  }
  if (parsed.dimension === "date")
    throw new SeoCenterError('זה דוח לפי תאריכים — ייצאו את "שאילתות" או את "דפים"');
  if (!parsed.rows.length) throw new SeoCenterError("אין שורות בקובץ");
  await staffRpc("seo_gsc_csv_import", {
    _dimension: parsed.dimension,
    _start: input.start,
    _end: input.end,
    _rows: parsed.rows,
    _totals: totals(parsed.rows),
  });
  return seoCenter();
}

export async function disconnectGsc(): Promise<SeoCenterView> {
  await staffRpc("seo_gsc_disconnect");
  return seoCenter();
}

const SEO_PATH: Record<string, string> = {
  hospitality: "/manage/seo",
  ecommerce: "/admin?tab=seo",
};

/** the owner's "connect" link: a signed, 10-minute ticket — the owner is checked in the database first */
export async function gscConnectLink(): Promise<{ url: string }> {
  if (!gscConfig()) throw new SeoCenterError("החיבור ל-Search Console עוד לא הוגדר בפלטפורמה");
  const allowed = await staffRpc<boolean>("seo_gsc_can_connect");
  if (!allowed) throw new SeoCenterError("רק בעל העסק יכול לחבר את Search Console");
  const [s, site, hosts] = await Promise.all([
    sessionFromRequest(),
    currentSite(),
    currentSiteHosts(),
  ]);
  if (!s || !site || !hosts?.requestHost) throw new SeoCenterError("העסק לא זוהה");
  const path = SEO_PATH[site.siteType] ?? "/";
  const url = startUrl(
    signTicket({ t: site.id, u: s.userId, r: `https://${hosts.requestHost}${path}` }),
  );
  if (!url) throw new SeoCenterError("החיבור ל-Search Console עוד לא הוגדר בפלטפורמה");
  return { url };
}

// ------------------------------------------------------------------ the platform admin (platform host only)

async function platformRpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { isPlatformHost } = await import("../tenancy/current-site.server");
  if (!(await isPlatformHost())) throw new SeoCenterError("רק מפאנל הפלטפורמה");
  const s = await sessionFromRequest().catch(() => null);
  if (!s) throw new SeoCenterError("נדרשת התחברות");
  const { data, error } = await apiClient({
    schema: "public",
    siteId: null,
    accessToken: s.accessToken,
  }).rpc(fn, args);
  if (error) {
    const userFacing = USER_FACING.test(error.message ?? "");
    if (!userFacing) console.error(`[seo] ${fn} failed`, error.code, error.message);
    throw new SeoCenterError(userFacing ? error.message : "הפעולה נכשלה — נסו שוב");
  }
  return data as T;
}

export interface SeoPlatformRow {
  tenant_id: string;
  slug: string;
  name: string;
  site_type: string;
  status: string;
  score: number | null;
  audited_at: string | null;
  critical: number;
  high: number;
  pending: number;
  gsc: boolean;
  ideas: number;
  queued: number;
}

/** numbers per business only — the database returns no proposal texts and no customer data */
export async function platformSeoOverview(): Promise<{
  rows: SeoPlatformRow[];
  gsc_configured: boolean;
}> {
  const rows = await platformRpc<SeoPlatformRow[]>("seo_platform_overview");
  return { rows: rows ?? [], gsc_configured: gscConfig() !== null };
}

export function platformSeoRequest(tenantId: string, kind: "audit" | "initial" | "gsc_sync") {
  return platformRpc<{ queued: boolean; already: boolean }>("seo_platform_request", {
    _tenant: tenantId,
    _kind: kind,
  });
}

/** the platform's own domain property (covers the businesses on the platform's subdomains) */
export async function platformGscConnectLink(): Promise<{ url: string }> {
  const cfg = gscConfig();
  if (!cfg) throw new SeoCenterError("החיבור ל-Search Console עוד לא הוגדר בפלטפורמה");
  await platformRpc("seo_platform_overview"); // platform admin only (checked in the database)
  const s = await sessionFromRequest();
  if (!s) throw new SeoCenterError("נדרשת התחברות");
  const origin = new URL(cfg.redirectUri).origin;
  const url = startUrl(signTicket({ t: "platform", u: s.userId, r: `${origin}/platform/seo` }));
  if (!url) throw new SeoCenterError("החיבור ל-Search Console עוד לא הוגדר בפלטפורמה");
  return { url };
}
