import { useCallback, useEffect, useState } from "react";
import { FolderCog, History, KeyRound, Send } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getLicenseModule, type LicenseModuleState } from "@/lib/licenses.functions";
import { LicenseSendForm } from "./LicenseSendForm";
import { LicenseHistory } from "./LicenseHistory";
import { LicenseFilesManager } from "./LicenseFilesManager";

type Tab = "send" | "history" | "files";

/**
 * "שליחת רישיון דיגיטלי ללקוח" — באזור המיילים של החנות.
 * מוצג רק כשהשרת מאשר: הפיילוט פעיל לחנות (לפי ה-host, לא לפי הדפדפן) ולמשתמש הרשאת ניהול.
 * בכל חנות אחרת / משתמש אחר — לא מוצג כלל (וגם כל פעולה בשרת נחסמת בנפרד).
 */
export function DigitalLicensesPanel() {
  const [module, setModule] = useState<LicenseModuleState | null>(null);
  const [tab, setTab] = useState<Tab>("send");
  const [historyKey, setHistoryKey] = useState(0);

  const reload = useCallback(async () => {
    try {
      setModule(await getLicenseModule());
    } catch {
      // המודול הוא תוספת לאזור המיילים — כשל בטעינה לא מפיל את שאר ההגדרות
      setModule((current) => current ?? { enabled: false });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!module || !module.enabled) return null;

  return (
    <Card className="overflow-hidden border-primary/20 shadow-card" data-testid="digital-licenses">
      <div className="bg-gradient-to-l from-[#0B1F4D] to-[#1F5FD6] px-4 py-4 text-white sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/15">
            <KeyRound className="size-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-bold leading-tight">שליחת רישיון דיגיטלי ללקוח</h2>
            <p className="text-sm text-white/90">
              Office / Windows — מפתח, מדריך התקנה וקישור הורדה מאובטח, במייל ממותג
            </p>
          </div>
        </div>
      </div>
      <CardContent className="p-4 sm:p-6">
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} dir="rtl" className="space-y-5">
          <TabsList className="h-auto w-full flex-wrap justify-start sm:w-auto">
            <TabsTrigger value="send" className="gap-1.5">
              <Send className="size-4" aria-hidden /> שליחה
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-1.5">
              <History className="size-4" aria-hidden /> היסטוריה
            </TabsTrigger>
            <TabsTrigger value="files" className="gap-1.5">
              <FolderCog className="size-4" aria-hidden /> קבצי ברירת מחדל
            </TabsTrigger>
          </TabsList>
          <TabsContent value="send" forceMount className="data-[state=inactive]:hidden">
            <LicenseSendForm
              files={module.files}
              branding={module.branding}
              configured={module.configured}
              onSent={() => setHistoryKey((k) => k + 1)}
              onManageFiles={() => setTab("files")}
              onOpenHistory={() => setTab("history")}
            />
          </TabsContent>
          <TabsContent value="history">
            <LicenseHistory refreshKey={historyKey} />
          </TabsContent>
          <TabsContent value="files">
            <LicenseFilesManager files={module.files} onChanged={reload} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
