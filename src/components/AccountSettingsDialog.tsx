import { useEffect, useState } from "react";
import { Loader2, Settings } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const USERNAME_PATTERN = /^[a-z0-9_.]{3,30}$/;

type BusinessForm = {
  business_name: string;
  business_address: string;
  tax_id: string;
  contact_name: string;
  phone: string;
};

/**
 * אזור אישי: שם משתמש, סיסמה, ועבור לקוחות עסקיים גם עדכון עצמי של
 * פרטי העסק (כתובת למשלוח, טלפון ואיש קשר). קבוצת המחיר והשיוך לסוכן
 * נשארים בשליטת המנהל בלבד — גם ב-RLS וגם בטריגר במסד.
 */
export function AccountSettingsDialog({
  userId,
  currentUsername,
  isCustomer = false,
}: {
  userId: string;
  currentUsername: string;
  isCustomer?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState(currentUsername);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingUsername, setSavingUsername] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [business, setBusiness] = useState<BusinessForm | null>(null);
  const [loadingBusiness, setLoadingBusiness] = useState(false);
  const [savingBusiness, setSavingBusiness] = useState(false);

  useEffect(() => {
    if (!open || !isCustomer) return;
    setLoadingBusiness(true);
    void (async () => {
      const { data, error } = await supabase
        .from("customer_profiles")
        .select("business_name, business_address, tax_id, contact_name, phone")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) toast.error(error.message);
      setBusiness((data as BusinessForm | null) ?? null);
      setLoadingBusiness(false);
    })();
  }, [open, isCustomer, userId]);

  const saveBusiness = async (e: React.FormEvent) => {
    e.preventDefault();
    if (business === null) return;
    if (business.business_address.trim().length < 2 || business.phone.trim().length < 7) {
      toast.error("נא למלא כתובת וטלפון תקינים");
      return;
    }
    setSavingBusiness(true);
    const { error } = await supabase
      .from("customer_profiles")
      .update({
        business_name: business.business_name.trim(),
        business_address: business.business_address.trim(),
        tax_id: business.tax_id.trim(),
        contact_name: business.contact_name.trim(),
        phone: business.phone.trim(),
      })
      .eq("user_id", userId);
    setSavingBusiness(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("פרטי העסק עודכנו");
  };

  const saveUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = username.trim().toLowerCase();
    if (!USERNAME_PATTERN.test(clean)) {
      toast.error("שם משתמש: 3–30 תווים — אותיות/ספרות באנגלית, נקודה או קו תחתון בלבד");
      return;
    }
    setSavingUsername(true);
    const { error } = await supabase
      .from("user_roles")
      .update({ username: clean })
      .eq("user_id", userId);
    setSavingUsername(false);
    if (error) {
      toast.error(error.message.includes("duplicate") ? "שם המשתמש הזה כבר תפוס" : error.message);
      return;
    }
    setUsername(clean);
    toast.success("שם המשתמש עודכן");
  };

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      toast.error("סיסמה חייבת להכיל לפחות 6 תווים");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("הסיסמאות אינן תואמות");
      return;
    }
    setSavingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSavingPassword(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setNewPassword("");
    setConfirmPassword("");
    toast.success("הסיסמה עודכנה");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label="הגדרות חשבון"
          className="border-white/25 bg-transparent text-primary-foreground hover:bg-white/10 hover:text-primary-foreground"
        >
          <Settings className="size-4" />
          <span className="hidden sm:inline">הגדרות חשבון</span>
        </Button>
      </DialogTrigger>
      <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto text-right sm:max-w-md">
        <DialogHeader>
          <DialogTitle>הגדרות חשבון</DialogTitle>
          <DialogDescription>
            {isCustomer ? "שם משתמש, סיסמה ופרטי העסק שלך" : "שינוי שם המשתמש (לכניסה) והסיסמה שלך"}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue={isCustomer ? "business" : "login"} dir="rtl">
          <TabsList className="w-full">
            {isCustomer && (
              <TabsTrigger value="business" className="flex-1">
                פרטי העסק
              </TabsTrigger>
            )}
            <TabsTrigger value="login" className="flex-1">
              כניסה וסיסמה
            </TabsTrigger>
          </TabsList>

          {isCustomer && (
            <TabsContent value="business" className="pt-4">
              {loadingBusiness ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  טוען את הפרטים...
                </p>
              ) : business === null ? (
                <p className="text-sm text-muted-foreground">לא נמצאו פרטי עסק לחשבון הזה.</p>
              ) : (
                <form onSubmit={saveBusiness} className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="acc-business-name">שם העסק</Label>
                    <Input
                      id="acc-business-name"
                      value={business.business_name}
                      onChange={(e) => setBusiness({ ...business, business_name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="acc-address">כתובת למשלוח</Label>
                    <Input
                      id="acc-address"
                      value={business.business_address}
                      onChange={(e) =>
                        setBusiness({ ...business, business_address: e.target.value })
                      }
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="acc-contact">איש קשר</Label>
                      <Input
                        id="acc-contact"
                        value={business.contact_name}
                        onChange={(e) => setBusiness({ ...business, contact_name: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="acc-phone">טלפון</Label>
                      <Input
                        id="acc-phone"
                        type="tel"
                        dir="ltr"
                        value={business.phone}
                        onChange={(e) => setBusiness({ ...business, phone: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="acc-tax">ח.פ / עוסק מורשה</Label>
                    <Input
                      id="acc-tax"
                      dir="ltr"
                      value={business.tax_id}
                      onChange={(e) => setBusiness({ ...business, tax_id: e.target.value })}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    תנאי המחיר והסוכן המטפל נקבעים על ידי המנהל ואינם ניתנים לשינוי כאן.
                  </p>
                  <Button type="submit" className="w-full" size="lg" disabled={savingBusiness}>
                    {savingBusiness ? "שומר..." : "שמירת פרטי העסק"}
                  </Button>
                </form>
              )}
            </TabsContent>
          )}

          <TabsContent value="login" className="space-y-4 pt-4">
            <form onSubmit={saveUsername} className="space-y-2 border-b border-border pb-4">
              <Label htmlFor="acc-username">שם משתמש</Label>
              <div className="flex gap-2">
                <Input
                  id="acc-username"
                  dir="ltr"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  maxLength={30}
                />
                <Button type="submit" disabled={savingUsername}>
                  {savingUsername ? "שומר..." : "שמירה"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                ניתן להתחבר בשם המשתמש הזה במקום באימייל.
              </p>
            </form>

            <form onSubmit={savePassword} className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="acc-new-password">סיסמה חדשה</Label>
                <Input
                  id="acc-new-password"
                  type="password"
                  dir="ltr"
                  minLength={6}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="acc-confirm-password">אימות סיסמה</Label>
                <Input
                  id="acc-confirm-password"
                  type="password"
                  dir="ltr"
                  minLength={6}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
              <Button type="submit" className="w-full" disabled={savingPassword}>
                {savingPassword ? "מעדכן..." : "עדכון סיסמה"}
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
