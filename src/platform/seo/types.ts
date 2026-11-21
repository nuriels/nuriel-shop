// NURIEL AI SEO ENGINE — the shapes the SEO center shows (both engines). Numbers here are either a technical
// checklist (the audit score) or Google's own data (Search Console) — never an estimate presented as data.
import type { AuditIssue, Severity } from "./audit/rules";
import type { GscRow } from "./gsc/csv";
import type { Opportunity } from "./gsc/opportunities";

export type SeoSiteType = "ecommerce" | "hospitality";

export interface SeoAuditView {
  id: string;
  source: "manual" | "auto" | "scheduled";
  origin: string;
  score: number;
  counts: Partial<Record<Severity, number>>;
  pages_audited: number;
  sitemap_urls: number;
  robots_status: number;
  sitemap_status: number;
  pages: {
    url: string;
    kind: string;
    status: number;
    title: string | null;
    description: string | null;
    h1: string | null;
  }[];
  issues: AuditIssue[];
  finished_at: string;
}

export interface SeoKeywordIdea {
  id: string;
  phrase: string;
  kind: string;
  intent: string;
  source: "template" | "ai" | "gsc" | "import";
  reason: string | null;
  status: "new" | "adopted" | "dismissed";
  /** only for Search Console rows: Google's numbers and their period */
  metrics: {
    impressions?: number;
    clicks?: number;
    ctr?: number;
    position?: number;
    period?: string;
  } | null;
}

export interface SeoSnapshot {
  id: string;
  dimension: "query" | "page";
  period_start: string;
  period_end: string;
  source: "api" | "csv";
  rows: GscRow[];
  totals: { clicks?: number; impressions?: number; ctr?: number; position?: number };
  created_at: string;
}

export interface SeoCenterData {
  site_type: SeoSiteType | string;
  can_connect_gsc: boolean;
  settings: {
    auto_apply: { alt: boolean; meta: boolean; keywords: boolean };
    weekly_audit: boolean;
    initial_done_at: string | null;
  };
  pending_proposals: number;
  audit: SeoAuditView | null;
  audits: {
    id: string;
    score: number;
    counts: Partial<Record<Severity, number>>;
    finished_at: string;
    source: string;
  }[];
  keywords: SeoKeywordIdea[];
  gsc: {
    connected: boolean;
    property: string | null;
    status: string | null;
    last_sync_at: string | null;
    last_error: string | null;
    platform_connection: boolean;
    snapshots: SeoSnapshot[];
  };
}

export interface SeoCenterView extends SeoCenterData {
  /** the platform has the OAuth client (GSC_OAUTH_CLIENT_ID / SECRET) — else "connect" is not offered */
  gsc_configured: boolean;
  /** from the newest Search Console query snapshot (and the one before it, for drops) — real numbers only */
  opportunities: Opportunity[];
  /** the period the opportunities are from */
  opportunities_period: { start: string; end: string } | null;
}

export type SeoSettingsPatch = Partial<{
  alt: boolean;
  meta: boolean;
  keywords: boolean;
  weekly_audit: boolean;
}>;
