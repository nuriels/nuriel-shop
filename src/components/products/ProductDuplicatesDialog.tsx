import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  EyeOff,
  ImageOff,
  Loader2,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ecommerceAiStatus } from "@/lib/ai-assistant.functions";
import {
  AI_CONFIDENCE_LABELS,
  AI_MAX_PRODUCTS,
  AI_REASON_LABELS,
  KEEP_REASON_LABELS,
  REASON_LABELS,
  defaultKeepId,
  mustHide,
  planMerge,
  type AiSuggestion,
  type DuplicateGroup,
  type DuplicateProduct,
  type MergeOutcome,
  type StockMode,
} from "@/lib/product-duplicates";
import {
  productDuplicateCards,
  productDuplicateDismiss,
  productDuplicateDismissalsClear,
  productDuplicateGroups,
  productMerge,
} from "@/lib/product-duplicates.functions";
import { productDuplicatesAiSuggest } from "@/lib/product-duplicates-ai.functions";
import type { AssistantStatusView } from "@/platform/ai/logic";

/**
 * מוצרים כפולים (Ecommerce) — כפתור בקטלוג המוצרים שפותח חלון:
 *  • "כפילויות שנמצאו": קבוצות של מוצרים עם אותו שם / אותה תמונה / אותו ברקוד (מהמסד).
 *  • "הצעות AI": לחנויות עם התוסף NURIEL AI — הצעות למוצרים שנראים כפולים גם בשמות שונים.
 * בכל קבוצה בוחרים איזה מוצר נשאר, איזו כמות, ומה קורה לשאר (נמחקים, או מוסתרים — חובה כשיש הזמנות).
 * המיזוג נעשה רק אחרי אישור, במסד, בפעולה אחת (הכול או כלום) ועם יומן לשחזור.
 */

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "הפעולה לא הושלמה. נסו שוב.";
}

const money = (value: number | null) =>
  value === null ? "—" : `₪${value.toLocaleString("he-IL", { maximumFractionDigits: 2 })}`;

const dateText = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("he-IL");
};

export function ProductDuplicatesDialog({
  onMerged,
  refreshKey = 0,
  productCount,
  categories = [],
}: {
  onMerged: () => void;
  /** משתנה אחרי טעינה מחדש של הקטלוג (ייבוא / מחיקה) — הספירה בכפתור מתעדכנת */
  refreshKey?: number;
  productCount: number;
  categories?: string[];
}) {
  const loadGroups = useServerFn(productDuplicateGroups);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"found" | "ai">("found");
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await loadGroups();
      setGroups(result.groups);
      setTotal(result.total);
    } catch (error) {
      setLoadError(errorText(error));
    } finally {
      setLoading(false);
    }
  }, [loadGroups]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  const [results, setResults] = useState<MergeOutcome[]>([]);
  const resultsRef = useRef<HTMLDivElement>(null);
  const afterMerge = useCallback(
    (outcome: MergeOutcome) => {
      setResults((prev) => [outcome, ...prev].slice(0, 10));
      onMerged();
      void refresh();
      // הקבוצה נעלמת מהרשימה — הפוקוס עובר לסיכום המיזוג
      window.setTimeout(() => resultsRef.current?.focus(), 0);
    },
    [onMerged, refresh],
  );

  const count = groups?.length ?? 0;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setOpen(true);
          void refresh();
        }}
        data-testid="open-duplicates"
      >
        <Copy className="size-4" aria-hidden="true" />
        מוצרים כפולים
        {count > 0 && (
          <Badge variant="destructive" className="ms-1 px-1.5" aria-label={`${count} קבוצות`}>
            {count}
          </Badge>
        )}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          dir="rtl"
          className="max-h-[92vh] grid-cols-[minmax(0,1fr)] overflow-y-auto text-right sm:max-w-4xl"
        >
          <DialogHeader className="text-right">
            <DialogTitle className="flex items-center gap-2">
              <Copy className="size-5 text-primary" aria-hidden="true" />
              מוצרים כפולים
            </DialogTitle>
            <DialogDescription>
              מוצרים שנראים כמו אותו מוצר שנוסף יותר מפעם אחת. בכל קבוצה בוחרים איזה מוצר נשאר ואיזו
              כמות תהיה לו. הביקורות, המוצרים הקשורים והמחירים המיוחדים עוברים אליו, ושאר המוצרים
              נמחקים — או מוסתרים, אם יש להם הזמנות. שום דבר לא משתנה בלי אישור.
            </DialogDescription>
          </DialogHeader>

          {results.length > 0 && (
            <div
              ref={resultsRef}
              tabIndex={-1}
              className="space-y-2 outline-none"
              aria-label="מיזוגים שבוצעו"
            >
              {results.map((done) => (
                <MergeDone key={done.mergeId} done={done} />
              ))}
            </div>
          )}

          <Tabs value={tab} onValueChange={(v) => setTab(v as "found" | "ai")} dir="rtl">
            <TabsList className="flex-wrap">
              <TabsTrigger value="found">כפילויות שנמצאו ({count})</TabsTrigger>
              <TabsTrigger value="ai">
                <Sparkles className="me-1 size-4" aria-hidden="true" />
                הצעות AI
              </TabsTrigger>
            </TabsList>

            <TabsContent value="found" className="mt-4 space-y-4">
              <div aria-live="polite" className="sr-only">
                {loading ? "טוען את המוצרים הכפולים" : groups ? `${count} קבוצות` : ""}
              </div>
              {loadError && (
                <p
                  role="alert"
                  className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
                >
                  {loadError}
                </p>
              )}
              {loading && groups === null ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  בודקים את הקטלוג…
                </p>
              ) : groups && groups.length === 0 ? (
                <div className="rounded-xl border border-dashed p-6 text-center">
                  <CheckCircle2
                    className="mx-auto mb-2 size-8 text-emerald-600"
                    aria-hidden="true"
                  />
                  <p className="font-medium">לא נמצאו מוצרים כפולים בחנות</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    נבדקו מוצרים עם אותו שם, אותה תמונה או אותו ברקוד. מוצרים עם שמות שונים —
                    בלשונית "הצעות AI".
                  </p>
                </div>
              ) : (
                (groups ?? []).map((group) => (
                  <DuplicateGroupCard
                    key={group.key}
                    products={group.products}
                    reasons={group.reasons.map((r) => REASON_LABELS[r])}
                    onDone={afterMerge}
                    onDismissed={() => void refresh()}
                  />
                ))
              )}
              {total > count && (
                <p className="text-sm text-muted-foreground">
                  מוצגות {count} הקבוצות הראשונות מתוך {total}. אחרי המיזוג יופיעו הבאות.
                </p>
              )}
              <ClearDismissals onCleared={() => void refresh()} />
            </TabsContent>

            <TabsContent value="ai" className="mt-4">
              {tab === "ai" && (
                <AiSuggestionsPanel
                  productCount={productCount}
                  categories={categories}
                  onMerged={afterMerge}
                />
              )}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ClearDismissals({ onCleared }: { onCleared: () => void }) {
  const clear = useServerFn(productDuplicateDismissalsClear);
  const [busy, setBusy] = useState(false);
  return (
    <div className="border-t pt-3">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const result = await clear();
            toast.success(
              result.cleared > 0
                ? `${result.cleared} קבוצות שסומנו "לא כפול" יוצגו שוב`
                : 'אין קבוצות שסומנו "לא כפול"',
            );
            onCleared();
          } catch (error) {
            toast.error(errorText(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <RotateCcw className="size-4" aria-hidden="true" />
        להציג שוב קבוצות שסומנו "לא כפול"
      </Button>
    </div>
  );
}

function MergeDone({ done }: { done: MergeOutcome }) {
  return (
    <div
      role="status"
      className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100"
    >
      <p className="flex items-center gap-2 font-semibold">
        <CheckCircle2 className="size-5 shrink-0" aria-hidden="true" />
        המיזוג הושלם: נשאר "{done.keptName}" עם כמות {done.stockAfter}
      </p>
      <p className="mt-1">
        {done.deleted > 0 && `נמחקו ${done.deleted}. `}
        {done.hidden > 0 && `הוסתרו ${done.hidden}. `}
        עברו למוצר שנשאר: {done.moved.reviews} ביקורות, {done.moved.relations} מוצרים קשורים,{" "}
        {done.moved.customPrices} מחירים מיוחדים ו-{done.moved.giftPromotions} מבצעי מתנה.
        {done.reviewsLeft > 0 &&
          ` ${done.reviewsLeft} ביקורות של לקוחות שכבר כתבו על המוצר שנשאר לא עברו.`}
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ קבוצה אחת: הבחירות והמיזוג

export function DuplicateGroupCard({
  products,
  reasons,
  note,
  onDone,
  onDismissed,
}: {
  products: DuplicateProduct[];
  reasons: string[];
  /** הסבר נוסף מעל הקבוצה (בהצעות ה-AI: הסיבה ורמת הביטחון) */
  note?: ReactNode;
  onDone: (outcome: MergeOutcome) => void;
  onDismissed: () => void;
}) {
  const merge = useServerFn(productMerge);
  const dismiss = useServerFn(productDuplicateDismiss);
  const baseId = useId();
  const [keepId, setKeepId] = useState<string>(() => defaultKeepId(products) ?? "");
  const [mode, setMode] = useState<StockMode>("keep");
  const [fromId, setFromId] = useState<string>(() => products[0]?.id ?? "");
  const [custom, setCustom] = useState<string>("");
  const [hideIds, setHideIds] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const customNumber = custom.trim() === "" ? null : Number(custom);
  const plan = useMemo(
    () => planMerge(products, keepId, mode, fromId, customNumber, hideIds),
    [products, keepId, mode, fromId, customNumber, hideIds],
  );
  const kept = products.find((p) => p.id === keepId);
  const sum = products.reduce((s, p) => s + Math.max(0, p.stock), 0);

  async function onDismiss() {
    setBusy(true);
    setError(null);
    try {
      await dismiss({ data: { ids: products.map((p) => p.id) } });
      toast.success('סומן "לא כפול" — הקבוצה לא תוצג שוב');
      onDismissed();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function onMerge() {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await merge({
        data: {
          keep: keepId,
          others: products.filter((p) => p.id !== keepId).map((p) => p.id),
          stockMode: mode,
          stockFrom: mode === "from" ? fromId : null,
          stock: mode === "custom" ? customNumber : null,
          hide: [...hideIds].filter((id) => id !== keepId),
        },
      });
      toast.success("המוצרים מוזגו");
      onDone(outcome);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  const keepLabelId = `${baseId}-keep`;
  const stockLabelId = `${baseId}-stock`;

  return (
    <section
      className="space-y-4 rounded-xl border bg-card p-4"
      aria-label={`קבוצה של ${products.length} מוצרים`}
      data-testid="duplicate-group"
    >
      <div className="flex flex-wrap items-center gap-2">
        {reasons.map((reason) => (
          <Badge key={reason} variant="secondary">
            {reason}
          </Badge>
        ))}
        <span className="text-xs text-muted-foreground">{products.length} מוצרים</span>
      </div>
      {note}

      <div>
        <p id={keepLabelId} className="mb-2 text-sm font-medium">
          איזה מוצר להשאיר?
        </p>
        <RadioGroup
          value={keepId}
          onValueChange={setKeepId}
          aria-labelledby={keepLabelId}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          dir="rtl"
        >
          {products.map((p) => {
            const isKept = p.id === keepId;
            const forced = mustHide(p);
            const radioId = `${baseId}-k-${p.id}`;
            return (
              <div
                key={p.id}
                className={`rounded-lg border p-3 text-sm ${isKept ? "border-primary ring-2 ring-primary/30" : ""}`}
              >
                <div className="flex items-start gap-3">
                  <RadioGroupItem value={p.id} id={radioId} className="mt-1" />
                  {p.imageUrl ? (
                    <img
                      src={p.imageUrl}
                      alt=""
                      loading="lazy"
                      className="size-14 shrink-0 rounded-md border object-cover"
                    />
                  ) : (
                    <span className="flex size-14 shrink-0 items-center justify-center rounded-md border bg-muted">
                      <ImageOff className="size-5 text-muted-foreground" aria-hidden="true" />
                    </span>
                  )}
                  <Label
                    htmlFor={radioId}
                    className="min-w-0 flex-1 cursor-pointer space-y-1 font-normal"
                  >
                    <span className="block font-medium leading-snug break-words">{p.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      מק"ט <span dir="ltr">{p.sku}</span> · נוסף {dateText(p.createdAt)}
                    </span>
                    <span className="block text-xs">
                      {money(p.price)} · כמות {p.stock} · {p.orders} הזמנות · {p.reviews} ביקורות
                    </span>
                    <span className="flex flex-wrap gap-1 pt-0.5">
                      {isKept && <Badge>נשאר</Badge>}
                      {p.hidden && <Badge variant="outline">מוסתר</Badge>}
                      {p.outOfStock && <Badge variant="outline">אזל</Badge>}
                      {p.requiresSerial && <Badge variant="outline">מספרים סידוריים</Badge>}
                    </span>
                  </Label>
                </div>
                {!isKept && (
                  <div className="mt-2 border-t pt-2 text-xs">
                    {forced ? (
                      <p className="flex items-center gap-1 text-amber-800 dark:text-amber-300">
                        <EyeOff className="size-3.5" aria-hidden="true" />
                        יוסתר, לא יימחק:{" "}
                        {p.keepReasons.map((r) => KEEP_REASON_LABELS[r]).join(", ")}
                      </p>
                    ) : (
                      <label className="flex cursor-pointer items-center gap-2">
                        <Checkbox
                          checked={hideIds.has(p.id)}
                          onCheckedChange={(checked) =>
                            setHideIds((prev) => {
                              const next = new Set(prev);
                              if (checked === true) next.add(p.id);
                              else next.delete(p.id);
                              return next;
                            })
                          }
                          aria-label={`להסתיר את "${p.name}" במקום למחוק`}
                        />
                        להסתיר במקום למחוק
                      </label>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </RadioGroup>
      </div>

      <fieldset className="space-y-2">
        <legend id={stockLabelId} className="mb-1 text-sm font-medium">
          הכמות של המוצר שנשאר
        </legend>
        <RadioGroup
          value={mode}
          onValueChange={(v) => setMode(v as StockMode)}
          aria-labelledby={stockLabelId}
          className="space-y-2"
          dir="rtl"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="keep" id={`${baseId}-m-keep`} />
            <Label htmlFor={`${baseId}-m-keep`} className="font-normal">
              להשאיר את הכמות שלו ({kept?.stock ?? 0})
            </Label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <RadioGroupItem value="from" id={`${baseId}-m-from`} />
            <Label htmlFor={`${baseId}-m-from`} className="font-normal">
              לקחת את הכמות מ:
            </Label>
            <select
              aria-label="מאיזה מוצר לקחת את הכמות"
              className="h-9 max-w-full rounded-md border bg-background px-2 text-sm"
              value={fromId}
              onChange={(e) => {
                setFromId(e.target.value);
                setMode("from");
              }}
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name.slice(0, 50)} ({p.stock})
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="sum" id={`${baseId}-m-sum`} />
            <Label htmlFor={`${baseId}-m-sum`} className="font-normal">
              לחבר את הכמויות (סה"כ {sum})
            </Label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <RadioGroupItem value="custom" id={`${baseId}-m-custom`} />
            <Label htmlFor={`${baseId}-m-custom`} className="font-normal">
              כמות אחרת:
            </Label>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              max={9_999_999}
              step={1}
              value={custom}
              onChange={(e) => {
                setCustom(e.target.value);
                setMode("custom");
              }}
              aria-label="כמות אחרת"
              className="h-9 w-28"
              dir="ltr"
            />
          </div>
        </RadioGroup>
      </fieldset>

      {plan?.serialBlocked && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          למוצר שנשאר יש מספר סידורי לכל יחידה, ולכן אי אפשר להוסיף לו כמות במיזוג (מוסיפים ב"קליטת
          סחורה"). בחרו "להשאיר את הכמות שלו".
        </p>
      )}
      {plan && (
        <p className="rounded-lg bg-muted p-3 text-sm" aria-live="polite">
          אחרי המיזוג: נשאר "{plan.kept.name}" עם כמות {plan.stockAfter}.
          {plan.deleted.length > 0 && ` יימחקו ${plan.deleted.length}.`}
          {plan.hidden.length > 0 && ` יוסתרו ${plan.hidden.length}.`}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={busy || !plan || plan.serialBlocked}
          onClick={() => setConfirming(true)}
        >
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          מיזוג…
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void onDismiss()}
        >
          לא כפול
        </Button>
      </div>

      <AlertDialog open={confirming} onOpenChange={(next) => !busy && setConfirming(next)}>
        <AlertDialogContent dir="rtl" className="text-right">
          <AlertDialogHeader className="text-right">
            <AlertDialogTitle>למזג את המוצרים?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                {plan && (
                  <>
                    <p>
                      נשאר: <strong>{plan.kept.name}</strong> — כמות {plan.stockAfter}.
                    </p>
                    {plan.deleted.length > 0 && (
                      <p>יימחקו: {plan.deleted.map((p) => `"${p.name}"`).join(", ")}.</p>
                    )}
                    {plan.hidden.length > 0 && (
                      <p>יוסתרו (בלי כמות): {plan.hidden.map((p) => `"${p.name}"`).join(", ")}.</p>
                    )}
                    <p>
                      ביקורות, מוצרים קשורים, מחירים מיוחדים ומבצעי מתנה יעברו למוצר שנשאר. ההזמנות
                      הקיימות לא משתנות.
                    </p>
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:justify-start">
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void onMerge();
              }}
            >
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              כן, למזג
            </AlertDialogAction>
            <AlertDialogCancel disabled={busy}>ביטול</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

// ------------------------------------------------------------------ הצעות ה-AI

type AiState =
  | { kind: "idle" }
  | { kind: "loading" }
  | {
      kind: "ok";
      suggestions: AiSuggestion[];
      cards: Map<string, DuplicateProduct>;
      checked: number;
      total: number;
    }
  | { kind: "message"; message: string };

function AiSuggestionsPanel({
  productCount,
  categories,
  onMerged,
}: {
  productCount: number;
  categories: string[];
  onMerged: (outcome: MergeOutcome) => void;
}) {
  const loadStatus = useServerFn(ecommerceAiStatus);
  const suggest = useServerFn(productDuplicatesAiSuggest);
  const loadCards = useServerFn(productDuplicateCards);
  const [status, setStatus] = useState<AssistantStatusView | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [category, setCategory] = useState("");
  const [state, setState] = useState<AiState>({ kind: "idle" });
  const [handled, setHandled] = useState<Set<number>>(new Set());
  const needsCategory = productCount > AI_MAX_PRODUCTS;

  useEffect(() => {
    let cancelled = false;
    loadStatus()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch((e) => {
        if (!cancelled) setStatusError(errorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [loadStatus]);

  async function run() {
    setState({ kind: "loading" });
    setHandled(new Set());
    try {
      const result = await suggest({ data: { category: category || null } });
      if (result.status !== "ok") {
        setState({ kind: "message", message: result.message });
        return;
      }
      const ids = [...new Set(result.suggestions.flatMap((s) => s.ids))];
      const cards = new Map<string, DuplicateProduct>();
      if (ids.length > 0) {
        for (const card of await loadCards({ data: { ids } })) cards.set(card.id, card);
      }
      setState({
        kind: "ok",
        suggestions: result.suggestions,
        cards,
        checked: result.checked,
        total: result.total,
      });
    } catch (e) {
      setState({ kind: "message", message: errorText(e) });
    }
  }

  if (statusError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {statusError}
      </p>
    );
  }
  if (!status) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        בודקים את התוסף…
      </p>
    );
  }
  if (!status.visible || !status.available) {
    return (
      <div className="rounded-xl border border-dashed p-5 text-sm" data-testid="ai-duplicates-off">
        <p className="flex items-center gap-2 font-medium">
          <Sparkles className="size-4 text-primary" aria-hidden="true" />
          הצעות AI זמינות בחנויות עם התוסף NURIEL AI
        </p>
        <p className="mt-2 text-muted-foreground">
          ה-AI עובר על שמות המוצרים ומציע מוצרים שנראים כמו אותו מוצר גם כשהשם שונה (ניסוח אחר,
          שגיאת כתיב, דגם שנוסף שוב). ההחלטה תמיד שלכם.
        </p>
        <p className="mt-2">
          {status.visible && status.message
            ? status.message
            : "להפעלת התוסף פנו לצוות NURIEL COMPUTERS. הכפילויות עם אותו שם, תמונה או ברקוד מוצגות גם בלי התוסף."}
        </p>
      </div>
    );
  }

  const visibleSuggestions =
    state.kind === "ok"
      ? state.suggestions
          .map((s, index) => ({ s, index, products: s.ids.map((id) => state.cards.get(id)) }))
          .filter(
            (x): x is { s: AiSuggestion; index: number; products: DuplicateProduct[] } =>
              !handled.has(x.index) &&
              x.products.every((p) => p !== undefined) &&
              x.products.length >= 2,
          )
      : [];

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-muted/40 p-4 text-sm">
        <p>
          ה-AI עובר על השם, המק"ט, המחיר והקטגוריה של{" "}
          {needsCategory ? `עד ${AI_MAX_PRODUCTS}` : "כל"} המוצרים ומציע מוצרים שנראים כפולים גם
          כשהשם שונה. שום דבר לא מתמזג בלי האישור שלכם. אפשר לבדוק עד 3 פעמים ב-10 דקות.
        </p>
        {status.notice && (
          <p className="mt-2 text-amber-800 dark:text-amber-300">{status.notice}</p>
        )}
        <div className="mt-3 flex flex-wrap items-end gap-2">
          {needsCategory && categories.length > 0 && (
            <div className="space-y-1">
              <Label htmlFor="ai-dup-category">קטגוריה לבדיקה</Label>
              <select
                id="ai-dup-category"
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">{AI_MAX_PRODUCTS} המוצרים האחרונים</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          )}
          <Button
            type="button"
            size="sm"
            onClick={() => void run()}
            disabled={state.kind === "loading"}
          >
            {state.kind === "loading" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles className="size-4" aria-hidden="true" />
            )}
            בדיקה עם AI
          </Button>
        </div>
      </div>

      <div aria-live="polite" className="space-y-4">
        {state.kind === "loading" && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ה-AI בודק את המוצרים…
          </p>
        )}
        {state.kind === "message" && (
          <p role="alert" className="rounded-lg border p-3 text-sm">
            {state.message}
          </p>
        )}
        {state.kind === "ok" && (
          <p className="text-sm text-muted-foreground">
            נבדקו {state.checked} מוצרים
            {state.total > state.checked ? ` מתוך ${state.total}` : ""}.{" "}
            {visibleSuggestions.length === 0
              ? "ה-AI לא מצא מוצרים שנראים כפולים."
              : `${visibleSuggestions.length} הצעות.`}
          </p>
        )}
        {visibleSuggestions.map(({ s, index, products }) => (
          <DuplicateGroupCard
            key={`${index}-${s.ids.join(",")}`}
            products={products}
            reasons={["הצעת AI"]}
            note={
              <p className="text-sm">
                {AI_REASON_LABELS[s.reason]} ·{" "}
                <span className="text-muted-foreground">{AI_CONFIDENCE_LABELS[s.confidence]}</span>
              </p>
            }
            onDone={(outcome) => {
              setHandled((prev) => new Set(prev).add(index));
              onMerged(outcome);
            }}
            onDismissed={() => setHandled((prev) => new Set(prev).add(index))}
          />
        ))}
      </div>
    </div>
  );
}
