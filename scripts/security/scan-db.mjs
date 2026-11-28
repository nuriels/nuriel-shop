#!/usr/bin/env node
// ============================================================
// Leak scan of a database (MAX/Hyp DEMO, plan §6.2 / DM-SEC-3; evidence 02-security §6.2 "Database").
//
//   node scripts/security/scan-db.mjs --psql "<psql command prefix>" [--canaries <file>]
//                                     [--schemas public,billing,payments] [--max-rows 1000000]
//   node scripts/security/scan-db.mjs --self-test
//
// e.g. --psql "psql -h /tmp/pg -p 5499 -U postgres -d shop_test"
//      --psql "docker exec -i <db container> psql -U postgres -d postgres"
//
// • Lists every text / varchar / json / jsonb column (and arrays of them) of the given schemas through the given
//   psql command, reads the values in ONE read-only transaction (BEGIN TRANSACTION READ ONLY … ROLLBACK) and
//   scans them HERE: the canaries are never sent to the database (they would land in its statement log).
// • Rules: the canaries; KEY / PassP / zPass with a value; long Sign / signature values; a Hyp URL with a query;
//   raw returns; card fields as parameters or JSON keys (Tmonth, Tyear, bincard, UserId, L4digit, cell);
//   Luhn-valid card-like runs; a *_enc column whose value is not a contract token "v1:<kid>:<iv>:<tag>:<ct>".
//   A 10-digit canary (a fake terminal number) is expected in columns named terminal_number and only there.
// • Output: "HIT <schema>.<table>.<column> <rule> count=<n>" — never a value. Exit 0 clean, 1 hits, 2 the scan
//   itself failed (bad arguments, psql error, a table larger than --max-rows).
// • The command prefix is split into arguments without a shell; the SQL goes to psql on stdin.
// ============================================================
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import {
  EXIT_CLEAN,
  EXIT_ERROR,
  EXIT_HITS,
  ScanError,
  assertCanariesDetectable,
  canaryMatchers,
  parseCanaries,
  rulesFor,
  splitCommand,
  withLuhnDigit,
} from "./scan-core.mjs";

const DEFAULT_SCHEMAS = ["public", "billing", "payments"];
const SCHEMA_NAME = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/;
/** the token format of src/platform/payments/server/crypto.ts (kid = 8 hex from the key modules) */
const CONTRACT_TOKEN =
  /^v1:[A-Za-z0-9_-]{1,32}:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]{2,}$/;
const TERMINAL_CANARY = /^[0-9]{10}$/;

const hex = (s) => Buffer.from(String(s), "utf8").toString("hex");
const unhex = (s) => Buffer.from(s, "hex").toString("utf8");
const ident = (s) => `"${String(s).replace(/"/g, '""')}"`;

function parseArgs(argv) {
  const args = {
    psql: null,
    canaries: null,
    schemas: DEFAULT_SCHEMAS,
    maxRows: 1_000_000,
    selfTest: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s, 2);
    const value = () => {
      const v = inline ?? argv[++i];
      if (v === undefined) throw new ScanError(`${flag} needs a value`);
      return v;
    };
    if (flag === "--psql") args.psql = value();
    else if (flag === "--canaries") args.canaries = value();
    else if (flag === "--schemas")
      args.schemas = value()
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    else if (flag === "--max-rows") args.maxRows = Number(value());
    else if (flag === "--self-test") args.selfTest = true;
    else throw new ScanError(`unknown argument ${flag}`);
  }
  if (!args.selfTest && !args.psql) throw new ScanError("--psql is required");
  if (!args.schemas.length || !args.schemas.every((s) => SCHEMA_NAME.test(s))) {
    throw new ScanError("--schemas: comma-separated schema names");
  }
  if (!Number.isInteger(args.maxRows) || args.maxRows < 1)
    throw new ScanError("--max-rows: a positive integer");
  return args;
}

const PRELUDE = [
  "\\set ON_ERROR_STOP on",
  "\\pset pager off",
  "\\pset format unaligned",
  "\\pset tuples_only on",
  "BEGIN TRANSACTION READ ONLY;",
  "SET LOCAL statement_timeout = '600s';",
];

export function catalogSql(schemas) {
  const list = schemas.map((s) => `'${s}'`).join(",");
  return [
    ...PRELUDE,
    "-- scan-db:catalog",
    "SELECT 'C' || chr(9) || encode(convert_to(n.nspname, 'UTF8'), 'hex') || chr(9) ||",
    "       encode(convert_to(c.relname, 'UTF8'), 'hex') || chr(9) ||",
    "       encode(convert_to(a.attname, 'UTF8'), 'hex') || chr(9) || t.typname",
    "FROM pg_catalog.pg_attribute a",
    "JOIN pg_catalog.pg_class c ON c.oid = a.attrelid",
    "JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace",
    "JOIN pg_catalog.pg_type t ON t.oid = a.atttypid",
    "LEFT JOIN pg_catalog.pg_type e ON e.oid = t.typelem AND t.typcategory = 'A'",
    `WHERE n.nspname IN (${list})`,
    "  AND (c.relkind = 'p' OR (c.relkind = 'r' AND NOT c.relispartition))",
    "  AND a.attnum > 0 AND NOT a.attisdropped",
    "  AND (t.typcategory = 'S' OR t.typname IN ('json', 'jsonb')",
    "       OR e.typcategory = 'S' OR e.typname IN ('json', 'jsonb'))",
    "ORDER BY n.nspname, c.relname, a.attnum;",
    "ROLLBACK;",
  ].join("\n");
}

export function dataSql(tables, maxRows) {
  const out = [...PRELUDE];
  tables.forEach((t, idx) => {
    // names travel hex-encoded in the marker comment (a name with a newline cannot break out of it)
    out.push(
      `-- scan-db:table ${idx} ${hex(t.schema)} ${hex(t.table)} ${t.columns.map((c) => hex(c.name)).join(",")}`,
    );
    const cells = t.columns
      .map((c) => `coalesce(encode(convert_to(x.${ident(c.name)}::text, 'UTF8'), 'hex'), '-')`)
      .join(" || chr(9) || ");
    const any = t.columns.map((c) => `x.${ident(c.name)} IS NOT NULL`).join(" OR ");
    out.push(
      `SELECT 'R' || chr(9) || '${idx}' || chr(9) || ${cells} FROM ${ident(t.schema)}.${ident(t.table)} AS x WHERE ${any} LIMIT ${maxRows + 1};`,
    );
  });
  out.push("ROLLBACK;");
  return out.join("\n");
}

/** runs psql with the script on stdin; calls onLine for every stdout line; resolves when psql exits 0 */
function runPsql(argv, script, onLine) {
  return new Promise((resolvePromise, reject) => {
    let child;
    try {
      child = spawn(argv[0], argv.slice(1), { stdio: ["pipe", "pipe", "pipe"] });
    } catch {
      reject(new ScanError("cannot start the psql command"));
      return;
    }
    let stderr = "";
    child.stderr.on("data", (d) => {
      if (stderr.length < 64 * 1024) stderr += d.toString("utf8");
    });
    child.on("error", () => reject(new ScanError("cannot start the psql command")));
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on("line", onLine);
    // done when both the output is fully read and the process has exited
    const outputRead = new Promise((r) => rl.once("close", r));
    child.on("close", async (code) => {
      await outputRead;
      if (code === 0) return resolvePromise();
      // the first error line only, digits masked and shortened: it may quote the query, never print data
      const first = stderr.split("\n").find((l) => /ERROR|FATAL|error/.test(l)) ?? "";
      const safe = first.replace(/[0-9]{4,}/g, "#").slice(0, 200);
      reject(new ScanError(`psql exited with ${code}${safe ? `: ${safe}` : ""}`));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(script);
  });
}

/**
 * The scan. `psql` is the argv of the command prefix. Returns { code, lines, hits } where hits are
 * { column: "schema.table.column", rule, count } — never a value.
 */
export async function scanDb(
  { psql, canaries: canariesFile, schemas = DEFAULT_SCHEMAS, maxRows = 1_000_000 },
  cwd = process.cwd(),
) {
  const argv = Array.isArray(psql) ? psql : splitCommand(psql);
  if (!argv.length) throw new ScanError("--psql is empty");
  let canaries = [];
  if (canariesFile) {
    const file = resolve(cwd, canariesFile);
    if (!existsSync(file)) throw new ScanError("the canaries file does not exist");
    canaries = parseCanaries(readFileSync(file, "utf8"));
  }
  const matchers = canaryMatchers(canaries);
  assertCanariesDetectable(matchers, canaries);
  const terminalCanaries = new Set(
    canaries.filter((c) => TERMINAL_CANARY.test(c.value)).map((c) => c.id),
  );
  const rules = rulesFor("db");

  const tables = new Map();
  await runPsql(argv, catalogSql(schemas), (line) => {
    const p = line.split("\t");
    if (p[0] !== "C" || p.length !== 5) return;
    const [schema, table, column] = [unhex(p[1]), unhex(p[2]), unhex(p[3])];
    const key = `${schema}\u0000${table}`;
    if (!tables.has(key)) tables.set(key, { schema, table, columns: [] });
    tables.get(key).columns.push({ name: column, type: p[4] });
  });
  const list = [...tables.values()];
  const counts = new Map();
  const rowsSeen = new Map();
  const add = (where, rule) => {
    const k = `${where}\u0000${rule}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  };
  let values = 0;
  if (list.length) {
    await runPsql(argv, dataSql(list, maxRows), (line) => {
      const p = line.split("\t");
      if (p[0] !== "R") return;
      const t = list[Number(p[1])];
      if (!t || p.length !== t.columns.length + 2) return;
      rowsSeen.set(t, (rowsSeen.get(t) ?? 0) + 1);
      t.columns.forEach((col, i) => {
        const cell = p[i + 2];
        if (cell === "-") return;
        values += 1;
        const text = unhex(cell);
        const where = `${t.schema}.${t.table}.${col.name}`;
        const found = new Set();
        const lines = text.split("\n");
        for (const l of lines) {
          const lower = l.toLowerCase();
          for (const m of matchers) {
            if (m.test(l, lower) && !(col.name === "terminal_number" && terminalCanaries.has(m.id)))
              found.add(m.id);
          }
        }
        if (/_enc$/.test(col.name)) {
          // ciphertext: only the format matters (its bytes are random), plus the canaries above
          if (!CONTRACT_TOKEN.test(text)) found.add("ciphertext-format");
        } else {
          for (const l of lines) for (const r of rules) if (r.test(l, {})) found.add(r.id);
        }
        for (const rule of found) add(where, rule);
      });
    });
  }
  const truncated = list.filter((t) => (rowsSeen.get(t) ?? 0) > maxRows);
  if (truncated.length) {
    throw new ScanError(
      `${truncated.length} table(s) have more than --max-rows rows: the scan would be incomplete`,
    );
  }

  const hits = [...counts.entries()]
    .map(([k, count]) => {
      const [column, rule] = k.split("\u0000");
      return { column, rule, count };
    })
    .sort((a, b) => a.column.localeCompare(b.column) || a.rule.localeCompare(b.rule));
  const lines = hits.map((h) => `HIT ${h.column} ${h.rule} count=${h.count}`);
  const columns = list.reduce((n, t) => n + t.columns.length, 0);
  lines.push(
    `scan-db: schemas=${schemas.join(",")} tables=${list.length} columns=${columns} values=${values} canaries=${canaries.length} hits=${hits.length}` +
      (canaries.length ? " positive-control=ok" : " (no canaries given: pattern rules only)"),
  );
  return { code: hits.length ? EXIT_HITS : EXIT_CLEAN, lines, hits };
}

// ---------- self-test: a fake psql serves fixed tables; planted values must be found ----------

const FAKE_PSQL = `// fake psql for the scan-db self-test: serves the tables of a JSON fixture
import { appendFileSync, readFileSync } from "node:fs";
const [fixtureFile, logFile] = process.argv.slice(2);
const fixture = JSON.parse(readFileSync(fixtureFile, "utf8"));
let script = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (script += d));
process.stdin.on("end", () => {
  appendFileSync(logFile, script + "\\n");
  if (!script.includes("BEGIN TRANSACTION READ ONLY;") || !script.includes("ROLLBACK;")) process.exit(3);
  const hex = (s) => Buffer.from(String(s), "utf8").toString("hex");
  const unhex = (s) => Buffer.from(s, "hex").toString("utf8");
  if (script.includes("-- scan-db:catalog")) {
    for (const c of fixture.columns) console.log(["C", hex(c.schema), hex(c.table), hex(c.column), c.type].join("\\t"));
    return;
  }
  for (const m of script.matchAll(/^-- scan-db:table (\\d+) ([0-9a-f]+) ([0-9a-f]+) ([0-9a-f,]+)$/gm)) {
    const name = unhex(m[2]) + "." + unhex(m[3]);
    const cols = m[4].split(",").map(unhex);
    for (const row of fixture.rows[name] ?? []) {
      const cells = cols.map((c) => (row[c] === null || row[c] === undefined ? "-" : hex(row[c])));
      console.log(["R", m[1], ...cells].join("\\t"));
    }
  }
});
`;

function selfTestFixture(kind, canary, terminal, card) {
  const token = `v1:${randomBytes(4).toString("hex")}:${randomBytes(12).toString("base64url")}:${randomBytes(16).toString("base64url")}:${randomBytes(24).toString("base64url")}`;
  const columns = [
    ["payments", "tenant_accounts", "terminal_number", "text"],
    ["payments", "tenant_accounts", "api_key_enc", "text"],
    ["payments", "tenant_events", "detail", "jsonb"],
    ["public", "orders", "notes", "text"],
    ["public", "customer_profiles", "extra", "jsonb"],
    ["billing", "ledger", "description", "text"],
  ].map(([schema, table, column, type]) => ({ schema, table, column, type }));
  const clean = {
    "payments.tenant_accounts": [{ terminal_number: terminal, api_key_enc: token }],
    "payments.tenant_events": [
      { detail: JSON.stringify({ event: "verified", ccode: "0", last2: "01" }) },
    ],
    "public.orders": [
      { notes: `KEY=*** sent at ${Date.now()} ref ${randomBytes(16).toString("hex")}` },
    ],
    "public.customer_profiles": [{ extra: JSON.stringify({ cell: null, city: "x" }) }],
    "billing.ledger": [{ description: "Order=abc paid" }, { description: null }],
  };
  if (kind === "clean") return { columns, rows: clean };
  return {
    columns,
    rows: {
      "payments.tenant_accounts": [
        ...clean["payments.tenant_accounts"],
        { terminal_number: terminal, api_key_enc: "plaintext" },
      ],
      "payments.tenant_events": [{ detail: JSON.stringify({ note: canary }) }],
      "public.orders": [
        { notes: `terminal ${terminal}` },
        { notes: `card ${card}` },
        { notes: `KEY=${randomBytes(6).toString("hex")}` },
      ],
      "public.customer_profiles": [{ extra: JSON.stringify({ Tmonth: "12" }) }],
      "billing.ledger": [{ description: "CCode=0&Order=abc" }],
    },
  };
}

export async function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), "scan-db-selftest-"));
  const problems = [];
  try {
    const canary = `selftest-canary-${randomBytes(12).toString("hex")}`;
    const terminal = `00100${Array.from(randomBytes(5), (b) => b % 10).join("")}`;
    const card = withLuhnDigit(`2720${"0".repeat(14)}`);
    writeFileSync(join(dir, "canaries.txt"), `${canary}\n${terminal}\n`);
    writeFileSync(join(dir, "fake-psql.mjs"), FAKE_PSQL);
    const expectations = {
      dirty: [
        "billing.ledger.description raw-return",
        "payments.tenant_accounts.api_key_enc ciphertext-format",
        "payments.tenant_events.detail canary#1",
        "public.customer_profiles.extra card-json-key",
        "public.orders.notes canary#2",
        "public.orders.notes card-number",
        "public.orders.notes credential-param",
      ],
      clean: [],
    };
    for (const kind of ["dirty", "clean"]) {
      const fixture = join(dir, `${kind}.json`);
      const log = join(dir, `${kind}.sql.log`);
      writeFileSync(fixture, JSON.stringify(selfTestFixture(kind, canary, terminal, card)));
      const result = await scanDb(
        {
          psql: [process.execPath, join(dir, "fake-psql.mjs"), fixture, log],
          canaries: join(dir, "canaries.txt"),
        },
        dir,
      );
      const got = result.hits.map((h) => `${h.column} ${h.rule}`);
      for (const e of expectations[kind])
        if (!got.includes(e)) problems.push(`${kind}: missing ${e}`);
      for (const g of got)
        if (!expectations[kind].includes(g)) problems.push(`${kind}: unexpected ${g}`);
      const printed = result.lines.join("\n");
      if ([canary, terminal, card].some((v) => printed.includes(v)))
        problems.push(`${kind}: a planted value was printed`);
      const sent = readFileSync(log, "utf8");
      if ([canary, terminal].some((v) => sent.includes(v)))
        problems.push(`${kind}: a canary was sent to the database`);
      if (!sent.includes("BEGIN TRANSACTION READ ONLY;"))
        problems.push(`${kind}: the scan was not read-only`);
    }
  } catch (error) {
    problems.push(error instanceof ScanError ? error.message : "self-test crashed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const lines = problems.map((p) => `self-test FAILED: ${p}`);
  lines.push(
    `scan-db self-test: ${problems.length ? "FAILED" : "ok"} (fake psql; planted values found, clean tables passed, nothing sent but SQL)`,
  );
  return { code: problems.length ? EXIT_HITS : EXIT_CLEAN, lines };
}

async function main() {
  let result;
  try {
    const args = parseArgs(process.argv.slice(2));
    result = args.selfTest ? await selfTest() : await scanDb(args);
  } catch (error) {
    console.error(
      `scan-db: ERROR ${error instanceof ScanError ? error.message : "unexpected failure"}`,
    );
    process.exit(EXIT_ERROR);
  }
  for (const line of result.lines) console.log(line);
  process.exit(result.code);
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
)
  main();
