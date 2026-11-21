// רגרסיה ל-/sitemap (400 "column record.id does not exist"): בקריאה לפונקציה (rpc) PostgREST ממיין את
// התוצאה אחרי הבחירה — אז עמודה שממיינים לפיה חייבת להיות בתוך ה-select. (בטבלה רגילה זה לא נדרש.)
// הבדיקה עוברת על כל שרשרת rpc(...) ב-src, ובכל אחת שיש בה select עם עמודות מפורשות — כל order(...) חייב
// להיות על עמודה שנבחרה.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) return walk(abs);
    return /\.(ts|tsx)$/.test(name) ? [abs] : [];
  });
}

/** הסוגר שסוגר את הסוגר הפותח ב-open (מדלג על מחרוזות) */
function closeParen(src: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i;
  }
  return -1;
}

interface RpcCall {
  fn: string;
  select: string | null;
  orders: string[];
  line: number;
}

/** כל שרשראות rpc("…") בקובץ: הפונקציה, ה-select (אם יש) וה-order-ים שאחריה */
function rpcChains(src: string): RpcCall[] {
  const out: RpcCall[] = [];
  const re = /\.rpc\(\s*["'`]([a-z0-9_]+)["'`]/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const open = src.indexOf("(", m.index);
    let end = closeParen(src, open);
    if (end < 0) continue;
    let select: string | null = null;
    const orders: string[] = [];
    // ההמשך של השרשרת: ‎.method(args)‎ אחרי ‎.method(args)‎ (עם רווחים ושורות ביניהן)
    for (;;) {
      const next = /^\s*\.\s*([A-Za-z]+)\s*\(/.exec(src.slice(end + 1));
      if (!next) break;
      const argOpen = end + 1 + next[0].length - 1;
      const argClose = closeParen(src, argOpen);
      if (argClose < 0) break;
      const args = src.slice(argOpen + 1, argClose);
      const first = /^\s*["'`]([^"'`]*)["'`]/.exec(args)?.[1];
      if (next[1] === "select" && first !== undefined) select = first;
      if (next[1] === "order" && first !== undefined) orders.push(first);
      end = argClose;
    }
    out.push({ fn: m[1]!, select, orders, line: src.slice(0, m.index).split("\n").length });
  }
  return out;
}

/** שמות העמודות בתוצאה של select (alias:column → alias, column::cast → column), בלי הטמעות מקוננות */
function selectedColumns(select: string): Set<string> | "all" {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of select) {
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (depth > 0) continue;
    else if (c === ",") {
      parts.push(cur);
      cur = "";
    } else cur += c;
  }
  parts.push(cur);
  const names = new Set<string>();
  for (const part of parts.map((p) => p.trim()).filter(Boolean)) {
    if (part === "*") return "all";
    const alias = /^([A-Za-z_]\w*):(?!:)/.exec(part)?.[1];
    names.add(alias ?? part.split("::")[0]!.replace(/!.*$/, "").trim());
  }
  return names;
}

describe("rpc(...).select(...).order(...) — PostgREST sorts by a selected column only", () => {
  it("the parser finds the chain, its select and its orders", () => {
    const calls = rpcChains(
      `supabase.rpc("get_catalog")\n  .select("id, category")\n  .order("id", { ascending: true })\n  .range(0, 9)`,
    );
    expect(calls).toEqual([{ fn: "get_catalog", select: "id, category", orders: ["id"], line: 1 }]);
    expect(selectedColumns("id, category")).toEqual(new Set(["id", "category"]));
    expect(selectedColumns("*")).toBe("all");
    expect(selectedColumns("pid:id,name")).toEqual(new Set(["pid", "name"]));
  });

  it("the old /sitemap query is caught (order by id without id in the select)", () => {
    const [call] = rpcChains(
      `supabase.rpc("get_catalog").select("category").order("id").range(from, to)`,
    );
    const cols = selectedColumns(call!.select!);
    expect(cols !== "all" && !cols.has("id")).toBe(true);
  });

  it("every rpc chain in src that selects columns also selects every column it sorts by", () => {
    const bad: string[] = [];
    let checked = 0;
    for (const abs of walk(join(ROOT, "src"))) {
      const rel = relative(ROOT, abs).split("\\").join("/");
      for (const call of rpcChains(readFileSync(abs, "utf8"))) {
        if (call.select === null || call.orders.length === 0) continue;
        checked++;
        const cols = selectedColumns(call.select);
        if (cols === "all") continue;
        for (const col of call.orders)
          if (!cols.has(col))
            bad.push(
              `${rel}:${call.line} rpc("${call.fn}") orders by "${col}" but selects "${call.select}"`,
            );
      }
    }
    expect(bad).toEqual([]);
    // /sitemap לפחות (get_catalog עם select ו-order)
    expect(checked).toBeGreaterThan(0);
  });
});
