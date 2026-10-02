import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  FileClock,
  Loader2,
  MapPin,
  Package,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StockSearch } from "@/components/StockSearch";
import {
  approveTransfer,
  cancelTransfer,
  createTransfer,
  deleteTransferLine,
  fetchLocations,
  fetchTransferLines,
  fetchTransfers,
  lookupStock,
  saveTransferLine,
  unitsLabel,
  type LocationSummary,
  type StockItem,
  type TransferLine,
  type TransferSummary,
} from "@/lib/locations";

/**
 * העברה בין איתורים — למחסנאי ולמנהל. כל שורה נשמרת מיד בטיוטה; "אישור העברה"
 * מבצע את כל השורות יחד. המסד בודק בשורה וגם באישור: לא יותר ממה שפנוי
 * באיתור המקור (כמות שמורה להזמנות לא נמצאת בשום איתור), לא לאותו איתור.
 */
export function TransfersPanel() {
  const [tab, setTab] = useState("new");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [lines, setLines] = useState<TransferLine[]>([]);
  const [drafts, setDrafts] = useState<TransferSummary[] | null>(null);
  const [history, setHistory] = useState<TransferSummary[] | null>(null);
  const [locations, setLocations] = useState<LocationSummary[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const loadLists = useCallback(async () => {
    try {
      const [d, h, l] = await Promise.all([
        fetchTransfers("draft"),
        fetchTransfers("approved"),
        fetchLocations(),
      ]);
      setDrafts(d);
      setHistory(h);
      setLocations(l);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "טעינת ההעברות נכשלה");
    }
  }, []);

  const loadDraft = useCallback(async (id: string) => {
    setDraftId(id);
    setLines(await fetchTransferLines(id));
  }, []);

  useEffect(() => {
    void loadLists();
  }, [loadLists]);

  const ensureDraft = async (): Promise<string> => {
    if (draftId) return draftId;
    const id = await createTransfer();
    setDraftId(id);
    return id;
  };

  const approve = async () => {
    if (!draftId) return;
    setBusy("approve");
    try {
      const n = await approveTransfer(draftId);
      toast.success(`ההעברה אושרה — ${n} שורות עודכנו במלאי`);
      setDraftId(null);
      setLines([]);
      await loadLists();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "האישור נכשל");
      if (draftId) setLines(await fetchTransferLines(draftId));
    } finally {
      setBusy(null);
    }
  };

  const cancel = async (id: string) => {
    if (!window.confirm("לבטל את הטיוטה? השורות יימחקו והמלאי לא יזוז.")) return;
    try {
      await cancelTransfer(id);
      if (id === draftId) {
        setDraftId(null);
        setLines([]);
      }
      await loadLists();
      toast.success("הטיוטה בוטלה");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "הביטול נכשל");
    }
  };

  return (
    <div className="space-y-4" dir="rtl">
      <h2 className="text-xl font-bold text-foreground">העברה בין איתורים</h2>
      <Tabs value={tab} onValueChange={setTab} dir="rtl" className="space-y-4">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="new">{draftId ? "ההעברה הפתוחה" : "העברה חדשה"}</TabsTrigger>
          <TabsTrigger value="drafts">
            טיוטות{" "}
            {drafts && drafts.length > 0 && <span className="numeric ms-1">({drafts.length})</span>}
          </TabsTrigger>
          <TabsTrigger value="history">היסטוריה</TabsTrigger>
        </TabsList>

        <TabsContent value="new" className="space-y-4">
          <LineEditor
            key={draftId ?? "new"}
            locations={locations}
            disabled={busy !== null}
            onSave={async (input) => {
              const id = await ensureDraft();
              await saveTransferLine({ transferId: id, lineId: null, ...input });
              setLines(await fetchTransferLines(id));
              void loadLists();
            }}
          />
          {draftId && (
            <Card className="shadow-card">
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-sm font-semibold">
                    <FileClock className="size-4 text-muted-foreground" /> טיוטה — נשמרת אוטומטית (
                    {lines.length} שורות)
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={() => void cancel(draftId)}
                  >
                    <X className="size-4" /> ביטול הטיוטה
                  </Button>
                </div>
                <LinesTable
                  lines={lines}
                  onDelete={async (line) => {
                    await deleteTransferLine(line.id);
                    setLines(await fetchTransferLines(draftId));
                    void loadLists();
                  }}
                />
                <Button
                  size="lg"
                  className="h-12 w-full gap-2"
                  disabled={lines.length === 0 || busy !== null}
                  onClick={() => void approve()}
                >
                  {busy === "approve" ? (
                    <Loader2 className="size-5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="size-5" />
                  )}
                  אישור העברה — לבצע את כל השורות
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="drafts" className="space-y-3">
          {drafts === null ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : drafts.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">אין טיוטות פתוחות</p>
          ) : (
            drafts.map((t) => (
              <SummaryCard
                key={t.id}
                t={t}
                actions={
                  <>
                    <Button onClick={() => void loadDraft(t.id).then(() => setTab("new"))}>
                      המשך
                    </Button>
                    <Button
                      variant="ghost"
                      className="text-muted-foreground"
                      onClick={() => void cancel(t.id)}
                    >
                      ביטול
                    </Button>
                  </>
                }
              />
            ))
          )}
        </TabsContent>

        <TabsContent value="history" className="space-y-3">
          {history === null ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : history.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">עוד לא אושרו העברות</p>
          ) : (
            history.map((t) => <HistoryCard key={t.id} t={t} />)
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** שורה חדשה: מוצר → (ריבוע האיתורים) איתור מקור → כמות → איתור יעד → הוספה */
function LineEditor({
  locations,
  disabled,
  onSave,
}: {
  locations: LocationSummary[];
  disabled: boolean;
  onSave: (input: {
    productId: string;
    from: string;
    to: string;
    quantity: number;
  }) => Promise<void>;
}) {
  const [item, setItem] = useState<StockItem | null>(null);
  const [from, setFrom] = useState("");
  const [qty, setQty] = useState("");
  const [to, setTo] = useState("");
  const [saving, setSaving] = useState(false);

  const max = useMemo(
    () => item?.locations.find((l) => l.location === from)?.quantity ?? 0,
    [item, from],
  );
  const qtyNumber = Number(qty);
  const toNorm = to.trim().replace(/\s+/g, " ").toUpperCase();
  const problem = !item
    ? null
    : !from
      ? "בחרו איתור מקור"
      : !Number.isInteger(qtyNumber) || qtyNumber < 1
        ? "כמות להעברה — מספר שלם, לפחות 1"
        : qtyNumber > max
          ? `ב"${from}" פנויות ${max} יח׳ בלבד (כמות שמורה להזמנות לא ניתנת להעברה)`
          : !toNorm
            ? "בחרו או הקלידו איתור יעד"
            : toNorm === from.toUpperCase()
              ? "איתור היעד זהה למקור"
              : null;

  const pick = (picked: StockItem) => {
    setItem(picked);
    const first = picked.locations[0]?.location ?? "";
    setFrom(first);
    setQty("");
    setTo("");
  };

  const submit = async () => {
    if (!item || problem) return;
    setSaving(true);
    try {
      await onSave({ productId: item.id, from, to: toNorm, quantity: qtyNumber });
      toast.success(`נשמר בטיוטה: ${item.name} — ${qtyNumber} יח׳ מ-${from} ל-${toNorm}`);
      // רענון המוצר (הכמות הפנויה בטיוטה ירדה) והכנה לשורה הבאה
      const fresh =
        (await lookupStock(item.barcode ?? item.sku)).find((f) => f.id === item.id) ?? null;
      setItem(null);
      setFrom("");
      setQty("");
      setTo("");
      void fresh;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "השמירה נכשלה");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="shadow-card">
      <CardContent className="space-y-4 p-4">
        {!item ? (
          <>
            <Label className="text-base">1. איזה מוצר מעבירים?</Label>
            <StockSearch onPick={pick} autoFocus />
          </>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-secondary/60">
                  {item.image_url ? (
                    <img
                      src={item.image_url}
                      alt=""
                      className="size-full object-contain mix-blend-multiply"
                    />
                  ) : (
                    <Package className="size-6 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate font-bold">{item.name}</p>
                  <p className="numeric text-xs text-muted-foreground" dir="ltr">
                    {item.barcode ?? item.sku}
                  </p>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setItem(null)}>
                החלפת מוצר
              </Button>
            </div>

            <div className="space-y-2">
              <Label className="text-base">2. מאיזה איתור? (איפה יש מלאי פנוי)</Label>
              {item.locations.length === 0 ? (
                <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">
                  אין למוצר הזה מלאי פנוי באף איתור
                  {item.reserved > 0 ? ` — ${item.reserved} יח׳ שמורות להזמנות` : ""}.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {item.locations.map((loc) => (
                    <button
                      key={loc.location}
                      type="button"
                      onClick={() => setFrom(loc.location)}
                      aria-pressed={from === loc.location}
                      className={`rounded-lg border-2 p-3 text-right transition-colors ${
                        from === loc.location
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-secondary"
                      }`}
                    >
                      <span className="flex items-center gap-1 font-bold">
                        <MapPin className="size-4" /> {loc.location}
                      </span>
                      <span className="numeric text-sm text-muted-foreground">
                        פנוי: {unitsLabel(loc.quantity, item.pack_size)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {item.reserved > 0 && (
                <p className="text-xs text-muted-foreground">
                  <span className="numeric">{item.reserved}</span> יח׳ שמורות להזמנות פתוחות — לא
                  ניתנות להעברה.
                </p>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="tr-qty" className="text-base">
                  3. כמות להעברה{" "}
                  {from && (
                    <span className="numeric text-sm font-normal text-muted-foreground">
                      (עד {max})
                    </span>
                  )}
                </Label>
                <Input
                  id="tr-qty"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={max || undefined}
                  step={item.pack_size && item.pack_size >= 2 ? item.pack_size : 1}
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  className="h-12 text-lg"
                  placeholder={
                    item.pack_size && item.pack_size >= 2 ? `מארז = ${item.pack_size}` : ""
                  }
                />
                {from && max > 0 && (
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto p-0 text-xs"
                    onClick={() => setQty(String(max))}
                  >
                    הכל ({max})
                  </Button>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="tr-to" className="text-base">
                  4. לאיזה איתור?
                </Label>
                <Input
                  id="tr-to"
                  list="tr-locations"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="למשל A-03 — או איתור חדש"
                  className="h-12 text-lg"
                  autoComplete="off"
                />
                <datalist id="tr-locations">
                  {locations
                    .filter((l) => l.location !== from)
                    .map((l) => (
                      <option key={l.location} value={l.location} />
                    ))}
                </datalist>
              </div>
            </div>

            {problem && qty !== "" && <p className="text-sm text-destructive">{problem}</p>}
            <Button
              size="lg"
              className="h-12 w-full gap-2"
              disabled={!!problem || saving || disabled}
              onClick={() => void submit()}
            >
              {saving ? <Loader2 className="size-5 animate-spin" /> : <Plus className="size-5" />}
              הוספה לטיוטה
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function LinesTable({
  lines,
  onDelete,
}: {
  lines: TransferLine[];
  onDelete?: (line: TransferLine) => Promise<void>;
}) {
  if (lines.length === 0) return <p className="text-sm text-muted-foreground">עוד אין שורות</p>;
  return (
    <ul className="space-y-2">
      {lines.map((line) => {
        const over = line.quantity > line.available;
        return (
          <li
            key={line.id}
            className={`flex flex-wrap items-center gap-2 rounded-lg border p-2 text-sm ${over ? "border-destructive/50 bg-destructive/5" : "border-border"}`}
          >
            <span className="min-w-0 flex-1 font-semibold">{line.name}</span>
            <span className="flex items-center gap-1 rounded bg-secondary px-2 py-0.5">
              {line.from_location} <ArrowLeft className="size-3.5" /> {line.to_location}
            </span>
            <span className="numeric font-bold">{unitsLabel(line.quantity, line.pack_size)}</span>
            {over && (
              <span className="text-xs text-destructive">באיתור פנויות עכשיו {line.available}</span>
            )}
            {onDelete && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="מחיקת שורה"
                onClick={() => void onDelete(line)}
              >
                <Trash2 className="size-4" />
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function SummaryCard({ t, actions }: { t: TransferSummary; actions: React.ReactNode }) {
  return (
    <Card className="shadow-card">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="text-sm">
          <p className="font-semibold">
            {t.lines} שורות · <span className="numeric">{t.units}</span> יח׳
          </p>
          <p className="text-muted-foreground">
            {t.created_by_name} · עודכנה{" "}
            {new Date(t.updated_at).toLocaleString("he-IL", {
              dateStyle: "short",
              timeStyle: "short",
            })}
          </p>
        </div>
        <div className="flex gap-2">{actions}</div>
      </CardContent>
    </Card>
  );
}

function HistoryCard({ t }: { t: TransferSummary }) {
  const [lines, setLines] = useState<TransferLine[] | null>(null);
  return (
    <Card className="shadow-card">
      <CardContent className="space-y-2 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <p>
            <span className="font-semibold">{t.lines} שורות</span> · אושרה ע״י{" "}
            {t.approved_by_name ?? "—"} ·{" "}
            {t.approved_at
              ? new Date(t.approved_at).toLocaleString("he-IL", {
                  dateStyle: "short",
                  timeStyle: "short",
                })
              : ""}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchTransferLines(t.id).then(setLines)}
          >
            {lines ? "רענון" : "פירוט"}
          </Button>
        </div>
        {lines && (
          <LinesTable lines={lines.map((l) => ({ ...l, available: Number.MAX_SAFE_INTEGER }))} />
        )}
      </CardContent>
    </Card>
  );
}
