/**
 * Online payments, platform scope — the background jobs (server only; arch §7).
 *
 * startPlatformPaymentJobs() (called once from src/server.ts): its own timer every 5 minutes, unref'd; the first
 * tick only after 5 minutes (no DB or network call at boot). No timer with NODE_ENV=test or PAYMENTS_JOBS=off
 * (the operational switch; E2E sets it off and triggers the steps itself — DB calls and a replayed return).
 * runPlatformPaymentJobs(): (1) re-VERIFY the returns that were recorded but not verified
 * (platform_attempts_pending_verify → reverifyPlatformReturn) — only when payments are READY (X-19);
 * (2) platform_attempts_expire() (expiry + parking sweep), (3) platform_payment_returns_purge(), (4) the review
 * alert claim (X-17: the only path that rings for a review). (2)–(4) are DB-only and run even when payments are
 * not ready. Nothing at all with PAYMENTS_JOBS=off.
 * One run at a time (`running`, the only mutable state allowed in scope code: U17-B8). Imports no TanStack code.
 */
import type { PaymentMode } from "@/platform/payments/provider";
import { paymentsReady, type PaymentsEnv } from "@/platform/payments/server/env";
import { claimPlatformReviewAlerts } from "./alerts";
import { asRows, int, platformCall, platformPaymentsRpc, text, uuid, type PlatformRpc } from "./db";
import { platformLog, type PlatformLogger } from "./log";
import { reverifyPlatformReturn, type SettleResult } from "./return";

const FIVE_MINUTES = 5 * 60_000;
const PENDING_BATCH = 20;
const REFERENCE = /^[0-9a-f]{32}$/;
const SHA256 = /^[0-9a-f]{64}$/;

type Ready = { ok: true; env: PaymentsEnv } | { ok: false; reason: string };
type Reverify = (item: {
  attemptId: string;
  reference: string;
  sha: string;
  mode: PaymentMode;
}) => Promise<{ result: SettleResult | "gone" | "off" }>;

export interface PlatformJobDeps {
  jobsOn(): boolean;
  ready(): Ready;
  rpc: PlatformRpc;
  reverify: Reverify;
  /** X-17: claim the not-yet-alerted reviews and ring once for each → rows claimed */
  claimAlerts(): Promise<number>;
  log: PlatformLogger;
}

/** PAYMENTS_JOBS ∈ { on (default), off } — any other value counts as on (contract §2) */
const jobsOn = () => process.env["PAYMENTS_JOBS"]?.trim().toLowerCase() !== "off";

export const defaultJobDeps: PlatformJobDeps = {
  jobsOn,
  ready: () => paymentsReady("platform"),
  rpc: platformPaymentsRpc,
  reverify: (item) => reverifyPlatformReturn(item),
  claimAlerts: () => claimPlatformReviewAlerts(),
  log: platformLog,
};

export type PlatformJobsSummary = {
  pending: number;
  paid: number;
  review: number;
  expired: number;
  purged: number;
  alerted: number;
};

const isMode = (value: unknown): value is PaymentMode => value === "test" || value === "live";

async function reverifyPending(deps: PlatformJobDeps, summary: PlatformJobsSummary): Promise<void> {
  const pending = await platformCall(deps.rpc, "platform_attempts_pending_verify", {
    _limit: PENDING_BATCH,
  });
  if (pending.error) deps.log.error("jobs_pending", { sqlstate: pending.error.code ?? "none" });
  for (const row of asRows(pending.data)) {
    const attemptId = uuid(row, "attempt_id");
    const reference = text(row, "reference");
    const sha = text(row, "payload_sha256");
    const mode = text(row, "mode");
    if (!attemptId || !reference || !REFERENCE.test(reference) || !sha || !SHA256.test(sha))
      continue;
    if (!isMode(mode)) continue;
    summary.pending += 1;
    try {
      const done = await deps.reverify({ attemptId, reference, sha, mode });
      if (done.result === "paid") summary.paid += 1;
      if (done.result === "review") summary.review += 1;
    } catch {
      deps.log.error("jobs_reverify", {});
    }
  }
}

export async function runPlatformPaymentJobs(
  deps: PlatformJobDeps = defaultJobDeps,
): Promise<PlatformJobsSummary> {
  const summary: PlatformJobsSummary = {
    pending: 0,
    paid: 0,
    review: 0,
    expired: 0,
    purged: 0,
    alerted: 0,
  };
  if (!deps.jobsOn()) return summary;
  // X-19: not ready → no VERIFY, but the DB-only steps still run (sweep, purge, alert claim)
  const ready = deps.ready();
  if (ready.ok) await reverifyPending(deps, summary);
  else deps.log.warn("jobs_verify_skipped", { reason: ready.reason });

  const expired = await platformCall(deps.rpc, "platform_attempts_expire", {});
  if (expired.error) deps.log.error("jobs_expire", { sqlstate: expired.error.code ?? "none" });
  else
    summary.expired =
      typeof expired.data === "number" ? expired.data : (int({ n: expired.data }, "n") ?? 0);

  const purged = await platformCall(deps.rpc, "platform_payment_returns_purge", {});
  if (purged.error) deps.log.error("jobs_purge", { sqlstate: purged.error.code ?? "none" });
  else
    summary.purged =
      typeof purged.data === "number" ? purged.data : (int({ n: purged.data }, "n") ?? 0);

  try {
    summary.alerted = await deps.claimAlerts();
  } catch {
    deps.log.alert("review_claim_failed", {});
  }

  if (summary.pending + summary.expired + summary.purged + summary.alerted > 0)
    deps.log.info("jobs", summary);
  return summary;
}

let started = false;
let running = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await runPlatformPaymentJobs();
  } catch {
    platformLog.error("jobs_tick", {});
  } finally {
    running = false;
  }
}

export function startPlatformPaymentJobs(): void {
  if (started) return;
  started = true;
  if (process.env["NODE_ENV"] === "test" || !jobsOn()) return;
  const timer = setInterval(() => void tick(), FIVE_MINUTES);
  timer.unref?.();
}
