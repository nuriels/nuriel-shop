/**
 * Online payments, platform scope — the store owner pays NURIEL one open charge (plan §4.2; arch §4.3).
 *
 * The only platform-side file that reads the host's store (currentSite(), U17-B5): the payer is the store whose
 * admin panel sent the request — never an input, and nothing on the platform host (currentSite() is null there).
 * The actor is the verified session. The DB decides the rest: the protected, unblocked owner and never a platform
 * admin (DM-PLAT-1); an open billing.ledger charge, its amount and the balance, one live attempt per charge
 * (DM-PLAT-2); the ₪50 test cap; the flag and NURIEL's terminal. A locked store can still pay (DM-PLAT-5: a server
 * function passes storeGate, and nothing here asks for an open store). Then SIGN on NURIEL's terminal: the browser
 * gets the signed payment-page URL, nothing else.
 *
 * Also the owner's two read views ("המנוי שלי"): what can be paid online now, and the card payments so far — both
 * with the owner's own token and store header (ownerRpc; the DB's auth functions check the owner).
 */
import type {
  MyCardPayment,
  PayCharge,
  PayOptions,
  PayStartResult,
} from "@/platform/billing/pay.functions";
import {
  buildSignParams,
  encodeParams,
  validateSignResponse,
} from "@/platform/payments/max/protocol";
import {
  hypEndpoint,
  modeAllowed,
  paymentsEnv,
  paymentsReady,
  terminalAllowed,
  type PaymentsEnv,
} from "@/platform/payments/server/env";
import { hypRequest } from "@/platform/payments/server/http";
import { allowAction, requestIp } from "@/platform/security/rate-limit.server";
import { currentSite, currentSiteHosts } from "@/platform/tenancy/current-site.server";
import { alertPlatformAdmins } from "./alerts";
import { platformAttemptCredentials, type AttemptSecrets } from "./credentials";
import {
  PlatformPaymentError,
  asRow,
  asRows,
  dbFailure,
  flag,
  int,
  platformCall,
  platformPaymentsRpc,
  text,
  uuid,
  type PlatformRpc,
} from "./db";
import { platformLog, shortId, type PlatformLogger } from "./log";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REFERENCE = /^[0-9a-f]{32}$/;
const MINUTES_15 = 15 * 60_000;
const HYP_OPTIONS = { method: "GET", timeoutMs: 15_000, maxBytes: 64 * 1024 } as const;

type Ready = { ok: true; env: PaymentsEnv } | { ok: false; reason: string };

export interface PayDeps {
  ready(): Ready;
  /** the environment marker alone (the DEMO notice), whether or not the root key is ready */
  paymentsEnv(): PaymentsEnv | null;
  endpoint(): string;
  session(): Promise<{ userId: string } | null>;
  site(): Promise<{ id: string } | null>;
  storeOrigin(): Promise<string | null>;
  allow(key: string, limit: number, windowMs: number): boolean;
  ip(): Promise<string>;
  rpc: PlatformRpc;
  credentials(attemptId: string, purpose: "sign", env: PaymentsEnv): Promise<AttemptSecrets>;
  http: typeof hypRequest;
  alert(reason: string, attemptId: string | null): Promise<unknown>;
  ownerRpc<T>(fn: "platform_card_my_options" | "platform_card_my_payments"): Promise<T>;
  log: PlatformLogger;
}

// ------------------------------------------------------------------------------------------ return origin

type SiteHosts = {
  slugHost: string | null;
  canonicalOrigin: string | null;
  customDomain: string | null;
} | null;

const HOST = /^([a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?)(?::([0-9]{1,5}))?$/;
const isLocal = (hostname: string) => hostname === "localhost" || hostname.endsWith(".localhost");
const originOf = (hostname: string, port: string | undefined) =>
  isLocal(hostname) ? `http://${hostname}${port ? `:${port}` : ""}` : `https://${hostname}`;

/**
 * The store address the owner started from (arch §4.3, C8): the request's host when it is one of THIS store's
 * hosts (its platform subdomain, its custom domain, its canonical host), else the store's subdomain; https, or
 * http with the port only on a local *.localhost stack. Never a request parameter; the DB validates it again.
 */
export function storeOriginOf(headers: Headers, url: string, hosts: SiteHosts): string | null {
  if (!hosts) return null;
  let urlHost = "";
  try {
    urlHost = new URL(url).host;
  } catch {
    urlHost = "";
  }
  const raw = (headers.get("x-forwarded-host") ?? headers.get("host") ?? urlHost)
    .split(",")[0]!
    .trim()
    .toLowerCase();
  const match = HOST.exec(raw);
  const allowed = new Set<string>();
  const add = (value: string | null) => {
    const host = value
      ?.trim()
      .toLowerCase()
      .replace(/:[0-9]+$/, "");
    if (host && HOST.test(host)) allowed.add(host);
  };
  add(hosts.slugHost);
  add(hosts.customDomain);
  if (hosts.canonicalOrigin) {
    try {
      add(new URL(hosts.canonicalOrigin).hostname);
    } catch {
      // no canonical host
    }
  }
  if (match && allowed.has(match[1]!)) return originOf(match[1]!, match[2]);
  const slug =
    hosts.slugHost
      ?.trim()
      .toLowerCase()
      .replace(/:[0-9]+$/, "") ?? "";
  if (!HOST.test(slug)) return null;
  // the subdomain; on a local stack the request's port is the app's port
  return originOf(slug, match && isLocal(match[1]!) ? match[2] : undefined);
}

/** the request and the session come from TanStack Start: loaded on use (never at module load, never in a job) */
async function requestStoreOrigin(): Promise<string | null> {
  const { getRequest } = await import("@tanstack/react-start/server");
  const request = getRequest();
  if (!request) return null;
  return storeOriginOf(request.headers, request.url, await currentSiteHosts());
}

// ------------------------------------------------------------------------------------------ defaults

export const defaultPayDeps: PayDeps = {
  ready: () => paymentsReady("platform"),
  paymentsEnv,
  endpoint: hypEndpoint,
  session: async () => {
    try {
      const { sessionFromRequest } = await import("@/platform/auth/session.server");
      const session = await sessionFromRequest();
      return session ? { userId: session.userId } : null;
    } catch {
      return null; // an invalid token is no session (never anonymous)
    }
  },
  site: async () => {
    const site = await currentSite();
    return site ? { id: site.id } : null;
  },
  storeOrigin: requestStoreOrigin,
  allow: allowAction,
  ip: requestIp,
  rpc: platformPaymentsRpc,
  credentials: (attemptId, purpose, env) => platformAttemptCredentials(attemptId, purpose, env),
  http: hypRequest,
  alert: alertPlatformAdmins,
  ownerRpc: async (fn) => (await import("@/platform/billing/billing.server")).ownerRpc(fn),
  log: platformLog,
};

// ------------------------------------------------------------------------------------------ start

/** SIGN failures that mean NURIEL's terminal credentials were refused (the DB switches the terminal off) */
const CREDENTIAL_CODES: readonly string[] = ["901", "902"];

export async function startPlatformPayment(
  input: { chargeId: string },
  deps: PayDeps = defaultPayDeps,
): Promise<PayStartResult> {
  const chargeId = typeof input?.chargeId === "string" ? input.chargeId.toLowerCase() : "";
  if (!UUID.test(chargeId)) throw new PlatformPaymentError("invalid");
  const ready = deps.ready();
  if (!ready.ok) {
    deps.log.warn("start_off", { reason: ready.reason });
    throw new PlatformPaymentError("unavailable");
  }
  const env = ready.env;
  const session = await deps.session();
  if (!session) throw new PlatformPaymentError("login");
  const ip = await deps.ip();
  if (
    !deps.allow(`pay-start:p:user:${session.userId}`, 10, MINUTES_15) ||
    !deps.allow(`pay-start:p:ip:${ip}`, 20, MINUTES_15)
  )
    throw new PlatformPaymentError("rate_limited");
  const site = await deps.site();
  if (!site) throw new PlatformPaymentError("store_only");
  const origin = await deps.storeOrigin();

  const opened = await platformCall(deps.rpc, "platform_attempt_open", {
    _actor: session.userId,
    _tenant: site.id,
    _target_kind: "ledger_charge",
    _target_id: chargeId,
    _return_origin: origin,
    _app_environment: env,
  });
  if (opened.error) {
    if (/environments differ/i.test(opened.error.message))
      await deps.alert("environment_mismatch", null);
    throw dbFailure(opened.error, "platform_attempt_open", deps.log);
  }
  const row = asRow(opened.data);
  const attemptId = uuid(row, "attempt_id");
  const reference = text(row, "reference");
  const amountMinor = int(row, "amount_minor");
  const terminal = text(row, "terminal_number");
  if (!attemptId || !reference || !REFERENCE.test(reference) || !amountMinor || amountMinor <= 0) {
    deps.log.error("start_open_answer", {});
    throw new PlatformPaymentError("generic");
  }

  const signed = async (ok: boolean, code: string | null) => {
    const answer = await platformCall(deps.rpc, "platform_attempt_signed", {
      _attempt: attemptId,
      _ok: ok,
      _code: code,
    });
    if (answer.error) deps.log.error("signed_record", { attempt: shortId(attemptId) });
  };

  const secrets = await deps.credentials(attemptId, "sign", env);
  if (secrets.result !== "ok") throw new PlatformPaymentError("generic");
  const { creds, mode } = secrets;
  // tripwires (never proof): the attempt's own terminal, the environment's prefix and mode (DM-ENV-3)
  if (creds.masof !== terminal || !terminalAllowed(env, creds.masof) || !modeAllowed(env, mode)) {
    await signed(false, null);
    deps.log.alert("terminal_not_allowed", { attempt: shortId(attemptId) });
    throw new PlatformPaymentError("unavailable");
  }

  const endpoint = deps.endpoint();
  const pairs = buildSignParams(creds, { amountMinor, order: reference, moreData: true });
  const http = await deps.http(endpoint, encodeParams(pairs), HYP_OPTIONS);
  const sign = http.ok
    ? validateSignResponse(
        http.body,
        { masof: creds.masof, amountMinor, order: reference, moreData: true },
        endpoint,
      )
    : ({ ok: false, code: http.error } as const);
  const ccode = !sign.ok && "ccode" in sign ? (sign.ccode ?? null) : null;
  await signed(sign.ok, ccode !== null && /^[0-9]{1,4}$/.test(ccode) ? ccode : null);
  deps.log.info("sign", {
    attempt: shortId(attemptId),
    ok: sign.ok,
    code: sign.ok ? null : sign.code,
    ccode,
    reused: flag(row, "reused"),
  });
  if (!sign.ok) {
    if (ccode !== null && CREDENTIAL_CODES.includes(ccode))
      await deps.alert("credentials", attemptId);
    throw new PlatformPaymentError("sign_failed");
  }
  return { url: sign.payUrl, demo: env === "demo" };
}

// ------------------------------------------------------------------------------------------ owner views

export async function platformPayOptions(deps: PayDeps = defaultPayDeps): Promise<PayOptions> {
  const ready = deps.ready();
  const row = asRow(await deps.ownerRpc<unknown>("platform_card_my_options"));
  const available = ready.ok && flag(row, "available");
  const charges: PayCharge[] = asRows(row?.["charges"]).flatMap((c) => {
    const id = uuid(c, "id");
    const amountMinor = int(c, "amount_minor");
    if (!id || amountMinor === null) return [];
    return [
      {
        id,
        no: int(c, "no"),
        amountMinor,
        description: text(c, "description"),
        occurredOn: text(c, "occurred_on"),
        payable: available && flag(c, "payable"),
        paidOnline: flag(c, "paid_online"),
      },
    ];
  });
  return {
    available,
    test: flag(row, "test"),
    demo: deps.paymentsEnv() === "demo",
    testCapMinor: int(row, "test_amount_cap_minor"),
    charges,
  };
}

const PAYMENT_STATES: readonly string[] = [
  "in_progress",
  "paid",
  "test_paid",
  "needs_review",
  "failed",
  "expired",
  "cancelled",
];

export async function myPlatformPayments(deps: PayDeps = defaultPayDeps): Promise<MyCardPayment[]> {
  const rows = asRows(await deps.ownerRpc<unknown>("platform_card_my_payments"));
  return rows.flatMap((p) => {
    const id = uuid(p, "id");
    const state = text(p, "state");
    const amountMinor = int(p, "amount_minor");
    if (!id || !state || !PAYMENT_STATES.includes(state) || amountMinor === null) return [];
    return [
      {
        id,
        targetId: uuid(p, "target_id"),
        targetLabel: text(p, "target_label"),
        amountMinor,
        state: state as MyCardPayment["state"],
        test: flag(p, "test"),
        cardBrand: text(p, "card_brand"),
        cardLast4: /^[0-9]{4}$/.test(text(p, "card_last4") ?? "") ? text(p, "card_last4") : null,
        approvalCode: text(p, "approval_code"),
        createdAt: text(p, "created_at"),
        paidAt: text(p, "paid_at"),
      },
    ];
  });
}
