import { useState } from "react";
import { Loader2, UserCog } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { updateUserDetails } from "@/lib/admin.functions";
import { ROLE_LABEL } from "@/lib/admin";
import type { Role } from "@/hooks/useAuthState";
import { cn } from "@/lib/utils";

const ROLE_EXPLAIN: Record<Role, string> = {
  customer: "רואה את הקטלוג ומזמין. אין לו גישה לניהול.",
  agent:
    "מטפל בלקוחות שמשויכים אליו: יוצר הזמנות, רואה תיק לקוח ושולח מסמכים. מספר סוכן יוקצה אוטומטית.",
  warehouse:
    "מלאי, ליקוט, מדבקות ברקוד ועדכון סטטוס משלוח. אין לו גישה למחירים, להכנסות, ללקוחות או להגדרות.",
  cashier:
    "קופה מהירה בלבד: יוצר הזמנות בקופה ורואה מוצרים. אין לו גישה להכנסות, להזמנות קודמות או להגדרות.",
  admin:
    "מנהל חנות: גישה לכל הניהול — מוצרים, הזמנות, משתמשים והגדרות. שינוי החבילה ומינוי מנהלים — רק בעל החנות.",
};

/**
 * שינוי תפקיד מפורש — למשל עובד שנרשם בטעות כלקוח והופך לסוכן.
 * תמיד דרך חלון אישור שמסביר מה התפקיד החדש מאפשר. קידום לסוכן/מנהל
 * מאשר את המשתמש אוטומטית (בשרת), והפרטים העסקיים שלו נשמרים.
 */
export function ChangeRoleDialog({
  userId,
  name,
  currentRole,
  isProtected,
  onChanged,
}: {
  userId: string;
  name: string;
  currentRole: Role;
  isProtected: boolean;
  onChanged: (next: Role) => void;
}) {
  const save = useServerFn(updateUserDetails);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<Role | null>(null);
  const [busy, setBusy] = useState(false);

  if (isProtected) return null;

  const options = (["customer", "agent", "cashier", "warehouse", "admin"] as Role[]).filter(
    (role) => role !== currentRole,
  );

  const confirm = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await save({ data: { userId, role: target } });
      toast.success(`${name} הוא עכשיו ${ROLE_LABEL[target]}`);
      setOpen(false);
      onChanged(target);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "שינוי התפקיד נכשל");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setOpen(next);
        if (next) setTarget(null);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="outline">
          <UserCog className="size-4" />
          שינוי תפקיד
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent dir="rtl" className="text-right">
        <AlertDialogHeader className="text-right">
          <AlertDialogTitle>שינוי תפקיד: {name}</AlertDialogTitle>
          <AlertDialogDescription>
            התפקיד הנוכחי: <strong className="text-foreground">{ROLE_LABEL[currentRole]}</strong>.
            בחרו תפקיד חדש:
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div role="radiogroup" aria-label="תפקיד חדש" className="space-y-2">
          {options.map((role) => (
            <button
              key={role}
              type="button"
              role="radio"
              aria-checked={target === role}
              onClick={() => setTarget(role)}
              className={cn(
                "w-full rounded-lg border-2 p-3 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                target === role
                  ? "border-accent bg-secondary"
                  : "border-border hover:border-accent/60",
              )}
            >
              <span className="block font-semibold text-foreground">{ROLE_LABEL[role]}</span>
              <span className="mt-0.5 block text-sm text-muted-foreground">
                {ROLE_EXPLAIN[role]}
              </span>
            </button>
          ))}
        </div>

        {target === "admin" && (
          <p className="rounded-md border border-accent/40 bg-accent/10 p-2.5 text-sm text-foreground">
            הרשאת מנהל נותנת שליטה מלאה, כולל מחיקת משתמשים ושינוי מחירים. תנו אותה רק למי שצריך.
          </p>
        )}
        {currentRole === "customer" && target !== null && target !== "customer" && (
          <p className="text-xs text-muted-foreground">
            אם המשתמש עדיין ממתין לאישור, הוא יאושר אוטומטית. הפרטים העסקיים שלו נשמרים.
          </p>
        )}

        <AlertDialogFooter className="gap-2 sm:justify-start">
          <Button onClick={() => void confirm()} disabled={busy || target === null}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {target ? `כן, לשנות ל${ROLE_LABEL[target]}` : "בחרו תפקיד"}
          </Button>
          <AlertDialogCancel disabled={busy}>ביטול</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
