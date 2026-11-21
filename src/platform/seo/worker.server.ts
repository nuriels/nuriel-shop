/**
 * NURIEL AI SEO ENGINE — the background worker. Runs inside the app server (setInterval, like the other
 * background jobs; started from the composition root after the engines registered their handlers), every
 * 2 minutes; the queue itself is in the database (public.seo_jobs, migration 203):
 *  • a job is claimed with FOR UPDATE SKIP LOCKED — several app instances never run the same job; a crashed
 *    run goes back to the queue (at most 3 attempts);
 *  • one job per business and type (a 500-product import queues ONE job);
 *  • audit — the business's OWN public site only (its own hosts, SSRF-safe fetcher, small page cap, polite
 *    concurrency, an honest user agent). A site that is closed / not answering is skipped, not "scored";
 *  • proposals — through the engine's handler: empty fields only, always pending (or the owner's own auto
 *    switch, empty fields only). NURIEL AI only when SEO_BACKGROUND_AI=on AND the business has its own active
 *    package — the same key, model, quotas, budget and usage log as every other AI call (no parallel system);
 *  • Search Console — only for a business whose owner connected it (read-only scope, encrypted token).
 * Switches: SEO_WORKER=off stops the worker; SEO_BACKGROUND_AI=on lets background runs call AI (default off).
 */
import { crawlSite, kindOfPath, type CrawlResult } from "./audit/crawl";
import { makeSafeFetcher, type Fetcher } from "./audit/fetch.server";
import { seoServiceRpc } from "./db.server";
import { seoEngineFor } from "./engines";
import { seedKeywords } from "./keywords";
import { syncSearchConsole } from "./gsc/sync.server";
import { siteAddressesOf } from "../tenancy/current-site.server";

export interface SeoJob {
  id: number;
  tenant_id: string;
  kind: "initial" | "entity" | "audit" | "gsc_sync";
  entity_type: string | null;
  attempts: number;
}

export interface TenantBasics {
  id: string;
  slug: string;
  name: string;
  site_type: string;
  status: string;
  is_default?: boolean;
  domain: string | null;
  custom_domain: string | null;
  custom_domain_status: string | null;
  settings: {
    auto_apply?: Record<string, boolean>;
    weekly_audit?: boolean;
    initial_done_at?: string | null;
  } | null;
}

export type JobOutcome = { status: "done" | "skipped"; result: Record<string, unknown> };

export interface WorkerDeps {
  rpc: <T>(fn: string, args: Record<string, unknown>) => Promise<T>;
  fetcherFor: (hosts: string[]) => Fetcher;
  originsOf: (b: TenantBasics) => Promise<{ origin: string | null; hosts: string[] }>;
  backgroundAi: () => boolean;
  now?: () => number;
}

const TICK_MS = 2 * 60 * 1000;
const PERIODIC_MS = 60 * 60 * 1000;
const JOBS_PER_TICK = 3;
/** a capped sample — enough to find template-wide problems, light on the site */
export const AUDIT_MAX_PAGES = 30;

const ENGINES = new Set(["ecommerce", "hospitality"]);

async function defaultOrigins(
  b: TenantBasics,
): Promise<{ origin: string | null; hosts: string[] }> {
  const a = await siteAddressesOf({
    slug: b.slug,
    custom_domain: b.custom_domain,
    custom_domain_status: b.custom_domain_status,
  });
  const origin = b.domain ? `https://${b.domain}` : a.publicOrigin;
  const hosts = [origin, a.slugOrigin]
    .map((o) => {
      try {
        return o ? new URL(o).host.toLowerCase() : null;
      } catch {
        return null;
      }
    })
    .filter((h): h is string => !!h);
  return { origin, hosts: [...new Set(hosts)] };
}

export const defaultDeps: WorkerDeps = {
  rpc: (fn, args) => seoServiceRpc(fn, args),
  fetcherFor: (hosts) => makeSafeFetcher(hosts),
  originsOf: defaultOrigins,
  backgroundAi: () => process.env["SEO_BACKGROUND_AI"] === "on",
};

/** one audit of the business's own public site; null — the site is closed / did not answer (not "scored") */
export async function auditTenant(
  b: TenantBasics,
  deps: WorkerDeps = defaultDeps,
): Promise<CrawlResult | null> {
  const { origin, hosts } = await deps.originsOf(b);
  if (!origin || !hosts.length) return null;
  const engine = b.site_type === "hospitality" ? "hospitality" : "ecommerce";
  const result = await crawlSite(
    {
      origin,
      engine,
      startPaths: ["/"],
      maxPages: AUDIT_MAX_PAGES,
      kindOf: (p) => kindOfPath(engine, p),
      concurrency: 2,
    },
    deps.fetcherFor(hosts),
  );
  const home = result.pages[0];
  if (!home || home.status !== 200) return null;
  return result;
}

async function auditAndSave(b: TenantBasics, source: "auto" | "scheduled", deps: WorkerDeps) {
  const result = await auditTenant(b, deps);
  if (!result) return { audited: false, reason: "site_not_open" };
  // the stored copy: page list trimmed (the audit row has a 1 MB cap)
  const stored = {
    ...result,
    pages: result.pages.slice(0, AUDIT_MAX_PAGES),
    issues: result.issues.slice(0, 400),
  };
  await deps.rpc("seo_audit_save", {
    _tenant: b.id,
    _source: source,
    _result: stored,
    _actor: null,
  });
  return { audited: true, score: result.score, pages: result.pagesAudited };
}

async function seedIdeas(b: TenantBasics, deps: WorkerDeps): Promise<number> {
  const handler = seoEngineFor(b.site_type);
  const facts = handler ? await handler.facts(b.id).catch(() => null) : null;
  if (!facts) return 0;
  const ideas = seedKeywords(facts).slice(0, 120);
  if (!ideas.length) return 0;
  const r = await deps.rpc<{ added?: number }>("seo_keyword_ideas_add", {
    _tenant: b.id,
    _items: ideas,
  });
  return r?.added ?? 0;
}

export async function handleJob(job: SeoJob, deps: WorkerDeps = defaultDeps): Promise<JobOutcome> {
  const b = await deps.rpc<TenantBasics | null>("seo_tenant_basics", { _tenant: job.tenant_id });
  if (!b) return { status: "skipped", result: { reason: "no_business" } };
  if (b.status !== "active") return { status: "skipped", result: { reason: "not_active" } };
  if (!ENGINES.has(b.site_type)) return { status: "skipped", result: { reason: "engine" } };
  const handler = seoEngineFor(b.site_type);

  if (job.kind === "audit") {
    const r = await auditAndSave(b, "scheduled", deps);
    return { status: r.audited ? "done" : "skipped", result: r };
  }
  if (job.kind === "gsc_sync") {
    const r = await syncSearchConsole(b, deps);
    return { status: r.synced ? "done" : "skipped", result: r };
  }
  if (!handler) throw new Error(`engine ${b.site_type} not registered yet`);
  const ai = deps.backgroundAi();
  if (job.kind === "initial") {
    const audit = await auditAndSave(b, "auto", deps);
    const ideas = await seedIdeas(b, deps);
    const proposals = await handler.proposals({
      tenantId: b.id,
      scope: "initial",
      entityType: null,
      ai,
    });
    await deps.rpc("seo_mark_initial_done", { _tenant: b.id });
    return { status: "done", result: { audit, ideas, proposals } };
  }
  // entity: the new items of one type
  const proposals = await handler.proposals({
    tenantId: b.id,
    scope: "entity",
    entityType: job.entity_type,
    ai,
  });
  return { status: "done", result: { proposals } };
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

export async function runJob(job: SeoJob, deps: WorkerDeps = defaultDeps): Promise<void> {
  try {
    const out = await handleJob(job, deps);
    await deps.rpc("seo_job_finish", {
      _id: job.id,
      _status: out.status,
      _result: out.result,
      _error: null,
    });
  } catch (e) {
    // back to the queue (30 minutes later) — the database caps the attempts at 3
    console.error("[seo] job failed", job.id, job.kind, errorText(e));
    await deps
      .rpc("seo_job_finish", {
        _id: job.id,
        _status: job.attempts >= 3 ? "failed" : "queued",
        _result: null,
        _error: errorText(e),
      })
      .catch(() => undefined);
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
let busy = false;
let lastPeriodic = 0;

export async function tick(deps: WorkerDeps = defaultDeps): Promise<number> {
  if (busy) return 0;
  busy = true;
  try {
    const now = (deps.now ?? Date.now)();
    if (now - lastPeriodic > PERIODIC_MS) {
      lastPeriodic = now;
      await deps
        .rpc("seo_jobs_enqueue_periodic", {})
        .catch((e: unknown) => console.error("[seo] periodic", errorText(e)));
    }
    const jobs = (await deps.rpc<SeoJob[]>("seo_jobs_claim", { _limit: JOBS_PER_TICK })) ?? [];
    for (const job of jobs) await runJob(job, deps);
    return jobs.length;
  } catch (e) {
    // before migration 203 / the database not answering — the site works as before, the next tick retries
    console.error("[seo] tick", errorText(e));
    return 0;
  } finally {
    busy = false;
  }
}

export function startSeoWorker(): void {
  if (timer || process.env["NODE_ENV"] === "test" || process.env["SEO_WORKER"] === "off") return;
  const first = setTimeout(() => void tick(), 90 * 1000);
  first.unref?.();
  timer = setInterval(() => void tick(), TICK_MS);
  timer.unref?.();
  console.log(
    `[seo] worker started: every 2 minutes (background AI ${process.env["SEO_BACKGROUND_AI"] === "on" ? "on" : "off"})`,
  );
}
