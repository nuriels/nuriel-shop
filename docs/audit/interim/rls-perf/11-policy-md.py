#!/usr/bin/env python3
"""Renders out/policy-rewrite-log.csv (before/after text from pg_policy) as markdown."""
import csv, os, re
HERE = os.path.dirname(os.path.abspath(__file__))
rows = list(csv.DictReader(open(os.path.join(HERE, "out", "policy-rewrite-log.csv"))))
norm = lambda t: re.sub(r"\s+", " ", t or "").strip()
print("| table | policy | cmd | type |")
print("|---|---|---|---|")
for r in rows:
    print(f"| {r['rel']} | `{r['pol']}` | {r['cmd']} | {r['permissive'].lower()} |")
KEY = ["orders select", "order items select", "customer profile select", "role readable by self staff or agent of customer",
       "products readable by staff", "products managed by admin", "orders update by staff", "orders insert by customer or staff"]
print()
for r in rows:
    if r["pol"] in KEY or (r["rel"] == "inquiries"):
        print(f"**{r['rel']}.`{r['pol']}`** ({r['cmd']})\n")
        for lab, b, a in (("USING", r["before_using"], r["after_using"]), ("WITH CHECK", r["before_check"], r["after_check"])):
            if b or a:
                print(f"- {lab} before: `{norm(b)}`\n- {lab} after:  `{norm(a)}`")
        print()
