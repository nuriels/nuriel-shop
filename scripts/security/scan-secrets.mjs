#!/usr/bin/env node
// ============================================================
// Leak scan of files (MAX/Hyp DEMO, plan §6.2 / DM-SEC-1, 2, 4, 5, 6; evidence 02-security §6.2).
//
//   node scripts/security/scan-secrets.mjs --mode bundle    [--canaries <file>] .output/public
//   node scripts/security/scan-secrets.mjs --mode logs      [--canaries <file>] [--mask <text>]… <log files/dirs>
//   node scripts/security/scan-secrets.mjs --mode artifacts [--canaries <file>] e2e/playwright-report e2e/test-results
//   node scripts/security/scan-secrets.mjs --mode repo      [--canaries <file>] [--allow <file>] [pathspec…]
//   node scripts/security/scan-secrets.mjs --self-test [--mode <mode>]
//
// bundle    the client build: canaries, payment literals (PassP, zPass, APISign, What=VERIFY/SIGN, zikoyAPI,
//           CancelTrans, the payment env names, the payment table names), (KEY|PassP)=<value>
// logs      server logs: canaries, KEY/PassP/zPass with a value that is not the redaction mask, long Sign /
//           signature values, a Hyp URL with a query, raw returns (CCode= and Order= on one line), card fields,
//           Luhn-valid 13–19 digit runs
// artifacts CI uploads (and browser dumps): as logs, and inside zip / gzip / brotli files and base64 data: URIs
//           (the Playwright HTML report and traces are zips); an archive that cannot be opened is a hit
// repo      tracked files (git ls-files): 10-digit 00100… terminal numbers, KEY/PassP/zPass with a literal value,
//           Luhn-valid runs, tracked .env* (not examples) / *.pem / *.key files. Declared fakes:
//           scripts/security/declared-fakes.json, or "scan-secrets:allow" on the same line
//
// Output: "HIT <file>:<line> <rule>" — never the value. Exit 0 = clean, 1 = hits, 2 = the scan itself failed
// (bad arguments, unreadable input, nothing scanned, a canary that the positive control cannot find).
// ============================================================
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
  BUNDLE_LITERALS,
  EXIT_CLEAN,
  EXIT_ERROR,
  EXIT_HITS,
  ScanError,
  assertCanariesDetectable,
  canaryMatchers,
  emptyAllow,
  makeZip,
  neverRead,
  parseAllow,
  parseCanaries,
  rulesFor,
  scanBuffer,
  withLuhnDigit,
} from "./scan-core.mjs";

const MODES = ["bundle", "logs", "artifacts", "repo"];
const MAX_FILE_BYTES = 512 * 1024 * 1024;
const ALLOW_FILE = "scripts/security/declared-fakes.json";

function parseArgs(argv) {
  const args = { mode: null, canaries: null, masks: [], allow: null, selfTest: false, paths: [] };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].startsWith("--") ? argv[i].split(/=(.*)/s, 2) : [argv[i]];
    const value = () => {
      const v = inline ?? argv[++i];
      if (v === undefined) throw new ScanError(`${flag} needs a value`);
      return v;
    };
    if (flag === "--mode") args.mode = value();
    else if (flag === "--canaries") args.canaries = value();
    else if (flag === "--mask") args.masks.push(value());
    else if (flag === "--allow") args.allow = value();
    else if (flag === "--self-test") args.selfTest = true;
    else if (flag.startsWith("--")) throw new ScanError(`unknown option ${flag}`);
    else args.paths.push(argv[i]);
  }
  if (args.mode !== null && !MODES.includes(args.mode)) {
    throw new ScanError(`--mode must be one of ${MODES.join(", ")}`);
  }
  return args;
}

const globToRegExp = (glob) =>
  new RegExp(
    `^${glob
      .split("**")
      .map((part) =>
        part
          .split("*")
          .map((s) => s.replace(/[.+^${}()|[\]\\?]/g, "\\$&"))
          .join("[^/]*"),
      )
      .join(".*")}$`,
  );

/** every regular file under the given paths (symlinks are not followed) */
function walk(path, out, stats) {
  const st = lstatSync(path);
  if (st.isSymbolicLink()) {
    stats.skipped.push(`${path} (symlink)`);
  } else if (st.isDirectory()) {
    for (const name of readdirSync(path).sort()) walk(join(path, name), out, stats);
  } else if (st.isFile()) out.push(path);
}

const SECRET_FILE =
  /(^|\/)\.env(?!.*\.(?:example|sample|template)$)[^/]*$|\.(?:pem|key|p12|pfx)$|(^|\/)id_(?:rsa|dsa|ecdsa|ed25519)(\.|$)/i;

/**
 * Runs one scan. Returns { code, lines } — lines are what the CLI prints (never a matched value).
 * `cwd` is where relative paths are resolved (the self-test passes its temporary directory).
 */
export function scan(
  { mode, canaries: canariesFile, masks = [], allow: allowFile, paths = [] },
  cwd = process.cwd(),
) {
  const lines = [];
  const stats = { scanned: 0, binary: 0, skipped: [], notRead: [] };
  const hits = new Map();
  const onHit = (hit) => hits.set(`${hit.where}\u0000${hit.line}\u0000${hit.rule}`, hit);
  if (!mode) throw new ScanError("--mode is required");

  let canaries = [];
  let canariesReal = null;
  if (canariesFile) {
    const file = resolve(cwd, canariesFile);
    if (!existsSync(file)) throw new ScanError("the canaries file does not exist");
    canaries = parseCanaries(readFileSync(file, "utf8"));
    canariesReal = realpathSync(file);
  }
  const matchers = canaryMatchers(canaries);
  assertCanariesDetectable(matchers, canaries);

  let allow = emptyAllow();
  let allowReal = null;
  const files = [];
  let root = cwd;
  if (mode === "repo") {
    try {
      root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
        cwd,
        encoding: "utf8",
      }).trim();
    } catch {
      throw new ScanError("repo mode needs a git work tree");
    }
    const allowPath = allowFile ? resolve(cwd, allowFile) : join(root, ALLOW_FILE);
    if (allowFile && !existsSync(allowPath)) throw new ScanError("the --allow file does not exist");
    if (existsSync(allowPath)) {
      try {
        allow = parseAllow(readFileSync(allowPath, "utf8"));
      } catch {
        throw new ScanError("the declared-fakes file is not valid JSON");
      }
      allowReal = realpathSync(allowPath);
    }
    const listed = execFileSync(
      "git",
      ["ls-files", "-z", "--full-name", "--", ...(paths.length ? paths : ["."])],
      {
        cwd,
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
      },
    );
    for (const rel of listed.split("\u0000").filter(Boolean)) {
      if (SECRET_FILE.test(rel)) onHit({ where: rel, line: 0, rule: "secret-file" });
      files.push(join(root, rel));
    }
  } else {
    if (!paths.length) throw new ScanError("no path to scan");
    for (const p of paths) {
      const abs = resolve(cwd, p);
      if (!existsSync(abs)) throw new ScanError(`path not found: ${p}`);
      walk(abs, files, stats);
    }
  }

  const luhnPaths = allow.luhnPaths.map(globToRegExp);
  const rules = rulesFor(mode, { extraMasks: masks, allow });
  for (const abs of files) {
    const shown =
      relative(mode === "repo" ? root : cwd, abs)
        .split("\\")
        .join("/") || abs;
    if (neverRead(shown) || neverRead(abs)) {
      stats.notRead.push(shown);
      continue;
    }
    let real;
    try {
      const st = lstatSync(abs);
      if (!st.isFile()) {
        stats.skipped.push(`${shown} (${st.isSymbolicLink() ? "symlink" : "not a regular file"})`);
        continue;
      }
      if (st.size > MAX_FILE_BYTES) throw new ScanError(`too large to scan: ${shown}`);
      real = realpathSync(abs);
    } catch (error) {
      if (error instanceof ScanError) throw error;
      if (mode === "repo") {
        stats.skipped.push(`${shown} (not in the work tree)`);
        continue;
      }
      throw new ScanError(`cannot read ${shown}`);
    }
    if (real === canariesReal) {
      stats.skipped.push(`${shown} (the canaries file itself — remove it before any upload)`);
      continue;
    }
    if (real === allowReal) continue;
    const opts = {
      mode,
      rules,
      matchers,
      ctx: { luhnFixture: luhnPaths.some((re) => re.test(shown)) },
      skipLine: mode === "repo" ? (line) => line.includes("scan-secrets:allow") : undefined,
    };
    scanBuffer(readFileSync(abs), shown, opts, onHit, stats);
  }
  if (stats.scanned === 0 && hits.size === 0) throw new ScanError("nothing was scanned");

  const sorted = [...hits.values()].sort((a, b) =>
    a.where === b.where
      ? a.line - b.line || a.rule.localeCompare(b.rule)
      : a.where.localeCompare(b.where),
  );
  for (const h of sorted) lines.push(`HIT ${h.where}${h.line ? `:${h.line}` : ""} ${h.rule}`);
  for (const s of stats.skipped) lines.push(`note: skipped ${s}`);
  for (const s of stats.notRead) lines.push(`note: not read (owner-only file): ${s}`);
  lines.push(
    `scan-secrets: mode=${mode} files=${stats.scanned} binary=${stats.binary} canaries=${canaries.length} hits=${sorted.length}` +
      (canaries.length ? " positive-control=ok" : " (no canaries given: pattern rules only)"),
  );
  return { code: sorted.length ? EXIT_HITS : EXIT_CLEAN, lines, hits: sorted };
}

// ---------- self-test: planted values must be found, clean inputs must pass ----------

const randomHex = (n) => randomBytes(n).toString("hex");
const randomDigits = (n) => Array.from(randomBytes(n), (b) => String(b % 10)).join("");
/**
 * Obviously synthetic and never a real card: a 19-digit number in the Mastercard 2-series (Mastercard issues only
 * 16 digits there), all zeros, built at run time (no card-like literal in the repository).
 */
const syntheticCard = () => withLuhnDigit(`2720${"0".repeat(14)}`);

function write(dir, rel, content) {
  const abs = join(dir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

function expectRun(label, result, expected, secrets, problems) {
  const got = new Set(result.hits.map((h) => `${h.where} ${h.rule}`));
  for (const e of expected) if (!got.has(e)) problems.push(`${label}: missing ${e}`);
  for (const g of got) if (!expected.includes(g)) problems.push(`${label}: unexpected ${g}`);
  const printed = result.lines.join("\n");
  for (const s of secrets)
    if (printed.includes(s)) problems.push(`${label}: the output contains a planted value`);
}

function selfTestMode(mode, base, problems) {
  const dir = mkdtempSync(join(base, `${mode}-`));
  const canary = `selftest-canary-${randomHex(12)}`;
  write(dir, "canaries.txt", `# self-test\n${canary}\n`);
  const key = randomHex(8);
  const pass = `P${randomHex(6)}`;
  const card = syntheticCard();
  const secrets = [canary, key, pass, card];
  const run = (paths, extra = {}) => scan({ mode, canaries: "canaries.txt", paths, ...extra }, dir);

  if (mode === "bundle") {
    const planted = [
      `var c="${canary}";`,
      `u="?KEY=${key}&x=1";`,
      ...BUNDLE_LITERALS.map((w) => `s("${w}");`),
    ];
    write(dir, "dirty/assets/app.js", planted.join("\n"));
    write(
      dir,
      "clean/assets/app.js",
      'var KEY_NAME="k",API_KEY="x";u="?KEY="+k;s("passport","tenant_accounts_x");',
    );
    const expected = [
      "dirty/assets/app.js canary#2",
      "dirty/assets/app.js credential-param",
      ...BUNDLE_LITERALS.map((w) => `dirty/assets/app.js literal:${w}`),
    ];
    expectRun("bundle dirty", run(["dirty"]), expected, secrets, problems);
    expectRun("bundle clean", run(["clean"]), [], secrets, problems);
  }

  if (mode === "logs") {
    write(
      dir,
      "dirty/server.log",
      [
        `[pay] attempt ok ref=${canary}`,
        `GET /p/?action=APISign&KEY=${key}&PassP=${pass}`,
        `{"msg":"x","PassP":"${pass}"}`,
        `verify Sign=${randomHex(20)}`,
        "fetch https://pay.hyp.co.il/p/?action=pay",
        "return Id=1&CCode=0&Amount=10&Order=abc",
        "Tmonth=12&Tyear=30",
        `{"bincard":"${randomDigits(6)}"}`,
        `card ${card} seen`,
      ].join("\n"),
    );
    write(
      dir,
      "clean/server.log",
      [
        "GET /p/?action=APISign&KEY=***&PassP=[REDACTED]&zPass=&Masof=********01",
        '{"PassP":"***","KEY":"","Sign":"***","cell":null}',
        `ts=${Date.now()} took=12ms id=${randomHex(16)} sha=${randomHex(32)}`,
        `SUPABASE_SERVICE_ROLE_KEY=k${randomHex(8)} Order=abc`,
      ].join("\n"),
    );
    const expected = [
      "dirty/server.log canary#2",
      "dirty/server.log credential-param",
      "dirty/server.log credential-json",
      "dirty/server.log signature-value",
      "dirty/server.log hyp-url-with-query",
      "dirty/server.log raw-return",
      "dirty/server.log card-field",
      "dirty/server.log card-json-key",
      "dirty/server.log card-number",
    ];
    expectRun("logs dirty", run(["dirty"]), expected, secrets, problems);
    expectRun("logs clean", run(["clean"]), [], secrets, problems);
  }

  if (mode === "artifacts") {
    const inner = makeZip([{ name: "data/trace.json", data: `{"note":"${canary}"}` }]);
    write(
      dir,
      "dirty/report/index.html",
      `<script>window.playwrightReportBase64 = "data:application/zip;base64,${inner.toString("base64")}";</script>`,
    );
    write(
      dir,
      "dirty/results/trace.zip",
      makeZip([{ name: "trace.network", data: `GET /p/?PassP=${pass} ${canary}` }]),
    );
    write(dir, "dirty/results/stdout.txt.gz", gzipSync(`line ${canary}\n`));
    write(
      dir,
      "dirty/results/broken.zip",
      Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), randomBytes(64)]),
    );
    write(
      dir,
      "clean/report/index.html",
      `<img src="data:image/png;base64,${randomBytes(48).toString("base64")}">`,
    );
    write(
      dir,
      "clean/results/trace.zip",
      makeZip([{ name: "trace.network", data: "GET /p/?PassP=***" }]),
    );
    const expected = [
      "dirty/report/index.html:1!data-uri#1!data/trace.json canary#2",
      "dirty/results/trace.zip!trace.network canary#2",
      "dirty/results/trace.zip!trace.network credential-param",
      "dirty/results/stdout.txt.gz!gunzip canary#2",
      "dirty/results/broken.zip unscannable-archive",
    ];
    expectRun("artifacts dirty", run(["dirty"]), expected, secrets, problems);
    expectRun("artifacts clean", run(["clean"]), [], secrets, problems);
  }

  if (mode === "repo") {
    const gitEnv = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")),
    );
    const git = (repo, ...a) =>
      execFileSync("git", ["-C", repo, ...a], { env: gitEnv, stdio: "ignore" });
    const terminal = `00100${randomDigits(5)}`;
    const declared = `00100${randomDigits(5)}`;
    for (const kind of ["dirty", "clean"]) {
      const repo = join(dir, kind);
      mkdirSync(repo, { recursive: true });
      git(repo, "init", "-q");
      write(
        repo,
        "src/ok.ts",
        "const q = `KEY=${key}&PassP=${pass}`; // KEY=fake-key PassP=*** zPass=\n",
      );
      write(
        repo,
        "scripts/security/declared-fakes.json",
        JSON.stringify({ terminals: [declared], luhnPaths: ["tests/fixtures/**"] }),
      );
      write(
        repo,
        "e2e/mock.mjs",
        `const TERMINAL = "${declared}";\nconst OTHER = "${terminal}"; // scan-secrets:allow fake\n`,
      );
      write(repo, "tests/fixtures/cards.txt", `${card}\n`);
      // owner-only files: never opened (a canary inside them is not found)
      write(repo, ".env.example", `X=${canary}\n`);
      write(repo, "deploy/setup-selfhost.sh", `echo ${canary}\n`);
      write(repo, "docs/seo-engine/ISTORES-COMPARISON.md", `${canary}\n`);
      if (kind === "dirty") {
        write(
          repo,
          "docs/notes.md",
          `terminal ${terminal}\nPassP=${pass}\ncard ${card}\nref ${canary}\n`,
        );
        write(repo, ".env.local", "X=1\n");
        write(repo, "certs/server.pem", "-\n");
      }
      git(repo, "add", "-A");
    }
    const expected = [
      ".env.local secret-file",
      "certs/server.pem secret-file",
      "docs/notes.md canary#2",
      "docs/notes.md card-number",
      "docs/notes.md credential-assignment",
      "docs/notes.md terminal-number",
    ];
    const canaries = resolve(dir, "canaries.txt");
    expectRun(
      "repo dirty",
      scan({ mode, canaries, paths: [] }, join(dir, "dirty")),
      expected,
      [...secrets, terminal],
      problems,
    );
    expectRun(
      "repo clean",
      scan({ mode, canaries, paths: [] }, join(dir, "clean")),
      [],
      [...secrets, terminal],
      problems,
    );
  }
}

export function selfTest(modes = MODES) {
  const base = mkdtempSync(join(tmpdir(), "scan-secrets-selftest-"));
  const problems = [];
  try {
    for (const mode of modes) {
      try {
        selfTestMode(mode, base, problems);
      } catch (error) {
        problems.push(
          `${mode}: ${error instanceof ScanError ? error.message : "self-test crashed"}`,
        );
      }
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
  const lines = problems.map((p) => `self-test FAILED: ${p}`);
  lines.push(
    `scan-secrets self-test: modes=${modes.join(",")} ${problems.length ? "FAILED" : "ok"} (planted values found, clean inputs passed)`,
  );
  return { code: problems.length ? EXIT_HITS : EXIT_CLEAN, lines };
}

function main() {
  let result;
  try {
    const args = parseArgs(process.argv.slice(2));
    result = args.selfTest ? selfTest(args.mode ? [args.mode] : MODES) : scan(args);
  } catch (error) {
    const message = error instanceof ScanError ? error.message : "unexpected failure";
    console.error(`scan-secrets: ERROR ${message}`);
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
