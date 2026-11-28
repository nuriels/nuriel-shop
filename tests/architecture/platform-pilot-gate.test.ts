// P-5 (contract §7.2) — in the production pilot NURIEL's own terminal is off at every platform entry point, and ONE
// helper decides it: platformPilotOff() in src/platform/payments/server/platform/pilot.ts.
//
// Pinned here (each rule runs on the real files and on a small synthetic source, where it must bite):
//  G1  every server function of src/platform/billing/pay*.functions.ts runs through `guarded(`, and `guarded` asks
//      platformPilotOff() before it runs anything (before any DB or Hyp call);
//  G2  every exported async function (an entry point) of the platform orchestrators pay.ts, terminal.ts, return.ts
//      and jobs.ts asks platformPilotOff( in its FIRST statement;
//  G3  the platform return route asks platformPilotOff() before its host check;
//  G4  nobody else decides: the "pilot" literal appears in no platform payment file but pilot.ts.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const SERVER_FN_FILES = [
  "src/platform/billing/pay.functions.ts",
  "src/platform/billing/pay-terminal.functions.ts",
];
const ORCHESTRATORS = [
  "src/platform/payments/server/platform/pay.ts",
  "src/platform/payments/server/platform/terminal.ts",
  "src/platform/payments/server/platform/return.ts",
  "src/platform/payments/server/platform/jobs.ts",
];
const RETURN_ROUTE = "src/routes/platform_.payments_.return.$provider.ts";
const PLATFORM_DIR = "src/platform/payments/server/platform";

/** G1: the server functions that do not run through `guarded(`, or "guarded" when it does not gate first */
export function ungatedServerFunctions(source: string): string[] {
  const problems: string[] = [];
  const parts = source.split(/(?=export const \w+ = createServerFn\()/);
  for (const part of parts.slice(1)) {
    const name = /export const (\w+)/.exec(part)?.[1] ?? "?";
    const body = part.split(/\nexport /)[0] ?? "";
    if (!/\bguarded\(/.test(body)) problems.push(name);
  }
  const guardedAt = source.indexOf("async function guarded<");
  if (guardedAt < 0) problems.push("guarded");
  else {
    const body = source.slice(guardedAt, source.indexOf("\n}\n", guardedAt));
    const gate = body.indexOf("platformPilotOff()");
    const run = body.indexOf("run()");
    if (gate < 0 || run < 0 || gate > run) problems.push("guarded");
  }
  return problems;
}

/** G2: exported async functions whose first statement does not ask platformPilotOff( */
export function ungatedEntryPoints(source: string): string[] {
  const problems: string[] = [];
  const at = /export async function (\w+)\(/g;
  let match: RegExpExecArray | null;
  while ((match = at.exec(source)) !== null) {
    const name = match[1] ?? "?";
    const signatureEnd = source.indexOf("): Promise<", match.index);
    const bodyStart = signatureEnd < 0 ? -1 : source.indexOf("{\n", signatureEnd);
    if (bodyStart < 0) {
      problems.push(name);
      continue;
    }
    const first = source
      .slice(bodyStart + 2)
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line !== "" && !line.startsWith("//"));
    if (!first || !first.includes("platformPilotOff(")) problems.push(name);
  }
  return problems;
}

/** G3: the route's GET asks the gate before its host check */
export function routeGatedFirst(source: string): boolean {
  const gate = source.indexOf("platformPilotOff()");
  const host = source.indexOf("isPlatformHost()");
  return gate >= 0 && host >= 0 && gate < host;
}

const stripComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("P-5: the platform scope is off in the pilot at every entry point, through one helper", () => {
  it("G1: every platform payment server function runs through guarded(), which asks platformPilotOff() first", () => {
    for (const file of SERVER_FN_FILES) {
      const source = read(file);
      expect(source.match(/createServerFn\(/g)?.length ?? 0, file).toBeGreaterThan(0);
      expect(ungatedServerFunctions(source), file).toEqual([]);
    }
    // bites: a server function that skips guarded(), and a guarded() that gates after running
    expect(
      ungatedServerFunctions(`async function guarded<T>(run: () => Promise<T>) {
  if (platformPilotOff()) throw x;
  return run();
}
export const a = createServerFn({ method: "POST" }).handler(async () => guarded(async () => 1));
export const b = createServerFn({ method: "POST" }).handler(async () => (await x()).y());
`),
    ).toEqual(["b"]);
    expect(
      ungatedServerFunctions(`async function guarded<T>(run: () => Promise<T>) {
  const v = await run();
  if (platformPilotOff()) throw x;
  return v;
}
export const a = createServerFn({ method: "POST" }).handler(async () => guarded(async () => 1));
`),
    ).toEqual(["guarded"]);
  });

  it("G2: every exported async function of the platform orchestrators asks platformPilotOff( first", () => {
    const names: string[] = [];
    for (const file of ORCHESTRATORS) {
      const source = read(file);
      names.push(...[...source.matchAll(/export async function (\w+)\(/g)].map((m) => m[1] ?? ""));
      expect(ungatedEntryPoints(source), file).toEqual([]);
    }
    // the entry points this pins today (a new one is covered by the rule above automatically)
    expect(names).toEqual(
      expect.arrayContaining([
        "startPlatformPayment",
        "platformPayOptions",
        "myPlatformPayments",
        "platformTerminalStatus",
        "requestTerminalSaveCode",
        "savePlatformTerminal",
        "testPlatformTerminal",
        "platformCardPaymentsList",
        "platformUnreturnedList",
        "resolvePlatformCardPayment",
        "handlePlatformReturn",
        "reverifyPlatformReturn",
        "runPlatformPaymentJobs",
      ]),
    );
    // bites: the gate not in the first statement
    expect(
      ungatedEntryPoints(`export async function ok(deps: D): Promise<void> {
  // a comment
  if (platformPilotOff(deps.paymentsEnv)) throw x;
}
export async function late(deps: D): Promise<void> {
  const row = await deps.rpc("x");
  if (platformPilotOff(deps.paymentsEnv)) throw x;
}
`),
    ).toEqual(["late"]);
  });

  it("G3: the platform return route asks the gate before anything else", () => {
    expect(routeGatedFirst(read(RETURN_ROUTE))).toBe(true);
    expect(routeGatedFirst("if (!(await isPlatformHost())) x; if (platformPilotOff()) y;")).toBe(
      false,
    );
  });

  it('G4: only pilot.ts decides — no other platform payment file names "pilot"', () => {
    const files = [
      ...readdirSync(join(ROOT, PLATFORM_DIR)).map((f) => `${PLATFORM_DIR}/${f}`),
      ...SERVER_FN_FILES,
      RETURN_ROUTE,
    ].filter((f) => /\.tsx?$/.test(f) && !f.endsWith("/pilot.ts"));
    for (const file of files)
      expect(/["'`]pilot["'`]/.test(stripComments(read(file))), file).toBe(false);
    expect(read(`${PLATFORM_DIR}/pilot.ts`)).toContain('PILOT_ENV = "pilot"');
  });
});
