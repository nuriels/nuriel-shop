import { useState } from "react";
import { Check, Copy, Dices } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { generateTempPassword } from "@/lib/admin.functions";

export type PasswordSetup = {
  /** "link" = הלקוח קובע סיסמה בעצמו · "temp" = המנהל קובע סיסמה זמנית */
  mode: "link" | "temp";
  tempPassword: string;
  emailTempPassword: boolean;
};

export const defaultPasswordSetup: PasswordSetup = {
  mode: "link",
  tempPassword: "",
  emailTempPassword: false,
};

/** בחירת דרך הגדרת הסיסמה בעת הקמת משתמש חדש */
export function PasswordSetupFields({
  value,
  onChange,
}: {
  value: PasswordSetup;
  onChange: (next: PasswordSetup) => void;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <Label>איך המשתמש יקבל סיסמה?</Label>
      <RadioGroup
        dir="rtl"
        value={value.mode}
        onValueChange={(mode) => onChange({ ...value, mode: mode as PasswordSetup["mode"] })}
        className="gap-3"
      >
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <RadioGroupItem value="link" id="pw-mode-link" className="mt-0.5" />
          <span>
            <span className="block font-medium">שליחת קישור ליצירת סיסמה</span>
            <span className="block text-xs text-muted-foreground">
              נשלח מייל עם קישור חד-פעמי (3 שעות); המשתמש בוחר סיסמה בעצמו.
            </span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <RadioGroupItem value="temp" id="pw-mode-temp" className="mt-0.5" />
          <span>
            <span className="block font-medium">סיסמה זמנית מיידית</span>
            <span className="block text-xs text-muted-foreground">
              תקבלו סיסמה להעתקה (למשל לוואטסאפ). המשתמש יחויב להחליף אותה בכניסה.
            </span>
          </span>
        </label>
      </RadioGroup>

      {value.mode === "temp" && (
        <div className="space-y-3 border-t border-border pt-3">
          <div className="space-y-2">
            <Label htmlFor="pw-temp">סיסמה זמנית</Label>
            <div className="flex gap-2">
              <Input
                id="pw-temp"
                dir="ltr"
                className="numeric"
                minLength={6}
                value={value.tempPassword}
                onChange={(e) => onChange({ ...value, tempPassword: e.target.value })}
                placeholder="לפחות 6 תווים"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => onChange({ ...value, tempPassword: generateTempPassword() })}
              >
                <Dices className="size-4" />
                חולל סיסמה
              </Button>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={value.emailTempPassword}
              onCheckedChange={(checked) =>
                onChange({ ...value, emailTempPassword: checked === true })
              }
            />
            שלח את הסיסמה הזמנית גם למייל של הלקוח
          </label>
        </div>
      )}
    </div>
  );
}

/**
 * מוצג אחרי יצירת המשתמש במצב "סיסמה זמנית".
 * זו ההזדמנות היחידה להעתיק את הסיסמה — היא לא נשמרת בשום מקום קריא.
 */
export function TempPasswordNotice({
  email,
  password,
  emailed,
}: {
  email: string;
  password: string;
  emailed: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error("ההעתקה נכשלה — אפשר לסמן ולהעתיק ידנית");
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-accent/50 bg-accent/5 p-4">
      <p className="text-sm font-medium">החשבון נוצר עבור {email}</p>
      <div className="flex items-center gap-2">
        <code
          dir="ltr"
          className="numeric flex-1 rounded-md bg-card px-3 py-2 text-lg font-bold tracking-wider"
        >
          {password}
        </code>
        <Button type="button" variant="outline" onClick={() => void copy()}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? "הועתק" : "העתק סיסמה"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {emailed
          ? "הסיסמה נשלחה גם למייל של הלקוח. "
          : "הסיסמה לא נשלחה במייל — יש להעביר אותה ללקוח. "}
        זו הפעם היחידה שהיא מוצגת. בכניסה הראשונה הלקוח יחויב להחליף אותה ולהשלים את פרטי העסק.
      </p>
    </div>
  );
}
