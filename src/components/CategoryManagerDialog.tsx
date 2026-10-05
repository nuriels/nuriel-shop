import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  FolderInput,
  FolderTree,
  Home,
  ImageOff,
  ImagePlus,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { deleteCategory, renameCategory } from "@/lib/categories.functions";
import {
  CATEGORY_NAME_MAX,
  MAX_CATEGORY_DEPTH,
  formatPath,
  normalizeCategoryName,
  subtreeNames,
  totalCounts,
  validMoveTargets,
  type CategoryNode,
} from "@/lib/category-tree";
import { uploadProductImage } from "@/lib/site";
import { refreshCategories, useCategoryTree } from "@/hooks/useCategories";
import { cn } from "@/lib/utils";
import { useBackToClose } from "@/hooks/useBackToClose";

const ROOT_TARGET = "__root__";

function friendlyError(message: string): string {
  if (message.includes("duplicate") || message.includes("categories_pkey")) {
    return 'כבר קיימת קטגוריה בשם הזה. שמות קטגוריות ייחודיים בכל העץ — למשל "וויסקי סקוטי" במקום "סקוטי".';
  }
  if (message.includes("row-level security") || message.includes("אין הרשאה")) {
    return "אין הרשאה לנהל קטגוריות";
  }
  if (message.includes("categories_name_check")) {
    return `שם קטגוריה חייב להכיל 1 עד ${CATEGORY_NAME_MAX} תווים`;
  }
  if (message.includes("foreign key")) {
    return "אי אפשר למחוק קטגוריה שיש בה מוצרים או תת-קטגוריות";
  }
  return message;
}

type Pending =
  | { kind: "rename"; name: string; newName: string }
  | { kind: "move"; name: string }
  | { kind: "delete"; name: string };

/**
 * ניהול עץ הקטגוריות (מנהל בלבד): הוספה בכל רמה, שינוי שם, העברה, סידור,
 * תמונה לקטגוריה ראשית ומחיקה. כל שינוי שם, העברה ומחיקה עוברים חלון
 * אישור עם פירוט ההשפעה — ומחיקה אפשרית רק לקטגוריה ריקה, כך שמוצר לא
 * יכול להימחק בגלל לחיצה כאן.
 */
const CATEGORY_TREE_BODY_DESCRIPTION =
  "בונים עץ של עד " +
  MAX_CATEGORY_DEPTH +
  " רמות — למשל אלכוהול ← וויסקי ← סקוטי. לחיצה על קטגוריה בקטלוג מציגה גם את כל מה שמתחתיה. " +
  'התמונה וה"הצג קטגוריה במסך הבית" עובדות בכל רמה. מוצרים לא נמחקים מכאן לעולם.';

/** "הצג קטגוריה במסך הבית" — מתג עם תווית (ביצירה ובשורה של כל קטגוריה) */
function HomepageSwitch({
  id,
  checked,
  disabled,
  onChange,
  compact = false,
  categoryName,
}: {
  id: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  /** בשורת הקטגוריה: תווית קצרה, ובנייד רק אייקון */
  compact?: boolean;
  categoryName?: string;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md text-xs font-medium",
        compact ? "px-1.5 py-1" : "text-sm",
        checked ? "text-primary" : "text-muted-foreground",
        disabled && "cursor-not-allowed opacity-60",
      )}
      title={checked ? "מוצגת במסך הבית" : "הצג קטגוריה במסך הבית"}
    >
      <Home className={cn("size-4", checked && "fill-current")} aria-hidden="true" />
      <span className={compact ? "hidden md:inline" : undefined}>
        {compact ? "במסך הבית" : "הצג קטגוריה במסך הבית"}
      </span>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        aria-label={categoryName ? `הצג את "${categoryName}" במסך הבית` : "הצג קטגוריה במסך הבית"}
        data-homepage-switch={categoryName ?? "new"}
      />
    </label>
  );
}

export type CategoryTreeBodyHandle = {
  hasPendingEdit: () => boolean;
  cancelEdit: () => void;
};

/**
 * גוף עריכת עץ הקטגוריות: הוספה בכל רמה, שינוי שם, העברה, סידור, תמונה
 * ו"הצג קטגוריה במסך הבית" (חלק 20: מתג ביצירה ובכל שורה), ומחיקה. כל שינוי שם, העברה ומחיקה עוברים חלון
 * אישור עם פירוט ההשפעה — ומחיקה אפשרית רק לקטגוריה ריקה, כך שמוצר לא יכול
 * להימחק בגלל לחיצה כאן. משותף לחלון הקופץ (עריכה מהירה) וללשונית הניהול.
 */
const CategoryTreeBody = forwardRef<CategoryTreeBodyHandle, { active?: boolean }>(
  function CategoryTreeBody({ active = true }, ref) {
    const renameFn = useServerFn(renameCategory);
    const deleteFn = useServerFn(deleteCategory);
    const tree = useCategoryTree();
    const [direct, setDirect] = useState<Map<string, number>>(new Map());
    const [busy, setBusy] = useState(false);
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
    const [newRoot, setNewRoot] = useState("");
    const [newRootHome, setNewRootHome] = useState(false);
    const [addingUnder, setAddingUnder] = useState<string | null>(null);
    const [childName, setChildName] = useState("");
    const [childHome, setChildHome] = useState(false);
    const [editing, setEditing] = useState<string | null>(null);
    const [editValue, setEditValue] = useState("");
    const [pending, setPending] = useState<Pending | null>(null);
    const [moveTarget, setMoveTarget] = useState<string>("");
    const [imageFor, setImageFor] = useState<string | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);

    const loadCounts = useCallback(async () => {
      const { data, error } = await supabase.rpc("category_product_counts");
      if (error) return;
      setDirect(new Map((data ?? []).map((row) => [row.category, Number(row.products)])));
    }, []);

    useEffect(() => {
      if (!active) return;
      void refreshCategories();
      void loadCounts();
    }, [active, loadCounts]);

    const totals = useMemo(() => totalCounts(tree, direct), [tree, direct]);

    const reload = async () => {
      await Promise.all([refreshCategories(), loadCounts()]);
    };

    const guard = async (action: () => Promise<void>) => {
      setBusy(true);
      try {
        await action();
      } catch (error) {
        toast.error(friendlyError(error instanceof Error ? error.message : String(error)));
      } finally {
        setBusy(false);
      }
    };

    const nextOrder = (parent: string | null) => {
      const siblings = parent === null ? tree.roots : (tree.byName.get(parent)?.children ?? []);
      return siblings.reduce((max, node) => Math.max(max, node.sort_order), 0) + 1;
    };

    const add = (rawName: string, parent: string | null, showOnHomepage: boolean) =>
      guard(async () => {
        const name = normalizeCategoryName(rawName);
        if (name === "") return;
        const { error } = await supabase.from("categories").insert({
          name,
          parent_name: parent,
          sort_order: nextOrder(parent),
          show_on_homepage: showOnHomepage,
        });
        if (error) throw new Error(error.message);
        await reload();
        if (parent === null) {
          setNewRoot("");
          setNewRootHome(false);
        } else {
          setChildName("");
          setChildHome(false);
          setAddingUnder(null);
          setCollapsed((current) => {
            const next = new Set(current);
            next.delete(parent);
            return next;
          });
        }
        toast.success(
          (parent ? `"${name}" נוספה תחת "${parent}"` : `הקטגוריה "${name}" נוספה`) +
            (showOnHomepage ? " ותוצג במסך הבית" : ""),
        );
      });

    const moveWithinSiblings = (node: CategoryNode, direction: -1 | 1) =>
      guard(async () => {
        const siblings = node.parent_name
          ? (tree.byName.get(node.parent_name)?.children ?? [])
          : tree.roots;
        const names = siblings.map((sibling) => sibling.name);
        const index = names.indexOf(node.name);
        const swap = index + direction;
        if (index < 0 || swap < 0 || swap >= names.length) return;
        [names[index], names[swap]] = [names[swap]!, names[index]!];
        const { error } = await supabase.rpc("set_category_order", { _names: names });
        if (error) throw new Error(error.message);
        await refreshCategories();
      });

    const confirmRename = () => {
      if (pending?.kind !== "rename") return;
      const { name, newName } = pending;
      void guard(async () => {
        const result = await renameFn({ data: { oldName: name, newName } });
        await reload();
        setEditing(null);
        setPending(null);
        toast.success(
          `"${name}" שונתה ל-"${newName}"` +
            (result.productsUpdated > 0 ? ` — ${result.productsUpdated} מוצרים עודכנו` : ""),
        );
      });
    };

    const confirmMove = () => {
      if (pending?.kind !== "move" || moveTarget === "") return;
      const { name } = pending;
      const parent = moveTarget === ROOT_TARGET ? null : moveTarget;
      void guard(async () => {
        const { error } = await supabase
          .from("categories")
          .update({ parent_name: parent, sort_order: nextOrder(parent) })
          .eq("name", name);
        if (error) throw new Error(error.message);
        await refreshCategories();
        setPending(null);
        toast.success(
          parent ? `"${name}" הועברה אל "${parent}"` : `"${name}" היא עכשיו קטגוריה ראשית`,
        );
      });
    };

    const confirmDelete = () => {
      if (pending?.kind !== "delete") return;
      const { name } = pending;
      void guard(async () => {
        await deleteFn({ data: { name } });
        await reload();
        setPending(null);
        toast.success(`הקטגוריה "${name}" נמחקה`);
      });
    };

    const uploadImage = (file: File | undefined) => {
      const name = imageFor;
      if (!file || !name) return;
      void guard(async () => {
        const { url } = await uploadProductImage(file);
        const { error } = await supabase
          .from("categories")
          .update({ image_url: url })
          .eq("name", name);
        if (error) throw new Error(error.message);
        await refreshCategories();
        toast.success(`התמונה של "${name}" עודכנה`);
      });
      setImageFor(null);
      if (fileInput.current) fileInput.current.value = "";
    };

    const removeImage = (name: string) =>
      guard(async () => {
        const { error } = await supabase
          .from("categories")
          .update({ image_url: null })
          .eq("name", name);
        if (error) throw new Error(error.message);
        await refreshCategories();
        toast.success(`התמונה של "${name}" הוסרה`);
      });

    const setShowOnHomepage = (node: CategoryNode, next: boolean) =>
      guard(async () => {
        const { error } = await supabase
          .from("categories")
          .update({ show_on_homepage: next })
          .eq("name", node.name);
        if (error) throw new Error(error.message);
        await refreshCategories();
        toast.success(next ? `"${node.name}" תוצג במסך הבית` : `"${node.name}" הוסרה ממסך הבית`);
      });

    const startRename = (node: CategoryNode) => {
      setEditing(node.name);
      setEditValue(node.name);
      setAddingUnder(null);
    };

    const submitRename = (node: CategoryNode) => {
      const newName = normalizeCategoryName(editValue);
      if (newName === "" || newName === node.name) {
        setEditing(null);
        return;
      }
      setPending({ kind: "rename", name: node.name, newName });
    };

    const renderRow = (node: CategoryNode, siblings: CategoryNode[], index: number) => {
      const isCollapsed = collapsed.has(node.name);
      const hasChildren = node.children.length > 0;
      const canAddChild = node.depth < MAX_CATEGORY_DEPTH;
      const total = totals.get(node.name) ?? 0;
      const own = direct.get(node.name) ?? 0;

      return (
        <li key={node.name}>
          {/* בנייד הכפתורים יורדים לשורה שנייה — כדי שהשם לא יידחס עד שייעלם */}
          <div className="group flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card py-1 pe-1 ps-1.5 sm:flex-nowrap">
            {hasChildren ? (
              <button
                type="button"
                onClick={() =>
                  setCollapsed((current) => {
                    const next = new Set(current);
                    if (next.has(node.name)) next.delete(node.name);
                    else next.add(node.name);
                    return next;
                  })
                }
                aria-expanded={!isCollapsed}
                aria-label={isCollapsed ? `פתיחת ${node.name}` : `סגירת ${node.name}`}
                className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft
                  className={cn(
                    "size-4 motion-safe:transition-transform",
                    !isCollapsed && "-rotate-90",
                  )}
                />
              </button>
            ) : (
              <span className="size-7 shrink-0" aria-hidden />
            )}

            <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-secondary">
              {node.image_url ? (
                <img src={node.image_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="font-display text-sm text-primary/70" aria-hidden>
                  {node.name.slice(0, 1)}
                </span>
              )}
            </div>

            {editing === node.name ? (
              <div className="flex min-w-[calc(100%-4.5rem)] flex-1 items-center gap-1 sm:min-w-0">
                <Input
                  value={editValue}
                  onChange={(event) => setEditValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      // בלי זה, ה-Enter "נוחת" על כפתור הביטול של חלון האישור שנפתח וסוגר אותו מיד
                      event.preventDefault();
                      submitRename(node);
                    }
                    if (event.key === "Escape") setEditing(null);
                  }}
                  maxLength={CATEGORY_NAME_MAX}
                  autoFocus
                  className="h-8"
                  aria-label={`שם חדש ל-${node.name}`}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  onClick={() => submitRename(node)}
                  aria-label="שמירת השם"
                >
                  <Check className="size-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  onClick={() => setEditing(null)}
                  aria-label="ביטול"
                >
                  <X className="size-4" />
                </Button>
              </div>
            ) : (
              // חלק 22: בנייד השם תופס את כל השורה ומוצג במלואו (יורד שורה, בלי "...");
              // כפתורי הפעולה עוברים לשורה שמתחת. במחשב — שורה אחת כמו קודם.
              <div className="flex min-w-[calc(100%-4.5rem)] flex-1 flex-wrap items-baseline gap-x-2 px-1 sm:min-w-0 sm:flex-nowrap">
                <span className="min-w-0 whitespace-normal break-words font-medium text-foreground [overflow-wrap:anywhere] sm:truncate">
                  {node.name}
                </span>
                <span
                  className="numeric shrink-0 text-xs text-muted-foreground"
                  title="מוצרים בקטגוריה, כולל תת-הקטגוריות"
                >
                  {total} מוצרים{hasChildren && own > 0 ? ` (${own} ישירות)` : ""}
                </span>
              </div>
            )}

            {editing !== node.name && (
              <div className="ms-auto flex shrink-0 items-center">
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  disabled={busy || index === 0}
                  onClick={() => void moveWithinSiblings(node, -1)}
                  aria-label={`הזזת ${node.name} למעלה`}
                >
                  <ArrowUp className="size-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  disabled={busy || index === siblings.length - 1}
                  onClick={() => void moveWithinSiblings(node, 1)}
                  aria-label={`הזזת ${node.name} למטה`}
                >
                  <ArrowDown className="size-4" />
                </Button>
                {canAddChild && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 px-2"
                    disabled={busy}
                    onClick={() => {
                      setAddingUnder(node.name);
                      setChildName("");
                      setChildHome(false);
                      setEditing(null);
                    }}
                  >
                    <Plus className="size-4" />
                    <span className="hidden sm:inline">תת-קטגוריה</span>
                  </Button>
                )}
                <HomepageSwitch
                  id={`home-${node.id ?? node.name}`}
                  compact
                  categoryName={node.name}
                  checked={node.show_on_homepage}
                  disabled={busy}
                  onChange={(next) => void setShowOnHomepage(node, next)}
                />
                <DropdownMenu dir="rtl">
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      aria-label={`פעולות נוספות ל-${node.name}`}
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-44 text-right">
                    <DropdownMenuItem onSelect={() => startRename(node)}>
                      <Pencil className="size-4" />
                      שינוי שם
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => {
                        setMoveTarget("");
                        setPending({ kind: "move", name: node.name });
                      }}
                    >
                      <FolderInput className="size-4" />
                      העברה לקטגוריה אחרת
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => {
                        setImageFor(node.name);
                        fileInput.current?.click();
                      }}
                    >
                      <ImagePlus className="size-4" />
                      {node.image_url ? "החלפת תמונה" : "הוספת תמונה"}
                    </DropdownMenuItem>
                    {node.image_url && (
                      <DropdownMenuItem onSelect={() => void removeImage(node.name)}>
                        <ImageOff className="size-4" />
                        הסרת התמונה
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={() => setPending({ kind: "delete", name: node.name })}
                    >
                      <Trash2 className="size-4" />
                      מחיקה
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>

          {addingUnder === node.name && (
            <div className="ms-6 mt-1 space-y-2 border-s border-border ps-3">
              <div className="flex gap-2">
                <Input
                  value={childName}
                  onChange={(event) => setChildName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      // בלי זה, ה-Enter "נוחת" על כפתור הביטול של חלון האישור שנפתח וסוגר אותו מיד
                      event.preventDefault();
                      void add(childName, node.name, childHome);
                    }
                    if (event.key === "Escape") setAddingUnder(null);
                  }}
                  placeholder={`תת-קטגוריה תחת "${node.name}"`}
                  maxLength={CATEGORY_NAME_MAX}
                  autoFocus
                  className="h-9"
                />
                <Button
                  size="sm"
                  className="h-9"
                  disabled={busy || childName.trim() === ""}
                  onClick={() => void add(childName, node.name, childHome)}
                >
                  הוספה
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-9"
                  onClick={() => setAddingUnder(null)}
                >
                  ביטול
                </Button>
              </div>
              <HomepageSwitch
                id={`new-child-home-${node.id ?? node.name}`}
                checked={childHome}
                disabled={busy}
                onChange={setChildHome}
              />
            </div>
          )}

          {hasChildren && !isCollapsed && (
            <ul className="ms-3.5 mt-1 space-y-1 border-s border-border ps-3">
              {node.children.map((child, childIndex) =>
                renderRow(child, node.children, childIndex),
              )}
            </ul>
          )}
        </li>
      );
    };

    // ---------- חלון האישור: שינוי שם / העברה / מחיקה ----------
    const pendingNode = pending ? tree.byName.get(pending.name) : undefined;
    const pendingTotal = pendingNode ? (totals.get(pendingNode.name) ?? 0) : 0;
    const pendingDescendants = pendingNode ? subtreeNames(tree, pendingNode.name).size - 1 : 0;
    const moveTargets = pending?.kind === "move" ? validMoveTargets(tree, pending.name) : [];
    const deleteBlocked =
      pending?.kind === "delete" && pendingNode !== undefined
        ? (direct.get(pendingNode.name) ?? 0) > 0 || pendingNode.children.length > 0
        : false;

    const deleteBlockedReason = (() => {
      if (pending?.kind !== "delete" || !pendingNode) return "";
      const own = direct.get(pendingNode.name) ?? 0;
      const childCount = pendingNode.children.length;
      const nested = pendingTotal - own;
      const parts: string[] = [];
      if (own > 0) parts.push(`${own} מוצרים`);
      if (childCount > 0) {
        parts.push(
          `${childCount} תת-קטגוריות` + (nested > 0 ? ` (ובהן עוד ${nested} מוצרים)` : ""),
        );
      }
      return `בקטגוריה יש ${parts.join(" ו-")}. כדי לשמור על המוצרים, מוחקים רק קטגוריה ריקה — קודם מעבירים את התוכן שלה למקום אחר.`;
    })();

    const confirmDialog = (
      <AlertDialog
        open={pending !== null}
        onOpenChange={(next) => {
          if (!next && !busy) setPending(null);
        }}
      >
        <AlertDialogContent dir="rtl" className="text-right">
          {pending?.kind === "rename" && (
            <>
              <AlertDialogHeader className="text-right">
                <AlertDialogTitle>לשנות את שם הקטגוריה?</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2 text-sm">
                    <p>
                      <strong className="text-foreground">{pending.name}</strong> ←{" "}
                      <strong className="text-foreground">{pending.newName}</strong>
                    </p>
                    <p>
                      השם יתעדכן אוטומטית ב-{pendingTotal} מוצרים
                      {pendingDescendants > 0 ? ` ובכל ${pendingDescendants} תת-הקטגוריות` : ""}.
                      שום מוצר לא נמחק. הזמנות ומסמכים שכבר הופקו שומרים את השם הקודם.
                    </p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="gap-2 sm:justify-start">
                <Button onClick={confirmRename} disabled={busy}>
                  {busy && <Loader2 className="size-4 animate-spin" />}
                  כן, לשנות את השם
                </Button>
                <AlertDialogCancel disabled={busy}>ביטול</AlertDialogCancel>
              </AlertDialogFooter>
            </>
          )}

          {pending?.kind === "move" && (
            <>
              <AlertDialogHeader className="text-right">
                <AlertDialogTitle>להעביר את "{pending.name}"?</AlertDialogTitle>
                <AlertDialogDescription>
                  {pendingTotal} המוצרים
                  {pendingDescendants > 0 ? ` ו-${pendingDescendants} תת-הקטגוריות` : ""} שבה יעברו
                  יחד איתה. אפשר עד {MAX_CATEGORY_DEPTH} רמות, ולכן מוצגים רק יעדים אפשריים.
                </AlertDialogDescription>
              </AlertDialogHeader>
              {moveTargets.length === 0 ? (
                <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
                  אין יעד אפשרי להעברה — המבנה הנוכחי כבר מנצל את כל הרמות.
                </p>
              ) : (
                <Select value={moveTarget} onValueChange={setMoveTarget}>
                  <SelectTrigger dir="rtl" aria-label="לאן להעביר">
                    <SelectValue placeholder="בחרו לאן להעביר" />
                  </SelectTrigger>
                  <SelectContent dir="rtl">
                    {moveTargets.map((target) =>
                      target === null ? (
                        <SelectItem key={ROOT_TARGET} value={ROOT_TARGET}>
                          קטגוריה ראשית (בלי אב)
                        </SelectItem>
                      ) : (
                        <SelectItem key={target.name} value={target.name}>
                          {formatPath(target)}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              )}
              <AlertDialogFooter className="gap-2 sm:justify-start">
                <Button onClick={confirmMove} disabled={busy || moveTarget === ""}>
                  {busy && <Loader2 className="size-4 animate-spin" />}
                  כן, להעביר
                </Button>
                <AlertDialogCancel disabled={busy}>ביטול</AlertDialogCancel>
              </AlertDialogFooter>
            </>
          )}

          {pending?.kind === "delete" && (
            <>
              <AlertDialogHeader className="text-right">
                <AlertDialogTitle>
                  {deleteBlocked
                    ? `אי אפשר למחוק את "${pending.name}"`
                    : `למחוק את "${pending.name}"?`}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {deleteBlocked
                    ? deleteBlockedReason
                    : "הקטגוריה ריקה — אין בה מוצרים ואין תת-קטגוריות. המחיקה סופית."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="gap-2 sm:justify-start">
                {!deleteBlocked && (
                  <Button variant="destructive" onClick={confirmDelete} disabled={busy}>
                    {busy && <Loader2 className="size-4 animate-spin" />}
                    כן, למחוק
                  </Button>
                )}
                <AlertDialogCancel disabled={busy}>
                  {deleteBlocked ? "הבנתי" : "ביטול"}
                </AlertDialogCancel>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    );

    useImperativeHandle(ref, () => ({
      hasPendingEdit: () => editing !== null || addingUnder !== null,
      cancelEdit: () => {
        setEditing(null);
        setAddingUnder(null);
      },
    }));

    return (
      <>
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input
              value={newRoot}
              onChange={(event) => setNewRoot(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  // בלי זה, ה-Enter "נוחת" על כפתור הביטול של חלון האישור שנפתח וסוגר אותו מיד
                  event.preventDefault();
                  void add(newRoot, null, newRootHome);
                }
              }}
              placeholder="קטגוריה ראשית חדשה, למשל: משקאות אלכוהוליים"
              maxLength={CATEGORY_NAME_MAX}
              aria-label="שם קטגוריה ראשית חדשה"
            />
            <Button
              onClick={() => void add(newRoot, null, newRootHome)}
              disabled={busy || newRoot.trim() === ""}
            >
              <Plus className="size-4" />
              הוספה
            </Button>
          </div>
          <HomepageSwitch
            id="new-root-home"
            checked={newRootHome}
            disabled={busy}
            onChange={setNewRootHome}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pe-1">
          {tree.roots.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm leading-6 text-muted-foreground">
              עוד אין קטגוריות. הוסיפו למעלה קטגוריה ראשית, ואז לחצו "תת-קטגוריה" בשורה שלה כדי
              לבנות מתחתיה.
            </p>
          ) : (
            <ul className="space-y-1">
              {tree.roots.map((node, index) => renderRow(node, tree.roots, index))}
            </ul>
          )}
        </div>

        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => uploadImage(event.target.files?.[0])}
        />
        {confirmDialog}
      </>
    );
  },
);

/**
 * חלון קופץ לניהול מהיר של הקטגוריות — למשל כפתור "+" בטופס מוצר.
 * ללשונית הניהול המלאה בפאנל האדמין ראו CategoryManagementPanel.
 */
export function CategoryManagerDialog({
  trigger = "button",
}: {
  trigger?: "button" | "plus" | "icon";
}) {
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<CategoryTreeBodyHandle>(null);
  useBackToClose(open, () => setOpen(false));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger === "plus" ? (
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="size-9 shrink-0"
            title="ניהול קטגוריות"
            aria-label="ניהול קטגוריות"
          >
            <Plus className="size-4" />
          </Button>
        ) : trigger === "icon" ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8 shrink-0"
            title="ניהול קטגוריות"
            aria-label="ניהול קטגוריות"
          >
            <Settings2 className="size-4" />
          </Button>
        ) : (
          <Button variant="outline">
            <FolderTree className="size-4" />
            ניהול קטגוריות
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        dir="rtl"
        className="flex max-h-[90vh] flex-col text-right sm:max-w-2xl"
        onEscapeKeyDown={(event) => {
          // Escape בזמן הקלדת שם מבטל רק את העריכה, לא סוגר את כל החלון
          if (bodyRef.current?.hasPendingEdit()) {
            event.preventDefault();
            bodyRef.current.cancelEdit();
          }
        }}
      >
        <DialogHeader className="text-right">
          <DialogTitle>ניהול קטגוריות</DialogTitle>
          <DialogDescription>{CATEGORY_TREE_BODY_DESCRIPTION}</DialogDescription>
        </DialogHeader>
        <CategoryTreeBody ref={bodyRef} active={open} />
      </DialogContent>
    </Dialog>
  );
}

/**
 * ניהול קטגוריות — לשונית מלאה בפאנל האדמין (לצד הזמנות, מוצרים וכו').
 * אותו עץ עריכה בדיוק כמו בחלון הקופץ, בלי מגבלת הגובה של דיאלוג.
 */
export function CategoryManagementPanel() {
  return (
    <section className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex size-11 items-center justify-center rounded-xl gradient-brand text-primary-foreground">
          <FolderTree className="size-5" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-foreground">ניהול קטגוריות</h2>
          <p className="text-sm text-muted-foreground">{CATEGORY_TREE_BODY_DESCRIPTION}</p>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">עץ הקטגוריות</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <CategoryTreeBody />
        </CardContent>
      </Card>
    </section>
  );
}
