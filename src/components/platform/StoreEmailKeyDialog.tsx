import { useState, type FormEvent } from "react";
import { CheckCircle2, Clock, KeyRound, Loader2, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setStoreResendKey, type StoreResendKeyResult } from "@/lib/platform.functions";

export type StoreEmailKey = { has_key: boolean; key_hint: string | null; updated_at: string };

/**
 * מפתח ה-API של Resend לחנות — מדביקים פעם אחת, והשרת שולח איתו את כל
 * המיילים של החנות. המפתח נבדק מול Resend לפני השמירה, נשמר בשרת בלבד
 * (tenant_secrets — סגור לדפדפן), ובפאנל מוצגים רק 4 התווים האחרונים.
 */
export function StoreEmailKeyDialog({
  store,
  current,
  onClose,
  onSaved,
}: {
  store: { id: string; name: string } | null;
  current: StoreEmailKey | null;
  onClose: () => void;
  onSaved: (tenantId: string, state: StoreEmailKey) => void;
}) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [result, setResult] = useState<StoreResendKeyResult | null>(null);

  const save = async (value: string) => {
    if (!store) return;
    setBusy(value === "" ? "remove" : "save");
    try {
      const saved = await setStoreResendKey({ data: { tenantId: store.id, key: value } });
      setResult(saved);
      setKey("");
      onSaved(store.id, {
        has_key: saved.hint !== null,
        key_hint: saved.hint,
        updated_at: new Date().toISOString(),
      });
      toast.success(
        saved.hint
          ? `מפתח המייל של "${store.name}" נשמר (${saved.hint})`
          : `המפתח של "${store.name}" הוסר — המיילים יישלחו עם המפתח הכללי של השרת`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "שמירת המפתח נכשלה");
    } finally {
      setBusy(null);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void save(key.trim());
  };

  return (
    <Dialog open={store !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader className="text-right">
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-5 text-accent" aria-hidden="true" />
            מפתח מייל (Resend) · {store?.name}
          </DialogTitle>
          <DialogDescription className="text-right leading-6">
            כל המיילים של החנות — אישורי הזמנה, "ההזמנה יצאה למשלוח", איפוס סיסמה — יישלחו עם המפתח
            הזה. חנות בלי מפתח משתמשת במפתח הכללי של השרת. המפתח נשמר בשרת בלבד ולא מוצג שוב.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm">
          <span className="text-muted-foreground">מצב נוכחי:</span>
          {current?.has_key ? (
            <>
              <Badge variant="outline" className="border-green-600 text-green-700">
                מפתח חנות{" "}
                <span dir="ltr" className="font-mono">
                  {current.key_hint}
                </span>
              </Badge>
              <span className="text-xs text-muted-foreground">
                עודכן {new Date(current.updated_at).toLocaleDateString("he-IL")}
              </span>
            </>
          ) : (
            <Badge variant="secondary">המפתח הכללי של השרת</Badge>
          )}
        </div>

        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="store-resend-key">
              {current?.has_key ? "מפתח חדש (מחליף את הקיים)" : "מפתח API של Resend"}
            </Label>
            <Input
              id="store-resend-key"
              type="password"
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              placeholder="re_xxxxxxxxxxxxxxxx"
              className="font-mono"
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
            <p className="text-xs leading-5 text-muted-foreground">
              ב-Resend: API Keys ← Create API Key (מספיקה הרשאת Sending access). ודאו שהדומיין של
              כתובת השולח שהחנות הגדירה ("הגדרות מייל" בפאנל החנות) מאומת באותו חשבון.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy !== null || key.trim() === ""}>
              {busy === "save" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="size-4" />
              )}
              בדיקה ושמירה
            </Button>
            {current?.has_key && (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={busy !== null}
                onClick={() => void save("")}
              >
                {busy === "remove" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
                הסרת המפתח
              </Button>
            )}
          </div>
        </form>

        {result?.warning && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {result.warning}
          </p>
        )}
        {result?.hint && result.domains && (
          <div className="space-y-1.5 text-sm">
            <p className="font-medium">דומיינים בחשבון Resend:</p>
            {result.domains.length === 0 ? (
              <p className="text-xs text-destructive">
                אין דומיינים בחשבון — יש להוסיף ולאמת את הדומיין של כתובת השולח, אחרת המיילים לא
                ייצאו.
              </p>
            ) : (
              <ul className="space-y-1">
                {result.domains.map((domain) => (
                  <li key={domain.name} className="flex items-center gap-2 text-xs">
                    {domain.status === "verified" ? (
                      <CheckCircle2 className="size-4 text-green-600" aria-hidden="true" />
                    ) : (
                      <Clock className="size-4 text-amber-600" aria-hidden="true" />
                    )}
                    <span dir="ltr" className="font-mono">
                      {domain.name}
                    </span>
                    <span className="text-muted-foreground">
                      {domain.status === "verified" ? "מאומת" : `לא מאומת (${domain.status})`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {result?.hint && result.domains === null && !result.warning && (
          <p className="text-xs text-muted-foreground">
            מפתח עם הרשאת שליחה בלבד — תקין. רשימת הדומיינים זמינה רק למפתח עם הרשאה מלאה.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
