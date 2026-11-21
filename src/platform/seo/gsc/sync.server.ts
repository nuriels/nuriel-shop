// NURIEL AI SEO ENGINE — the daily Search Console sync of one business (the worker's gsc_sync job). Only with the
// owner's own connection (or the platform's domain property, for a host it really covers); read-only scope; the
// refresh token is decrypted in memory for this sync only. What comes back is Google's own numbers, stored with
// their date range: snapshots (queries / pages) and keyword ideas marked source "gsc" — never estimates.
import type { TenantBasics, WorkerDeps } from "../worker.server";
import { classifyIntent, normalizePhrase, type KeywordKind } from "../keywords";
import { totals } from "./opportunities";
import {
  decryptRefreshToken,
  gscConfig,
  GscError,
  matchProperty,
  refreshAccessToken,
  searchAnalytics,
} from "./api.server";
import type { GscRow } from "./csv";

interface Connection {
  id: string;
  tenant_id: string | null;
  property: string;
  token: string;
  status: string;
}

const day = (offset: number, now: number) =>
  new Date(now - offset * 86_400_000).toISOString().slice(0, 10);

const QUESTION = /^(?:איך|מה|למה|מדוע|איפה|היכן|מתי|כמה|האם|מי|באיזה|איזה|איזו)(?=\s|$)/;
const LOCAL = /(ליד|באזור|קרוב|בסביבת)/;

function kindOf(phrase: string, name: string): KeywordKind {
  const p = normalizePhrase(phrase);
  if (name && p.includes(normalizePhrase(name))) return "brand";
  if (QUESTION.test(p)) return "question";
  if (LOCAL.test(p)) return "local";
  return p.split(" ").length >= 3 ? "long_tail" : "primary";
}

export async function syncSearchConsole(
  b: TenantBasics,
  deps: WorkerDeps,
): Promise<{ synced: boolean; reason?: string; queries?: number; pages?: number }> {
  const cfg = gscConfig();
  if (!cfg) return { synced: false, reason: "not_configured" };
  const conn = await deps.rpc<Connection | null>("seo_gsc_connection_get", { _tenant: b.id });
  if (!conn) return { synced: false, reason: "not_connected" };
  const { origin } = await deps.originsOf(b);
  if (!origin) return { synced: false, reason: "no_origin" };
  const platformRow = conn.tenant_id === null;
  // the platform's own property: only for a host it covers, and only this business's pages
  if (platformRow && !matchProperty(origin, [{ siteUrl: conn.property }]))
    return { synced: false, reason: "not_covered" };

  let access: string;
  try {
    const refresh = decryptRefreshToken(conn.token);
    if (!refresh) throw new GscError("the stored token cannot be read", "auth");
    access = await refreshAccessToken(cfg, refresh);
  } catch (e) {
    const code = e instanceof GscError ? e.code : "auth";
    if (!platformRow)
      await deps.rpc("seo_gsc_connection_status", {
        _id: conn.id,
        _status: code === "auth" ? "revoked" : "error",
        _error:
          code === "auth" ? "Google לא מאשר יותר את החיבור — מחברים מחדש" : "Search Console לא ענה",
        _synced: false,
      });
    return { synced: false, reason: code };
  }

  const now = (deps.now ?? Date.now)();
  // Google's data lags ~2–3 days: the last 28 full days, and the 28 before them (for drops)
  const cur = { start: day(30, now), end: day(3, now) };
  const prev = { start: day(58, now), end: day(31, now) };
  const pagePrefix =
    platformRow || conn.property.startsWith("sc-domain:") ? `${origin}/` : undefined;
  const q = (dimension: "query" | "page", range: { start: string; end: string }) =>
    searchAnalytics(access, conn.property, {
      startDate: range.start,
      endDate: range.end,
      dimension,
      rowLimit: 1000,
      ...(pagePrefix ? { pagePrefix } : {}),
    });

  let queries: GscRow[];
  let pages: GscRow[];
  let previous: GscRow[];
  try {
    [queries, pages, previous] = await Promise.all([
      q("query", cur),
      q("page", cur),
      q("query", prev),
    ]);
  } catch (e) {
    const code = e instanceof GscError ? e.code : "network";
    if (!platformRow)
      await deps.rpc("seo_gsc_connection_status", {
        _id: conn.id,
        _status: code === "forbidden" || code === "auth" ? "revoked" : "error",
        _error:
          code === "forbidden"
            ? "אין גישה לנכס הזה ב-Search Console"
            : "Search Console לא ענה — ננסה שוב מחר",
        _synced: false,
      });
    return { synced: false, reason: code };
  }

  const save = (
    dimension: "query" | "page",
    range: { start: string; end: string },
    rows: GscRow[],
  ) =>
    deps.rpc("seo_gsc_snapshot_save", {
      _tenant: b.id,
      _dimension: dimension,
      _start: range.start,
      _end: range.end,
      _source: "api",
      _rows: rows.slice(0, 5000),
      _totals: totals(rows),
      _actor: null,
    });
  await save("query", prev, previous);
  await save("query", cur, queries);
  await save("page", cur, pages);

  // the real queries become keyword ideas WITH Google's numbers (and their period)
  const ideas = queries
    .filter((r) => r.impressions >= 10 && r.key.length >= 2 && r.key.length <= 80)
    .slice(0, 150)
    .map((r) => ({
      phrase: r.key,
      kind: kindOf(r.key, b.name),
      intent: classifyIntent(r.key, { name: b.name, places: [] }),
      source: "gsc",
      reason: "חיפוש אמיתי מ-Google Search Console",
      metrics: {
        impressions: r.impressions,
        clicks: r.clicks,
        ctr: r.ctr,
        position: Number(r.position.toFixed(1)),
        period: `${cur.start}..${cur.end}`,
      },
    }));
  if (ideas.length) await deps.rpc("seo_keyword_ideas_add", { _tenant: b.id, _items: ideas });
  if (!platformRow)
    await deps.rpc("seo_gsc_connection_status", {
      _id: conn.id,
      _status: "connected",
      _error: null,
      _synced: true,
    });
  return { synced: true, queries: queries.length, pages: pages.length };
}
