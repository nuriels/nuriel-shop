import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, LayoutGrid, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { CategoryNode, CategoryTree } from "@/lib/category-tree";
import { cn } from "@/lib/utils";
import { useBackToClose } from "@/hooks/useBackToClose";

type NavProps = {
  tree: CategoryTree;
  value: string | null;
  onChange: (next: string | null) => void;
  /** מספר המוצרים לכל קטגוריה, כולל תת-הקטגוריות שלה */
  counts: Map<string, number>;
  totalCount: number;
  /** לקוחות ואורחים: לא מציגים קטגוריות בלי מוצרים */
  hideEmpty: boolean;
};

function isVisible(node: CategoryNode, props: Pick<NavProps, "counts" | "hideEmpty" | "value">) {
  if (!props.hideEmpty) return true;
  if (node.name === props.value) return true;
  return (props.counts.get(node.name) ?? 0) > 0;
}

function Count({ value, active }: { value: number; active?: boolean }) {
  return (
    <span
      className={cn(
        "numeric shrink-0 text-xs tabular-nums",
        active ? "text-foreground/70" : "text-muted-foreground",
      )}
    >
      {value}
    </span>
  );
}

/** עץ הקטגוריות עצמו — משותף לסרגל הצד, למגירה בטלפון ולחלון הקופץ */
function CategoryTreeNav({ tree, value, onChange, counts, totalCount, hideEmpty }: NavProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  // הקטגוריה שנבחרה תמיד גלויה: כל האבות שלה נפתחים אוטומטית
  useEffect(() => {
    if (value === null) return;
    const node = tree.byName.get(value);
    if (!node) return;
    setExpanded((current) => {
      const next = new Set(current);
      for (const name of node.path) next.add(name);
      return next;
    });
  }, [value, tree]);

  const toggle = (name: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const renderNodes = (nodes: CategoryNode[]) => (
    <ul className="space-y-0.5">
      {nodes
        .filter((node) => isVisible(node, { counts, hideEmpty, value }))
        .map((node) => {
          const children = node.children.filter((child) =>
            isVisible(child, { counts, hideEmpty, value }),
          );
          const hasChildren = children.length > 0;
          const isOpen = expanded.has(node.name);
          const active = value === node.name;
          return (
            <li key={node.name}>
              <div
                className={cn(
                  "flex items-center gap-1 rounded-md border-s-[3px] pe-2 transition-colors",
                  active
                    ? "border-accent bg-secondary font-semibold text-foreground"
                    : "border-transparent text-foreground/85 hover:bg-secondary/60",
                )}
              >
                {hasChildren ? (
                  <button
                    type="button"
                    onClick={() => toggle(node.name)}
                    aria-expanded={isOpen}
                    aria-label={isOpen ? `סגירת ${node.name}` : `פתיחת ${node.name}`}
                    className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ChevronLeft
                      className={cn(
                        "size-4 motion-safe:transition-transform motion-safe:duration-150",
                        isOpen && "-rotate-90",
                      )}
                    />
                  </button>
                ) : (
                  <span className="size-7 shrink-0" aria-hidden />
                )}
                <button
                  type="button"
                  onClick={() => {
                    onChange(node.name);
                    if (hasChildren && !isOpen) toggle(node.name);
                  }}
                  aria-current={active ? "true" : undefined}
                  className="flex min-w-0 flex-1 items-center justify-between gap-2 py-1.5 text-start text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                >
                  <span className="truncate">{node.name}</span>
                  <Count value={counts.get(node.name) ?? 0} active={active} />
                </button>
              </div>
              {hasChildren && isOpen && (
                <div className="ms-3.5 mt-0.5 border-s border-border ps-1">
                  {renderNodes(children)}
                </div>
              )}
            </li>
          );
        })}
    </ul>
  );

  return (
    <nav aria-label="קטגוריות" className="space-y-1">
      <button
        type="button"
        onClick={() => onChange(null)}
        aria-current={value === null ? "true" : undefined}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-md border-s-[3px] py-1.5 pe-2 ps-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          value === null
            ? "border-accent bg-secondary font-semibold text-foreground"
            : "border-transparent text-foreground/85 hover:bg-secondary/60",
        )}
      >
        <span className="flex items-center gap-2">
          <LayoutGrid className="size-4 text-muted-foreground" />
          כל המוצרים
        </span>
        <Count value={totalCount} active={value === null} />
      </button>
      {tree.roots.length === 0 ? (
        <p className="px-2 py-3 text-xs leading-5 text-muted-foreground">עוד לא הוגדרו קטגוריות.</p>
      ) : (
        renderNodes(tree.roots)
      )}
    </nav>
  );
}

/** "כל המוצרים › אלכוהול › וויסקי" — כל חלק לחיץ לחזרה אחורה */
function CategoryTrail({ tree, value, onChange }: Pick<NavProps, "tree" | "value" | "onChange">) {
  const node = value !== null ? tree.byName.get(value) : undefined;
  if (!node) return null;
  return (
    <nav aria-label="מיקום בקטלוג">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        <li>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="rounded hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            כל המוצרים
          </button>
        </li>
        {node.path.map((name, index) => {
          const last = index === node.path.length - 1;
          return (
            <li key={name} className="flex items-center gap-1">
              <ChevronLeft className="size-3.5 opacity-60" aria-hidden />
              {last ? (
                <span aria-current="page" className="font-display text-lg text-foreground">
                  {name}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onChange(name)}
                  className="rounded hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {name}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function Chips({
  nodes,
  counts,
  onChange,
  className,
}: {
  nodes: CategoryNode[];
  counts: Map<string, number>;
  onChange: (next: string) => void;
  className?: string | undefined;
}) {
  if (nodes.length === 0) return null;
  return (
    <div
      className={cn("flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible", className)}
    >
      {nodes.map((node) => (
        <button
          key={node.name}
          type="button"
          onClick={() => onChange(node.name)}
          className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 text-sm text-foreground shadow-card transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {node.name}
          <span className="numeric text-xs text-muted-foreground">
            {counts.get(node.name) ?? 0}
          </span>
        </button>
      ))}
    </div>
  );
}

/** אריחי קטגוריות ראשיות עם תמונה — מוצגים בכניסה לקטלוג אם הועלו תמונות */
function RootTiles({
  nodes,
  counts,
  onChange,
}: {
  nodes: CategoryNode[];
  counts: Map<string, number>;
  onChange: (next: string) => void;
}) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-1 sm:grid sm:grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] sm:overflow-visible">
      {nodes.map((node) => (
        <button
          key={node.name}
          type="button"
          onClick={() => onChange(node.name)}
          className="group flex w-36 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card text-start shadow-card transition-shadow hover:shadow-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto"
        >
          <div className="flex h-24 items-center justify-center bg-secondary/60">
            {node.image_url ? (
              <img
                src={node.image_url}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="font-display text-3xl text-primary/70" aria-hidden>
                {node.name.slice(0, 1)}
              </span>
            )}
          </div>
          <div className="flex flex-1 flex-col gap-0.5 px-3 py-2">
            <span className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">
              {node.name}
            </span>
            <span className="numeric text-xs text-muted-foreground">
              {counts.get(node.name) ?? 0} מוצרים
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}

/**
 * דפדוף בקטגוריות סביב רשימת מוצרים.
 * - "sidebar": סרגל עץ קבוע מימין במחשב, ומגירה מהצד בטלפון (הקטלוג, פאנל הניהול)
 * - "compact": כפתור שפותח את העץ בחלון קופץ (בתוך חלון "יצירת הזמנה" הצפוף)
 */
export function CategoryBrowser({
  variant = "sidebar",
  showTiles = false,
  toolbar,
  children,
  ...nav
}: NavProps & {
  variant?: "sidebar" | "compact";
  /** אריחי קטגוריות ראשיות כשלא נבחרה קטגוריה */
  showTiles?: boolean;
  /** רכיב נוסף בשורת הכלים של הקטגוריות, למשל כפתור ניהול */
  toolbar?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { tree, value, onChange, counts, hideEmpty } = nav;
  const [sheetOpen, setSheetOpen] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  // בטלפון: "חזור" סוגר את מגירת הקטגוריות במקום לצאת מהעמוד
  useBackToClose(sheetOpen, () => setSheetOpen(false));

  const visibleRoots = useMemo(
    () => tree.roots.filter((node) => isVisible(node, { counts, hideEmpty, value })),
    [tree, counts, hideEmpty, value],
  );
  const selected = value !== null ? tree.byName.get(value) : undefined;
  const subcategories = useMemo(
    () =>
      (selected?.children ?? []).filter((node) => isVisible(node, { counts, hideEmpty, value })),
    [selected, counts, hideEmpty, value],
  );
  const hasRootImages = visibleRoots.some((node) => node.image_url);

  const pick = (next: string | null) => {
    onChange(next);
    setSheetOpen(false);
    setPopoverOpen(false);
  };

  const triggerLabel = selected ? selected.name : "כל הקטגוריות";
  const shownCount = selected ? (counts.get(selected.name) ?? 0) : nav.totalCount;

  // בטלפון: סרגל סינון ברוחב מלא עם ☰ — מראה מה נבחר וכמה מוצרים יש בו
  const mobileBar = (
    <Button
      variant="outline"
      className="h-12 min-w-0 flex-1 justify-between gap-3 rounded-lg bg-card px-3 shadow-card"
      aria-label={`קטגוריות: ${triggerLabel}`}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <Menu className="size-5 shrink-0 text-foreground" />
        <span className="shrink-0 font-semibold text-foreground">קטגוריות</span>
        {selected && (
          <span className="truncate rounded-full bg-secondary px-2.5 py-0.5 text-sm font-medium text-foreground">
            {selected.name}
          </span>
        )}
      </span>
      <span className="numeric shrink-0 text-xs font-normal text-muted-foreground">
        {shownCount} מוצרים
      </span>
    </Button>
  );

  const compactTrigger = (
    <Button variant="outline" className="max-w-full justify-start gap-2">
      <Menu className="size-4 shrink-0" />
      <span className="truncate">{triggerLabel}</span>
    </Button>
  );

  const header = (
    <div className="space-y-3">
      <div
        className={cn("flex items-center gap-2", variant === "sidebar" ? "lg:hidden" : "flex-wrap")}
      >
        {variant === "sidebar" ? (
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>{mobileBar}</SheetTrigger>
            <SheetContent
              side="right"
              dir="rtl"
              className="w-[85vw] max-w-[22rem] overflow-y-auto text-right"
            >
              <SheetHeader className="pr-8 text-right">
                <SheetTitle className="font-display text-xl">קטגוריות</SheetTitle>
                <SheetDescription>בחירת קטגוריה מציגה גם את כל תת-הקטגוריות שלה.</SheetDescription>
              </SheetHeader>
              <div className="mt-4">
                <CategoryTreeNav {...nav} onChange={pick} />
              </div>
            </SheetContent>
          </Sheet>
        ) : (
          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>{compactTrigger}</PopoverTrigger>
            <PopoverContent
              dir="rtl"
              align="start"
              className="max-h-96 w-72 overflow-y-auto p-2 text-right"
            >
              <CategoryTreeNav {...nav} onChange={pick} />
            </PopoverContent>
          </Popover>
        )}
        {toolbar}
      </div>

      <CategoryTrail tree={tree} value={value} onChange={onChange} />

      {selected ? (
        <Chips nodes={subcategories} counts={counts} onChange={onChange} />
      ) : variant === "compact" ? (
        <Chips nodes={visibleRoots} counts={counts} onChange={onChange} />
      ) : showTiles && hasRootImages ? (
        // אריחי תמונה רק מטאבלט ומעלה — בטלפון סרגל ה-☰ מספיק ונקי יותר
        <div className="hidden sm:block">
          <RootTiles nodes={visibleRoots} counts={counts} onChange={onChange} />
        </div>
      ) : null}
    </div>
  );

  if (variant === "compact") {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {header}
        {children}
      </div>
    );
  }

  return (
    <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start lg:gap-8">
      <aside className="hidden lg:sticky lg:top-24 lg:block">
        <div className="max-h-[calc(100vh-8rem)] overflow-y-auto rounded-xl border border-border bg-card p-3 shadow-card">
          <div className="mb-2 flex items-center justify-between gap-2 px-2">
            <h3 className="font-display text-lg text-foreground">קטגוריות</h3>
            {toolbar}
          </div>
          <CategoryTreeNav {...nav} />
        </div>
      </aside>
      <div className="min-w-0 space-y-4">
        {header}
        {children}
      </div>
    </div>
  );
}
