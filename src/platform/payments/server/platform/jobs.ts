/**
 * Online payments, platform scope — the background jobs (server only; arch §7).
 *
 * startPlatformPaymentJobs() (called once from src/server.ts): its own timer every 5 minutes, unref'd; the first
 * tick only after 5 minutes (no DB or network call at boot). No timer with NODE_ENV=test or PAYMENTS_JOBS=off
 * (the operational switch; E2E sets it off and triggers the steps itself — DB calls and a replayed return).
 * runPlatformPaymentJobs(): (1) re-VERIFY the returns that were recorded but not verified
 * (platform_attempts_pending_verify → reverifyPlatformReturn; review items alert the platform team there),
 * (2) platform_attempts_expire(), (3) platform_payment_returns_purge(). Nothing when payments are off.
 * One run at a time (`running`, the only mutable state allowed in scope code: U17-B8). Imports no TanStack code.
 */
import type { PaymentMode } from "@/platform/payments/provider";
import { paymentsReady, type PaymentsEnv } from "@/platform/payments/server/env";
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
  log: PlatformLogger;
}

/** PAYMENTS_JOBS ∈ { on (default), off } — any other value counts as on (contract §2) */
const jobsOn = () => process.env["PAYMENTS_JOBS"]?.trim().toLowerCase() !== "off";

export const defaultJobDeps: PlatformJobDeps = {
  jobsOn,
  ready: () => paymentsReady("platform"),
  rpc: platformPaymentsRpc,
  reverify: (item) => reverifyPlatformReturn(item),
  log: platformLog,
};

export type PlatformJobsSummary = {
  pending: number;
  paid: number;
  review: number;
  expired: number;
  purged: number;
};

const isMode = (value: unknown): value is PaymentMode => value === "test" || value === "live";

export async function runPlatformPaymentJobs(
  deps: PlatformJobDeps = defaultJobDeps,
): Promise<PlatformJobsSummary> {
  const summary: PlatformJobsSummary = { pending: 0, paid: 0, review: 0, expired: 0, purged: 0 };
  if (!deps.jobsOn() || !deps.ready().ok) return summary;

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

  if (summary.pending + summary.expired + summary.purged > 0) deps.log.info("jobs", summary);
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
