import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import {
  ArrowRight,
  BadgePercent,
  Loader2,
  RotateCcw,
  Save,
  Search,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { fetchAllRows } from "@/lib/fetch-all";
import { formatIls, isSaleActive, unitPriceFromPack } from "@/lib/catalog";

/**
 * ניהול מחירי לקוחות מיוחדים (מחירון אישי).
 *
 * המוצרים לא משוכפלים ללקוח: בטבלת user_custom_prices נשמרים רק המחירים
 * שהמנהל דרס. מוצר בלי שורה = המחיר הרגיל של הלקוח (לפי הדרג שלו), ומחיקת
 * המחיר האישי מחזירה אותו אוטומטית למחיר הרגיל. המחיר המחייב נאכף בשרת
 * (get_catalog + הטריגר על שורות ההזמנה) — המסך הזה רק עורך את הדריסות.
 */

type CustomerRow = {
  user_id: string;
  business_name: string | null;
  contact_name: string | null;
  phone: string | null;
  price_tier: number | null;
  price_list_type: string;
};

type ProductRow = {
  id: string;
  sku: string;
  name: string;
  category: string;
  image_url: string | null;
  price_tier1: number;
  price_tier2: number;
  price_tier3: number;
  sale_price: number | null;
  sale_starts_at: string | null;
  sale_ends_at: string | null;
  is_hidden: boolean;
  /** נמכר במארזים של N — אז מציגים ומזינים גם מחיר למארז */
  pack_size: number | null;
};

const PAGE_SIZE = 60;

function customerLabel(customer: CustomerRow | undefined, email: string | undefined): string {
  return customer?.business_name?.trim() || email || "לקוח ללא שם";
}

/** מחיר רגיל של מוצר ללקוח לפי הדרג שלו (לקוח בלי דרג — מוצג דרג 1 לייחוס) */
function regularPriceFor(product: ProductRow, tier: number | null): number {
  if (tier === 2) return Number(product.price_tier2);
  if (tier === 3) return Number(product.price_tier3);
  return Number(product.price_tier1);
}

/** מחיר תקין: מספר אי-שלילי עם עד 10 ספרות אחרי הנקודה (מחיר ליחידה של מארז, למשל 115/24) */
function parsePrice(raw: string): number | null {
  const normalized = raw.trim().replace(",", ".").replace(/[₪\s]/g, "");
  if (normalized === "") return null;
  if (!/^\d{1,7}(\.\d{1,10})?$/.test(normalized)) return Number.NaN;
  return Number(normalized);
}

/** גובה הכותרת העליונה הדביקה — כדי שהבאנר של תיק הלקוח יידבק מתחתיה */
function useStickyHeaderOffset(): number {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const header = document.querySelector("header");
    if (!header) return;
    const update = () => setOffset(header.getBoundingClientRect().height);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  return offset;
}

export function CustomPricesPanel({
  customerId,
  onCustomerChange,
}: {
  /** הלקוח שהתיק שלו פתוח (נשמר בכתובת, כך ש"חזור" בדפדפן חוזר לרשימה) */
  customerId: string | null;
  onCustomerChange: (customerId: string | null) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [overrideCounts, setOverrideCounts] = useState<Record<string, number>>({});

  const loadCustomers = useCallback(async () => {
    setLoading(true);
    const [profilesResult, rolesResult, countsResult] = await Promise.all([
      fetchAllRows((from, to) =>
        supabase
          .from("customer_profiles")
          .select("user_id, business_name, contact_name, phone, price_tier, price_list_type")
          .order("business_name")
          .order("user_id")
          .range(from, to),
      ),
      fetchAllRows((from, to) =>
        supabase
          .from("user_roles")
          .select("user_id, email")
          .eq("role", "customer")
          .order("user_id")
          .range(from, to),
      ),
      fetchAllRows((from, to) =>
        supabase
          .from("user_custom_prices")
          .select("user_id, product_id")
          .order("user_id")
          .order("product_id")
          .range(from, to),
      ),
    ]);
    if (profilesResult.error) toast.error(profilesResult.error.message);
    setCustomers((profilesResult.data as CustomerRow[]) ?? []);
    setEmails(
      Object.fromEntries(
        ((rolesResult.data ?? []) as { user_id: string; email: string }[]).map((r) => [
          r.user_id,
          r.email,
        ]),
      ),
    );
    const counts: Record<string, number> = {};
    for (const row of (countsResult.data ?? []) as { user_id: string }[]) {
      counts[row.user_id] = (counts[row.user_id] ?? 0) + 1;
    }
    setOverrideCounts(counts);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  const customCustomers = useMemo(
    () => customers.filter((c) => c.price_list_type === "custom"),
    [customers],
  );

  if (loading) {
    return (
      <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        טוען לקוחות...
      </p>
    );
  }

  if (customerId) {
    const customer = customers.find((c) => c.user_id === customerId);
    return (
      <CustomerPriceEditor
        // key: מעבר בין לקוחות מאפס את כל הטיוטות — אין דליפת מחיר מלקוח ללקוח
        key={customerId}
        customerId={customerId}
        customer={customer}
        email={emails[customerId]}
        customCustomers={customCustomers}
        emails={emails}
        onSwitch={onCustomerChange}
        onChanged={loadCustomers}
      />
    );
  }

  return (
    <CustomerList
      customers={customers}
      customCustomers={customCustomers}
      emails={emails}
      overrideCounts={overrideCounts}
      onOpen={onCustomerChange}
      onChanged={loadCustomers}
    />
  );
}

// ============================================================
// מסך ראשי: רשימת הלקוחות עם מחירון אישי
// ============================================================
function CustomerList({
  customers,
  customCustomers,
  emails,
  overrideCounts,
  onOpen,
  onChanged,
}: {
  customers: CustomerRow[];
  customCustomers: CustomerRow[];
  emails: Record<string, string>;
  overrideCounts: Record<string, number>;
  onOpen: (customerId: string) => void;
  onChanged: () => Promise<void>;
}) {
  const [term, setTerm] = useState("");
  const [toAdd, setToAdd] = useState("");
  const [adding, setAdding] = useState(false);

  const query = term.trim().toLowerCase();
  const visible = customCustomers.filter((c) =>
    query === ""
      ? true
      : [c.business_name, c.contact_name, c.phone, emails[c.user_id]]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query)),
  );

  const regularCustomers = customers
    .filter((c) => c.price_list_type !== "custom")
    .sort((a, b) =>
      customerLabel(a, emails[a.user_id]).localeCompare(customerLabel(b, emails[b.user_id]), "he"),
    );

  /** העברת לקוח קיים למחירון אישי ופתיחת התיק שלו */
  const addCustomer = async () => {
    if (!toAdd) return;
    setAdding(true);
    const { error } = await supabase
      .from("customer_profiles")
      .update({ price_list_type: "custom" })
      .eq("user_id", toAdd);
    setAdding(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("הלקוח עבר למחירון אישי");
    const opened = toAdd;
    setToAdd("");
    await onChanged();
    onOpen(opened);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BadgePercent className="size-5 text-amber-600" />
            ניהול מחירי לקוחות מיוחדים
          </CardTitle>
          <CardDescription>
            לקוחות במחירון אישי. לחיצה על לקוח פותחת את התיק שלו לעריכת מחירים. מוצר בלי מחיר אישי
            נשאר אצל הלקוח במחיר הרגיל.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-56 flex-1 space-y-1">
              <Label className="text-xs">הוספת לקוח קיים למחירון אישי</Label>
              <Select value={toAdd} onValueChange={setToAdd}>
                <SelectTrigger dir="rtl">
                  <SelectValue placeholder="בחרו לקוח..." />
                </SelectTrigger>
                <SelectContent dir="rtl">
                  {regularCustomers.length === 0 ? (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">
                      כל הלקוחות כבר במחירון אישי
                    </div>
                  ) : (
                    regularCustomers.map((c) => (
                      <SelectItem key={c.user_id} value={c.user_id}>
                        {customerLabel(c, emails[c.user_id])}
                        {overrideCounts[c.user_id]
                          ? ` · ${overrideCounts[c.user_id]} מחירים שמורים`
                          : ""}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => void addCustomer()} disabled={!toAdd || adding}>
              {adding ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <UserPlus className="size-4" />
              )}
              העברה למחירון אישי
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            אפשר גם לקבוע &quot;סוג מחירון&quot; בהקמת לקוח, באישור לקוח ממתין ובעריכת משתמש (לשונית
            משתמשים).
          </p>
        </CardContent>
      </Card>

      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="חיפוש לקוח לפי שם עסק, איש קשר, טלפון או מייל"
          className="ps-9"
        />
      </div>

      {customCustomers.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <Users className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              עדיין אין לקוחות במחירון אישי. בחרו לקוח למעלה כדי להתחיל.
            </p>
          </CardContent>
        </Card>
      ) : visible.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">לא נמצאו לקוחות תואמים</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((c) => {
            const count = overrideCounts[c.user_id] ?? 0;
            return (
              <button
                key={c.user_id}
                type="button"
                onClick={() => onOpen(c.user_id)}
                className="group rounded-xl border-2 border-amber-300 bg-amber-50 p-4 text-start transition hover:border-amber-500 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-amber-700 dark:bg-amber-950/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-display min-w-0 truncate text-base font-bold text-foreground">
                    {customerLabel(c, emails[c.user_id])}
                  </p>
                  <Badge className="shrink-0 bg-amber-500 text-white hover:bg-amber-500">
                    {count} מחירים אישיים
                  </Badge>
                </div>
                <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                  {(c.contact_name || c.phone) && (
                    <p>
                      {c.contact_name}
                      {c.contact_name && c.phone ? " · " : ""}
                      <span dir="ltr">{c.phone}</span>
                    </p>
                  )}
                  {emails[c.user_id] && (
                    <p dir="ltr" className="text-right">
                      {emails[c.user_id]}
                    </p>
                  )}
                  {c.price_tier === null && (
                    <p className="font-medium text-destructive">
                      ללקוח אין קבוצת מחיר — הוא לא יראה מחירים עד שתוגדר לו
                    </p>
                  )}
                </div>
                <p className="mt-3 text-xs font-semibold text-amber-700 group-hover:underline dark:text-amber-400">
                  פתיחת תיק הלקוח ←
                </p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================
// תיק לקוח: עריכת מחירים אישיים
// ============================================================
function CustomerPriceEditor({
  customerId,
  customer,
  email,
  customCustomers,
  emails,
  onSwitch,
  onChanged,
}: {
  customerId: string;
  customer: CustomerRow | undefined;
  email: string | undefined;
  customCustomers: CustomerRow[];
  emails: Record<string, string>;
  onSwitch: (customerId: string | null) => void;
  onChanged: () => Promise<void>;
}) {
  const headerOffset = useStickyHeaderOffset();
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<ProductRow[]>([]);
  /** המחירים האישיים השמורים במסד: productId → מחיר */
  const [saved, setSaved] = useState<Map<string, number>>(new Map());
  /** טיוטות שהוקלדו ועוד לא נשמרו: productId → טקסט */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [term, setTerm] = useState("");
  const [category, setCategory] = useState("all");
  const [onlyCustom, setOnlyCustom] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [confirmResetAll, setConfirmResetAll] = useState(false);
  const [switchingType, setSwitchingType] = useState(false);

  const name = customerLabel(customer, email);
  const tier = customer?.price_tier ?? null;
  const isCustomList = customer?.price_list_type === "custom";

  const load = useCallback(async () => {
    setLoading(true);
    const [productsResult, pricesResult] = await Promise.all([
      fetchAllRows((from, to) =>
        supabase
          .from("global_products")
          .select(
            "id, sku, name, category, image_url, price_tier1, price_tier2, price_tier3, sale_price, sale_starts_at, sale_ends_at, is_hidden, pack_size",
          )
          .order("name")
          .order("id")
          .range(from, to),
      ),
      fetchAllRows((from, to) =>
        supabase
          .from("user_custom_prices")
          .select("product_id, custom_price")
          .eq("user_id", customerId)
          .order("product_id")
          .range(from, to),
      ),
    ]);
    if (productsResult.error) toast.error(productsResult.error.message);
    if (pricesResult.error) toast.error(pricesResult.error.message);
    setProducts((productsResult.data as ProductRow[]) ?? []);
    setSaved(
      new Map(
        ((pricesResult.data ?? []) as { product_id: string; custom_price: number }[]).map((r) => [
          r.product_id,
          Number(r.custom_price),
        ]),
      ),
    );
    setDrafts({});
    setLoading(false);
  }, [customerId]);

  useEffect(() => {
    void load();
  }, [load]);

  const categories = useMemo(
    () =>
      Array.from(new Set(products.map((p) => p.category))).sort((a, b) => a.localeCompare(b, "he")),
    [products],
  );

  const query = term.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      products.filter(
        (p) =>
          (category === "all" || p.category === category) &&
          (!onlyCustom || saved.has(p.id)) &&
          (query === "" ||
            p.name.toLowerCase().includes(query) ||
            p.sku.includes(query) ||
            p.category.toLowerCase().includes(query)),
      ),
    [products, category, onlyCustom, saved, query],
  );

  // מעבר מסנן/חיפוש מחזיר לעמוד הראשון
  useEffect(() => {
    setLimit(PAGE_SIZE);
  }, [query, category, onlyCustom]);

  const dirtyIds = Object.keys(drafts).filter((id) => {
    const parsed = parsePrice(drafts[id] ?? "");
    const current = saved.get(id);
    return parsed === null ? current !== undefined : parsed !== current;
  });

  const setBusy = (ids: string[], value: boolean) =>
    setBusyIds((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (value) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const clearDrafts = (ids: string[]) =>
    setDrafts((current) => {
      const next = { ...current };
      for (const id of ids) delete next[id];
      return next;
    });

  /** שמירת מחיר אישי (או מחיקתו כשהשדה ריק) למוצר אחד */
  const saveOne = async (productId: string) => {
    const raw = drafts[productId];
    if (raw === undefined) return;
    const parsed = parsePrice(raw);
    if (parsed !== null && Number.isNaN(parsed)) {
      toast.error("מחיר לא תקין — מספר חיובי עם עד 2 ספרות אחרי הנקודה");
      return;
    }
    if (parsed === null) {
      await revertOne(productId);
      return;
    }
    if (parsed === saved.get(productId)) {
      clearDrafts([productId]);
      return;
    }
    setBusy([productId], true);
    const { error } = await supabase
      .from("user_custom_prices")
      .upsert(
        { user_id: customerId, product_id: productId, custom_price: parsed },
        { onConflict: "user_id,product_id" },
      );
    setBusy([productId], false);
    if (error) {
      // מוצר שנמחק מהאתר בינתיים — מרעננים את הרשימה במקום להיתקע
      if (/foreign key|violates/i.test(error.message)) {
        toast.error("המוצר כבר לא קיים באתר — הרשימה רועננה");
        void load();
        return;
      }
      toast.error(error.message);
      return;
    }
    setSaved((current) => new Map(current).set(productId, parsed));
    clearDrafts([productId]);
    toast.success("המחיר האישי נשמר");
    void onChanged();
  };

  /** מחיקת המחיר האישי — המוצר חוזר אוטומטית למחיר הרגיל */
  const revertOne = async (productId: string) => {
    if (!saved.has(productId)) {
      clearDrafts([productId]);
      return;
    }
    setBusy([productId], true);
    const { error } = await supabase
      .from("user_custom_prices")
      .delete()
      .eq("user_id", customerId)
      .eq("product_id", productId);
    setBusy([productId], false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setSaved((current) => {
      const next = new Map(current);
      next.delete(productId);
      return next;
    });
    clearDrafts([productId]);
    toast.success("המוצר חזר למחיר הרגיל");
    void onChanged();
  };

  /** שמירת כל השינויים שהוקלדו בבת אחת */
  const saveAll = async () => {
    const upserts: { user_id: string; product_id: string; custom_price: number }[] = [];
    const deletes: string[] = [];
    for (const id of dirtyIds) {
      const parsed = parsePrice(drafts[id] ?? "");
      if (parsed !== null && Number.isNaN(parsed)) {
        const product = products.find((p) => p.id === id);
        toast.error(`מחיר לא תקין עבור "${product?.name ?? id}"`);
        return;
      }
      if (parsed === null) deletes.push(id);
      else upserts.push({ user_id: customerId, product_id: id, custom_price: parsed });
    }
    const ids = [...upserts.map((u) => u.product_id), ...deletes];
    setBusy(ids, true);
    const errors: string[] = [];
    if (upserts.length > 0) {
      const { error } = await supabase
        .from("user_custom_prices")
        .upsert(upserts, { onConflict: "user_id,product_id" });
      if (error) errors.push(error.message);
    }
    if (deletes.length > 0) {
      const { error } = await supabase
        .from("user_custom_prices")
        .delete()
        .eq("user_id", customerId)
        .in("product_id", deletes);
      if (error) errors.push(error.message);
    }
    setBusy(ids, false);
    if (errors.length > 0) {
      toast.error(`חלק מהשינויים לא נשמרו: ${errors.join(" · ")}`);
      await load();
      return;
    }
    toast.success(`נשמרו ${ids.length} שינויים`);
    await load();
    void onChanged();
  };

  const resetAll = async () => {
    setConfirmResetAll(false);
    const { error } = await supabase.from("user_custom_prices").delete().eq("user_id", customerId);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("כל המוצרים חזרו למחיר הרגיל עבור הלקוח");
    await load();
    void onChanged();
  };

  /** החזרת לקוח שיצא מהמחירון האישי (המחירים השמורים חוזרים לפעול) */
  const reactivate = async () => {
    setSwitchingType(true);
    const { error } = await supabase
      .from("customer_profiles")
      .update({ price_list_type: "custom" })
      .eq("user_id", customerId);
    setSwitchingType(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("הלקוח חזר למחירון אישי");
    await onChanged();
  };

  const switchCustomer = (next: string) => {
    if (next === customerId) return;
    if (dirtyIds.length > 0 && !window.confirm("יש מחירים שלא נשמרו. לעבור ללקוח אחר בלי לשמור?")) {
      return;
    }
    onSwitch(next);
  };

  const backToList = () => {
    if (dirtyIds.length > 0 && !window.confirm("יש מחירים שלא נשמרו. לצאת בלי לשמור?")) return;
    onSwitch(null);
  };

  const shown = filtered.slice(0, limit);

  return (
    <div className="space-y-4">
      {/* באנר קבוע ובולט: תמיד ברור באיזה תיק לקוח נמצאים */}
      <div
        className="sticky z-20 -mx-3 border-y-4 border-amber-600 bg-amber-400 px-3 py-3 text-amber-950 shadow-lg sm:mx-0 sm:rounded-xl sm:border-4 sm:px-4"
        style={{ top: headerOffset }}
        role="status"
        aria-live="polite"
      >
        <div className="flex flex-wrap items-center gap-3">
          <BadgePercent className="size-7 shrink-0" />
          <p className="font-display min-w-0 flex-1 text-base font-extrabold leading-snug sm:text-xl">
            את/ה נמצא/ת בתיק לקוח - מחירים אישיים עבור:{" "}
            <span className="underline decoration-2 underline-offset-4">{name}</span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {customCustomers.length > 1 && (
              <Select value={customerId} onValueChange={switchCustomer}>
                <SelectTrigger
                  dir="rtl"
                  className="h-9 w-48 border-amber-700 bg-amber-50 text-amber-950"
                  aria-label="מעבר לתיק לקוח אחר"
                >
                  <SelectValue placeholder="מעבר ללקוח אחר" />
                </SelectTrigger>
                <SelectContent dir="rtl">
                  {customCustomers.map((c) => (
                    <SelectItem key={c.user_id} value={c.user_id}>
                      {customerLabel(c, emails[c.user_id])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              size="sm"
              variant="outline"
              className="border-amber-800 bg-amber-50 text-amber-950 hover:bg-amber-100"
              onClick={backToList}
            >
              <ArrowRight className="size-4" />
              לרשימת הלקוחות
            </Button>
          </div>
        </div>
      </div>

      {!customer ? (
        <Card className="border-destructive/50">
          <CardContent className="space-y-3 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              הלקוח לא נמצא — ייתכן שהחשבון נמחק. המחירים האישיים שלו נמחקו יחד איתו.
            </p>
            <Button onClick={() => onSwitch(null)}>חזרה לרשימת הלקוחות</Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {!isCustomList && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
              <p className="min-w-0 flex-1">
                הלקוח הוחזר ל<strong>מחירון הרגיל</strong> — המחירים כאן שמורים אבל{" "}
                <strong>לא פעילים</strong>, והוא רואה כרגע את המחירים הרגילים.
              </p>
              <Button size="sm" onClick={() => void reactivate()} disabled={switchingType}>
                {switchingType && <Loader2 className="size-4 animate-spin" />}
                החזרה למחירון אישי
              </Button>
            </div>
          )}
          {tier === null && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
              ללקוח אין קבוצת מחיר, ולכן הוא לא רואה מחירים בכלל (הצעת מחיר בלבד). המחירים האישיים
              יחולו ברגע שתוגדר לו קבוצת מחיר בלשונית המשתמשים. &quot;מחיר רגיל&quot; כאן מוצג לפי
              דרג 1.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-56 flex-1">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="חיפוש מוצר לפי שם, מק״ט או קטגוריה"
                className="ps-9"
              />
            </div>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger dir="rtl" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent dir="rtl">
                <SelectItem value="all">כל הקטגוריות</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant={onlyCustom ? "default" : "outline"}
              onClick={() => setOnlyCustom((v) => !v)}
            >
              רק מוצרים עם מחיר אישי ({saved.size})
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void saveAll()} disabled={dirtyIds.length === 0}>
              <Save className="size-4" />
              שמירת כל השינויים{dirtyIds.length > 0 ? ` (${dirtyIds.length})` : ""}
            </Button>
            {dirtyIds.length > 0 && (
              <Button variant="ghost" onClick={() => setDrafts({})}>
                ביטול שינויים שלא נשמרו
              </Button>
            )}
            <div className="flex-1" />
            <Button
              variant="outline"
              className="text-destructive"
              disabled={saved.size === 0}
              onClick={() => setConfirmResetAll(true)}
            >
              <RotateCcw className="size-4" />
              החזרת כל המוצרים למחיר הרגיל
            </Button>
          </div>

          {loading ? (
            <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              טוען מוצרים ומחירים...
            </p>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {onlyCustom ? "אין עדיין מוצרים עם מחיר אישי ללקוח הזה" : "לא נמצאו מוצרים"}
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                מציג {shown.length} מתוך {filtered.length} מוצרים · הקלידו מחיר ולחצו Enter (או
                &quot;שמירה&quot;). שדה ריק = מחיר רגיל.
              </p>
              {shown.map((product) => (
                <ProductPriceRow
                  key={product.id}
                  product={product}
                  regular={regularPriceFor(product, tier)}
                  saved={saved.get(product.id)}
                  draft={drafts[product.id]}
                  busy={busyIds.has(product.id)}
                  onDraft={(value) => setDrafts((current) => ({ ...current, [product.id]: value }))}
                  onSave={() => void saveOne(product.id)}
                  onRevert={() => void revertOne(product.id)}
                />
              ))}
              {filtered.length > shown.length && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setLimit((current) => current + PAGE_SIZE)}
                >
                  הצגת עוד מוצרים ({filtered.length - shown.length} נותרו)
                </Button>
              )}
            </div>
          )}
        </>
      )}

      <AlertDialog open={confirmResetAll} onOpenChange={setConfirmResetAll}>
        <AlertDialogContent dir="rtl" className="text-right">
          <AlertDialogHeader>
            <AlertDialogTitle>להחזיר את כל המוצרים למחיר הרגיל?</AlertDialogTitle>
            <AlertDialogDescription>
              כל {saved.size} המחירים האישיים של {name} יימחקו, והוא יראה את המחירים הרגילים בכל
              המוצרים. הלקוח יישאר במחירון אישי, כך שאפשר לקבוע לו מחירים חדשים.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void resetAll()}
            >
              מחיקת כל המחירים האישיים
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ProductPriceRow({
  product,
  regular,
  saved,
  draft,
  busy,
  onDraft,
  onSave,
  onRevert,
}: {
  product: ProductRow;
  regular: number;
  saved: number | undefined;
  draft: string | undefined;
  busy: boolean;
  onDraft: (value: string) => void;
  onSave: () => void;
  onRevert: () => void;
}) {
  const value = draft ?? (saved !== undefined ? String(saved) : "");
  const parsed = parsePrice(value);
  const invalid = parsed !== null && Number.isNaN(parsed);
  const dirty = draft !== undefined && (parsed === null ? saved !== undefined : parsed !== saved);
  const effective = parsed !== null && !invalid ? parsed : null;
  const isPack = (product.pack_size ?? 0) >= 2;
  const sale = isSaleActive(product) ? Number(product.sale_price) : null;
  const hasCustom = saved !== undefined;

  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-lg border p-2 sm:flex-nowrap ${
        hasCustom ? "border-amber-400 bg-amber-50/60 dark:bg-amber-950/20" : "border-border"
      }`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {product.image_url ? (
          <img
            src={product.image_url}
            alt=""
            loading="lazy"
            className="size-12 shrink-0 rounded-md border border-border bg-white object-contain"
          />
        ) : (
          <div className="size-12 shrink-0 rounded-md border border-dashed border-border bg-secondary" />
        )}
        <div className="min-w-0">
          <p className="line-clamp-2 text-sm font-bold leading-snug" title={product.name}>
            {product.name}
          </p>
          <p className="text-xs text-muted-foreground">
            <span dir="ltr" className="numeric">
              {product.sku}
            </span>{" "}
            · {product.category}
            {product.is_hidden && (
              <Badge variant="outline" className="ms-1 px-1 py-0 text-[10px]">
                מוסתר
              </Badge>
            )}
          </p>
        </div>
      </div>

      <div className="text-xs sm:w-28 sm:text-end">
        <p className="text-muted-foreground">מחיר רגיל</p>
        <p className="numeric font-semibold">{formatIls(regular)}</p>
        {isPack && (
          <p className="numeric text-muted-foreground">
            מארז {product.pack_size}: {formatIls(regular * (product.pack_size ?? 1))}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {isPack && (
          <div className="w-32 space-y-1">
            <PackPriceMini
              unit={value}
              packSize={product.pack_size ?? 1}
              invalid={invalid}
              label={`מחיר אישי למארז של ${product.pack_size} עבור ${product.name}`}
              onUnit={onDraft}
            />
            <p className="text-center text-[10px] leading-3 text-muted-foreground">למארז</p>
          </div>
        )}
        <div className="w-32 space-y-1">
          <Input
            inputMode="decimal"
            dir="ltr"
            value={value}
            placeholder={String(regular)}
            aria-label={`מחיר אישי עבור ${product.name}`}
            aria-invalid={invalid}
            className={`numeric h-9 text-center ${invalid ? "border-destructive" : ""} ${
              dirty ? "border-primary ring-1 ring-primary" : ""
            }`}
            onChange={(e) => onDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSave();
              }
              if (e.key === "Escape" && draft !== undefined) {
                e.preventDefault();
                onDraft(saved !== undefined ? String(saved) : "");
              }
            }}
          />
        </div>
        <Button
          size="sm"
          variant={dirty ? "default" : "outline"}
          disabled={!dirty || invalid || busy}
          onClick={onSave}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          שמירה
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!hasCustom || busy}
          onClick={onRevert}
          title="מחיקת המחיר האישי — חזרה למחיר הרגיל"
        >
          <RotateCcw className="size-4" />
          <span className="sr-only sm:not-sr-only">למחיר רגיל</span>
        </Button>
      </div>

      <div className="w-full text-xs sm:w-36">
        {hasCustom ? (
          <Badge className="bg-amber-500 text-white hover:bg-amber-500">מחיר אישי</Badge>
        ) : (
          <Badge variant="secondary">מחיר רגיל</Badge>
        )}
        {effective !== null && effective > regular && (
          <p className="mt-1 text-amber-700 dark:text-amber-400">גבוה מהמחיר הרגיל</p>
        )}
        {effective !== null && sale !== null && sale < effective && (
          <p className="mt-1 text-muted-foreground">
            מבצע כללי ({formatIls(sale)}) זול יותר — הלקוח יקבל אותו
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * מחיר אישי למארז: כותבים את מחיר המארז (למשל 110), והמחיר ליחידה מחושב
 * ב-10 ספרות (110 / 24 = 4.5833333333) ונכנס לשדה המחיר האישי. עריכת המחיר
 * ליחידה מעדכנת את מחיר המארז.
 */
function PackPriceMini({
  unit,
  packSize,
  invalid,
  label,
  onUnit,
}: {
  unit: string;
  packSize: number;
  invalid: boolean;
  label: string;
  onUnit: (unit: string) => void;
}) {
  const unitNumber = Number(unit.replace(",", "."));
  const derived =
    unit.trim() === "" || !Number.isFinite(unitNumber)
      ? ""
      : String(Math.round(unitNumber * packSize * 100) / 100);
  const [text, setText] = useState(derived);
  const typed = useRef(false);
  useEffect(() => {
    const fromText = Math.round(Number(text) * 100) / 100;
    if (typed.current && text.trim() !== "" && Math.abs(fromText - Number(derived)) < 0.005) return;
    typed.current = false;
    setText(derived);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derived]);
  return (
    <Input
      inputMode="decimal"
      dir="ltr"
      value={text}
      placeholder="מחיר למארז"
      aria-label={label}
      aria-invalid={invalid}
      className="numeric h-9 text-center"
      onChange={(e) => {
        typed.current = true;
        setText(e.target.value);
        const pack = Number(e.target.value.replace(",", "."));
        onUnit(
          e.target.value.trim() === ""
            ? ""
            : Number.isFinite(pack)
              ? unitPriceFromPack(pack, packSize)
              : e.target.value,
        );
      }}
    />
  );
}
