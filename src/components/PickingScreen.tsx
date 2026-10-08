import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Barcode,
  Check,
  CheckCircle2,
  Loader2,
  MapPin,
  Package,
  Pause,
  Play,
  Printer,
  Undo2,
  UserRoundCog,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  approvePicking,
  fetchPickingLines,
  fetchPickingWorkers,
  locationLabel,
  markPickedItem,
  pickQuantityLabel,
  releaseOrder,
  setOrderPaused,
  transferOrder,
  type PickingLine,
  type PickingOrder,
  type PickingWorker,
  type Shortage,
} from "@/lib/picking";
import { OrderItemSerials } from "@/components/serials/OrderItemSerials";
import { supabase } from "@/integrations/supabase/client";

type SerialLine = {
  item_id: string;
  quantity: number;
  serial_required: boolean;
  serial_number: string | null;
  warranty_until: string | null;
};

/**
 * מסך ליקוט של הזמנה אחת — מותאם למסופון: טקסט וכפתורים גדולים, סימון ✓ לכל
 * שורה שנשמר מיד, סריקת ברקוד, כמות ביחידות ובארגזים, ואיתור במחסן.
 * הפעולות (השהיה / העברה / שחרור / אישור) נאכפות במסד — כאן רק הכפתורים.
 */
export function PickingScreen({
  order,
  meId,
  isAdmin,
  onBack,
  onChanged,
  onApproved,
}: {
  order: PickingOrder;
  meId: string;
  isAdmin: boolean;
  onBack: () => void;
  /** אחרי כל פעולה שמשנה את ההזמנה (לרענון הרשימות) */
  onChanged: () => void;
  /** אחרי אישור ליקוט — לשליחת המייל ללקוח */
  onApproved: (orderId: string, shortages: Shortage[], status: "picked" | "shipped") => void;
}) {
  const [lines, setLines] = useState<PickingLine[] | null>(null);
  const [workers, setWorkers] = useState<PickingWorker[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [scan, setScan] = useState("");
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [transferTo, setTransferTo] = useState<string>("");
  const scanRef = useRef<HTMLInputElement>(null);
  const readOnly = order.status !== "picking";
  const mine = order.picker_id === meId;
  const canAct = !readOnly && (mine || isAdmin);

  // חלק 35: שורות שדורשות מספר סידורי (מוצג מתחת לשורה — סריקה לכל יחידה)
  const [serialLines, setSerialLines] = useState<Map<string, SerialLine>>(new Map());
  const loadSerials = useCallback(async () => {
    const { data, error } = await supabase.rpc("order_serial_lines", { _order_id: order.id });
    if (error) return;
    setSerialLines(new Map((data ?? []).map((row) => [row.item_id, row])));
  }, [order.id]);

  const load = useCallback(async () => {
    try {
      setLines(await fetchPickingLines(order.id));
      void loadSerials();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "טעינת השורות נכשלה");
    }
  }, [order.id, loadSerials]);

  useEffect(() => {
    void load();
    void fetchPickingWorkers()
      .then(setWorkers)
      .catch(() => undefined);
  }, [load]);

  const progress = useMemo(() => {
    const total = lines?.length ?? 0;
    const done = lines?.filter((line) => line.picked).length ?? 0;
    const short =
      lines?.filter((line) => line.picked && (line.picked_qty ?? 0) < line.quantity) ?? [];
    return { total, done, short, complete: total > 0 && done === total };
  }, [lines]);

  const mark = async (line: PickingLine, qty: number | null) => {
    if (!canAct) return;
    // אופטימי: הסימון נראה מיד, ונשמר במסד ברקע
    setLines(
      (current) =>
        current?.map((l) =>
          l.item_id === line.item_id ? { ...l, picked: qty !== null, picked_qty: qty } : l,
        ) ?? null,
    );
    try {
      await markPickedItem(line.item_id, qty);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "השמירה נכשלה");
      void load();
    }
  };

  const onScan = async () => {
    const code = scan.trim();
    setScan("");
    if (!code || !lines) return;
    const line = lines.find((l) => l.barcode === code || l.sku === code);
    if (!line) {
      toast.error(`ברקוד ${code} לא נמצא בהזמנה הזו`);
      navigator.vibrate?.([80, 60, 80]);
      return;
    }
    await mark(line, line.quantity);
    toast.success(`✓ ${line.name}`);
    navigator.vibrate?.(30);
  };

  const run = async (key: string, action: () => Promise<void>, done?: string) => {
    setBusy(key);
    try {
      await action();
      if (done) toast.success(done);
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "הפעולה נכשלה");
    } finally {
      setBusy(null);
    }
  };

  const approve = async () => {
    setConfirmApprove(false);
    setBusy("approve");
    try {
      const result = await approvePicking(order.id);
      toast.success(
        result.status === "shipped"
          ? `ההזמנה ${order.order_number} לוקטה ואושרה`
          : `ההזמנה ${order.order_number} לוקטה — הועברה לאישור מנהל`,
      );
      onApproved(order.id, result.shortages, result.status);
      onChanged();
      onBack();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "אישור הליקוט נכשל");
    } finally {
      setBusy(null);
    }
  };

  const otherWorkers = workers.filter((w) => w.user_id !== order.picker_id && !w.is_blocked);

  return (
    <div className="space-y-4" dir="rtl">
      {/* ---------- כותרת ---------- */}
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
          <ArrowRight className="size-4" /> חזרה
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-1">
            <Printer className="size-4" /> הדפסת דף ליקוט
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-2xl font-bold text-foreground">
            הזמנה <span className="numeric">{order.order_number}</span>
          </h2>
          {order.is_urgent && (
            <span className="rounded-full bg-destructive px-2.5 py-0.5 text-sm font-bold text-destructive-foreground">
              דחוף
            </span>
          )}
          {order.picking_paused && (
            <span className="rounded-full bg-secondary px-2.5 py-0.5 text-sm font-medium">
              בהשהיה
            </span>
          )}
          {readOnly && (
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-sm font-medium text-primary">
              לוקטה ואושרה
            </span>
          )}
        </div>
        <p className="mt-1 text-lg font-semibold text-foreground">{order.customer_name}</p>
        <p className="text-sm text-muted-foreground">
          {[order.contact_name, order.customer_phone, order.customer_address]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {order.note && (
          <p className="mt-2 rounded-md bg-accent/10 p-2 text-sm">
            <span className="font-semibold">הערת הלקוח:</span> {order.note}
          </p>
        )}
        <p className="mt-2 text-sm text-muted-foreground">
          {order.picker_name ? `מלקט: ${order.picker_name}` : "עוד לא נלקחה לליקוט"}
          {order.approved_by_name ? ` · אישר: ${order.approved_by_name}` : ""}
        </p>
        {/* פס התקדמות */}
        <div className="mt-3 flex items-center gap-3">
          <div className="h-3 flex-1 overflow-hidden rounded-full bg-secondary">
            <div
              className={`h-full transition-all ${progress.complete ? "bg-primary" : "bg-accent"}`}
              style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
            />
          </div>
          <span className="numeric text-sm font-semibold">
            {progress.done}/{progress.total}
          </span>
        </div>
      </div>

      {/* ---------- סריקה ---------- */}
      {canAct && (
        <form
          className="flex gap-2 print:hidden"
          onSubmit={(event) => {
            event.preventDefault();
            void onScan();
          }}
        >
          <div className="relative flex-1">
            <Barcode className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={scanRef}
              value={scan}
              onChange={(event) => setScan(event.target.value)}
              placeholder="סריקת ברקוד — או הקלדה ו-Enter"
              inputMode="numeric"
              className="h-12 ps-10 text-lg"
              autoComplete="off"
            />
          </div>
          <Button type="submit" size="lg" variant="outline">
            סמן
          </Button>
        </form>
      )}

      {/* ---------- שורות ---------- */}
      {lines === null ? (
        <p className="flex items-center gap-2 py-8 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> טוען שורות...
        </p>
      ) : (
        <ul className="space-y-3">
          {lines.map((line) => {
            const short = line.picked && (line.picked_qty ?? 0) < line.quantity;
            return (
              <li
                key={line.item_id}
                className={`flex gap-3 rounded-xl border p-3 transition-colors ${
                  line.picked
                    ? short
                      ? "border-destructive/50 bg-destructive/5"
                      : "border-primary/40 bg-primary/5"
                    : "border-border bg-card"
                }`}
              >
                <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-secondary/60 sm:size-28">
                  {line.image_url ? (
                    <img
                      src={line.image_url}
                      alt=""
                      className="size-full object-contain mix-blend-multiply"
                      loading="lazy"
                    />
                  ) : (
                    <Package className="size-8 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-lg font-bold leading-snug text-foreground">{line.name}</p>
                  <p className="numeric text-sm text-muted-foreground" dir="ltr">
                    {line.barcode ?? line.sku ?? ""}
                  </p>
                  <p className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
                    <MapPin className="size-3.5" /> איתור:{" "}
                    {line.locations && line.locations.length > 0
                      ? line.locations.map((loc) => (
                          <span
                            key={loc.location}
                            className="rounded bg-secondary px-1.5 font-semibold text-foreground"
                          >
                            {loc.location} ({loc.quantity})
                          </span>
                        ))
                      : locationLabel(line.shelf_location)}
                  </p>
                  <p className="text-xl font-extrabold text-foreground">
                    {pickQuantityLabel(line.quantity, line.pack_size)}
                  </p>
                  {serialLines.has(line.item_id) && (
                    <div className="max-w-md pt-1">
                      <OrderItemSerials
                        item={{
                          id: line.item_id,
                          product_id: line.product_id,
                          product_name: line.name,
                          quantity: serialLines.get(line.item_id)!.quantity,
                          serial_number: serialLines.get(line.item_id)!.serial_number,
                          serial_required: serialLines.get(line.item_id)!.serial_required,
                          warranty_until: serialLines.get(line.item_id)!.warranty_until,
                        }}
                        orderStatus={order.status}
                        canEdit={canAct}
                        isManager={isAdmin}
                        onChanged={() => void loadSerials()}
                      />
                    </div>
                  )}
                  {canAct && (
                    <div className="flex flex-wrap items-center gap-2 pt-1 print:hidden">
                      <Button
                        size="lg"
                        variant={line.picked && !short ? "default" : "outline"}
                        className="h-12 min-w-28 gap-1 text-base"
                        onClick={() =>
                          void mark(line, line.picked && !short ? null : line.quantity)
                        }
                        aria-pressed={line.picked}
                      >
                        {line.picked && !short ? <Check className="size-5" /> : null}
                        {line.picked && !short ? "לוקט" : "סמן ✓"}
                      </Button>
                      <label className="flex items-center gap-1 text-sm">
                        לוקט בפועל
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={line.quantity}
                          step={line.pack_size && line.pack_size >= 2 ? line.pack_size : 1}
                          value={line.picked ? (line.picked_qty ?? "") : ""}
                          placeholder={String(line.quantity)}
                          onChange={(event) => {
                            const value = event.target.value.trim();
                            if (value === "") return void mark(line, null);
                            const qty = Math.max(0, Math.min(line.quantity, Number(value)));
                            void mark(line, Number.isFinite(qty) ? qty : null);
                          }}
                          className="h-12 w-24 text-center text-lg"
                        />
                      </label>
                      {short && (
                        <span className="rounded-md bg-destructive px-2 py-1 text-sm font-bold text-destructive-foreground">
                          חסר {line.quantity - (line.picked_qty ?? 0)}
                        </span>
                      )}
                    </div>
                  )}
                  {!canAct && line.picked && (
                    <p className="text-sm font-medium">
                      לוקט: {line.picked_qty}/{line.quantity}
                      {short ? " · חסר" : ""}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* ---------- פעולות ---------- */}
      {canAct && (
        <div className="sticky bottom-0 -mx-3 space-y-2 border-t border-border bg-background/95 p-3 backdrop-blur print:hidden sm:mx-0 sm:rounded-xl sm:border">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="gap-1"
              disabled={busy !== null}
              onClick={() =>
                void run(
                  "pause",
                  () => setOrderPaused(order.id, !order.picking_paused),
                  order.picking_paused ? "ממשיכים" : "ההזמנה בהשהיה — נשארת אצלך",
                )
              }
            >
              {order.picking_paused ? <Play className="size-4" /> : <Pause className="size-4" />}
              {order.picking_paused ? "המשך ליקוט" : "השהיה"}
            </Button>
            <div className="flex items-center gap-1">
              <Select value={transferTo} onValueChange={setTransferTo}>
                <SelectTrigger className="w-44" aria-label="העבר לעובד">
                  <SelectValue placeholder="העבר לעובד..." />
                </SelectTrigger>
                <SelectContent>
                  {otherWorkers.length === 0 && (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">אין עובד אחר</div>
                  )}
                  {otherWorkers.map((w) => (
                    <SelectItem key={w.user_id} value={w.user_id}>
                      {w.name} {w.active_orders > 0 ? `(${w.active_orders} בליקוט)` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                className="gap-1"
                disabled={!transferTo || busy !== null}
                onClick={() =>
                  void run(
                    "transfer",
                    () => transferOrder(order.id, transferTo),
                    "ההזמנה הועברה",
                  ).then(onBack)
                }
              >
                <Users className="size-4" /> העבר
              </Button>
            </div>
            <Button
              variant="ghost"
              className="gap-1 text-muted-foreground"
              disabled={busy !== null}
              onClick={() =>
                void run("release", () => releaseOrder(order.id), "ההזמנה חזרה לרשימה").then(onBack)
              }
            >
              <Undo2 className="size-4" /> שחרר
            </Button>
          </div>
          <Button
            size="lg"
            className="h-14 w-full gap-2 text-lg"
            disabled={!progress.complete || busy !== null}
            onClick={() => setConfirmApprove(true)}
          >
            {busy === "approve" ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <CheckCircle2 className="size-5" />
            )}
            {isAdmin && !mine ? "אישור ליקוט במקום העובד" : "אישור ליקוט"}
            {!progress.complete && progress.total > 0
              ? ` (נשארו ${progress.total - progress.done})`
              : ""}
          </Button>
        </div>
      )}

      <AlertDialog open={confirmApprove} onOpenChange={setConfirmApprove}>
        <AlertDialogContent dir="rtl" className="text-right">
          <AlertDialogHeader className="text-right">
            <AlertDialogTitle>לאשר את הליקוט של הזמנה {order.order_number}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-right text-sm">
                {progress.short.length > 0 ? (
                  <>
                    <p className="font-semibold text-destructive">
                      יש {progress.short.length} שורות עם חוסר:
                    </p>
                    <ul className="list-disc ps-5">
                      {progress.short.map((line) => (
                        <li key={line.item_id}>
                          {line.name}: לוקטו {line.picked_qty} מתוך {line.quantity}
                        </li>
                      ))}
                    </ul>
                    <p>ההזמנה תעודכן לכמויות שלוקטו, והלקוח יקבל במייל מה חסר.</p>
                  </>
                ) : (
                  <p>כל השורות לוקטו במלואן.</p>
                )}
                <p>
                  {isAdmin
                    ? 'ההזמנה תסומן כ"נשלחה / בוצעה", והלקוח יקבל מייל עם סיכום ו-PDF.'
                    : "ההזמנה תעבור לאישור מנהל, ואחריו יישלח ללקוח מייל שהיא בדרך."}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={() => void approve()}>אישור ליקוט</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---------- דף ליקוט להדפסה ---------- */}
      <table className="hidden w-full border-collapse text-sm print:table">
        <thead>
          <tr className="border-b">
            <th className="p-1 text-right">✓</th>
            <th className="p-1 text-right">איתור</th>
            <th className="p-1 text-right">מוצר</th>
            <th className="p-1 text-right">ברקוד</th>
            <th className="p-1 text-right">כמות</th>
          </tr>
        </thead>
        <tbody>
          {(lines ?? []).map((line) => (
            <tr key={line.item_id} className="border-b">
              <td className="p-1">☐</td>
              <td className="p-1">
                {line.locations && line.locations.length > 0
                  ? line.locations.map((loc) => `${loc.location} (${loc.quantity})`).join(" · ")
                  : locationLabel(line.shelf_location)}
              </td>
              <td className="p-1">{line.name}</td>
              <td className="p-1" dir="ltr">
                {line.barcode ?? line.sku ?? ""}
              </td>
              <td className="p-1">{pickQuantityLabel(line.quantity, line.pack_size)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hidden text-xs text-muted-foreground print:block">
        <UserRoundCog className="inline size-3" /> מלקט: {order.picker_name ?? "________"} · הודפס{" "}
        {new Date().toLocaleString("he-IL")}
      </p>
    </div>
  );
}
