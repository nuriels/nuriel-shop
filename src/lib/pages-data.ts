import { supabase } from "@/integrations/supabase/client";
import type { StorePage, StorePageLink } from "@/lib/pages";

/**
 * עמודי תוכן (חלק 30) — גישה לנתונים מהדפדפן. ההרשאות במסד (RLS): כל חנות
 * רואה רק את העמודים שלה; עמוד שפורסם — לכולם, טיוטה — רק למנהל החנות;
 * כתיבה — מנהל החנות בלבד.
 */

const PAGE_COLUMNS =
  "id, slug, title, content_html, is_published, sort_order, created_at, updated_at";

function fail(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

/** עמוד לפי כתובת — לחזית החנות (מנהל רואה גם טיוטה) */
export async function loadStorePage(slug: string): Promise<StorePage | null> {
  const value = slug.trim().toLowerCase();
  if (!/^[a-z0-9-]{1,80}$/.test(value)) return null;
  const { data, error } = await supabase
    .from("pages")
    .select(PAGE_COLUMNS)
    .eq("slug", value)
    .maybeSingle();
  fail(error);
  return (data as StorePage | null) ?? null;
}

/** העמודים שפורסמו — ל"מידע שימושי" בתחתית האתר ולמפת האתר */
export async function loadPublishedPageLinks(): Promise<StorePageLink[]> {
  const { data, error } = await supabase
    .from("pages")
    .select("id, slug, title")
    .eq("is_published", true)
    .order("sort_order")
    .order("created_at");
  fail(error);
  return (data as StorePageLink[] | null) ?? [];
}

/** כל העמודים (גם טיוטות) — לניהול */
export async function loadAllPages(): Promise<StorePage[]> {
  const { data, error } = await supabase
    .from("pages")
    .select(PAGE_COLUMNS)
    .order("sort_order")
    .order("created_at");
  fail(error);
  return (data as StorePage[] | null) ?? [];
}

export type PageDraft = {
  title: string;
  slug: string;
  content_html: string;
  is_published: boolean;
};

/** יצירה (id = null) או עדכון */
export async function savePage(id: string | null, draft: PageDraft): Promise<StorePage> {
  const row = {
    title: draft.title.trim(),
    slug: draft.slug.trim().toLowerCase(),
    content_html: draft.content_html,
    is_published: draft.is_published,
  };
  const query = id
    ? supabase.from("pages").update(row).eq("id", id).select(PAGE_COLUMNS).single()
    : supabase.from("pages").insert(row).select(PAGE_COLUMNS).single();
  const { data, error } = await query;
  fail(error);
  return data as StorePage;
}

export async function setPagePublished(id: string, published: boolean): Promise<void> {
  const { error } = await supabase.from("pages").update({ is_published: published }).eq("id", id);
  fail(error);
}

export async function deletePage(id: string): Promise<void> {
  const { error } = await supabase.from("pages").delete().eq("id", id);
  fail(error);
}

/** סדר חדש לכל הרשימה (1, 2, 3…) — רק השורות שהמקום שלהן השתנה */
export async function savePageOrder(pages: Pick<StorePage, "id" | "sort_order">[]): Promise<void> {
  const changes = pages
    .map((page, index) => ({ id: page.id, from: page.sort_order, to: index + 1 }))
    .filter((change) => change.from !== change.to);
  for (const change of changes) {
    const { error } = await supabase
      .from("pages")
      .update({ sort_order: change.to })
      .eq("id", change.id);
    fail(error);
  }
}
