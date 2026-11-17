#!/usr/bin/env python3
"""
pgbench load test of the two hot screens under the real API roles.
  05-loadtest.py <dbname> <label> [clients,...] [seconds]
Workloads (each transaction = BEGIN; SET LOCAL ROLE; set_config(jwt claims, headers); <PostgREST-shaped query>; COMMIT):
  cust_orders      CustomerOrdersTab query as written (no customer filter), random customer of tenant 1
  cust_orders_flt  same + customer_id = uid (the proposed client-side fix)
  admin_orders     OrderManagementPanel query as tenant-1 admin
  agent_orders     OrderManagementPanel query as tenant-1 agent
Latency percentiles come from the pgbench per-transaction log (-l).
"""
import os, re, statistics, subprocess, sys, glob, json
DB, LABEL = sys.argv[1], sys.argv[2]
CLIENTS = [int(x) for x in (sys.argv[3] if len(sys.argv) > 3 else "8,16").split(",")]
SECS = int(sys.argv[4]) if len(sys.argv) > 4 else 30
if DB not in ("perf_scratch", "perf_scratch_b"):
    sys.exit("refusing " + DB)
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out", LABEL + "-load"); os.makedirs(OUT, exist_ok=True)

def dump(qid):
    env = dict(os.environ, DUMP_SQL=qid)
    return subprocess.run([sys.executable, os.path.join(HERE, "run-measure.py"), DB, "dump"], env=env, capture_output=True, text=True).stdout

# DUMP_SQL prints "<role>\n<persona uid>\n<tenant>\n<sql>" ; we build the pgbench script around it
def build(qid, who):
    d = dump(qid).split("\n", 3)
    role, uid, tenant, sql = d[0], d[1], d[2], d[3].strip().rstrip(";")
    n_cust = int(subprocess.run(["psql", "-X", "-At", "-h", "/tmp/pg", "-p", "5499", "-U", "postgres", "-d", DB, "-c",
              "select n_cust from perf.cfg where k=1"], capture_output=True, text=True).stdout.strip())
    if who == "random_customer":
        pre = f"\\set cid random(1, {n_cust})\n"
        sub = "md5('t1-cust-' || :cid)::uuid"
        sql = sql.replace(f"'{uid}'", "(" + sub + ")::text::uuid") if f"'{uid}'" in sql else sql
        claims = f"json_build_object('sub', {sub}, 'role', 'authenticated')::text"
    else:
        pre = ""
        claims = f"'{{\"sub\":\"{uid}\",\"role\":\"authenticated\"}}'"
    return (pre + "BEGIN;\nSET LOCAL ROLE authenticated;\n"
            f"SELECT set_config('request.jwt.claims', {claims}, true), set_config('request.headers', '{{\"x-tenant-id\":\"{tenant}\"}}', true);\n"
            + sql + ";\nCOMMIT;\n")

WORK = {"cust_orders": ("a1_cust_orders_nofilter", "random_customer"),
        "cust_orders_flt": ("a2_cust_orders_filtered", "random_customer"),
        "admin_orders": ("b2_admin_orders", "fixed"),
        "agent_orders": ("b1_agent_orders", "fixed")}
res = []
for name, (qid, who) in WORK.items():
    script = os.path.join(OUT, name + ".pgb")
    open(script, "w").write(build(qid, who))
    for c in CLIENTS:
        prefix = os.path.join(OUT, f"{name}-c{c}")
        for f in glob.glob(prefix + ".log*"): os.remove(f)
        p = subprocess.run(["pgbench", "-n", "-h", "/tmp/pg", "-p", "5499", "-U", "postgres", "-c", str(c), "-j", str(min(c, 4)), "-T", str(SECS),
                            "-f", script, "-l", "--log-prefix", prefix + ".log", "-r", DB], capture_output=True, text=True)
        lat = []
        for f in glob.glob(prefix + ".log*"):
            for ln in open(f):
                parts = ln.split()
                if len(parts) >= 3: lat.append(int(parts[2]) / 1000.0)
        for f in glob.glob(prefix + ".log*"): os.remove(f)
        tps = re.search(r"tps = ([\d.]+) \(without", p.stdout); n = re.search(r"number of transactions actually processed: (\d+)", p.stdout)
        fail = re.search(r"number of failed transactions: (\d+)", p.stdout)
        lat.sort()
        pct = lambda q: lat[min(len(lat) - 1, int(q * len(lat)))] if lat else None
        r = {"label": LABEL, "db": DB, "workload": name, "clients": c, "secs": SECS, "tx": int(n.group(1)) if n else None,
             "tps": float(tps.group(1)) if tps else None, "p50_ms": pct(0.50), "p95_ms": pct(0.95), "max_ms": lat[-1] if lat else None,
             "failed": int(fail.group(1)) if fail else 0, "stderr": p.stderr.strip()[:200]}
        res.append(r)
        print(f"{LABEL:10s} {name:16s} c={c:2d} tx={r['tx']} tps={r['tps']} p50={r['p50_ms'] and round(r['p50_ms'],1)} p95={r['p95_ms'] and round(r['p95_ms'],1)} max={r['max_ms'] and round(r['max_ms'],1)} fail={r['failed']} {r['stderr']}", flush=True)
        json.dump(res, open(os.path.join(OUT, "load.json"), "w"), indent=1)
