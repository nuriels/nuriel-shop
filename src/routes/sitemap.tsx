import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, FolderTree, Map as MapIcon, Navigation } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoPage, LoadingLine } from "@/components/legal/InfoPage";
import { supabase } from "@/integrations/supabase/client";
import { useCategoryTree } from "@/hooks/useCategories";
import { useStorePages } from "@/hooks/useStorePages";
import { countByCategory, totalCounts, type CategoryNode } from "@/lib/category-tree";
import { fetchAllRows } from "@/lib/fetch-all";

export const Route = createFileRoute("/sitemap")({
  ssr: false,
  head: () => ({ meta: [{ title: "מפת האתר" }] }),
  component: SitemapPage,
});

/** הקטגוריות שיש בהן מוצרים (כולל בתת-הקטגוריות) — null בזמן הטעינה */
function useActiveCategoryCounts(): Map<string, number> | null {
  const tree = useCategoryTree();
  const [direct, setDirect] = useState<Map<string, number> | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchAllRows<{ category: string }>((from, to) =>
      supabase.rpc("get_catalog").select("category").order("id").range(from, to),
    ).then(({ data, error }) => {
      if (!alive) return;
      // בלי גישה לקטלוג (למשל תקלה) — מציגים את כל הקטגוריות
      setDirect(error ? new Map() : countByCategory(data));
    });
    return () => {
      alive = false;
    };
  }, []);
  return useMemo(() => (direct === null ? null : totalCounts(tree, direct)), [tree, direct]);
}

/**
 * מפת האתר (חלק 16א): מימין — כל הקטגוריות הפעילות (שיש בהן מוצרים), לפי
 * העץ; משמאל — העמודים הכלליים. (למנועי חיפוש יש גם /sitemap.xml)
 */
function SitemapPage() {
  const pages = useStorePages();
  const tree = useCategoryTree();
  const counts = useActiveCategoryCounts();
  const visible = (node: CategoryNode) =>
    counts === null || counts.size === 0 || (counts.get(node.name) ?? 0) > 0;
  const roots = tree.roots.filter(visible);

  return (
    <InfoPage
      title="מפת האתר"
      icon={<MapIcon aria-hidden="true" />}
      intro="כל הקטגוריות והעמודים באתר במקום אחד."
      wide
    >
      <div className="grid items-start gap-5 md:grid-cols-2">
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FolderTree className="size-4 text-primary" aria-hidden="true" />
              קטגוריות
            </CardTitle>
          </CardHeader>
          <CardContent>
            {counts === null && roots.length === 0 ? (
              <LoadingLine />
            ) : roots.length === 0 ? (
              <p className="text-sm text-muted-foreground">אין עדיין קטגוריות באתר.</p>
            ) : (
              <CategoryList nodes={roots} visible={visible} />
            )}
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Navigation className="size-4 text-primary" aria-hidden="true" />
              עמודים כלליים
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              <PageLink>
                <Link to="/">דף הבית — הקטלוג</Link>
              </PageLink>
              <PageLink>
                <Link to="/account">החשבון שלי</Link>
              </PageLink>
              <PageLink>
                <Link to="/account" search={{ tab: "orders" }}>
                  ההזמנות שלי
                </Link>
              </PageLink>
              <PageLink>
                <Link to="/" search={{ cart: "open" }}>
                  עגלת קניות
                </Link>
              </PageLink>
              <PageLink>
                <Link to="/checkout">קופה</Link>
              </PageLink>
              <PageLink>
                <Link to="/login">התחברות</Link>
              </PageLink>
              <PageLink>
                <Link to="/register">הרשמה</Link>
              </PageLink>
              <PageLink>
                <Link to="/about">אודות</Link>
              </PageLink>
              <PageLink>
                <Link to="/contact">צור קשר</Link>
              </PageLink>
              <PageLink>
                <Link to="/terms">תקנון האתר</Link>
              </PageLink>
              <PageLink>
                <Link to="/privacy">מדיניות פרטיות</Link>
              </PageLink>
              <PageLink>
                <Link to="/cancellations">ביטול עסקה</Link>
              </PageLink>
              <PageLink>
                <Link to="/about" hash="accessibility">
                  הצהרת נגישות
                </Link>
              </PageLink>
              {/* חלק 30: עמודי התוכן שבעל החנות פרסם */}
              {(pages ?? []).map((page) => (
                <PageLink key={page.id}>
                  <Link to="/pages/$slug" params={{ slug: page.slug }}>
                    {page.title}
                  </Link>
                </PageLink>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </InfoPage>
  );
}

function PageLink({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-center gap-1.5 text-sm [&_a]:text-foreground [&_a]:underline-offset-4 [&_a:hover]:text-primary [&_a:hover]:underline">
      <ChevronLeft className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      {children}
    </li>
  );
}

function CategoryList({
  nodes,
  visible,
}: {
  nodes: CategoryNode[];
  visible: (node: CategoryNode) => boolean;
}) {
  return (
    <ul className="space-y-1.5">
      {nodes.map((node) => {
        const children = node.children.filter(visible);
        return (
          <li key={node.name} className="space-y-1.5">
            <span className="flex items-center gap-1.5 text-sm">
              <span
                aria-hidden="true"
                className={
                  node.depth === 1
                    ? "size-1.5 shrink-0 rounded-full bg-primary"
                    : "size-1.5 shrink-0 rounded-full border border-muted-foreground"
                }
              />
              <Link
                to="/"
                search={{ category: node.name }}
                className={
                  node.depth === 1
                    ? "font-semibold text-foreground underline-offset-4 hover:text-primary hover:underline"
                    : "text-foreground underline-offset-4 hover:text-primary hover:underline"
                }
              >
                {node.name}
              </Link>
            </span>
            {children.length > 0 && (
              <div className="ms-3 border-s border-border ps-3">
                <CategoryList nodes={children} visible={visible} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
