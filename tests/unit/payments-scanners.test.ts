// MAX/Hyp DEMO — the leak scanners (plan §6.2; Appendix D DM-SEC-1…6, the tooling).
// Each scanner must find a planted canary (positive control) and pass a clean input, and it must never print
// a matched value. All planted values are generated here at run time (no secret, card or terminal literal).
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { makeZip, withLuhnDigit } from "../../scripts/security/scan-core.mjs";

const ROOT = process.cwd();
const SECRETS = join(ROOT, "scripts/security/scan-secrets.mjs");
const DB = join(ROOT, "scripts/security/scan-db.mjs");
const BASE = mkdtempSync(join(tmpdir(), "payments-scanners-"));
afterAll(() => rmSync(BASE, { recursive: true, force: true }));

const hex = (n: number) => randomBytes(n).toString("hex");
/** a 19-digit Mastercard-2-series number (Mastercard issues 16 there): card-like, never a real card */
const fakeCard = () => withLuhnDigit(`2720${"0".repeat(14)}`) as string;
const digits = (n: number) => Array.from(randomBytes(n), (b) => String(b % 10)).join("");

let n = 0;
function workdir() {
  const dir = join(BASE, `case-${(n += 1)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}
function put(dir: string, rel: string, content: string | Buffer) {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), content);
}
function run(script: string, args: string[], cwd: string) {
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 60_000,
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
/** a canaries file as E2E writes it (one fake secret per line) */
function canaries(dir: string, ...values: string[]) {
  put(dir, "hyp-canaries.txt", `${values.join("\n")}\n`);
  return "hyp-canaries.txt";
}
const expectSilent = (out: string, values: string[]) => {
  for (const v of values) expect(out.includes(v), "a planted value was printed").toBe(false);
};

describe("scan-secrets.mjs", () => {
  it("DM-SEC-1: bundle — a canary and payment literals in the client build are found; a clean build passes", () => {
    const dir = workdir();
    const canary = `canary-${hex(12)}`;
    const file = canaries(dir, canary);
    put(
      dir,
      "dirty/assets/index-1.js",
      `var a=1;\nvar k="${canary}";\nf("PassP");g("What=VERIFY");h("PAYMENTS_SECRETS_KEY")\n`,
    );
    put(dir, "clean/assets/index-1.js", 'var KEY_NAME="x",passport=1;f("API_KEY=" + k)\n');
    const dirty = run(SECRETS, ["--mode", "bundle", "--canaries", file, "dirty"], dir);
    expect(dirty.code).toBe(1);
    expect(dirty.out).toContain("HIT dirty/assets/index-1.js:2 canary#1");
    expect(dirty.out).toContain("HIT dirty/assets/index-1.js:3 literal:PassP");
    expect(dirty.out).toContain("HIT dirty/assets/index-1.js:3 literal:What=VERIFY");
    expect(dirty.out).toContain("HIT dirty/assets/index-1.js:3 literal:PAYMENTS_SECRETS_KEY");
    expect(dirty.out).toContain("positive-control=ok");
    expectSilent(dirty.out, [canary]);
    const clean = run(SECRETS, ["--mode", "bundle", "--canaries", file, "clean"], dir);
    expect(clean.out).toContain("hits=0");
    expect(clean.code).toBe(0);
  });

  it("DM-SEC-2: logs — unmasked credentials, canaries, raw returns and card numbers are found; redacted logs pass", () => {
    const dir = workdir();
    const canary = `canary-${hex(12)}`;
    const key = `k${hex(8)}`;
    const pass = `p${hex(6)}`;
    const card = fakeCard();
    const file = canaries(dir, canary, key, pass);
    put(
      dir,
      "dirty/server.log",
      [
        "[server] up",
        `[pay] SIGN ok KEY=${key}&PassP=${pass}`,
        `{"level":"info","msg":"return","raw":"Id=7&CCode=0&Amount=10&Order=${hex(16)}"}`,
        `{"PassP":"${pass}"}`,
        `card ${card}`,
        `ref ${canary}`,
      ].join("\n"),
    );
    put(
      dir,
      "clean/server.log",
      [
        "[pay] SIGN ok KEY=***&PassP=[REDACTED]&zPass=&Masof=********01",
        `[pay] verify ccode=0 order=${hex(16)} at ${Date.now()}`,
        '{"PassP":"***","Sign":"***","cell":null}',
        "[pay] SIGN ok KEY=~~&PassP=~~",
      ].join("\n"),
    );
    const dirty = run(SECRETS, ["--mode", "logs", "--canaries", file, "dirty"], dir);
    expect(dirty.code).toBe(1);
    for (const hit of [
      "dirty/server.log:2 canary#2",
      "dirty/server.log:2 canary#3",
      "dirty/server.log:2 credential-param",
      "dirty/server.log:3 raw-return",
      "dirty/server.log:4 credential-json",
      "dirty/server.log:5 card-number",
      "dirty/server.log:6 canary#1",
    ]) {
      expect(dirty.out).toContain(`HIT ${hit}`);
    }
    expectSilent(dirty.out, [canary, key, pass, card]);
    // the redactor's own mask can be declared (--mask); the common masks are known already
    const clean = run(
      SECRETS,
      ["--mode", "logs", "--canaries", file, "--mask", "~~", "clean"],
      dir,
    );
    expect(clean.code).toBe(0);
    const undeclared = run(SECRETS, ["--mode", "logs", "--canaries", file, "clean"], dir);
    expect(undeclared.code).toBe(1);
    expect(undeclared.out).toContain("HIT clean/server.log:4 credential-param");
  });

  it("DM-SEC-4: a browser dump (storage, cookies, HTML, /_serverFn bodies) is scanned like an artifact", () => {
    const dir = workdir();
    const canary = `canary-${hex(12)}`;
    const file = canaries(dir, canary);
    const dump = {
      localStorage: { "sb-auth": "token-x", cart: "[]" },
      sessionStorage: { checkout: Buffer.from(`{"k":"${canary}"}`).toString("base64") },
      cookies: [{ name: "sid", value: "abc" }],
      serverFn: ['{"result":{"status":"redirect"}}'],
    };
    put(dir, "dirty/browser.json", JSON.stringify(dump, null, 1));
    put(dir, "clean/browser.json", JSON.stringify({ ...dump, sessionStorage: {} }, null, 1));
    const dirty = run(SECRETS, ["--mode", "artifacts", "--canaries", file, "dirty"], dir);
    expect(dirty.code).toBe(1);
    expect(dirty.out).toMatch(/HIT dirty\/browser\.json:\d+ canary#1/);
    expectSilent(dirty.out, [canary]);
    expect(run(SECRETS, ["--mode", "artifacts", "--canaries", file, "clean"], dir).code).toBe(0);
  });

  it("DM-SEC-5: artifacts — canaries inside zips, gzip and the report's data: URI are found; clean uploads pass", () => {
    const dir = workdir();
    const canary = `canary-${hex(12)}`;
    const file = canaries(dir, canary);
    const trace = makeZip([{ name: "trace.network", data: `POST /p/ body=${canary}` }]);
    put(dir, "dirty/test-results/a/trace.zip", trace);
    put(dir, "dirty/test-results/a/stdout.txt.gz", gzipSync(`log ${canary}\n`));
    const report = makeZip([
      { name: "data/report.json", data: JSON.stringify({ attachments: [canary] }) },
    ]);
    put(
      dir,
      "dirty/playwright-report/index.html",
      `<html><script>window.playwrightReportBase64 = "data:application/zip;base64,${report.toString("base64")}";</script></html>`,
    );
    put(
      dir,
      "clean/test-results/a/trace.zip",
      makeZip([{ name: "trace.network", data: "GET /x 200" }]),
    );
    put(dir, "clean/playwright-report/index.html", "<html>ok</html>");
    // the canaries file itself sits in test-results in CI: never reported, but named so it is removed before upload
    put(dir, "clean/test-results/hyp-canaries.txt", `${canary}\n`);
    const dirty = run(SECRETS, ["--mode", "artifacts", "--canaries", file, "dirty"], dir);
    expect(dirty.code).toBe(1);
    expect(dirty.out).toContain("HIT dirty/test-results/a/trace.zip!trace.network:1 canary#1");
    expect(dirty.out).toContain("HIT dirty/test-results/a/stdout.txt.gz!gunzip:1 canary#1");
    expect(dirty.out).toContain(
      "HIT dirty/playwright-report/index.html:1!data-uri#1!data/report.json:1 canary#1",
    );
    expectSilent(dirty.out, [canary]);
    const cleanCanaries = join("clean/test-results/hyp-canaries.txt");
    const clean = run(SECRETS, ["--mode", "artifacts", "--canaries", cleanCanaries, "clean"], dir);
    expect(clean.code).toBe(0);
    expect(clean.out).toContain(
      "note: skipped clean/test-results/hyp-canaries.txt (the canaries file itself",
    );
  });

  it("DM-SEC-6: repo — tracked terminal numbers, credentials, card numbers and secret files are found", () => {
    const dir = workdir();
    const git = (...a: string[]) => execFileSync("git", ["-C", dir, ...a], { stdio: "ignore" });
    git("init", "-q");
    const terminal = `00100${digits(5)}`;
    const pass = `p${hex(6)}`;
    const card = fakeCard();
    put(dir, "docs/notes.md", `ok\nterminal ${terminal}\nPassP=${pass}\ncard ${card}\n`);
    put(
      dir,
      "src/ok.ts",
      "const q = `KEY=${creds.key}&PassP=${creds.passp}`; // KEY=fake-key PassP=***\n",
    );
    put(dir, ".env.production", "X=1\n");
    put(dir, ".env.example", "X=\n");
    put(dir, "keys/dev.pem", "-\n");
    git("add", "-A");
    const dirty = run(SECRETS, ["--mode", "repo"], dir);
    expect(dirty.code).toBe(1);
    for (const hit of [
      "HIT .env.production secret-file",
      "HIT keys/dev.pem secret-file",
      "HIT docs/notes.md:2 terminal-number",
      "HIT docs/notes.md:3 credential-assignment",
      "HIT docs/notes.md:4 card-number",
    ]) {
      expect(dirty.out).toContain(hit);
    }
    expect(dirty.out).not.toContain("src/ok.ts");
    expect(dirty.out).toContain("note: not read (owner-only file): .env.example");
    expectSilent(dirty.out, [terminal, pass, card]);
    // declared fakes: the allow file, or the marker on the line
    put(
      dir,
      "scripts/security/declared-fakes.json",
      JSON.stringify({ terminals: [terminal], luhnPaths: ["docs/**"] }),
    );
    put(
      dir,
      "docs/notes.md",
      `ok\nterminal ${terminal}\nPassP=*** // scan-secrets:allow\ncard ${card}\n`,
    );
    rmSync(join(dir, ".env.production"));
    rmSync(join(dir, "keys/dev.pem"));
    git("add", "-A");
    const clean = run(SECRETS, ["--mode", "repo"], dir);
    expect(clean.out).toContain("hits=0");
    expect(clean.code).toBe(0);
  });

  it("DM-SEC-6: the repository itself has no hit (tracked files of this branch)", () => {
    const r = run(SECRETS, ["--mode", "repo"], ROOT);
    expect(r.out.split("\n").filter((l) => l.startsWith("HIT "))).toEqual([]);
    expect(r.code).toBe(0);
  });

  it("DM-SEC-1…6: the scanner's own self-test passes (positive controls for every mode)", () => {
    const r = run(SECRETS, ["--self-test"], workdir());
    expect(r.out).toContain("scan-secrets self-test: modes=bundle,logs,artifacts,repo ok");
    expect(r.code).toBe(0);
  });

  it("the scan itself failing is exit 2, never 'clean'", () => {
    const dir = workdir();
    put(dir, "short.txt", "abc\n");
    put(dir, "x.log", "x\n");
    expect(run(SECRETS, ["--mode", "logs", "missing.log"], dir).code).toBe(2);
    expect(run(SECRETS, ["--mode", "logs", "--canaries", "short.txt", "x.log"], dir).code).toBe(2);
    expect(run(SECRETS, ["--mode", "nope", "x.log"], dir).code).toBe(2);
    expect(run(SECRETS, ["--mode", "logs"], dir).code).toBe(2);
    expect(run(SECRETS, ["--mode", "logs", "--canaries", "missing.txt", "x.log"], dir).code).toBe(
      2,
    );
    put(dir, "empty/.keep-dir/.gitkeep", "");
    rmSync(join(dir, "empty/.keep-dir/.gitkeep"));
    expect(run(SECRETS, ["--mode", "logs", "empty"], dir).code).toBe(2);
  });
});

describe("scan-db.mjs", () => {
  /** a fake psql: answers the catalog query and the data query from a JSON fixture, logs what it received */
  const FAKE = `import { appendFileSync, readFileSync } from "node:fs";
const [fixtureFile, logFile] = process.argv.slice(2);
const fx = JSON.parse(readFileSync(fixtureFile, "utf8"));
let sql = "";
process.stdin.on("data", (d) => (sql += d));
process.stdin.on("end", () => {
  appendFileSync(logFile, sql);
  if (!sql.includes("BEGIN TRANSACTION READ ONLY;")) process.exit(3);
  const h = (s) => Buffer.from(String(s)).toString("hex");
  const u = (s) => Buffer.from(s, "hex").toString();
  if (sql.includes("-- scan-db:catalog")) {
    for (const c of fx.columns) console.log(["C", h(c[0]), h(c[1]), h(c[2]), c[3]].join("\\t"));
    return;
  }
  for (const m of sql.matchAll(/^-- scan-db:table (\\d+) ([0-9a-f]+) ([0-9a-f]+) ([0-9a-f,]+)$/gm)) {
    const cols = m[4].split(",").map(u);
    for (const row of fx.rows[u(m[2]) + "." + u(m[3])] ?? []) {
      console.log(["R", m[1], ...cols.map((c) => (row[c] == null ? "-" : h(row[c])))].join("\\t"));
    }
  }
});
`;

  function db(dir: string, rows: Record<string, Record<string, string | null>[]>) {
    put(dir, "fake-psql.mjs", FAKE);
    put(
      dir,
      "fixture.json",
      JSON.stringify({
        columns: [
          ["payments", "tenant_accounts", "terminal_number", "text"],
          ["payments", "tenant_accounts", "api_password_enc", "text"],
          ["payments", "tenant_events", "detail", "jsonb"],
          ["public", "orders", "notes", "text"],
          ["billing", "ledger", "description", "text"],
        ],
        rows,
      }),
    );
    return `"${process.execPath}" "${join(dir, "fake-psql.mjs")}" "${join(dir, "fixture.json")}" "${join(dir, "sql.log")}"`;
  }
  const token = () =>
    `v1:${hex(4)}:${randomBytes(12).toString("base64url")}:${randomBytes(16).toString("base64url")}:${randomBytes(20).toString("base64url")}`;

  it("DM-SEC-3: finds canaries and secret / card patterns, prints table.column + count only", () => {
    const dir = workdir();
    const canary = `canary-${hex(12)}`;
    const terminal = `00100${digits(5)}`;
    const card = fakeCard();
    const file = canaries(dir, canary, terminal);
    const psql = db(dir, {
      "payments.tenant_accounts": [
        { terminal_number: terminal, api_password_enc: token() },
        { terminal_number: terminal, api_password_enc: `plain-${hex(4)}` },
      ],
      "payments.tenant_events": [
        { detail: JSON.stringify({ note: canary }) },
        { detail: JSON.stringify({ Tyear: "30" }) },
      ],
      "public.orders": [{ notes: `call about ${terminal}` }, { notes: card }, { notes: null }],
      "billing.ledger": [{ description: "Id=1&CCode=0&Order=x" }],
    });
    const r = run(DB, ["--psql", psql, "--canaries", file], dir);
    expect(r.code).toBe(1);
    expect(r.out.split("\n").filter((l) => l.startsWith("HIT "))).toEqual([
      "HIT billing.ledger.description raw-return count=1",
      "HIT payments.tenant_accounts.api_password_enc ciphertext-format count=1",
      "HIT payments.tenant_events.detail canary#1 count=1",
      "HIT payments.tenant_events.detail card-json-key count=1",
      "HIT public.orders.notes canary#2 count=1",
      "HIT public.orders.notes card-number count=1",
    ]);
    expectSilent(r.out, [canary, terminal, card]);
    // the database never sees a canary: the values are matched in the scanner
    const sent = readFileSync(join(dir, "sql.log"), "utf8");
    expect(sent).toContain("BEGIN TRANSACTION READ ONLY;");
    expectSilent(sent, [canary, terminal]);
  });

  it("DM-SEC-3: clean tables pass (terminal numbers only in terminal_number, valid tokens, masked text)", () => {
    const dir = workdir();
    const terminal = `00100${digits(5)}`;
    const file = canaries(dir, `canary-${hex(12)}`, terminal);
    const psql = db(dir, {
      "payments.tenant_accounts": [{ terminal_number: terminal, api_password_enc: token() }],
      "payments.tenant_events": [
        { detail: JSON.stringify({ event: "verified", ccode: "0", last2: "01" }) },
      ],
      "public.orders": [{ notes: `KEY=*** at ${Date.now()}` }],
      "billing.ledger": [{ description: "payment" }],
    });
    const r = run(DB, ["--psql", psql, "--canaries", file], dir);
    expect(r.out).toContain("hits=0");
    expect(r.code).toBe(0);
  });

  it("DM-SEC-3: the self-test passes; a failing psql or bad arguments are exit 2", () => {
    const dir = workdir();
    const self = run(DB, ["--self-test"], dir);
    expect(self.out).toContain("scan-db self-test: ok");
    expect(self.code).toBe(0);
    put(
      dir,
      "fail.mjs",
      'process.stdin.resume();process.stdin.on("end",()=>{console.error("ERROR: boom");process.exit(2)});',
    );
    expect(run(DB, ["--psql", `"${process.execPath}" "${join(dir, "fail.mjs")}"`], dir).code).toBe(
      2,
    );
    expect(run(DB, [], dir).code).toBe(2);
    expect(run(DB, ["--psql", "psql", "--schemas", "public;drop"], dir).code).toBe(2);
  });
});
