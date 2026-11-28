// deploy/demo/demo-check.sh — the DEMO server check, run for real against a fake docker / curl / ss (state in files)
// and the real Nginx template of the DEMO server. No server, no Docker, no network.
// What must hold: it refuses to run on the production server before checking anything; every check can fail;
// no secret value is ever printed; the D6 proofs read the app's startup line and the database's refusal.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "deploy/demo/demo-check.sh");
const TEMPLATE = join(process.cwd(), "deploy/demo/nginx/nuriel-demo.conf.template");
const NODE = process.execPath;

// canaries: none of them may ever appear in the output
const ROOT_A = "a1".repeat(32);
const ROOT_B = "b2".repeat(32);
const SERVICE = "svc-canary-0123456789abcdef0123456789abcdef";
const LOGIN = "login-canary-0123456789abcdef0123456789abcd";

const FAKE_DOCKER = String.raw`#!/usr/bin/env bash
S="$STATE"; echo "docker $*" >> "$S/calls"
cmd="$1"; shift
case "$cmd" in
  ps)
    if [[ "$*" == *"{{.Ports}}"* ]]; then cat "$S/ports" 2>/dev/null; else cat "$S/names"; fi ;;
  inspect)
    fmt="$2"; name="$3"
    case "$fmt" in
      *State.Health*) cat "$S/health" ;;
      *State.Running*) grep -qx "$name" "$S/names" && echo true || echo false ;;
      *Config.Image*) echo nuriel-demo-app-app ;;
    esac ;;
  port) cat "$S/sink_ports" 2>/dev/null ;;
  exec)
    [[ "$1" == -i ]] && shift
    shift # container
    prog="$1"; shift
    case "$prog" in
      printenv) v=$(grep -m1 "^$1=" "$S/appenv" | cut -d= -f2-); [[ -n "$v" ]] && echo "$v" || exit 1 ;;
      pg_isready) exit 0 ;;
      getent) echo "$(cat "$S/hyp_ip") pay.hyp.co.il" ;;
      node) env -i $(grep -v '^#' "$S/appenv" | xargs) "$NODE_BIN" - ;;
      psql)
        sql=""; while (($#)); do [[ "$1" == -tAc ]] && { sql="$2"; break; }; shift; done
        if [[ -z "$sql" ]]; then
          body=$(cat); echo "$body" >> "$S/proof_sql"
          if [[ -f "$S/marker_switch_allowed" ]]; then exit 0; fi
          if grep -q "SET name = 'production'" <<<"$body"; then echo "ERROR:  this DEMO database cannot become production" >&2; exit 3; fi
          exit 0
        fi
        case "$sql" in
          *"_migrations_applied WHERE filename"*) [[ -f "$S/migrated" ]] && echo t || echo f ;;
          *"to_regclass('payments.environment')"*) [[ -f "$S/migrated" ]] && echo t || echo f ;;
          *"FROM payments.environment"*) cat "$S/marker" ;;
          *"concat_ws('|'"*) cat "$S/db_row" ;;
          *) echo "unexpected sql" >&2; exit 9 ;;
        esac ;;
    esac ;;
  run)
    name=""; envs=""
    while (($#)); do case "$1" in --name) name="$2"; shift 2 ;; -e) envs+="$2 "; shift 2 ;; --env-file|--network) shift 2 ;; *) shift ;; esac; done
    echo "$envs" > "$S/run_$name"; echo "cid_$name" ;;
  logs)
    envs=$(cat "$S/run_$1")
    echo "Listening on http://[::]:3000"
    if [[ "$envs" == *PAYMENTS_ENV=production* ]]; then echo "[payments] env=off:host_mismatch endpoint=hyp tenant=off:env platform=off:env"
    elif [[ "$envs" == *MAX_PAY_TEST_URL=* && -f "$S/mock_honoured" ]]; then echo "[payments] env=demo endpoint=local-mock tenant=ready platform=ready"
    else echo "[payments] env=demo endpoint=hyp tenant=ready platform=ready"; fi ;;
  rm) : ;;
esac
`;

const FAKE_CURL = String.raw`#!/usr/bin/env bash
S="$STATE"; echo "curl $*" >> "$S/calls"
url=""; host=""; want_code=0; dump=0
while (($#)); do case "$1" in
  -w) want_code=1; shift 2 ;;
  -D) dump=1; shift 2 ;;
  -H) [[ "$2" == Host:* ]] && host="@{2#Host: }"; shift 2 ;;
  --resolve) host="@{2%%:*}"; shift 2 ;;
  -o|-m) shift 2 ;;
  http*) url="$1"; shift ;;
  *) shift ;;
esac; done
rest="@{url#*://}"; hostport="@{rest%%/*}"; path="/"; [[ "$rest" == */* ]] && path="/@{rest#*/}"
[[ -z "$host" ]] && host="$hostport"
if [[ "$url" == https* && -f "$S/no_tls" ]]; then [[ $want_code == 1 ]] && printf 000; exit 7; fi
if [[ "$hostport" == 127.0.0.1:* ]]; then code=200; body=ok
elif [[ "$host" == api.* ]]; then
  if [[ "$path" =~ ^/(auth|rest|storage)/v1/ ]]; then code=502; elif [[ -f "$S/studio_open" ]]; then code=200; else code=404; fi; body=""
elif [[ "$path" == /robots.txt ]]; then code=200; body=$'User-agent: *\nDisallow: /'
elif [[ -f "$S/no_password" ]]; then code=200; body="page"
else code=401; body="401"; fi
if [[ $dump == 1 ]]; then
  printf 'HTTP/1.1 %s X\r\n' "$code"; [[ -f "$S/no_robots_header" ]] || printf 'X-Robots-Tag: noindex, nofollow, noarchive\r\n'; printf '\r\n'
elif [[ $want_code == 1 ]]; then printf '%s' "$code"
else printf '%s\n' "$body"; fi
`;

const FAKE_SS = String.raw`#!/usr/bin/env bash
cat "$STATE/listeners"
`;

const bashScript = (src: string) => src.replaceAll("@{", "${");

let root = "";
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

function setup() {
  root = mkdtempSync(join(tmpdir(), "demo-check-"));
  const state = join(root, "state");
  const bin = join(root, "bin");
  const app = join(root, "app");
  const logs = join(root, "logs");
  for (const d of [state, bin, join(app, "deploy"), logs]) mkdirSync(d, { recursive: true });
  const file = (name: string, content: string) => writeFileSync(join(state, name), content);
  file("names", "nuriel-demo-app\nnuriel-demo-mailsink\nnuriel-demo-db\nnuriel-demo-kong\n");
  file(
    "ports",
    "nuriel-demo-app 127.0.0.1:3800->3000/tcp\nnuriel-demo-kong 127.0.0.1:8600->8000/tcp\nnuriel-demo-mailsink 4025/tcp\n",
  );
  file(
    "appenv",
    [
      "PLATFORM_ADMIN_HOST=admin.demo.example.test",
      "PAYMENTS_ENV=demo",
      `PAYMENTS_SECRETS_KEY=${ROOT_A}`,
      `PLATFORM_TERMINAL_SECRETS_KEY=${ROOT_B}`,
      `SUPABASE_SERVICE_ROLE_KEY=${SERVICE}`,
      `LOGIN_CODE_SECRET=${LOGIN}`,
      "RESEND_API_URL=http://nuriel-demo-mailsink:4025",
      "RESEND_API_KEY=demo-mail-sink",
      "PAYMENTS_JOBS=on",
      "",
    ].join("\n"),
  );
  file("health", "healthy\n");
  file("hyp_ip", "127.0.0.1\n");
  file("marker", "demo\n");
  file("db_row", "0|0|t|0\n");
  file(
    "listeners",
    "LISTEN 0 511 0.0.0.0:80 0.0.0.0:*\nLISTEN 0 511 0.0.0.0:443 0.0.0.0:*\nLISTEN 0 128 0.0.0.0:22 0.0.0.0:*\nLISTEN 0 511 127.0.0.1:3800 0.0.0.0:*\n",
  );
  writeFileSync(join(state, "migrated"), "");
  // the real template, rendered the way the guide renders it
  const site = readFileSync(TEMPLATE, "utf8")
    .replaceAll("@@DEMO_PLATFORM_HOST@@", "admin.demo.example.test")
    .replaceAll("@@DEMO_STORE_HOSTS@@", "store-a.demo.example.test store-b.demo.example.test")
    .replaceAll("@@DEMO_API_HOST@@", "api.demo.example.test")
    .replaceAll("@@DEMO_APP_PORT@@", "3800")
    .replaceAll("@@DEMO_KONG_PORT@@", "8600");
  writeFileSync(join(root, "nuriel-demo.conf"), site);
  writeFileSync(
    join(logs, "access.log"),
    '203.0.113.5 - tester [28/Nov/2026:09:00:00 +0000] "GET /payments/return/max HTTP/1.1" 303 0 0.120 "Mozilla"\n',
  );
  writeFileSync(join(app, "deploy/check-default-secrets.sh"), "#!/usr/bin/env bash\nexit 0\n");
  writeFileSync(join(app, ".env"), `PAYMENTS_SECRETS_KEY=${ROOT_A}\n`);
  writeFileSync(join(bin, "docker"), bashScript(FAKE_DOCKER));
  writeFileSync(join(bin, "curl"), bashScript(FAKE_CURL));
  writeFileSync(join(bin, "ss"), bashScript(FAKE_SS));
  for (const b of ["docker", "curl", "ss"]) chmodSync(join(bin, b), 0o755);
  const run = (...args: string[]) => {
    const r = spawnSync("bash", [SCRIPT, ...args], {
      encoding: "utf8",
      env: {
        PATH: `${bin}:${process.env["PATH"]}`,
        HOME: root,
        STATE: state,
        NODE_BIN: NODE,
        APP_DIR: app,
        SB_DIR: join(root, "sb"),
        NGINX_SITE: join(root, "nuriel-demo.conf"),
        NGINX_ACCESS_LOGS: join(logs, "access.log"),
        PROOF_WAIT: "2",
      },
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const calls = () => {
    try {
      return readFileSync(join(state, "calls"), "utf8");
    } catch {
      return "";
    }
  };
  return { state, app, logs, file, run, calls };
}

const noSecret = (out: string) => {
  for (const canary of [ROOT_A, ROOT_B, SERVICE, LOGIN]) expect(out).not.toContain(canary);
};

describe("deploy/demo/demo-check.sh", () => {
  it("passes every check on a correct DEMO server (stage d6) and prints no secret", () => {
    const t = setup();
    const r = t.run();
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("DEMO CHECK OK — stage d6");
    for (const line of [
      "PAYMENTS_ENV=demo in nuriel-demo-app",
      "the two payment roots differ",
      "PAYMENTS_SECRETS_KEY is not reused by another secret",
      "MAX_PAY_TEST_URL absent",
      "email goes to the DEMO mail sink",
      "pay.hyp.co.il is blocked inside nuriel-demo-app (D6)",
      "store-b.demo.example.test/ without a password: 401",
      "api.demo.example.test/project/default: 404 (closed)",
      "error logs at crit (no full request lines)",
      "access logs: no request line with a query string",
      "database marked demo",
      "RLS on every payments table",
      "nuriel-demo-mailsink publishes no port",
    ])
      expect(r.out).toContain(line);
    noSecret(r.out);
  });

  it("stops before checking anything on the production server (container names)", () => {
    const t = setup();
    t.file("names", "nuriel-shop-app\nnuriel-shop-db\n");
    const r = t.run();
    expect(r.code).toBe(2);
    expect(r.out).toContain("looks like the PRODUCTION server. Nothing was checked.");
    expect(t.calls()).not.toMatch(/exec|curl|psql/);
  });

  it("stops when the platform host is the production one", () => {
    const t = setup();
    t.file("appenv", "PLATFORM_ADMIN_HOST=Nuriel.Nuri1.fit\nPAYMENTS_ENV=demo\n");
    const r = t.run();
    expect(r.code).toBe(2);
    expect(r.out).toContain("is the production platform host");
    expect(t.calls()).not.toMatch(/node|psql|curl/);
  });

  it("fails when Hyp is reachable at stage d6, and passes the same server at stage d7", () => {
    const t = setup();
    t.file("hyp_ip", "203.0.113.10\n");
    const d6 = t.run();
    expect(d6.code).toBe(1);
    expect(d6.out).toContain("pay.hyp.co.il is NOT blocked");
    const d7 = t.run("--stage", "d7");
    expect(d7.code, d7.out).toBe(0);
    expect(d7.out).toContain("the Hyp block was removed (D7");
  });

  it("fails on weak, equal or reused payment roots, a test override, or real email — still printing no value", () => {
    const t = setup();
    t.file(
      "appenv",
      [
        "PLATFORM_ADMIN_HOST=admin.demo.example.test",
        "PAYMENTS_ENV=demo",
        `PAYMENTS_SECRETS_KEY=${SERVICE}`,
        `PLATFORM_TERMINAL_SECRETS_KEY=${SERVICE}`,
        `SUPABASE_SERVICE_ROLE_KEY=${SERVICE}`,
        "MAX_PAY_TEST_URL=http://127.0.0.1:4010/hyp/p/",
        "RESEND_API_URL=https://api.resend.com",
        "RESEND_API_KEY=re_live_canary_value",
        "",
      ].join("\n"),
    );
    const r = t.run();
    expect(r.code).toBe(1);
    for (const line of [
      "✗ the two payment roots differ",
      "✗ PAYMENTS_SECRETS_KEY is not reused by another secret",
      "✗ MAX_PAY_TEST_URL absent",
      "✗ email goes to the DEMO mail sink",
      "✗ no real Resend key",
    ])
      expect(r.out).toContain(line);
    noSecret(r.out);
    expect(r.out).not.toContain("re_live_canary_value");
  });

  it("fails on an open port, an open Studio, a missing password, a missing noindex and a logged query string", () => {
    const t = setup();
    t.file("ports", "nuriel-demo-app 0.0.0.0:3800->3000/tcp\n");
    t.file(
      "listeners",
      "LISTEN 0 511 0.0.0.0:80 0.0.0.0:*\nLISTEN 0 4096 0.0.0.0:5432 0.0.0.0:*\n",
    );
    t.file("studio_open", "");
    t.file("no_password", "");
    t.file("no_robots_header", "");
    writeFileSync(
      join(t.logs, "access.log"),
      '203.0.113.5 - - [28/Nov/2026:09:00:00 +0000] "GET /payments/return/max?Id=1&CCode=0 HTTP/1.1" 303 0 0.1 "x"\n',
    );
    const r = t.run();
    expect(r.code).toBe(1);
    for (const line of [
      "docker ports published on all interfaces",
      "other listeners on all interfaces",
      "api.demo.example.test/: 200 (expected 404)",
      "admin.demo.example.test/ without a password: 200 (expected 401)",
      "no X-Robots-Tag: noindex",
      "access logs: 1 request lines with a query string",
    ])
      expect(r.out).toContain(line);
  });

  it("falls back to http before certbot, and reports a database that is not marked or not migrated without failing", () => {
    const t = setup();
    t.file("no_tls", "");
    t.file("marker", "unset\n");
    expect(t.run().out).toContain("database not marked yet");
    rmSync(join(t.state, "migrated"));
    const r = t.run();
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("migration 208 not applied yet");
    expect(t.calls()).toContain("-H Host: store-a.demo.example.test http://127.0.0.1/");
  });

  it("fails on a live or non-test terminal account and on API access to the payments schema", () => {
    const t = setup();
    t.file("db_row", "1|2|f|3\n");
    const r = t.run();
    expect(r.code).toBe(1);
    for (const line of [
      "terminal accounts not in test mode: 1",
      "terminal numbers without the test prefix: 2",
      "the payments schema is open to an API role",
      "payments tables without RLS: 3",
    ])
      expect(r.out).toContain(line);
  });

  it("--proofs: the database refuses production (rolled back) and the app's startup line proves the env guard", () => {
    const t = setup();
    const r = t.run("--proofs");
    expect(r.out).toContain("marking the DEMO database production: refused");
    expect(r.out).toContain(
      "positive control: [payments] env=demo endpoint=hyp tenant=ready platform=ready",
    );
    expect(r.out).toContain("PAYMENTS_ENV=production on a non-production host: payments off");
    expect(r.out).toContain("the mock-server override is ignored on a non-local host");
    const sql = readFileSync(join(t.state, "proof_sql"), "utf8");
    expect(sql).toMatch(/^BEGIN;/);
    expect(sql.trim()).toMatch(/ROLLBACK;$/);
    noSecret(r.out);
  });

  it("--proofs: fails when the database accepts production or the app honours the mock override", () => {
    const t = setup();
    t.file("marker_switch_allowed", "");
    t.file("mock_honoured", "");
    const r = t.run("--proofs");
    expect(r.code).toBe(1);
    expect(r.out).toContain("marking the DEMO database production: NOT refused");
    expect(r.out).toContain("mock-server override: '[payments] env=demo endpoint=local-mock");
  });
});
