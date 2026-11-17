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

def pct(r):
    if not r or "exec_ms_median" not in r: return ""
    lim = limit(r["role"])
    if lim is None: return "n/a (no limit)"
    p = r["exec_ms_median"] / lim * 100
    return f"{p:.0f}% of {lim // 1000} s" + (" **EXCEEDS**" if p > 100 else "")

def table(scn):
    o, w = load(scn + "-orig"), load(scn + "-rewrite")
    print(f"\n#### Scenario {scn}\n")
    print("| query | role / persona | rows | plan ms | exec ms orig | vs timeout | exec ms rewrite | speed-up | orders index (orig) | helper calls orig → rewrite | buffers hit orig → rewrite |")
    print("|---|---|--:|--:|--:|---|--:|--:|---|---|---|")
    for qid, r in o.items():
        rw = w.get(qid)
        if "exec_ms_median" not in r:
            print(f"| `{qid}` | {r['role']} / {r['persona']} | | | {fmt(r)} | | {fmt(rw)} | | | | |"); continue
        sp = f"{r['exec_ms_median'] / rw['exec_ms_median']:.1f}x" if rw and "exec_ms_median" in rw and rw["exec_ms_median"] > 0 else ""
        print(f"| `{qid}` | {r['role']} / {r['persona']} | {r.get('rows_returned', '')} | {r.get('plan_ms_median', 0):.1f} | {fmt(r)} | {pct(r)} | {fmt(rw)} | {sp} | {idx(r)} | {fn(r)} → {fn(rw)} | {r.get('hit', '')} → {rw.get('hit', '') if rw else ''} |")

def loadtable():
    print("\n#### Load test (pgbench, 30 s per cell, real API roles; run 2 = quiet machine, run 1 = shared with other jobs)\n")
    print("| scenario | variant | workload | clients | tx (run 2) | TPS run 2 | TPS run 1 | p50 ms run 2 | p50 ms run 1 | p95 ms run 2 | p95 ms run 1 | max ms run 2 |")
    print("|---|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|")
    for scn in ("A", "B"):
        for var in ("orig", "rewrite"):
            p2 = os.path.join(HERE, "out", f"{scn}-{var}-load", "load.json")
            p1 = os.path.join(HERE, "out", f"{scn}-{var}-load-run1", "load.json")
            if not os.path.exists(p2): continue
            r1 = {(r["workload"], r["clients"]): r for r in json.load(open(p1))} if os.path.exists(p1) else {}
            for r in json.load(open(p2)):
                o = r1.get((r["workload"], r["clients"]), {})
                g = lambda k, f="{:.0f}": f.format(o[k]) if o.get(k) is not None else ""
                print(f"| {scn} | {var} | {r['workload']} | {r['clients']} | {r['tx']} | {r['tps']:.1f} | {g('tps', '{:.1f}')} | {r['p50_ms']:.0f} | {g('p50_ms')} | {r['p95_ms']:.0f} | {g('p95_ms')} | {r['max_ms']:.0f} |")

if __name__ == "__main__":
    for scn in ("A", "B"):
        if os.path.exists(os.path.join(HERE, "out", scn + "-orig", "results.json")): table(scn)
    loadtable()
