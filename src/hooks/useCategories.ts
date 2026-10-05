import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { buildCategoryTree, type CategoryRow, type CategoryTree } from "@/lib/category-tree";

/** מטמון ברמת המודול — הקטגוריות נטענות פעם אחת לכל הדפדוף (גם לאורחים) */
let cached: CategoryRow[] | null = null;
const listeners = new Set<(next: CategoryRow[]) => void>();

export async function fetchCategoryRows(force = false): Promise<CategoryRow[]> {
  if (cached !== null && !force) return cached;
  const { data, error } = await supabase
    .from("categories")
    .select("id, name, parent_name, sort_order, image_url, show_on_homepage")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) {
    // אין רשימת ברירת מחדל: קטגוריות נוצרות ידנית ע"י המנהל בלבד, ולכן
    // לא מציגים "קטגוריות פנטום" שאינן קיימות במסד.
    return cached ?? [];
  }
  cached = data as CategoryRow[];
  for (const listener of listeners) listener(cached);
  return cached;
}

/** ניקוי המטמון אחרי שינוי בניהול הקטגוריות + עדכון כל המסכים הפתוחים */
export async function refreshCategories(): Promise<CategoryRow[]> {
  return fetchCategoryRows(true);
}

function useCategoryRows(): CategoryRow[] {
  const [rows, setRows] = useState<CategoryRow[]>(cached ?? []);
  useEffect(() => {
    listeners.add(setRows);
    void fetchCategoryRows().then(setRows);
    return () => {
      listeners.delete(setRows);
    };
  }, []);
  return rows;
}

/** עץ הקטגוריות החי — מתעדכן בכל המסכים הפתוחים אחרי שינוי בניהול */
export function useCategoryTree(): CategoryTree {
  const rows = useCategoryRows();
  return useMemo(() => buildCategoryTree(rows), [rows]);
}

/** כל שמות הקטגוריות בסדר העץ (אב ואחריו הילדים שלו) */
export function useCategories(): string[] {
  const tree = useCategoryTree();
  return useMemo(() => tree.flat.map((node) => node.name), [tree]);
}
