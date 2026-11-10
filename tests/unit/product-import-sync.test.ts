// STORE-2: ייבוא שמזהה מוצרים קיימים — ההחלטות לכל שורה, כפילויות בקובץ, הסיכום לפני הייבוא
// והדוח (CSV). השרת בודק שוב כל החלטה (scripts/db-tests/product-import-sync.test.sql) — כאן מה
// שהדפדפן מציג ושולח.
import { describe, expect, it } from "vitest";
import type { ImportRow } from "@/lib/csv-import";
import {
  emptySyncSummary,
  mergeSyncSummary,
  nameKey,
  planDecisions,
  presentProductIds,
  reportCsv,
  reportStats,
  skuKey,
  summarizePlan,
  type MatchProduct,
  type MatchRow,
  type ReportRow,
} from "@/lib/product-import-sync";

function row(n: number, name: string, extra: Partial<ImportRow> = {}): ImportRow {
  return {
    row: n,
    name,
    price: "10",
    category: "",
    categories: [],
    description: "",
    sku: "",
    barcode: "",
    stock: "",
    image_url: "",
    images: [],
    sale_price: "",
    sale_ends_at: "",
    cost_price: "",
    hidden: "",
    show_in_zap: "",
    seo_title: "",
    seo_description: "",
    ...extra,
  };
}

function product(id: string, extra: Partial<MatchProduct> = {}): MatchProduct {
  return {
    id,
    name: `מוצר ${id.slice(0, 4)}`,
    sku: "10000001",
    barcode: null,
    stock: 5,
    price: 10,
    hidden: false,
    out_of_stock: false,
    serial: false,
    digital: false,
    price_editable: true,
    ordered: false,
    ...extra,
  };
}

const P1 = "11111111-1111-1111-1111-111111111111";
const P2 = "22222222-2222-2222-2222-222222222222";
const P3 = "33333333-3333-3333-3333-333333333333";

function matched(n: number, p: MatchProduct, kind: MatchRow["kind"] = "barcode"): MatchRow {
  return { row: n, status: "matched", kind, problem: null, total: 1, ids: [p.id], products: [p] };
}
const fresh = (n: number): MatchRow => ({
  row: n,
  status: "new",
  kind: null,
  problem: null,
  total: 0,
  ids: [],
  products: [],
});

describe("keys: the same normalization as the database", () => {
  it("names: spaces collapsed, trimmed, lower case", () => {
    expect(nameKey("  Lenovo   IdeaPad  ")).toBe("lenovo ideapad");
    expect(nameKey("כבל  HDMI")).toBe(nameKey("כבל HDMI"));
  });
  it("SKUs: no spaces at all, lower case", () => {
    expect(skuKey(" SUP - 77 ")).toBe("sup-77");
    expect(skuKey("ABC 12")).toBe(skuKey("abc12"));
  });
});

describe("planDecisions: one decision per file row", () => {
  it("an existing product is updated (with the key that found it); a new one is created", () => {
    const rows = [row(2, "קיים"), row(3, "חדש")];
    const plan = planDecisions(
      rows,
      new Map([
        [2, matched(2, product(P1))],
        [3, fresh(3)],
      ]),
      { createNew: true },
    );
    expect(plan.map((p) => p.decision)).toEqual([
      { row: 2, action: "update", product_id: P1, match: "barcode" },
      { row: 3, action: "create" },
    ]);
  });

  it("not clear-cut (several products): skipped by default, every candidate counts as in the file", () => {
    const amb: MatchRow = {
      row: 2,
      status: "ambiguous",
      kind: "name",
      problem: null,
      total: 2,
      ids: [P1, P2],
      products: [product(P1), product(P2)],
    };
    const [p] = planDecisions([row(2, "מקלדת")], new Map([[2, amb]]), { createNew: true });
    expect(p!.decision).toMatchObject({ action: "skip", candidates: [P1, P2] });
    const [chosen] = planDecisions(
      [row(2, "מקלדת")],
      new Map([[2, amb]]),
      { createNew: true },
      { 2: P2 },
    );
    expect(chosen!.decision).toEqual({ row: 2, action: "update", product_id: P2, match: "chosen" });
    const [asNew] = planDecisions(
      [row(2, "מקלדת")],
      new Map([[2, amb]]),
      { createNew: true },
      { 2: "new" },
    );
    expect(asNew!.decision).toEqual({ row: 2, action: "create", force_new: true });
  });

  it("a choice that is not one of the candidates is never sent as an update", () => {
    const [p] = planDecisions(
      [row(2, "x")],
      new Map([[2, matched(2, product(P1))]]),
      { createNew: true },
      { 2: P3 },
    );
    expect(p!.decision.action).toBe("skip");
    expect(p!.decision.product_id).toBe(P1);
  });

  it('"don\'t add new products": new rows are skipped; a matched row marked "new" keeps its product in the file', () => {
    const plan = planDecisions(
      [row(2, "חדש"), row(3, "קיים")],
      new Map([
        [2, fresh(2)],
        [3, matched(3, product(P1), "name")],
      ]),
      { createNew: false },
      { 3: "new" },
    );
    expect(plan[0]!.decision).toMatchObject({
      action: "skip",
      reason: "נבחר לא להוסיף מוצרים חדשים",
    });
    expect(plan[1]!.decision).toMatchObject({ action: "skip", candidates: [P1] });
  });

  it("an invalid row is skipped with the reason from the check", () => {
    const bad: MatchRow = {
      row: 2,
      status: "invalid",
      kind: null,
      problem: 'מחיר לא תקין: "abc"',
      total: 0,
      ids: [],
      products: [],
    };
    const [p] = planDecisions([row(2, "x")], new Map([[2, bad]]), { createNew: true });
    expect(p!.decision).toEqual({ row: 2, action: "skip", reason: 'מחיר לא תקין: "abc"' });
  });

  it("the same existing product twice in the file: only the first row updates it", () => {
    const plan = planDecisions(
      [row(2, "a"), row(5, "a")],
      new Map([
        [2, matched(2, product(P1))],
        [5, matched(5, product(P1))],
      ]),
      { createNew: true },
    );
    expect(plan[0]!.decision.action).toBe("update");
    expect(plan[1]!.decision).toMatchObject({ action: "skip", product_id: P1 });
    expect(plan[1]!.duplicateOf).toBe(2);
  });

  it("the same new product twice (barcode / SKU / name): only the first is created", () => {
    const rows = [
      row(2, "עכבר", { barcode: "729001" }),
      row(3, "עכבר אחר", { barcode: "729001" }),
      row(4, "מקלדת", { sku: "SUP-1" }),
      row(5, "מקלדת 2", { sku: "sup-1" }),
      row(6, "כבל  USB"),
      row(7, "כבל usb"),
    ];
    const plan = planDecisions(rows, new Map(rows.map((r) => [r.row, fresh(r.row)])), {
      createNew: true,
    });
    expect(plan.map((p) => p.decision.action)).toEqual([
      "create",
      "skip",
      "create",
      "skip",
      "create",
      "skip",
    ]);
    expect(plan.map((p) => p.duplicateOf)).toEqual([null, 2, null, 4, null, 6]);
  });

  it("the same name with two different barcodes = two different new products", () => {
    const rows = [row(2, "כבל HDMI", { barcode: "1" }), row(3, "כבל HDMI", { barcode: "2" })];
    const plan = planDecisions(rows, new Map(rows.map((r) => [r.row, fresh(r.row)])), {
      createNew: true,
    });
    expect(plan.map((p) => p.decision.action)).toEqual(["create", "create"]);
  });

  it("a row without a check result is never imported", () => {
    const [p] = planDecisions([row(2, "x")], new Map(), { createNew: true });
    expect(p!.decision.action).toBe("skip");
  });
});

describe("summarizePlan: what will change, before running", () => {
  const rows = [
    row(2, "up", { stock: "9" }),
    row(3, "down", { stock: "2" }),
    row(4, "zero", { stock: "0" }),
    row(5, "same", { stock: "5" }),
    row(6, "serial", { stock: "8" }),
    row(7, "no stock"),
    row(8, "price", { stock: "5", price: "12" }),
    row(9, "locked price", { stock: "5", price: "99" }),
    row(10, "new at zero", { stock: "0" }),
  ];
  const ids = rows.map((r) => `${String(r.row).padStart(8, "0")}-0000-0000-0000-000000000000`);
  const matches = new Map<number, MatchRow>([
    [2, matched(2, product(ids[0]!))],
    [3, matched(3, product(ids[1]!))],
    [4, matched(4, product(ids[2]!))],
    [5, matched(5, product(ids[3]!), "name")],
    [6, matched(6, product(ids[4]!, { serial: true }), "sku")],
    [7, matched(7, product(ids[5]!), "supplier_sku")],
    [8, matched(8, product(ids[6]!))],
    [9, matched(9, product(ids[7]!, { price_editable: false }))],
    [10, fresh(10)],
  ]);
  const plan = planDecisions(rows, matches, { createNew: true });

  it("stock: up / down / to 0, serial products and empty cells are not changed", () => {
    const s = summarizePlan(plan, { existing: "stock", createNew: true, missing: "keep" });
    expect(s).toMatchObject({
      update: 8,
      create: 1,
      stockChanges: 3,
      stockUp: 1,
      stockDown: 2,
      toZero: 1,
      serialKept: 1,
      noStockInFile: 1,
      priceChanges: 0,
      newAtZero: 1,
    });
    expect(s.kinds).toEqual({ barcode: 5, sku: 1, supplier_sku: 1, name: 1 });
  });

  it("prices only with stock + price, and tier prices are reported as not changing", () => {
    const s = summarizePlan(plan, { existing: "stock_price", createNew: true, missing: "keep" });
    expect(s.priceChanges).toBe(1);
    expect(s.priceLocked).toBe(1);
  });

  it('"don\'t change existing products": nothing is counted as a change', () => {
    const s = summarizePlan(plan, { existing: "none", createNew: true, missing: "keep" });
    expect(s.stockChanges + s.toZero + s.priceChanges).toBe(0);
  });

  it("the products that count as in the file: updated, skipped and candidates", () => {
    const amb: MatchRow = {
      row: 2,
      status: "ambiguous",
      kind: "name",
      problem: null,
      total: 2,
      ids: [P2, P3],
      products: [],
    };
    const p = planDecisions(
      [row(2, "x"), row(3, "y")],
      new Map([
        [2, amb],
        [3, matched(3, product(P1))],
      ]),
      { createNew: true },
    );
    expect(presentProductIds(p).sort()).toEqual([P1, P2, P3].sort());
  });
});

describe("the change report", () => {
  const rows: ReportRow[] = [
    {
      row: 2,
      action: "updated",
      product_id: P1,
      name: 'מסך 24"',
      sku: "10000001",
      match: "barcode",
      before: { stock: 5 },
      after: { stock: 0 },
      message: null,
      undone: null,
      undo_message: null,
    },
    {
      row: 3,
      action: "updated",
      product_id: P2,
      name: "כבל",
      sku: "10000002",
      match: "name",
      before: { stock: 1, price: 10 },
      after: { stock: 4, price: 12 },
      message: null,
      undone: "conflict",
      undo_message: "המלאי השתנה",
    },
    {
      row: 4,
      action: "created",
      product_id: P3,
      name: "חדש",
      sku: "10000003",
      match: null,
      before: {},
      after: { stock: 3, price: 7 },
      message: null,
      undone: null,
      undo_message: null,
    },
    {
      row: null,
      action: "zeroed",
      product_id: P3,
      name: "לא בקובץ",
      sku: null,
      match: null,
      before: { stock: 2 },
      after: { stock: 0 },
      message: null,
      undone: null,
      undo_message: null,
    },
    {
      row: 5,
      action: "failed",
      product_id: null,
      name: "x",
      sku: null,
      match: null,
      before: {},
      after: {},
      message: "מחיר לא תקין",
      undone: null,
      undo_message: null,
    },
  ];

  it("counts what was added, updated, went up / down / to 0, and what was not in the file", () => {
    expect(reportStats(rows)).toMatchObject({
      created: 1,
      updated: 2,
      failed: 1,
      zeroed: 1,
      stockUp: 1,
      stockDown: 1,
      toZero: 1,
      priceChanged: 1,
    });
  });

  it("CSV: Hebrew headers, before → after with the difference, quotes escaped, undo state", () => {
    const csv = reportCsv(rows);
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(6);
    expect(lines[0]).toContain('"מלאי לפני","מלאי אחרי","שינוי במלאי"');
    expect(lines[1]).toBe('"2","מסך 24""","10000001","עודכן","ברקוד","5","0","-5","","","",""');
    expect(lines[2]).toContain('"1","4","+3","10","12"');
    expect(lines[2]).toContain('"לא שוחזר — השתנה מאז — המלאי השתנה"');
    expect(lines[4]).toContain('"לא בקובץ — המלאי אופס"');
    expect(lines[5]).toContain('"לא בוצע"');
  });
});

describe("batch summaries add up in the browser", () => {
  it("counts are summed, categories once, lists capped", () => {
    const a = {
      ...emptySyncSummary(),
      created: 2,
      newCategories: ["א"],
      images: { saved: 1, failed: 0 },
    };
    const b = {
      ...emptySyncSummary(),
      created: 1,
      updated: 3,
      newCategories: ["א", "ב"],
      limitReached: true,
    };
    expect(mergeSyncSummary(a, b)).toMatchObject({
      created: 3,
      updated: 3,
      newCategories: ["א", "ב"],
      limitReached: true,
      images: { saved: 1, failed: 0 },
    });
  });
});
