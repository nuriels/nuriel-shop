import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Hash,
  Loader2,
  PackagePlus,
  Pencil,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldOff,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
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
import { SerialReceiveDialog } from "@/components/serials/SerialReceiveDialog";
import {
  loadSerialProducts,
  loadSerialUnits,
  lookupSerial,
  removeSerial,
  renameSerial,
} from "@/lib/serials-data";
import {
  formatWarrantyDate,
  SERIALS_CHANGED,
  serialProblem,
  warrantyLabel,
  type ReceiveMode,
  type SerialLookupRow,
  type SerialProduct,
  type SerialUnit,
} from "@/lib/serials";
import { formatOrderDate } from "@/lib/orders";
import { cn } from "@/lib/utils";

/**
 * חלק 35: "מספרים סידוריים ואחריות" (/admin/inventory/serials) — מחסנאי,
 * מנהל ובעלים.
 *  • בדיקת אחריות: סריקת מספר סידורי → איזה מוצר, למי נמכר, ועד מתי האחריות.
 *  • המוצרים שדורשים מספר סידורי: קליטת סחורה (סריקה לכל יחידה), רישום
 *    יחידות שכבר במלאי, ורשימת היחידות (תיקון טעות / הוצאה מהמלאי).
 * מוצר עובר למספרים סידוריים בעריכת המוצר ("דורש מספר סידורי").
 */
export function SerialsPanel() {
  const [products, setProducts] = useState<SerialProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [receive, setReceive] = useState<{ product: SerialProduct; mode: ReceiveMode } | null>(
    null,
  );
  const [version, setVersion] = useState(0);

  const load = useCallback(async () => {
    try {
      setProducts(await loadSerialProducts());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "הטעינה נכשלה");
    }
  }, []);

  useEffect(() => {
    void load();
    const refresh = () => {
      void load();
      setVersion((n) => n + 1);
    };
    window.addEventListener(SERIALS_CHANGED, refresh);
    return () => window.removeEventListener(SERIALS_CHANGED, refresh);
  }, [load]);

  return (
    <div className="space-y-4" data-testid="serials-panel">
      <WarrantyLookup />

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Hash className="size-5 text-primary" aria-hidden="true" />
              מוצרים עם מספר סידורי
            </CardTitle>
            <CardDescription>
              מלאי של מוצר כזה עולה רק בקליטה — סריקת מספר סידורי לכל יחידה. בליקוט ובקופה סורקים את
              המספר של היחידה שנמכרה, והאחריות נרשמת ללקוח. להוספת מוצר: עריכת המוצר ← "דורש מספר
              סידורי".
            </CardDescription>
          </div>
          <Button variant="outline" size="icon" onClick={() => void load()} aria-label="רענון">
            <RefreshCw className="size-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {products === null && !error ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> טוען...
            </p>
          ) : products && products.length === 0 ? (
            <p className="rounded-lg bg-secondary/50 p-4 text-sm text-muted-foreground">
              עדיין אין מוצרים שדורשים מספר סידורי. פתחו מוצר (למשל מחשב, טלפון או מכשיר חשמלי)
              וסמנו "דורש מספר סידורי" ואת חודשי האחריות.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {(products ?? []).map((product) => (
                <li key={product.product_id} className="p-3" data-testid="serial-product-row">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <p className="font-semibold leading-snug">{product.name}</p>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        <Badge variant="secondary" data-testid="serial-product-instock">
                          במלאי עם מספר: {product.in_stock_serials}
                        </Badge>
                        <Badge variant="outline">נמכרו: {product.sold_serials}</Badge>
                        <Badge variant="outline">פנוי למכירה: {product.stock_quantity}</Badge>
                        {warrantyLabel(product.warranty_months) ? (
                          <Badge variant="outline" className="gap-1">
                            <ShieldCheck className="size-3" aria-hidden="true" />
                            {warrantyLabel(product.warranty_months)}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1 text-muted-foreground">
                            <ShieldOff className="size-3" aria-hidden="true" />
                            בלי אחריות
                          </Badge>
                        )}
                      </div>
                      {product.missing_serials > 0 && (
                        <p className="flex items-center gap-1 text-xs font-medium text-amber-800 dark:text-amber-300">
                          <AlertTriangle className="size-3.5" aria-hidden="true" />
                          {product.missing_serials} יחידות במלאי עדיין בלי מספר סידורי
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        onClick={() => setReceive({ product, mode: "receive" })}
                        data-testid="serial-receive-open"
                      >
                        <PackagePlus className="size-4" />
                        קליטת סחורה
                      </Button>
                      {product.missing_serials > 0 && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setReceive({ product, mode: "existing" })}
                        >
                          רישום יחידות קיימות
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setExpanded((current) =>
                            current === product.product_id ? null : product.product_id,
                          )
                        }
                        aria-expanded={expanded === product.product_id}
                        data-testid="serial-units-toggle"
                      >
                        {expanded === product.product_id ? (
                          <ChevronUp className="size-4" />
                        ) : (
                          <ChevronDown className="size-4" />
                        )}
                        יחידות
                      </Button>
                    </div>
                  </div>
                  {expanded === product.product_id && (
                    <SerialUnitsList
                      key={`${product.product_id}:${version}`}
                      productId={product.product_id}
                      onChanged={() => void load()}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {receive && (
        <SerialReceiveDialog
          open
          onOpenChange={(open) => !open && setReceive(null)}
          productId={receive.product.product_id}
          productName={receive.product.name}
          mode={receive.mode}
          missing={receive.product.missing_serials}
          onReceived={() => {
            void load();
            setVersion((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}

/** בדיקת אחריות: סריקה / הקלדה של מספר סידורי */
function WarrantyLookup() {
  const [term, setTerm] = useState("");
  const [rows, setRows] = useState<SerialLookupRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    if (term.trim().length < 2) {
      setError("הקלידו לפחות 2 תווים");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setRows(await lookupSerial(term));
    } catch (lookupError) {
      setError(lookupError instanceof Error ? lookupError.message : "החיפוש נכשל");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <ShieldCheck className="size-5 text-primary" aria-hidden="true" />
          בדיקת אחריות לפי מספר סידורי
        </CardTitle>
        <CardDescription>
          לקוח הגיע עם מוצר לתיקון? סרקו את המספר הסידורי — תראו מתי נמכר, למי, ועד מתי האחריות.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void search();
          }}
        >
          <Input
            dir="ltr"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="סרקו / הקלידו מספר סידורי"
            className="text-left font-mono placeholder:text-right placeholder:font-sans"
            aria-label="מספר סידורי לבדיקת אחריות"
            data-testid="warranty-lookup-input"
          />
          <Button type="submit" disabled={busy} data-testid="warranty-lookup-submit">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
            בדיקה
          </Button>
        </form>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {rows !== null &&
          (rows.length === 0 ? (
            <p className="rounded-lg bg-secondary/50 p-3 text-sm text-muted-foreground">
              לא נמצא מספר סידורי כזה בחנות.
            </p>
          ) : (
            <ul className="space-y-2" data-testid="warranty-lookup-results">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="rounded-lg border border-border p-3 text-sm"
                  data-testid="warranty-lookup-row"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span dir="ltr" className="font-mono font-semibold">
                      {row.serial_number}
                    </span>
                    {row.status === "sold" ? (
                      row.warranty_until ? (
                        <Badge
                          className={cn(
                            row.warranty_active
                              ? "bg-green-600 text-white hover:bg-green-600"
                              : "bg-destructive text-destructive-foreground hover:bg-destructive",
                          )}
                          data-testid="warranty-status"
                        >
                          {row.warranty_active
                            ? `באחריות עד ${formatWarrantyDate(row.warranty_until)}`
                            : `האחריות הסתיימה ב-${formatWarrantyDate(row.warranty_until)}`}
                        </Badge>
                      ) : (
                        <Badge variant="outline">נמכר — בלי אחריות</Badge>
                      )
                    ) : (
                      <Badge variant="secondary">במלאי (לא נמכר)</Badge>
                    )}
                  </div>
                  <p className="mt-1 font-medium">{row.product_name}</p>
                  <p className="text-xs text-muted-foreground">
                    נקלט {formatOrderDate(row.received_at)}
                    {row.sold_at && ` · נמכר ${formatOrderDate(row.sold_at)}`}
                    {row.order_number && ` · הזמנה ${row.order_number}`}
                    {row.customer_name && ` · ${row.customer_name}`}
                    {row.customer_phone && ` · ${row.customer_phone}`}
                  </p>
                </li>
              ))}
            </ul>
          ))}
      </CardContent>
    </Card>
  );
}

/** היחידות של מוצר: חיפוש, תיקון מספר, הוצאה מהמלאי */
function SerialUnitsList({ productId, onChanged }: { productId: string; onChanged: () => void }) {
  const [units, setUnits] = useState<SerialUnit[] | null>(null);
  const [status, setStatus] = useState<"all" | "in_stock" | "sold">("all");
  const [term, setTerm] = useState("");
  const [renaming, setRenaming] = useState<SerialUnit | null>(null);
  const [removing, setRemoving] = useState<SerialUnit | null>(null);

  const load = useCallback(async () => {
    try {
      setUnits(await loadSerialUnits(productId, status, term));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "הטעינה נכשלה");
      setUnits([]);
    }
  }, [productId, status, term]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 200);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <div className="mt-3 space-y-2 rounded-lg bg-secondary/30 p-3" data-testid="serial-units">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          dir="ltr"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="חיפוש מספר"
          className="h-8 w-44 text-left font-mono text-sm placeholder:text-right placeholder:font-sans"
          aria-label="חיפוש מספר סידורי"
        />
        {(
          [
            ["all", "הכל"],
            ["in_stock", "במלאי"],
            ["sold", "נמכרו"],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            size="sm"
            variant={status === value ? "default" : "outline"}
            className="h-8"
            onClick={() => setStatus(value)}
          >
            {label}
          </Button>
        ))}
      </div>
      {units === null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> טוען...
        </p>
      ) : units.length === 0 ? (
        <p className="text-sm text-muted-foreground">אין יחידות להצגה.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b border-border text-right">
                <th className="py-1.5 pe-2 font-medium">מספר סידורי</th>
                <th className="py-1.5 pe-2 font-medium">סטטוס</th>
                <th className="py-1.5 pe-2 font-medium">נקלט</th>
                <th className="py-1.5 pe-2 font-medium">הזמנה / אחריות</th>
                <th className="py-1.5 font-medium" aria-label="פעולות" />
              </tr>
            </thead>
            <tbody>
              {units.map((unit) => (
                <tr
                  key={unit.id}
                  className="border-b border-border/60 last:border-0"
                  data-testid="serial-unit-row"
                >
                  <td className="py-1.5 pe-2 font-mono" dir="ltr">
                    {unit.serial_number}
                  </td>
                  <td className="py-1.5 pe-2">
                    {unit.status === "sold" ? (
                      <Badge variant="outline">נמכר</Badge>
                    ) : (
                      <Badge variant="secondary">במלאי</Badge>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-1.5 pe-2 text-xs text-muted-foreground">
                    {formatOrderDate(unit.received_at).split(",")[0]}
                  </td>
                  <td className="py-1.5 pe-2 text-xs">
                    {unit.order_number ? (
                      <>
                        {unit.order_number}
                        {unit.customer_name && ` · ${unit.customer_name}`}
                        {unit.warranty_until && (
                          <span className="block text-muted-foreground">
                            אחריות עד {formatWarrantyDate(unit.warranty_until)}
                          </span>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-1.5 text-left">
                    {unit.status === "in_stock" && (
                      <span className="inline-flex gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7"
                          onClick={() => setRenaming(unit)}
                          aria-label={`תיקון ${unit.serial_number}`}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7 text-destructive"
                          onClick={() => setRemoving(unit)}
                          aria-label={`הסרת ${unit.serial_number}`}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <RenameSerialDialog
        unit={renaming}
        onClose={() => setRenaming(null)}
        onDone={() => {
          setRenaming(null);
          void load();
        }}
      />
      <RemoveSerialDialog
        unit={removing}
        onClose={() => setRemoving(null)}
        onDone={() => {
          setRemoving(null);
          void load();
          onChanged();
        }}
      />
    </div>
  );
}

function RenameSerialDialog({
  unit,
  onClose,
  onDone,
}: {
  unit: SerialUnit | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValue(unit?.serial_number ?? "");
    setError(null);
  }, [unit]);

  const save = async () => {
    if (!unit) return;
    const problem = serialProblem(value);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      const saved = await renameSerial(unit.id, value);
      toast.success(`המספר עודכן ל-${saved}`);
      onDone();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "העדכון נכשל");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={unit !== null} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent dir="rtl" className="max-w-sm">
        <DialogHeader className="text-right">
          <DialogTitle>תיקון מספר סידורי</DialogTitle>
          <DialogDescription>
            לטעות הקלדה ביחידה שבמלאי (יחידה שנמכרה — לא משתנה).
          </DialogDescription>
        </DialogHeader>
        <Input
          dir="ltr"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="text-left font-mono"
          aria-label="מספר סידורי"
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter className="gap-2 sm:justify-start">
          <Button onClick={() => void save()} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            שמירה
          </Button>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            ביטול
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RemoveSerialDialog({
  unit,
  onClose,
  onDone,
}: {
  unit: SerialUnit | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState<"writeoff" | "serial" | null>(null);

  const remove = async (writeOff: boolean) => {
    if (!unit) return;
    setBusy(writeOff ? "writeoff" : "serial");
    try {
      await removeSerial(unit.id, writeOff);
      toast.success(
        writeOff
          ? `${unit.serial_number} הוצא מהמלאי (המלאי ירד ביחידה)`
          : `המספר ${unit.serial_number} נמחק (המלאי לא השתנה)`,
      );
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ההסרה נכשלה");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={unit !== null} onOpenChange={(open) => !open && busy === null && onClose()}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader className="text-right">
          <DialogTitle>הסרת יחידה {unit?.serial_number}</DialogTitle>
          <DialogDescription>
            יחידה פגומה / אבדה, או מספר שנקלט ליחידה שלא הגיעה — מוציאים מהמלאי. מספר שנרשם בטעות
            ליחידה שכן על המדף — מוחקים רק את המספר (ורושמים אותה מחדש ב"רישום יחידות קיימות").
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button variant="destructive" onClick={() => void remove(true)} disabled={busy !== null}>
            {busy === "writeoff" && <Loader2 className="size-4 animate-spin" />}
            הוצאה מהמלאי (המלאי יורד ביחידה)
          </Button>
          <Button variant="outline" onClick={() => void remove(false)} disabled={busy !== null}>
            {busy === "serial" && <Loader2 className="size-4 animate-spin" />}
            מחיקת המספר בלבד (המלאי לא משתנה)
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={busy !== null}>
            ביטול
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
