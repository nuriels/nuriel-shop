import { createContext, useContext, type ReactNode } from "react";
import type { CategoryRow } from "@/lib/category-tree";
import type { BannerSet } from "@/lib/banners";
import type { CatalogItem } from "@/lib/catalog";
import type { SiteSettings } from "@/lib/site";

/**
 * עמודי החנות שנבנים בשרת (SEO): מה שאורח היה רואה — נטען בשרת של הבקשה (מוגבל לחנות שלה) ומשמש
 * כמצב ההתחלתי של העמוד, גם בשרת וגם ברינדור הראשון בדפדפן (כך שה-HTML זהה ואין אי-התאמה בהידרציה).
 * אחרי הטעינה הדפדפן ממשיך כמו קודם: טוען שוב לפי מי שמחובר (מחיר אישי / דרג), עגלה, מלאי עדכני.
 *
 * אין כאן מידע אישי: אין משתמש בשרת (המחירון של אורח), ההגדרות — אותן עמודות שכל אורח קורא בדפדפן.
 */
export type StorefrontSeed = {
  settings: SiteSettings;
  categories: CategoryRow[];
  /** null — לא נטען (עמוד בלי קטלוג, או מצב תחזוקה: לא שולחים מוצרים ב-HTML) */
  catalog: CatalogItem[] | null;
  /** הבאנרים של מסך הבית (רק בעמוד הבית) — כדי שלא "יקפצו" אחרי הטעינה */
  banners: BannerSet | null;
};

const SeedContext = createContext<StorefrontSeed | null>(null);

export function StorefrontSeedProvider({
  seed,
  children,
}: {
  seed: StorefrontSeed | null | undefined;
  children: ReactNode;
}) {
  return <SeedContext.Provider value={seed ?? null}>{children}</SeedContext.Provider>;
}

/** הנתונים מהשרת לעמוד הנוכחי — או null (עמוד שלא נבנה בשרת / ניווט בדפדפן) */
export function useStorefrontSeed(): StorefrontSeed | null {
  return useContext(SeedContext);
}

/** טוענים בשרת רק בטעינה הראשונה של העמוד; בניווט בתוך האתר הדפדפן כבר טוען בעצמו */
export const isServerRender = (): boolean => typeof window === "undefined";
