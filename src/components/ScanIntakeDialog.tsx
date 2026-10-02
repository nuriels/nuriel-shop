import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Camera,
  CameraOff,
  Check,
  ImagePlus,
  Loader2,
  Minus,
  Plus,
  ScanLine,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  detectBarcodes,
  detectBarcodesInFile,
  isBarcodeDetectionSupported,
} from "@/lib/barcode-scan";
import { applyScanSession, lookupScannedBarcodes } from "@/lib/scan.functions";

type ScanRow = {
  barcode: string;
  quantity: number;
  /** null = טרם נבדק מול השרת · undefined = נבדק ולא נמצא */
  productName?: string | null;
  productId?: string;
  isOutOfStock?: boolean;
  suggestedName: string;
  known: boolean | null;
};

/**
 * קליטת סחורה בסריקה.
 *
 * סורקים ברקודים במצלמה או מצילום תמונה, המערכת בודקת מול הקטלוג ומציגה
 * טבלה: מה קיים, מה אזל ויחזור למלאי, ומה לא מוכר. רק אחרי אישור מפורש
 * של מי שסורק מתבצע העדכון בפועל.
 */
export function ScanIntakeDialog({ onApplied }: { onApplied: () => void }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [manual, setManual] = useState("");
  const [cameraOn, setCameraOn] = useState(false);
  const [addToStock, setAddToStock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastHit = useRef<Record<string, number>>({});

  const lookup = useServerFn(lookupScannedBarcodes);
  const apply = useServerFn(applyScanSession);
  const supported = isBarcodeDetectionSupported();

  /** הוספת ברקוד לרשימה, או הגדלת הכמות אם כבר נסרק */
  const addBarcode = useCallback((barcode: string) => {
    const clean = barcode.trim();
    if (clean === "") return;
    // אותו ברקוד מול המצלמה מזוהה עשרות פעמים בשנייה — חלון השהיה קצר
    // מונע מהכמות לקפוץ ל-40 מסריקה אחת
    const now = Date.now();
    if (now - (lastHit.current[clean] ?? 0) < 1500) return;
    lastHit.current[clean] = now;

    setRows((current) => {
      const existing = current.find((row) => row.barcode === clean);
      if (existing) {
        return current.map((row) =>
          row.barcode === clean ? { ...row, quantity: row.quantity + 1 } : row,
        );
      }
      return [...current, { barcode: clean, quantity: 1, suggestedName: "", known: null }];
    });
  }, []);

  // סריקה רציפה מהמצלמה
  useEffect(() => {
    if (!cameraOn) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        timer = setInterval(() => {
          const video = videoRef.current;
          if (!video || video.readyState < 2) return;
          void detectBarcodes(video).then((codes) => codes.forEach(addBarcode));
        }, 350);
      } catch {
        toast.error("לא הצלחנו לפתוח את המצלמה. בדקו הרשאות בדפדפן.");
        setCameraOn(false);
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [cameraOn, addBarcode]);

  useEffect(() => {
    if (!open) setCameraOn(false);
  }, [open]);

  const handlePhoto = async (file: File | undefined) => {
    if (!file) return;
    const codes = await detectBarcodesInFile(file);
    if (codes.length === 0) {
      toast.error("לא זוהה ברקוד בתמונה. נסו צילום קרוב וברור יותר.");
      return;
    }
    // בצילום בודד מזהים לרוב ברקוד אחד; ההשהיה לא רלוונטית כאן
    lastHit.current = {};
    codes.forEach(addBarcode);
    toast.success(`זוהו ${codes.length} ברקודים בתמונה`);
  };

  /** בדיקה מול הקטלוג: מה קיים ומה לא */
  const check = useCallback(async () => {
    const pendingRows = rows.filter((row) => row.known === null);
    if (pendingRows.length === 0) return;
    setChecking(true);
    try {
      const result = await lookup({ data: { barcodes: pendingRows.map((row) => row.barcode) } });
      setRows((current) =>
        current.map((row) => {
          if (row.known !== null) return row;
          const match = result.products.find((product) => product.barcode === row.barcode);
          if (!match) {
            const pending = result.pending.find((entry) => entry.barcode === row.barcode);
            return {
              ...row,
              known: false,
              suggestedName: row.suggestedName || (pending?.suggestedName ?? ""),
            };
          }
          return {
            ...row,
            known: true,
            productId: match.id,
            productName: match.name,
            isOutOfStock: match.isOutOfStock,
          };
        }),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "בדיקת הברקודים נכשלה");
    } finally {
      setChecking(false);
    }
  }, [rows, lookup]);

  // בדיקה אוטומטית של שורות חדשות, בלי להעמיס בקשה על כל סריקה
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => void check(), 700);
    return () => clearTimeout(timer);
  }, [rows, open, check]);

  const setQuantity = (barcode: string, delta: number) =>
    setRows((current) =>
      current.map((row) =>
        row.barcode === barcode ? { ...row, quantity: Math.max(1, row.quantity + delta) } : row,
      ),
    );

  const remove = (barcode: string) =>
    setRows((current) => current.filter((row) => row.barcode !== barcode));

  const submit = async () => {
    setBusy(true);
    try {
      const result = await apply({
        data: {
          lines: rows.map((row) => ({
            barcode: row.barcode,
            quantity: row.quantity,
            suggestedName: row.suggestedName,
          })),
          addToStock,
        },
      });
      const parts = [`עודכנו ${result.updated} מוצרים`];
      if (result.restocked > 0) parts.push(`${result.restocked} חזרו למלאי`);
      if (result.missingCount > 0) parts.push(`${result.missingCount} נשלחו לאישור`);
      toast.success(parts.join(" · "));
      setRows([]);
      setOpen(false);
      onApplied();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "אישור הסריקה נכשל");
    } finally {
      setBusy(false);
    }
  };

  const knownCount = rows.filter((row) => row.known === true).length;
  const missingCount = rows.filter((row) => row.known === false).length;
  const totalUnits = rows.reduce((sum, row) => sum + row.quantity, 0);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <ScanLine className="size-4" />
          קליטה בסריקה
        </Button>
      </DialogTrigger>
      <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto text-right sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display">קליטת סחורה בסריקה</DialogTitle>
          <DialogDescription>
            סרקו ברקודים במצלמה או מתמונה. המערכת תזהה מה קיים בקטלוג, מה אזל ויחזור למלאי, ומה
            עדיין לא מוכר — והעדכון יתבצע רק אחרי אישור.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {supported ? (
              <Button
                type="button"
                variant={cameraOn ? "secondary" : "default"}
                onClick={() => setCameraOn((current) => !current)}
              >
                {cameraOn ? <CameraOff className="size-4" /> : <Camera className="size-4" />}
                {cameraOn ? "עצירת המצלמה" : "סריקה במצלמה"}
              </Button>
            ) : null}

            <Button type="button" variant="outline" asChild>
              <label className="cursor-pointer">
                <ImagePlus className="size-4" />
                צילום / העלאת תמונה
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    void handlePhoto(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
            </Button>
          </div>

          {!supported && (
            <p className="rounded-lg border border-border bg-secondary p-3 text-xs text-muted-foreground">
              הדפדפן הזה לא תומך בזיהוי ברקוד אוטומטי (נפוץ ב-iPhone). אפשר להקליד ברקודים ידנית
              למטה, או להשתמש ב-Chrome באנדרואיד או במחשב.
            </p>
          )}

          {cameraOn && (
            <div className="relative overflow-hidden rounded-lg border border-border bg-black">
              <video ref={videoRef} playsInline muted className="h-56 w-full object-cover" />
              <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-accent/80" />
            </div>
          )}

          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              lastHit.current = {};
              addBarcode(manual);
              setManual("");
            }}
          >
            <Input
              dir="ltr"
              inputMode="numeric"
              className="numeric"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="הקלדת ברקוד ידנית"
              aria-label="הקלדת ברקוד"
            />
            <Button type="submit" variant="outline">
              הוספה
            </Button>
          </form>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                נסרקו {rows.length} פריטים · {totalUnits} יחידות
              </p>
              {checking && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  בודק מול הקטלוג...
                </span>
              )}
            </div>

            {rows.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                עדיין לא נסרק כלום
              </p>
            ) : (
              <ul className="space-y-2">
                {rows.map((row) => (
                  <li key={row.barcode} className="space-y-2 rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span dir="ltr" className="numeric text-sm font-bold">
                        {row.barcode}
                      </span>
                      {row.known === null && <Badge variant="outline">בבדיקה</Badge>}
                      {row.known === true && (
                        <Badge variant={row.isOutOfStock ? "default" : "secondary"}>
                          {row.isOutOfStock ? "אזל — יחזור למלאי" : "קיים בקטלוג"}
                        </Badge>
                      )}
                      {row.known === false && <Badge variant="destructive">לא קיים</Badge>}

                      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                        {row.productName ?? ""}
                      </span>

                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className="size-7"
                          aria-label="הפחתת כמות"
                          onClick={() => setQuantity(row.barcode, -1)}
                        >
                          <Minus className="size-3.5" />
                        </Button>
                        <span className="numeric w-8 text-center text-sm font-bold">
                          {row.quantity}
                        </span>
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className="size-7"
                          aria-label="הוספת כמות"
                          onClick={() => setQuantity(row.barcode, 1)}
                        >
                          <Plus className="size-3.5" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-7 text-destructive hover:text-destructive"
                          aria-label="הסרת שורה"
                          onClick={() => remove(row.barcode)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>

                    {row.known === false && (
                      <div className="space-y-1.5">
                        <Label htmlFor={`name-${row.barcode}`} className="text-xs">
                          שם מוצר מוצע (יישלח לאישור)
                        </Label>
                        <Input
                          id={`name-${row.barcode}`}
                          value={row.suggestedName}
                          onChange={(e) =>
                            setRows((current) =>
                              current.map((candidate) =>
                                candidate.barcode === row.barcode
                                  ? { ...candidate, suggestedName: e.target.value }
                                  : candidate,
                              ),
                            )
                          }
                          placeholder="למשל: קוקה קולה זירו 330 מ״ל"
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
            <span className="space-y-1">
              <span className="block text-sm font-medium">להוסיף את הכמויות שנסרקו למלאי</span>
              <span className="block text-xs text-muted-foreground">
                כבוי = רק החזרת מוצרים שאזלו לסטטוס "במלאי", בלי לשנות כמויות.
              </span>
            </span>
            <Switch checked={addToStock} onCheckedChange={setAddToStock} />
          </label>

          <Button
            size="lg"
            className="w-full"
            disabled={busy || rows.length === 0 || checking}
            onClick={() => void submit()}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            אישור סופי ({knownCount} לעדכון · {missingCount} לאישור מוצר חדש)
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
