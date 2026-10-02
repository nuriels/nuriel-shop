import { StockSearch } from "@/components/StockSearch";

/** בדיקת מלאי למחסנאי: כמה יש, כמה שמור ואיפה — בלי מחירים */
export function StockCheckPanel() {
  return (
    <div className="space-y-4" dir="rtl">
      <div>
        <h2 className="text-xl font-bold text-foreground">בדיקת מלאי</h2>
        <p className="text-sm text-muted-foreground">
          חיפוש לפי שם או מק"ט, או סריקת ברקוד. "פנוי" = מה שאפשר למכור / להעביר; "שמור" = כבר
          בהזמנות פתוחות.
        </p>
      </div>
      <StockSearch autoFocus />
    </div>
  );
}
