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
import { createStaffUser, notifyCustomerAssigned } from "@/lib/admin.functions";
import {
  PasswordSetupFields,
  TempPasswordNotice,
  defaultPasswordSetup,
  type PasswordSetup,
} from "@/components/PasswordSetupFields";
import { usePriceTiersEnabled } from "@/hooks/usePriceTiers";
import { PriceListTypeSelect } from "@/components/PriceListTypeSelect";
import type { PriceListType } from "@/lib/price-list";

type AgentOption = { user_id: string; email: string };

/** יצירת חשבון לקוח חדש. סוכן משייך אוטומטית לעצמו; אדמין יכול לבחור סוכן */
export function CreateCustomerDialog({
  agents,
  defaultAgentId,
  onCreated,
}: {
  /** רשימת סוכנים לבחירה — מועבר רק ע"י האדמין; סוכן מקבל undefined */
  agents?: AgentOption[];
  defaultAgentId?: string | null;
  onCreated: () => void;
}) {
  const tiersEnabled = usePriceTiersEnabled();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [businessAddress, setBusinessAddress] = useState("");
  const [taxId, setTaxId] = useState("");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  // "" = טרם נבחר (שדה חובה) — אין ברירת מחדל שקטה, מוכרחים לבחור דרג
  // או "ללא קבוצה / אורח" במפורש לפני שאפשר ליצור את הלקוח.
  const [priceTier, setPriceTier] = useState<"" | "none" | "1" | "2" | "3">("");
  const [agentId, setAgentId] = useState<string>(defaultAgentId ?? "none");
  const [priceListType, setPriceListType] = useState<PriceListType>("regular");
  const [passwordSetup, setPasswordSetup] = useState<PasswordSetup>(defaultPasswordSetup);
  // מוצג אחרי היצירה במצב "סיסמה זמנית" — ההזדמנות היחידה להעתיק אותה
  const [created, setCreated] = useState<{
    email: string;
    password: string;
    emailed: boolean;
  } | null>(null);
  const createUser = useServerFn(createStaffUser);
  const notifyAssigned = useServerFn(notifyCustomerAssigned);

  const reset = () => {
    setEmail("");
    setBusinessName("");
    setBusinessAddress("");
    setTaxId("");
    setContactName("");
    setPhone("");
    setPriceTier("");
    setAgentId(defaultAgentId ?? "none");
    setPriceListType("regular");
    setPasswordSetup(defaultPasswordSetup);
    setCreated(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (tiersEnabled && priceTier === "") {
      toast.error("יש לבחור קבוצת מחיר, או 'ללא קבוצה / אורח' במפורש");
      return;
    }
    setBusy(true);
    try {
      const result = await createUser({
        data: {
          email,
          role: "customer",
          businessName,
          businessAddress,
          taxId,
          contactName,
          phone,
          priceTier: !tiersEnabled
            ? 1
            : priceTier === "none"
              ? null
              : (Number(priceTier) as 1 | 2 | 3),
          ...(agents ? { agentId: agentId === "none" ? null : agentId, priceListType } : {}),
          passwordMode: passwordSetup.mode,
          tempPassword: passwordSetup.tempPassword,
          emailTempPassword: passwordSetup.emailTempPassword,
        },
      });
      onCreated();
      try {
        await notifyAssigned({ data: { customerId: result.userId } });
      } catch {
        // כשל בשליחת מייל ההתראה לא מבטל את יצירת הלקוח — הוא כבר נוצר
      }

      if (result.mode === "temp" && result.tempPassword) {
        // לא סוגרים את הדיאלוג: המנהל צריך להעתיק את הסיסמה קודם
        setCreated({ email, password: result.tempPassword, emailed: result.emailed });
        toast.success("הלקוח נוצר. יש להעתיק את הסיסמה הזמנית");
        return;
      }

      toast.success(`הלקוח נוצר בהצלחה. נשלח אליו קישור ליצירת סיסמה (${email})`);
      if (priceListType === "custom") {
        toast.info("הלקוח במחירון אישי — קובעים לו מחירים בלשונית 'ניהול מחירי לקוחות מיוחדים'");
      }
      reset();
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "יצירת הלקוח נכשלה");
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
        <Button>
          <UserPlus className="size-4" />
          לקוח חדש
        </Button>
      </DialogTrigger>
      <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto text-right">
        <DialogHeader>
          <DialogTitle>יצירת חשבון לקוח חדש</DialogTitle>
          <DialogDescription>
            החשבון ייווצר מאושר. שם העסק והאימייל חובה; את שאר הפרטים הלקוח יחויב להשלים בכניסה
            הראשונה.
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
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="c-business">שם העסק</Label>
                <Input
                  id="c-business"
                  required
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="c-tax">ח.פ / עוסק מורשה (אופציונלי)</Label>
                <Input
                  id="c-tax"
                  dir="ltr"
                  value={taxId}
                  onChange={(e) => setTaxId(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-address">כתובת (אופציונלי)</Label>
              <Input
                id="c-address"
                value={businessAddress}
                onChange={(e) => setBusinessAddress(e.target.value)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="c-contact">איש קשר (אופציונלי)</Label>
                <Input
                  id="c-contact"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="c-phone">טלפון (אופציונלי)</Label>
                <Input
                  id="c-phone"
                  dir="ltr"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-email">אימייל</Label>
              <Input
                id="c-email"
                type="email"
                dir="ltr"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {tiersEnabled && (
                <div className="space-y-2">
                  <Label>
                    קבוצת מחיר <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={priceTier}
                    onValueChange={(v) => setPriceTier(v as typeof priceTier)}
                  >
                    <SelectTrigger
                      dir="rtl"
                      className={priceTier === "" ? "border-destructive" : ""}
                    >
                      <SelectValue placeholder="חובה לבחור..." />
                    </SelectTrigger>
                    <SelectContent dir="rtl">
                      <SelectItem value="none">ללא קבוצה / אורח (לא יראה מחירים)</SelectItem>
                      <SelectItem value="1">דרג 1</SelectItem>
                      <SelectItem value="2">דרג 2</SelectItem>
                      <SelectItem value="3">דרג 3</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              {agents && (
                <div className="space-y-2">
                  <Label>סוכן משויך</Label>
                  <Select value={agentId} onValueChange={setAgentId}>
                    <SelectTrigger dir="rtl">
                      <SelectValue placeholder="ללא סוכן" />
                    </SelectTrigger>
                    <SelectContent dir="rtl">
                      <SelectItem value="none">ללא סוכן</SelectItem>
                      {agents.map((a) => (
                        <SelectItem key={a.user_id} value={a.user_id}>
                          {a.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {/* סוג מחירון — מנהל בלבד (רק למנהל מועברת רשימת הסוכנים) */}
              {agents && <PriceListTypeSelect value={priceListType} onChange={setPriceListType} />}
            </div>
            <PasswordSetupFields value={passwordSetup} onChange={setPasswordSetup} />

            <Button type="submit" className="w-full" size="lg" disabled={busy}>
              {busy ? "יוצר..." : "צור לקוח"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
