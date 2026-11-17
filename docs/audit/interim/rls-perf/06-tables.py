#!/usr/bin/env python3
"""Builds the markdown tables for the report from out/<label>/results.json and out/<label>-load/load.json."""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
def load(label):
    p = os.path.join(HERE, "out", label, "results.json")
    return {r["qid"]: r for r in json.load(open(p))} if os.path.exists(p) else {}
def limit(role): return {"anon": 3000, "authenticated": 8000}.get(role)
def fmt(r):
    if not r: return "n/a"
    if "error" in r:
        e = r["error"]; e = e if isinstance(e, str) else e.get("error", "")
        if "statement timeout" in e or r.get("timed_out_cap"): return "TIMEOUT >240 s (cap)"
        return "denied (42501)" if "permission denied" in e else "error"
    return f"{r['exec_ms_median']:.0f}"
def over(r):
    if not r or "exec_ms_median" not in r: return ""
    lim = limit(r["role"])
    if lim is None: return "n/a"
    return "YES" if r["exec_ms_median"] > lim else "no"
def fn(r, n=3):
    if not r or not r.get("fn_calls"): return ""
    keep = [c for c in r["fn_calls"] if c["fn"].split(".")[-1] in
            ("can_view_order", "is_admin", "is_staff", "is_agent", "current_tenant_id", "buyer_price_tier", "tenant_is_active",
             "tenant_subscription_state", "tenant_active_addons", "is_super_admin", "store_staff_role")]
    return ", ".join(f"{c['fn'].split('.')[-1]}×{c['calls']:,}" for c in keep[:n])
def idx(r):
    if not r or "indexes" not in r: return ""
    names = [i for i in r["indexes"] if i in ("orders_customer_idx", "orders_tenant_created_idx", "orders_tenant_id_idx")]
    return ", ".join(names) if names else "-"

def table(scn):
    o, w = load(scn + "-orig"), load(scn + "-rewrite")
    print(f"\n#### Scenario {scn}\n")
    print("| query | role / persona | rows | JSON KB | plan ms | exec ms orig | exec ms rewrite | speed-up | over limit (orig) | orders idx (orig) | helper calls orig → rewrite | buffers hit orig |")
    print("|---|---|--:|--:|--:|--:|--:|--:|---|---|---|--:|")
    for qid, r in o.items():
        rw = w.get(qid)
        sp = ""
        if "exec_ms_median" in r and rw and "exec_ms_median" in rw and rw["exec_ms_median"] > 0:
            sp = f"{r['exec_ms_median'] / rw['exec_ms_median']:.1f}×"
        kb = f"{r.get('body_bytes', 0) / 1024:.0f}" if r.get("body_bytes") else ""
        print(f"| `{qid}` | {r['role']} / {r['persona']} | {r.get('rows_returned', '')} | {kb} | {r.get('plan_ms_median', 0):.1f} | {fmt(r)} | {fmt(rw)} | {sp} | {over(r)} | {idx(r)} | {fn(r)} → {fn(rw)} | {r.get('hit', '')} |"
              if "exec_ms_median" in r else
              f"| `{qid}` | {r['role']} / {r['persona']} | | | | {fmt(r)} | {fmt(rw)} | | | | | |")

def loadtable():
    print("\n#### Load test (pgbench, 30 s per cell, real API roles)\n")
    print("| scenario | variant | workload | clients | tx | TPS | p50 ms | p95 ms | max ms | failed |")
    print("|---|---|---|--:|--:|--:|--:|--:|--:|--:|")
    for scn in ("A", "B"):
        for var in ("orig", "rewrite"):
            p = os.path.join(HERE, "out", f"{scn}-{var}-load", "load.json")
            if not os.path.exists(p): continue
            for r in json.load(open(p)):
                print(f"| {scn} | {var} | {r['workload']} | {r['clients']} | {r['tx']} | {r['tps']:.1f} | {r['p50_ms']:.0f} | {r['p95_ms']:.0f} | {r['max_ms']:.0f} | {r['failed']} |")

if __name__ == "__main__":
    for scn in ("A", "B"):
        if os.path.exists(os.path.join(HERE, "out", scn + "-orig", "results.json")): table(scn)
    loadtable()
