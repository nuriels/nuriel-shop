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

/** יצירת חשבון סוכן/מנהל ע"י אדמין */
export function CreateStaffAccountDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<"agent" | "admin" | "warehouse">("agent");
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
    setRole("agent");
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
        <Button variant="outline">
          <UserPlus className="size-4" />
          סוכן/מנהל חדש
        </Button>
      </DialogTrigger>
      <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto text-right">
        <DialogHeader>
          <DialogTitle>יצירת חשבון צוות</DialogTitle>
          <DialogDescription>קישור לקביעת סיסמה, או סיסמה זמנית להעברה ידנית</DialogDescription>
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
              <Select
                value={role}
                onValueChange={(v) => setRole(v as "agent" | "admin" | "warehouse")}
              >
                <SelectTrigger dir="rtl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent dir="rtl">
                  <SelectItem value="agent">סוכן</SelectItem>
                  <SelectItem value="warehouse">מחסנאי (ליקוט בלבד)</SelectItem>
                  <SelectItem value="admin">מנהל</SelectItem>
                </SelectContent>
              </Select>
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
