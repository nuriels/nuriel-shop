import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Mail } from "lucide-react";
import { toast } from "sonner";
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
import { requestPasswordReset } from "@/lib/password.functions";

/**
 * "שכחתי סיסמה": שולח למייל קישור חד-פעמי לקביעת סיסמה חדשה (3 שעות).
 * ההודעה למשתמש זהה גם אם החשבון לא קיים, כדי לא לחשוף מי רשום במערכת.
 * חלופה מהירה: כניסה מיידית עם קוד חד-פעמי למייל (onUseCode) — ואחר כך אפשר
 * לקבוע סיסמה חדשה בהגדרות החשבון.
 */
export function ForgotPasswordDialog({
  open,
  onOpenChange,
  onUseCode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** מעבר ללשונית "קוד למייל" בדף ההתחברות, עם הכתובת שהוזנה (אם היא אימייל) */
  onUseCode?: (email: string | null) => void;
}) {
  const [identifier, setIdentifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const requestReset = useServerFn(requestPasswordReset);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (identifier.trim().length < 3) {
      toast.error("נא להזין אימייל או שם משתמש");
      return;
    }
    setBusy(true);
    try {
      await requestReset({ data: { identifier: identifier.trim() } });
      setSent(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "שליחת הבקשה נכשלה");
    } finally {
      setBusy(false);
    }
  };

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setIdentifier("");
      setSent(false);
    }
  };

  const useCode = () => {
    const value = identifier.trim().toLowerCase();
    onUseCode?.(value.includes("@") ? value : null);
    setIdentifier("");
    setSent(false);
  };

  const codeOption = onUseCode ? (
    <div className="space-y-2 border-t border-border pt-4">
      <p className="text-sm text-muted-foreground">
        רוצים להיכנס עכשיו? אפשר להתחבר מיד עם קוד חד-פעמי שנשלח למייל, ולקבוע סיסמה חדשה אחר כך
        בהגדרות החשבון.
      </p>
      <Button type="button" variant="outline" className="w-full" onClick={useCode}>
        <Mail className="size-4" />
        כניסה עם קוד למייל
      </Button>
    </div>
  ) : null;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent dir="rtl" className="text-right sm:max-w-md">
        <DialogHeader>
          <DialogTitle>איפוס סיסמה</DialogTitle>
          <DialogDescription>
            נשלח אליך קישור לקביעת סיסמה חדשה. הקישור תקף לשלוש שעות ולשימוש חד-פעמי.
          </DialogDescription>
        </DialogHeader>

        {sent ? (
          <div className="space-y-4">
            <p className="rounded-lg border border-border bg-secondary p-3 text-sm">
              אם קיים חשבון פעיל עם הפרטים שהוזנו, נשלח אליו כרגע מייל עם קישור לקביעת סיסמה חדשה.
              כדאי לבדוק גם בתיקיית הספאם.
            </p>
            <Button className="w-full" size="lg" onClick={() => close(false)}>
              סגירה
            </Button>
            {codeOption}
          </div>
        ) : (
          <div className="space-y-4">
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="reset-identifier">אימייל או שם משתמש</Label>
                <Input
                  id="reset-identifier"
                  dir="ltr"
                  required
                  maxLength={255}
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="name@example.com"
                />
              </div>
              <Button type="submit" size="lg" className="w-full" disabled={busy}>
                {busy ? "שולח..." : "שליחת קישור לאיפוס"}
              </Button>
            </form>
            {codeOption}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
