// R-3: קובץ rollback לא מוחק נתוני לקוחות בשקט. כל קובץ שמסיר טבלה / עמודה או מוחק שורות חייב בלוק
// DO עם RAISE EXCEPTION (הגנה: נעצר כשיש נתונים) — או להופיע כאן ברשימת החריגים עם סיבה. מיגרציה חדשה
// עם rollback הרסני בלי הגנה נכשלת ב-CI. ההוכחה שההגנות באמת עוצרות: scripts/db-tests/rollback-guards.sh.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROLLBACKS = join(process.cwd(), "supabase/rollbacks");

/** בלי הערות ובלי גופי פונקציות / בלוקי DO ($tag$ … $tag$) — מה שנשאר הוא מה שהקובץ מריץ ישירות */
function topLevelSql(sql: string): string {
  return sql.replace(/--[^\n]*/g, "").replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, "");
}
function hasDataGuard(sql: string): boolean {
  const blocks = [...sql.matchAll(/^DO \$(\w*)\$([\s\S]*?)\$\1\$;/gm)];
  return blocks.some((m) => (m[2] ?? "").includes("RAISE EXCEPTION"));
}
const DESTRUCTIVE =
  /\bDROP\s+TABLE\b|\bDROP\s+COLUMN\b|\bDELETE\s+FROM\b|\bTRUNCATE\b|\bDROP\s+SCHEMA\b/i;

/** חריגים מכוונים — לא נתוני לקוח שאי אפשר לשחזר (כל אחד עם הסיבה) */
const ALLOWED_WITHOUT_GUARD: Record<string, string> = {
  "20261101100000_ecommerce_engine_guard.down.sql":
    "מוחק את שורות רישום התפקידים של Ecommerce (platform_product_roles) — הגדרות פלטפורמה שהמיגרציה זורעת; בהחלה מחדש חוזרות",
  "20261101140000_hosp_coupon_release.down.sql":
    "מוחק את promotion_released_at — סמן פנימי שמונע שחרור כפול של שימוש בקופון; מספרי השימוש עצמם נשארים",
  "20261103090000_hosp_security.down.sql":
    "מוחק את rate_buckets — מוני הגבלת קצב זמניים (דקות); לא נתוני לקוח",
  "20261105160000_hosp_confirm_link.down.sql":
    "מוחק manage_token2_hash — גיבוב של הקישור השני במייל האישור; הקישור הראשון ו'ההזמנות שלי' ממשיכים לעבוד. השפעה מתועדת (קישורים שנשלחו אחרי המיגרציה מפסיקים לעבוד); הגנה הייתה חוסמת rollback בכל מערכת חיה",
  "20261105120000_hosp_setup_guide.down.sql":
    "מוחק את setup_state — מצב תצוגה של מדריך ההקמה (איפה העסק עצר), לא נתוני עסק",
  "20261105170000_hosp_portal_open.down.sql":
    "מוחק את הקישור בקשת-פתיחה → עסק (opened_at / opened_tenant_id); הקישור נשאר ביומן הפלטפורמה (hosp_site_opened)",
  "20261108110000_hosp_guest_area.down.sql":
    "מוחק guest_codes / guest_sessions — קודי כניסה והתחברויות זמניים; הלקוחות פשוט נכנסים שוב",
  "20261111100000_hosp_hero_video_verified.down.sql":
    "מוחק duration_checked_at / video_codec ומאפס duration_seconds — מטא-דאטה שנמדדת מחדש מהקובץ",
  "20261113100000_hosp_business_admin.down.sql":
    "מוחק מינויי 'מנהל/ת עסק' (staff_grants) — הרשאות בלבד; הבעלים נשארים, וניתן למנות מחדש",
  "20261118110000_order_guard.down.sql":
    "מוחק coupon_grants — אישורי קופון זמניים (שעה); לא נתוני לקוח",
};

const files = readdirSync(ROLLBACKS).filter((f) => f.endsWith(".down.sql"));

describe("rollback files do not silently delete customer data (R-3)", () => {
  it("every destructive rollback has a data guard, or is a documented exception", () => {
    const unguarded = files.filter((f) => {
      const sql = readFileSync(join(ROLLBACKS, f), "utf8");
      return DESTRUCTIVE.test(topLevelSql(sql)) && !hasDataGuard(sql);
    });
    expect(unguarded.sort()).toEqual(Object.keys(ALLOWED_WITHOUT_GUARD).sort());
  });

  it("an exception that no longer exists (or gained a guard) is removed from the list", () => {
    for (const f of Object.keys(ALLOWED_WITHOUT_GUARD)) {
      expect(files, f).toContain(f);
      expect(hasDataGuard(readFileSync(join(ROLLBACKS, f), "utf8")), f).toBe(false);
    }
  });

  it("every rollback runs inside a transaction, so a guard failure leaves nothing half-done", () => {
    for (const f of files) {
      const sql = readFileSync(join(ROLLBACKS, f), "utf8");
      expect(/^BEGIN;/m.test(sql) && /^COMMIT;/m.test(sql), f).toBe(true);
    }
  });
});
