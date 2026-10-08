import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createStaffUser } from "@/lib/admin.functions";
import {
  PasswordSetupFields,
  TempPasswordNotice,
  defaultPasswordSetup,
  type PasswordSetup,
} from "@/components/PasswordSetupFields";

type StaffAccountRole = "agent" | "admin" | "warehouse" | "cashier";

/** יצירת חשבון צוות (סוכן / קופאי / מחסנאי / מנהל) ע"י מנהל */
export function CreateStaffAccountDialog({
  onCreated,
  adminSeatsFull = false,
  canAddManagers = true,
  defaultRole = "agent",
  triggerLabel = "סוכן/מנהל חדש",
}: {
  onCreated: () => void;
  /** חלק 24: החנות הגיעה למגבלת המנהלים בחבילה — אי אפשר לבחור "מנהל" */
  adminSeatsFull?: boolean;
  /** חלק 33: רק בעל החנות ממנה מנהלים */
  canAddManagers?: boolean;
  defaultRole?: StaffAccountRole;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<StaffAccountRole>(defaultRole);
  const [busy, setBusy] = useState(false);
  const [passwordSetup, setPasswordSetup] = useState<PasswordSetup>(defaultPasswordSetup);
  const [created, setCreated] = useState<{
    email: string;
    password: string;
    emailed: boolean;
  } | null>(null);
  const createUser = useServerFn(createStaffUser);

  const reset = () => {
    setEmail("");
    setDisplayName("");
    setRole(defaultRole);
    setPasswordSetup(defaultPasswordSetup);
    setCreated(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await createUser({
        data: {
          email,
          role,
          displayName,
          passwordMode: passwordSetup.mode,
          tempPassword: passwordSetup.tempPassword,
          emailTempPassword: passwordSetup.emailTempPassword,
        },
      });
      onCreated();

      // חלק 18ב: לאימייל כבר היה חשבון (למשל מנהל של חנות אחרת) — צורף לחנות הזו
      if (result.mode === "existing") {
        toast.success(
          `${email} כבר רשום/ה במערכת — החשבון צורף לחנות. הכניסה עם הסיסמה הקיימת, והמעבר בין החנויות ממחליף החנויות בניהול.`,
        );
        reset();
        setOpen(false);
        return;
      }

      if (result.mode === "temp" && result.tempPassword) {
        setCreated({ email, password: result.tempPassword, emailed: result.emailed });
        toast.success("המשתמש נוצר. יש להעתיק את הסיסמה הזמנית");
        return;
      }

      toast.success(`המשתמש נוצר בהצלחה. נשלח אליו קישור ליצירת סיסמה (${email})`);
      reset();
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "יצירת המשתמש נכשלה");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" data-testid="staff-invite">
          <UserPlus className="size-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto text-right">
        <DialogHeader>
          <DialogTitle>יצירת חשבון צוות</DialogTitle>
          <DialogDescription>
            קישור לקביעת סיסמה, או סיסמה זמנית להעברה ידנית. כבר יש לאימייל חשבון (למשל מנהל של חנות
            אחרת)? החשבון הקיים יצורף לחנות הזו.
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="space-y-4">
            <TempPasswordNotice
              email={created.email}
              password={created.password}
              emailed={created.emailed}
            />
            <Button
              className="w-full"
              size="lg"
              onClick={() => {
                reset();
                setOpen(false);
              }}
            >
              סיום
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="staff-display-name">שם מלא בעברית</Label>
              <Input
                id="staff-display-name"
                required
                maxLength={60}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="למשל: יוסי כהן"
              />
              <p className="text-xs text-muted-foreground">
                הלקוחות יראו את השם הזה במסמכים ובאזור האישי, במקום שם המשתמש.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="staff-email">אימייל</Label>
              <Input
                id="staff-email"
                type="email"
                dir="ltr"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>תפקיד</Label>
              <Select value={role} onValueChange={(v) => setRole(v as StaffAccountRole)}>
                <SelectTrigger dir="rtl" data-testid="staff-invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent dir="rtl">
                  <SelectItem value="cashier">קופאי (קופה מהירה בלבד)</SelectItem>
                  <SelectItem value="warehouse">מחסנאי (מלאי, ליקוט ומשלוחים)</SelectItem>
                  <SelectItem value="agent">סוכן מכירות</SelectItem>
                  <SelectItem value="admin" disabled={adminSeatsFull || !canAddManagers}>
                    {!canAddManagers
                      ? "מנהל חנות — רק בעל החנות ממנה מנהלים"
                      : adminSeatsFull
                        ? "מנהל חנות — הגעת למגבלה בחבילה"
                        : "מנהל חנות"}
                  </SelectItem>
                </SelectContent>
              </Select>
              {adminSeatsFull && canAddManagers && (
                <p className="text-xs text-muted-foreground">
                  הגעת למגבלת המנהלים בחבילה. להוספת מנהל — &quot;שלח בקשת שדרוג&quot; בראש המסך.
                </p>
              )}
            </div>
            <PasswordSetupFields value={passwordSetup} onChange={setPasswordSetup} />

            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "יוצר..." : "צור חשבון"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
