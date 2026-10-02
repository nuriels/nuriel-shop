import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Eye, MoonStar, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { SabbathScreen } from "@/components/SabbathScreen";
import { refreshSiteSettings } from "@/hooks/useSiteSettings";
import { saveSabbathMode } from "@/lib/site";

/**
 * מצב שבת בהגדרות החנות. המתג נשמר מיד (בלי כפתור "שמירה"), כדי שלא יישכח
 * לפני כניסת שבת. כשהוא דולק — הקטלוג מוסתר ללקוחות ולאורחים ואי אפשר להזמין.
 */
export function SabbathModeCard({
  checked,
  storeName,
  onSaved,
}: {
  checked: boolean;
  storeName: string;
  onSaved: (on: boolean) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);

  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      await saveSabbathMode(on);
      onSaved(on);
      await refreshSiteSettings();
      // מסך השבת ופס התזכורת נשענים על נתוני ה-root — טוענים מחדש
      await router.invalidate();
      toast.success(
        on ? "מצב שבת הופעל — הלקוחות רואים עכשיו מסך שבת שלום" : "מצב שבת כובה — החנות פתוחה",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className={checked ? "border-amber-400 shadow-card" : "shadow-card"}>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <MoonStar className="size-4" /> מצב שבת
        </CardTitle>
        <Button type="button" variant="outline" size="sm" onClick={() => setPreview(true)}>
          <Eye className="size-4" /> תצוגה מקדימה
        </Button>
      </CardHeader>
      <CardContent>
        <label className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
          <span className="space-y-1">
            <span className="block text-sm font-medium">
              {checked ? "מצב שבת פעיל — החנות סגורה ללקוחות" : "להפעיל מצב שבת"}
            </span>
            <span className="block text-xs text-muted-foreground">
              לקוחות ואורחים יראו מסך "שבת שלום — האתר שומר שבת ויחזור לפעילות במוצאי שבת" במקום
              הקטלוג, ואי אפשר יהיה לבצע הזמנות (גם לא מלשונית שנשארה פתוחה). אתם והצוות ממשיכים
              לעבוד כרגיל. המתג נשמר מיד.
            </span>
          </span>
          <Switch
            checked={checked}
            disabled={busy}
            onCheckedChange={(v) => void toggle(v)}
            aria-label="מצב שבת"
          />
        </label>
      </CardContent>

      {preview && (
        <div
          className="fixed inset-0 z-[60]"
          role="dialog"
          aria-modal="true"
          aria-label="תצוגה מקדימה של מסך השבת"
        >
          <SabbathScreen storeName={storeName} />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="absolute left-4 top-4"
            onClick={() => setPreview(false)}
          >
            <X className="size-4" /> סגירת התצוגה המקדימה
          </Button>
        </div>
      )}
    </Card>
  );
}
