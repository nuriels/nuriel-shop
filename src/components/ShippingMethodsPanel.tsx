import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowUp,
  Info,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Store,
  Trash2,
  TriangleAlert,
  Truck,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { formatIls } from "@/lib/catalog";
import {
  SHIPPING_DESCRIPTION_MAX,
  SHIPPING_KIND_LABEL,
  SHIPPING_METHOD_COLUMNS,
  SHIPPING_NAME_MAX,
  shippingMethodProblem,
  type ShippingMethod,
  type ShippingMethodKind,
} from "@/lib/shipping";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Draft = {
  id: string | null;
  name: string;
  kind: ShippingMethodKind;
  price: string;
  description: string;
  isActive: boolean;
};

const EMPTY_DRAFT: Draft = {
  id: null,
  name: "",
  kind: "delivery",
  price: "",
  description: "",
  isActive: true,
};

/**
 * ניהול שיטות המשלוח של החנות: הוספה (למשל "שליח עד הבית" 35 ₪), עריכה,
 * הפעלה/כיבוי, סדר ומחיקה. הלקוח בוחר שיטה בקופה, והסכום הסופי כולל את
 * דמי המשלוח. איסוף עצמי — בלי כתובת; הכתובת לאיסוף = כתובת העסק בהגדרות.
 */
export function ShippingMethodsPanel() {
  const { settings } = useSiteSettings();
  const [methods, setMethods] = useState<ShippingMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ShippingMethod | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("shipping_methods")
      .select(SHIPPING_METHOD_COLUMNS)
      .order("sort_order")
      .order("created_at");
    if (error) toast.error(error.message);
    setMethods(
      ((data ?? []) as ShippingMethod[]).map((method) => ({
        ...method,
        price: Number(method.price),
      })),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activeCount = methods.filter((method) => method.is_active).length;
  const threshold = settings?.free_shipping_threshold ?? null;
  const pickupAddress = settings?.business_address?.trim() ?? "";
  const hasPickup = methods.some((method) => method.kind === "pickup" && method.is_active);

  const openNew = () =>
    setDraft({
      ...EMPTY_DRAFT,
      name: methods.length === 0 ? "שליח עד הבית" : "",
    });
  const openEdit = (method: ShippingMethod) =>
    setDraft({
      id: method.id,
      name: method.name,
      kind: method.kind,
      price: method.price > 0 ? String(method.price) : "",
      description: method.description,
      isActive: method.is_active,
    });

  const draftProblem = draft
    ? shippingMethodProblem({
        name: draft.name,
        description: draft.description,
        price: draft.price,
      })
    : null;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    if (draftProblem) {
      toast.error(draftProblem);
      return;
    }
    setSaving(true);
    const values = {
      name: draft.name.trim(),
      kind: draft.kind,
      price: draft.price.trim() === "" ? 0 : Number(draft.price),
      description: draft.description.trim(),
      is_active: draft.isActive,
    };
    const { error } = draft.id
      ? await supabase.from("shipping_methods").update(values).eq("id", draft.id)
      : await supabase.from("shipping_methods").insert({
          ...values,
          sort_order: methods.reduce((max, method) => Math.max(max, method.sort_order), 0) + 1,
        });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(draft.id ? "שיטת המשלוח עודכנה" : `"${values.name}" נוספה לקופה`);
    setDraft(null);
    void load();
  };

  const toggleActive = async (method: ShippingMethod, next: boolean) => {
    setBusyId(method.id);
    const { error } = await supabase
      .from("shipping_methods")
      .update({ is_active: next })
      .eq("id", method.id);
    setBusyId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    setMethods((current) =>
      current.map((row) => (row.id === method.id ? { ...row, is_active: next } : row)),
    );
    toast.success(next ? `"${method.name}" מוצגת בקופה` : `"${method.name}" הוסתרה מהקופה`);
  };

  const move = async (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= methods.length) return;
    const reordered = [...methods];
    const [moved] = reordered.splice(index, 1);
    if (!moved) return;
    reordered.splice(target, 0, moved);
    const withOrder = reordered.map((method, position) => ({
      ...method,
      sort_order: position + 1,
    }));
    setMethods(withOrder);
    const changed = withOrder.filter(
      (method) => methods.find((row) => row.id === method.id)?.sort_order !== method.sort_order,
    );
    const results = await Promise.all(
      changed.map((method) =>
        supabase
          .from("shipping_methods")
          .update({ sort_order: method.sort_order })
          .eq("id", method.id),
      ),
    );
    const failed = results.find((result) => result.error);
    if (failed?.error) {
      toast.error(failed.error.message);
      void load();
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusyId(deleting.id);
    const { error } = await supabase.from("shipping_methods").delete().eq("id", deleting.id);
    setBusyId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`"${deleting.name}" נמחקה. הזמנות קודמות שומרות את שם השיטה והמחיר.`);
    setDeleting(null);
    void load();
  };

  return (
    <div className="space-y-4">
      <Card className="shadow-card">
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div className="min-w-0 space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Truck className="size-5 text-accent" aria-hidden="true" />
              משלוחים
            </CardTitle>
            <CardDescription>
              השיטות שהלקוח בוחר בקופה. הסכום הסופי של ההזמנה כולל את דמי המשלוח, ובאיסוף עצמי הלקוח
              לא צריך למלא כתובת.
            </CardDescription>
          </div>
          <Button onClick={openNew}>
            <Plus className="size-4" aria-hidden="true" />
            שיטת משלוח חדשה
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="flex items-start gap-2 rounded-lg bg-secondary/60 px-3 py-2 text-sm">
            <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>
              {threshold ? (
                <>
                  משלוח חינם מעל <strong className="numeric">{formatIls(Number(threshold))}</strong>{" "}
                  — חל על שיטות "משלוח לכתובת" (מוגדר ב
                  <Link
                    to="/admin"
                    search={{ tab: "site" }}
                    className="text-primary hover:underline"
                  >
                    הגדרות האתר
                  </Link>
                  ).
                </>
              ) : (
                <>
                  אפשר להגדיר משלוח חינם מעל סכום מסוים ב
                  <Link
                    to="/admin"
                    search={{ tab: "site" }}
                    className="text-primary hover:underline"
                  >
                    הגדרות האתר
                  </Link>
                  .
                </>
              )}{" "}
              מוצר דיגיטלי לא דורש משלוח — סל שכולו דיגיטלי עובר לתשלום בלי בחירת שיטה.
            </span>
          </p>
          {hasPickup && (
            <p
              className={cn(
                "flex items-start gap-2 rounded-lg px-3 py-2 text-sm",
                pickupAddress
                  ? "bg-violet-50 text-violet-950 dark:bg-violet-950/30 dark:text-violet-100"
                  : "border border-amber-300 bg-amber-50 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100",
              )}
            >
              <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {pickupAddress ? (
                <span>
                  כתובת לאיסוף עצמי (מהגדרות האתר): <strong>{pickupAddress}</strong>
                </span>
              ) : (
                <span>
                  לא הוגדרה כתובת עסק — הלקוח לא יראה מאיפה אוספים. הוסיפו אותה ב
                  <Link to="/admin" search={{ tab: "site" }} className="font-semibold underline">
                    הגדרות האתר
                  </Link>
                  .
                </span>
              )}
            </p>
          )}
        </CardContent>
      </Card>

      {!loading && activeCount === 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          אין שיטת משלוח פעילה — הלקוחות יזמינו בלי לבחור משלוח (כתובת חובה), ובלי דמי משלוח.
        </p>
      )}

      {loading ? (
        <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> טוען שיטות משלוח…
        </p>
      ) : methods.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Truck className="size-8 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">עוד אין שיטות משלוח.</p>
            <Button variant="outline" onClick={openNew}>
              <Plus className="size-4" aria-hidden="true" />
              הוספת שיטה ראשונה
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {methods.map((method, index) => {
            const Icon = method.kind === "pickup" ? Store : Truck;
            return (
              <li key={method.id}>
                <Card className={cn("shadow-card", !method.is_active && "opacity-70")}>
                  <CardContent className="flex flex-wrap items-center gap-3 p-3 sm:p-4">
                    <span
                      className={cn(
                        "flex size-10 shrink-0 items-center justify-center rounded-full",
                        method.kind === "pickup"
                          ? "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200"
                          : "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
                      )}
                    >
                      <Icon className="size-5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-bold text-foreground">{method.name}</span>
                        <Badge variant="outline" className="whitespace-nowrap">
                          {SHIPPING_KIND_LABEL[method.kind]}
                        </Badge>
                        {!method.is_active && (
                          <Badge variant="secondary" className="whitespace-nowrap">
                            כבויה
                          </Badge>
                        )}
                      </p>
                      {method.description ? (
                        <p className="break-words text-xs text-muted-foreground">
                          {method.description}
                        </p>
                      ) : method.kind === "pickup" && pickupAddress ? (
                        <p className="break-words text-xs text-muted-foreground">{pickupAddress}</p>
                      ) : null}
                    </div>
                    <span className="numeric shrink-0 text-lg font-bold text-accent">
                      {method.price > 0 ? formatIls(method.price) : "חינם"}
                    </span>
                    <div className="flex w-full items-center justify-between gap-2 border-t border-border pt-2 sm:w-auto sm:border-0 sm:pt-0">
                      <label className="flex items-center gap-2 text-sm">
                        <Switch
                          checked={method.is_active}
                          disabled={busyId === method.id}
                          onCheckedChange={(next) => void toggleActive(method, next)}
                          aria-label={`הצגת "${method.name}" בקופה`}
                        />
                        <span className="text-muted-foreground">בקופה</span>
                      </label>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={index === 0}
                          onClick={() => void move(index, -1)}
                          aria-label="הזזה למעלה"
                        >
                          <ArrowUp className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={index === methods.length - 1}
                          onClick={() => void move(index, 1)}
                          aria-label="הזזה למטה"
                        >
                          <ArrowDown className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(method)}
                          aria-label={`עריכת "${method.name}"`}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleting(method)}
                          aria-label={`מחיקת "${method.name}"`}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {/* ---------- הוספה / עריכה ---------- */}
      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent dir="rtl" className="text-right sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "עריכת שיטת משלוח" : "שיטת משלוח חדשה"}</DialogTitle>
            <DialogDescription>מה שמוגדר כאן מוצג ללקוח בקופה לבחירה.</DialogDescription>
          </DialogHeader>
          {draft && (
            <form noValidate onSubmit={save} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="ship-name">שם השיטה</Label>
                <Input
                  id="ship-name"
                  value={draft.name}
                  maxLength={SHIPPING_NAME_MAX}
                  placeholder="למשל: שליח עד הבית"
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label>סוג</Label>
                <RadioGroup
                  dir="rtl"
                  value={draft.kind}
                  onValueChange={(value) =>
                    setDraft({ ...draft, kind: value as ShippingMethodKind })
                  }
                  className="grid grid-cols-2 gap-2"
                >
                  {(["delivery", "pickup"] as const).map((kind) => (
                    <label
                      key={kind}
                      className={cn(
                        "flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm transition-colors",
                        draft.kind === kind ? "border-primary bg-primary/5" : "border-border",
                      )}
                    >
                      <RadioGroupItem value={kind} className="mt-0.5" />
                      <span>
                        <span className="block font-semibold">{SHIPPING_KIND_LABEL[kind]}</span>
                        <span className="text-xs text-muted-foreground">
                          {kind === "delivery" ? "הלקוח ממלא כתובת" : "בלי כתובת — מכתובת העסק"}
                        </span>
                      </span>
                    </label>
                  ))}
                </RadioGroup>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ship-price">מחיר (₪)</Label>
                <Input
                  id="ship-price"
                  inputMode="decimal"
                  dir="ltr"
                  className="text-right"
                  value={draft.price}
                  placeholder="0 = חינם"
                  onChange={(event) => setDraft({ ...draft, price: event.target.value })}
                />
                {draft.kind === "delivery" && threshold ? (
                  <p className="text-xs text-muted-foreground">
                    חינם אוטומטית כשסכום המוצרים בסל מעל {formatIls(Number(threshold))}.
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ship-desc">הסבר ללקוח (לא חובה)</Label>
                <Textarea
                  id="ship-desc"
                  rows={2}
                  maxLength={SHIPPING_DESCRIPTION_MAX}
                  value={draft.description}
                  placeholder={
                    draft.kind === "pickup"
                      ? "ריק = כתובת העסק מההגדרות. למשל: א׳–ה׳ 9:00–17:00"
                      : "למשל: עד 3 ימי עסקים"
                  }
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={draft.isActive}
                  onCheckedChange={(next) => setDraft({ ...draft, isActive: next })}
                />
                מוצגת בקופה
              </label>
              {draftProblem && draft.name.trim() !== "" && (
                <p role="alert" className="text-xs font-medium text-destructive">
                  {draftProblem}
                </p>
              )}
              <DialogFooter className="gap-2 sm:justify-start">
                <Button type="submit" disabled={saving}>
                  {saving && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                  {draft.id ? "שמירה" : "הוספה"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setDraft(null)}>
                  ביטול
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* ---------- מחיקה ---------- */}
      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent dir="rtl" className="text-right">
          <AlertDialogHeader>
            <AlertDialogTitle>למחוק את "{deleting?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              השיטה תיעלם מהקופה. הזמנות שכבר נשלחו איתה שומרות את השם ואת המחיר. אפשר גם רק לכבות
              אותה (המתג "בקופה").
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:justify-start">
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void confirmDelete();
              }}
            >
              מחיקה
            </AlertDialogAction>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
