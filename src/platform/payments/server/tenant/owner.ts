/**
 * Online payments, tenant scope — a store terminal's status (max_account_status) for the store owner's card and the
 * platform admin's MAX tab. Never a secret: has_* flags and the last 2 digits of the terminal only. The DB
 * authorizes the actor (the store's owner or a platform admin). DEMO: the owner changes nothing (one payment only).
 */
import { paymentsRpc } from "@/platform/payments/server/db";
import { testPaymentsEnv } from "@/platform/payments/server/env";
import {
  SECRET_MASK,
  type StorePilotStatus,
  type StoreTerminalView,
} from "@/platform/payments/tenant-views";
import { asRecord, bool, modeOf, str, unwrap } from "./db";

const ENVIRONMENTS = ["demo", "pilot", "production"] as const;
const STATUSES = ["unverified", "verified", "failed"] as const;

export function storeTerminalViewOf(data: unknown): StoreTerminalView {
  const r = asRecord(data);
  const environment = str(r?.["environment"]);
  const status = str(r?.["status"]);
  const hint = (str(r?.["terminal_hint"]) ?? "").replace(/[^0-9]/g, "").slice(-2);
  return {
    demo: testPaymentsEnv(),
    configured: bool(r?.["configured"]),
    active: bool(r?.["active"]),
    environment: ENVIRONMENTS.find((e) => e === environment) ?? null,
    enabled: bool(r?.["enabled"]),
    mode: modeOf(r?.["mode"]),
    status: STATUSES.find((s) => s === status) ?? null,
    lastVerifiedAt: str(r?.["last_verified_at"]),
    terminalHint: hint.length === 2 ? hint : null,
    hasApiKey: bool(r?.["has_api_key"]),
    hasApiPassword: bool(r?.["has_api_password"]),
    // P-6a (4): set / not set and a constant mask only; the DB's tokens are never read into a view
    apiKeyMask: bool(r?.["has_api_key"]) ? SECRET_MASK : null,
    apiPasswordMask: bool(r?.["has_api_password"]) ? SECRET_MASK : null,
    credentialsUpdatedAt: str(r?.["credentials_updated_at"]),
  };
}

export async function storeTerminalStatus(
  actorId: string,
  tenantId: string,
): Promise<StoreTerminalView> {
  return storeTerminalViewOf(
    unwrap(
      "max_account_status",
      await paymentsRpc("max_account_status", { _actor: actorId, _tenant: tenantId }),
    ),
  );
}

/**
 * P-6 / P-8: the store owner's view in the pilot — on or "coming soon", nothing else. A store outside the pilot list,
 * an unmarked DB or any refusal reads "not active" (the DB is the judge; nothing about the terminal leaves here).
 */
export async function storePilotStatus(
  actorId: string,
  tenantId: string,
): Promise<StorePilotStatus> {
  let active = false;
  try {
    const view = await storeTerminalStatus(actorId, tenantId);
    active = view.configured && view.active;
  } catch {
    active = false;
  }
  return { kind: "pilot", active, demo: active };
}
