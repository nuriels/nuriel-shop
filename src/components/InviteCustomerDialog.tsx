import { useState } from "react";
import { Check, Copy, Link2, Loader2, Mail, MessageCircle, Send } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createCustomerInvite } from "@/lib/invite.functions";
import { cn } from "@/lib/utils";
import { usePriceTiersEnabled } from "@/hooks/usePriceTiers";

type Mode = "email" | "link";
type Result = { link: string; expiresAt: string; emailed: boolean; reason: string | null };

/**
 * הזמנת לקוח לפתוח חשבון בעצמו — בלי למלא בשבילו את פרטי העסק.
 * "שליחה למייל": מזינים רק את כתובת המייל שלו.
 * "קישור חד-פעמי": ללקוח שלא זוכר את המייל שלו — מעתיקים את הקישור
 * ושולחים לו בוואטסאפ, והוא נרשם עם כל כתובת שיבחר.
 */
export function InviteCustomerDialog({
  handlers,
  isAgent = false,
}: {
  /** מי יכול לטפל בלקוח (מנהל בלבד בוחר; סוכן מזמין תמיד לעצמו) */
  handlers?: { user_id: string; label: string }[];
  isAgent?: boolean;
}) {
  const tiersEnabled = usePriceTiersEnabled();
  const invite = useServerFn(createCustomerInvite);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("email");
  const [email, setEmail] = useState("");
  const [tier, setTier] = useState<"none" | "1" | "2" | "3">("none");
  const [handler, setHandler] = useState<string>("none");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [copied, setCopied] = useState(false);

  const reset = () => {
    setMode("email");
    setEmail("");
    setTier("none");
    setHandler("none");
    setResult(null);
    setCopied(false);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const created = await invite({
        data: {
          email: mode === "email" ? email : null,
          priceTier: !tiersEnabled ? 1 : tier === "none" ? null : (Number(tier) as 1 | 2 | 3),
          agentId: isAgent || handler === "none" ? null : handler,
        },
      });
      setResult(created);
      if (mode === "email") {
        if (created.emailed) toast.success(`ההזמנה נשלחה אל ${email.trim().toLowerCase()}`);
        else toast.error("ההזמנה נוצרה, אבל המייל לא נשלח — אפשר להעתיק את הקישור");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "יצירת ההזמנה נכשלה");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.link);
      setCopied(true);
      toast.success("הקישור הועתק");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("ההעתקה נכשלה — סמנו את הקישור והעתיקו ידנית");
    }
  };

  const until = result
    ? new Date(result.expiresAt).toLocaleDateString("he-IL", { day: "numeric", month: "long" })
    : "";
  const whatsappText = result
    ? `שלום, זה הקישור לפתיחת חשבון במערכת ההזמנות שלנו: ${result.link}`
    : "";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <Send className="size-4" />
          הזמנת לקוח
        </Button>
      </DialogTrigger>
      <DialogContent dir="rtl" className="text-right sm:max-w-md">
        <DialogHeader className="text-right">
          <DialogTitle>הזמנת לקוח לפתוח חשבון</DialogTitle>
          <DialogDescription>
            הלקוח ממלא בעצמו את פרטי העסק ובוחר סיסמה. כיוון שהזמנתם אותו, החשבון פעיל מיד — בלי
            לחכות לאישור.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-4">
            {mode === "email" && result.emailed && (
              <p className="flex items-start gap-2 rounded-md bg-secondary p-3 text-sm">
                <Check className="mt-0.5 size-4 shrink-0 text-accent" />
                ההזמנה נשלחה אל <strong dir="ltr">{email.trim().toLowerCase()}</strong>. אם המייל לא
                מגיע, אפשר לשלוח לו את הקישור שלמטה.
              </p>
            )}
            {mode === "email" && !result.emailed && (
              <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                המייל לא נשלח{result.reason ? `: ${result.reason}` : ""}. ההזמנה עצמה נוצרה — העתיקו
                את הקישור ושלחו אותו ללקוח.
              </p>
            )}
            {mode === "link" && (
              <p className="rounded-md bg-secondary p-3 text-sm">
                הקישור מוכן. שלחו אותו ללקוח, והוא יירשם עם כתובת המייל שהוא בוחר.
              </p>
            )}

            <div className="space-y-2">
              <Label htmlFor="invite-link">קישור ההרשמה</Label>
              <div className="flex gap-2">
                <Input
                  id="invite-link"
                  readOnly
                  dir="ltr"
                  value={result.link}
                  onFocus={(event) => event.currentTarget.select()}
                  className="text-xs"
                />
                <Button type="button" variant="outline" onClick={() => void copy()}>
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                  העתקה
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">תקף עד {until}, להרשמה אחת בלבד.</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button asChild variant="secondary">
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(whatsappText)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <MessageCircle className="size-4" />
                  שליחה בוואטסאפ
                </a>
              </Button>
              <Button type="button" variant="ghost" onClick={reset}>
                הזמנה נוספת
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div role="radiogroup" aria-label="דרך ההזמנה" className="grid grid-cols-2 gap-2">
              {(
                [
                  { id: "email", label: "שליחה למייל", icon: Mail },
                  { id: "link", label: "קישור חד-פעמי", icon: Link2 },
                ] as const
              ).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={mode === option.id}
                  onClick={() => setMode(option.id)}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-lg border-2 px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    mode === option.id
                      ? "border-accent bg-secondary text-foreground"
                      : "border-border text-foreground/80 hover:border-accent/60",
                  )}
                >
                  <option.icon className="size-4" />
                  {option.label}
                </button>
              ))}
            </div>

            {mode === "email" ? (
              <div className="space-y-2">
                <Label htmlFor="invite-email">כתובת המייל של הלקוח</Label>
                <Input
                  id="invite-email"
                  type="email"
                  dir="ltr"
                  required
                  autoFocus
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@example.com"
                />
                <p className="text-xs text-muted-foreground">
                  הלקוח יקבל מייל עם כפתור "פתיחת חשבון". הוא יירשם עם הכתובת הזו.
                </p>
              </div>
            ) : (
              <p className="rounded-md bg-secondary p-3 text-sm leading-6">
                ללקוח שלא זוכר את כתובת המייל שלו, או שנוח לו בוואטסאפ: יוצרים קישור, שולחים לו,
                והוא נרשם עם כל מייל שיבחר. הקישור עובד פעם אחת בלבד.
              </p>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              {tiersEnabled && (
                <div className="space-y-2">
                  <Label>קבוצת מחיר אחרי ההרשמה</Label>
                  <Select value={tier} onValueChange={(v) => setTier(v as typeof tier)}>
                    <SelectTrigger dir="rtl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent dir="rtl">
                      <SelectItem value="none">הצעת מחיר בלבד</SelectItem>
                      <SelectItem value="1">דרג 1</SelectItem>
                      <SelectItem value="2">דרג 2</SelectItem>
                      <SelectItem value="3">דרג 3</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              {!isAgent && handlers && (
                <div className="space-y-2">
                  <Label>מי מטפל בלקוח</Label>
                  <Select value={handler} onValueChange={setHandler}>
                    <SelectTrigger dir="rtl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent dir="rtl">
                      <SelectItem value="none">ללא טיפול משויך</SelectItem>
                      {handlers.map((h) => (
                        <SelectItem key={h.user_id} value={h.user_id}>
                          {h.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            {isAgent && <p className="text-xs text-muted-foreground">הלקוח ישויך אליך אוטומטית.</p>}

            <Button type="submit" className="w-full" size="lg" disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {mode === "email" ? "שליחת הזמנה" : "יצירת קישור"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
