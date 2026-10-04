import { useCallback, useEffect, useRef, useState } from "react";
import { EyeOff, KeyRound, Loader2, Package, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Json, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { ColorsInput } from "@/components/ColorsInput";
import { CategoryManagerDialog } from "@/components/CategoryManagerDialog";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCategories, useCategoryTree } from "@/hooks/useCategories";
import { usePriceTiersEnabled } from "@/hooks/usePriceTiers";
import { useSubscription } from "@/hooks/useSubscription";
import { PremiumBadge, PremiumLockCard } from "@/components/billing/PremiumLock";
import { formatPath } from "@/lib/category-tree";
import {
  formatIls,
  generateSku,
  PRODUCT_ADMIN_COLUMNS,
  type GlobalProduct,
  unitPriceFromPack,
} from "@/lib/catalog";
import { uploadProductImage } from "@/lib/site";
import { formatBytes } from "@/lib/image";
import { useBackToClose } from "@/hooks/useBackToClose";
import { ProductPicker } from "@/components/sales/ProductPicker";
import { VariantsEditor } from "@/components/VariantsEditor";
import {
  VARIANT_ADMIN_COLUMNS,
  attributesProblem,
  draftFromStored,
  syncDrafts,
  variantAttributesOf,
  variantDraftProblem,
  variantLabel,
  variantsPayload,
  type StoredVariant,
  type VariantAttribute,
  type VariantDraft,
} from "@/lib/variants";

/** ISO -> "YYYY-MM-DDTHH:mm" (תאריכי מבצע ישנים נשמרים כמו שהם) */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  if (value.trim() === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

type FormState = {
  name: string;
  category: string;
  barcode: string;
  shelfLocation: string;
  description: string;
  salePrice: string;
  saleStartsAt: string;
  saleEndsAt: string;
  uniformPrice: boolean;
  imageUrl: string;
  colors: string[];
  priceTier1: string;
  priceTier2: string;
  priceTier3: string;
  /** מחיר עלות — ניהולי בלבד, לא מוצג ללקוחות */
  costPrice: string;
  stockQuantity: string;
  isPromo: boolean;
  isOutOfStock: boolean;
  isHidden: boolean;
  hasDeposit: boolean;
  depositPrice: string;
  depositUnits: string;
  /** נמכר במארזים — הלקוח מזמין רק כפולות של packSize */
  packEnabled: boolean;
  packSize: string;
  /** מינימום יחידות להזמנה — נפרד מהמארזים: רק סף תחתון, בלי כפולות */
  minEnabled: boolean;
  minQuantity: string;
  /** מוצר קופה: מוצע בסל ממש לפני שליחת ההזמנה */
  isOrderBump: boolean;
  orderBumpText: string;
  /** "מוצרים נוספים שאולי תאהבו" — לפי הסדר (נשמר ב-product_relations) */
  relatedIds: string[];
  /** מוצר דיגיטלי (רישיון / קוד): בלי מלאי פיזי, בלי משלוח ובלי ליקוט */
  isDigital: boolean;
  /** וריאציות: המאפיינים (צבע / מידה) והצירופים (נשמרים ב-product_variants) */
  variantAttributes: VariantAttribute[];
  variants: VariantDraft[];
};

export type ProductDraft = { id: string; title: string; data: Json; updated_at: string };

function emptyForm(defaultCategory: string): FormState {
  return {
    name: "",
    category: defaultCategory,
    barcode: "",
    shelfLocation: "",
    description: "",
    salePrice: "",
    saleStartsAt: "",
    saleEndsAt: "",
    uniformPrice: false,
    imageUrl: "",
    colors: [],
    priceTier1: "",
    priceTier2: "",
    priceTier3: "",
    costPrice: "",
    stockQuantity: "0",
    isPromo: false,
    isOutOfStock: false,
    isHidden: false,
    hasDeposit: false,
    depositPrice: "",
    depositUnits: "",
    packEnabled: false,
    packSize: "",
    minEnabled: false,
    minQuantity: "",
    isOrderBump: false,
    orderBumpText: "",
    relatedIds: [],
    isDigital: false,
    variantAttributes: [],
    variants: [],
  };
}

function fromProduct(product: GlobalProduct): FormState {
  return {
    name: product.name,
    category: product.category,
    barcode: product.barcode ?? "",
    shelfLocation: product.shelf_location ?? "",
    description: product.description ?? "",
    salePrice: product.sale_price != null ? String(product.sale_price) : "",
    saleStartsAt: toLocalInput(product.sale_starts_at),
    saleEndsAt: toLocalInput(product.sale_ends_at),
    uniformPrice: product.uniform_price ?? false,
    imageUrl: product.image_url ?? "",
    colors: product.colors ?? [],
    priceTier1: String(product.price_tier1),
    priceTier2: String(product.price_tier2),
    priceTier3: String(product.price_tier3),
    costPrice: product.cost_price != null ? String(product.cost_price) : "",
    stockQuantity: String(product.stock_quantity),
    isPromo: product.is_promo,
    isOutOfStock: product.is_out_of_stock,
    isHidden: product.is_hidden ?? false,
    hasDeposit: product.has_deposit ?? false,
    depositPrice: product.deposit_price != null ? String(product.deposit_price) : "",
    depositUnits: product.deposit_units != null ? String(product.deposit_units) : "",
    packEnabled: product.pack_size != null,
    packSize: product.pack_size != null ? String(product.pack_size) : "",
    minEnabled: product.min_order_quantity != null,
    minQuantity: product.min_order_quantity != null ? String(product.min_order_quantity) : "",
    isOrderBump: product.is_order_bump ?? false,
    orderBumpText: product.order_bump_text ?? "",
    // נטענים בנפרד (product_relations) כשהחלון נפתח
    relatedIds: [],
    isDigital: product.is_digital ?? false,
    variantAttributes: variantAttributesOf(product),
    // הצירופים נטענים בנפרד (product_variants) כשהחלון נפתח
    variants: [],
  };
}

/** המאפיינים והצירופים כפי שנשמרים — להשוואה (נשמרים רק אם השתנו) */
function variantsSnapshot(form: Pick<FormState, "variantAttributes" | "variants">): string {
  return JSON.stringify({
    attributes: form.variantAttributes,
    variants: variantsPayload(form.variants),
  });
}

function fromDraft(data: Json, defaultCategory: string): FormState {
  const base = emptyForm(defaultCategory);
  if (data === null || typeof data !== "object" || Array.isArray(data)) return base;
  const stored = data as Partial<FormState>;
  const merged = { ...base } as Record<string, unknown>;
  // רק מפתחות מוכרים ומאותו סוג — טיוטה ישנה/פגומה לא שוברת את הטופס
  for (const [key, value] of Object.entries(base)) {
    const candidate = (stored as Record<string, unknown>)[key];
    if (candidate !== undefined && typeof candidate === typeof value) merged[key] = candidate;
  }
  return merged as FormState;
}

/** יש בטופס משהו ששווה לשמור כטיוטה */
function hasContent(form: FormState): boolean {
  return (
    form.name.trim() !== "" ||
    form.imageUrl !== "" ||
    form.priceTier1.trim() !== "" ||
    form.barcode.trim() !== "" ||
    form.description.trim() !== ""
  );
}

const DRAFT_DELAY_MS = 900;

/** מחליף את רשימת המוצרים הקשורים של מוצר (הסדר נשמר); מחזיר הודעת שגיאה או null */
async function saveRelatedProducts(
  productId: string,
  relatedIds: string[],
): Promise<string | null> {
  const { error: deleteError } = await supabase
    .from("product_relations")
    .delete()
    .eq("product_id", productId);
  if (deleteError) return deleteError.message;
  if (relatedIds.length === 0) return null;
  const { error } = await supabase.from("product_relations").insert(
    relatedIds.map((relatedId, index) => ({
      product_id: productId,
      related_product_id: relatedId,
      sort_order: index,
    })),
  );
  return error ? error.message : null;
}

/**
 * יצירה/עריכה של מוצר בקטלוג — אדמין בלבד.
 * מוצר חדש נשמר אוטומטית כטיוטה (לשונית "טיוטות") עד שלוחצים "הוספה לקטלוג";
 * בעריכה — יציאה עם שינויים שלא נשמרו מבקשת אישור.
 */
export function AdminProductDialog({
  product,
  draft,
  onSaved,
  onDraftsChanged,
  triggerLabel,
  initialBarcode,
  initialName,
}: {
  /** ריק ליצירת מוצר חדש */
  product?: GlobalProduct;
  /** המשך עריכה של טיוטה שמורה */
  draft?: ProductDraft;
  onSaved: () => void;
  /** נקרא כשטיוטה נוצרה/עודכנה/נמחקה — לרענון לשונית הטיוטות */
  onDraftsChanged?: () => void;
  /** טקסט חלופי לכפתור הפתיחה (למשל "יצירת מוצר" מרשימת הממתינים) */
  triggerLabel?: string;
  /** ערכים שמגיעים מסריקת ברקוד — ממלאים מראש את הטופס */
  initialBarcode?: string;
  initialName?: string;
}) {
  const isEdit = product !== undefined;
  const tiersEnabled = usePriceTiersEnabled();
  // חבילה בסיסית (חלק 13): מוצר דיגיטלי ווריאציות נעולים — מה שכבר קיים נשמר
  const { can } = useSubscription();
  const categories = useCategories();
  const categoryTree = useCategoryTree();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(() =>
    product ? fromProduct(product) : emptyForm(categories[0] ?? ""),
  );
  // גרסת המוצר שממנה נטען הטופס (נטענת מחדש מהמסד בכל פתיחה)
  const [loaded, setLoaded] = useState<GlobalProduct | null>(product ?? null);
  const [uploading, setUploading] = useState(false);
  const [imageNote, setImageNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const baseline = useRef("");
  // המוצרים הקשורים כפי שנטענו מהמסד — כדי לשמור רק אם השתנו
  const loadedRelated = useRef<string[]>([]);
  // הוריאציות כפי שנטענו מהמסד — כדי לשמור רק אם השתנו
  const loadedVariants = useRef<string>(variantsSnapshot({ variantAttributes: [], variants: [] }));

  // ---------- טיוטה (מוצר חדש בלבד) ----------
  const [draftStatus, setDraftStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [draftSavedAt, setDraftSavedAt] = useState<Date | null>(null);
  const draftId = useRef<string | null>(draft?.id ?? null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftChain = useRef<Promise<void>>(Promise.resolve());
  const productSaved = useRef(false);

  useEffect(() => {
    if (!open) return;
    productSaved.current = false;
    setDraftStatus("idle");
    setDraftSavedAt(draft ? new Date(draft.updated_at) : null);
    draftId.current = draft?.id ?? null;
    const initial = product
      ? fromProduct(product)
      : draft
        ? fromDraft(draft.data, categories[0] ?? "")
        : {
            ...emptyForm(categories[0] ?? ""),
            barcode: initialBarcode ?? "",
            name: initialName ?? "",
          };
    setForm(initial);
    setLoaded(product ?? null);
    baseline.current = JSON.stringify(initial);

    loadedRelated.current = [];
    loadedVariants.current = variantsSnapshot({ variantAttributes: [], variants: [] });
    if (product) {
      // הרשימה במסך יכולה להיות ישנה (הזמנות מורידות מלאי ברקע) — טוענים את המוצר מחדש,
      // יחד עם המוצרים הקשורים והוריאציות שלו
      void (async () => {
        const [{ data }, { data: relations }, { data: storedVariants }] = await Promise.all([
          supabase
            .from("global_products")
            .select(PRODUCT_ADMIN_COLUMNS)
            .eq("id", product.id)
            .maybeSingle(),
          supabase
            .from("product_relations")
            .select("related_product_id")
            .eq("product_id", product.id)
            .order("sort_order"),
          supabase
            .from("product_variants")
            .select(VARIANT_ADMIN_COLUMNS)
            .eq("product_id", product.id)
            .order("sort_order"),
        ]);
        if (!data) return;
        const fresh = data as GlobalProduct;
        const relatedIds = (relations ?? []).map((row) => row.related_product_id);
        loadedRelated.current = relatedIds;
        const variantAttributes = variantAttributesOf(fresh);
        const variants = syncDrafts(
          ((storedVariants ?? []) as StoredVariant[]).map(draftFromStored),
          variantAttributes,
        );
        loadedVariants.current = variantsSnapshot({ variantAttributes, variants });
        const freshForm = { ...fromProduct(fresh), relatedIds, variantAttributes, variants };
        setLoaded(fresh);
        setForm((current) => {
          if (JSON.stringify(current) !== baseline.current) return current; // המנהל כבר התחיל להקליד
          baseline.current = JSON.stringify(freshForm);
          return freshForm;
        });
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const patch = (next: Partial<FormState>) => setForm((current) => ({ ...current, ...next }));
  const dirty = open && JSON.stringify(form) !== baseline.current;

  const persistDraft = useCallback(
    (snapshot: FormState) => {
      draftChain.current = draftChain.current.then(async () => {
        if (productSaved.current) return;
        setDraftStatus("saving");
        const payload = { title: snapshot.name.trim(), data: snapshot as unknown as Json };
        let id = draftId.current;
        if (id) {
          const { data, error } = await supabase
            .from("product_drafts")
            .update(payload)
            .eq("id", id)
            .select("id")
            .maybeSingle();
          if (error) {
            setDraftStatus("error");
            return;
          }
          if (!data) id = null; // הטיוטה נמחקה בינתיים (למשל ע"י מנהל אחר) — יוצרים חדשה
        }
        if (!id) {
          const { data, error } = await supabase
            .from("product_drafts")
            .insert(payload)
            .select("id")
            .single();
          if (error || !data) {
            setDraftStatus("error");
            return;
          }
          draftId.current = data.id;
          onDraftsChanged?.();
        }
        setDraftStatus("saved");
        setDraftSavedAt(new Date());
      });
      return draftChain.current;
    },
    [onDraftsChanged],
  );

  useEffect(() => {
    if (!open || isEdit || !dirty || !hasContent(form)) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      draftTimer.current = null;
      void persistDraft(form);
    }, DRAFT_DELAY_MS);
    return () => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
    };
  }, [form, open, isEdit, dirty, persistDraft]);

  // רענון / סגירת לשונית עם שינויים שלא נשמרו
  useEffect(() => {
    if (!open || !dirty || (!isEdit && draftStatus === "saved" && draftTimer.current === null))
      return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [open, dirty, isEdit, draftStatus]);

  const closeNow = async () => {
    setConfirmClose(false);
    setOpen(false);
    if (isEdit || productSaved.current) return;
    // שמירה מיידית של שינוי אחרון שעוד חיכה בתור
    if (draftTimer.current) {
      clearTimeout(draftTimer.current);
      draftTimer.current = null;
      if (dirty && hasContent(form)) await persistDraft(form);
    }
    await draftChain.current;
    if (draftId.current) {
      toast.info('המוצר עוד לא נוסף לקטלוג — נשמר בלשונית "טיוטות"');
      onDraftsChanged?.();
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setOpen(true);
      return;
    }
    if (busy) return;
    if (isEdit && dirty) {
      setConfirmClose(true);
      return;
    }
    void closeNow();
  };
  // "חזור" בדפדפן/בטלפון = סגירת החלון (כולל שאלת "יש שינויים שלא נשמרו")
  useBackToClose(open, () => handleOpenChange(false));

  const uploadImage = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setImageNote(null);
    try {
      const { url, originalBytes, compressedBytes } = await uploadProductImage(file);
      patch({ imageUrl: url });
      setImageNote(
        compressedBytes < originalBytes
          ? `התמונה נדחסה מ-${formatBytes(originalBytes)} ל-${formatBytes(compressedBytes)}`
          : `גודל התמונה: ${formatBytes(compressedBytes)}`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "העלאת התמונה נכשלה");
    } finally {
      setUploading(false);
    }
  };

  /** המחיר הרגיל שמולו נבדק מחיר המבצע (כמו במסד) */
  const regularPrice = (): number => {
    const prices = [Number(form.priceTier1)];
    if (tiersEnabled && !form.uniformPrice) {
      prices.push(Number(form.priceTier2), Number(form.priceTier3));
    }
    return Math.min(...prices);
  };

  const validate = (): string | null => {
    if (form.name.trim() === "") return "נדרש שם מוצר";
    if (form.orderBumpText.trim().length > 160)
      return "המשפט של מוצר הקופה ארוך מדי (עד 160 תווים)";
    if (form.category.trim() === "") return "נדרשת קטגוריה";
    const prices =
      tiersEnabled && !form.uniformPrice
        ? [form.priceTier1, form.priceTier2, form.priceTier3]
        : [form.priceTier1];
    for (const value of prices) {
      if (value.trim() === "" || !Number.isFinite(Number(value)) || Number(value) < 0) {
        return prices.length > 1 ? "נדרשים מחירים תקינים לשלושת דרגי המחיר" : "נדרש מחיר תקין";
      }
    }
    const cost = form.costPrice.trim();
    if (cost !== "" && (!Number.isFinite(Number(cost)) || Number(cost) < 0)) {
      return "מחיר עלות לא תקין (אפשר גם להשאיר ריק)";
    }
    if (form.isPromo) {
      const sale = Number(form.salePrice);
      if (form.salePrice.trim() === "" || !Number.isFinite(sale) || sale <= 0) {
        return 'סימנתם "מבצעים חמים" — חובה להזין את המחיר אחרי המבצע';
      }
      if (sale >= regularPrice()) {
        return `מחיר המבצע חייב להיות נמוך מהמחיר הרגיל (${formatIls(regularPrice())})`;
      }
      const ends = fromLocalInput(form.saleEndsAt);
      if (ends === null) {
        return "מבצע מחייב תאריך ושעת סיום";
      }
      if (new Date(ends).getTime() <= Date.now()) {
        return "תאריך סיום המבצע חייב להיות בעתיד";
      }
    }
    if (form.minEnabled) {
      const min = Number(form.minQuantity);
      if (form.minQuantity?.trim() === "" || !Number.isInteger(min) || min < 2 || min > 100000) {
        return "מינימום יחידות להזמנה: מספר שלם, 2 ומעלה";
      }
    }
    if (form.packEnabled && !form.isDigital) {
      const size = Number(form.packSize);
      if (form.packSize.trim() === "" || !Number.isInteger(size) || size < 2 || size > 1000) {
        return "נדרש מספר יחידות תקין במארז (2 ומעלה), למשל 6 או 24";
      }
    }
    // וריאציות: מאפיין בלי שם / בלי ערכים, או שורה עם מק"ט / מחיר / מלאי לא תקינים
    if (form.variantAttributes.length > 0) {
      const attributesError = attributesProblem(form.variantAttributes);
      if (attributesError) return attributesError;
      for (const variant of form.variants) {
        const variantError = variantDraftProblem(
          variant,
          variantLabel(variant.options, form.variantAttributes),
        );
        if (variantError) return variantError;
      }
      if (!form.variants.some((variant) => variant.isActive)) {
        return "כל הוריאציות כבויות — הפעילו לפחות אחת (או הסירו את המאפיינים)";
      }
    }
    if (form.hasDeposit && !form.isDigital) {
      if (form.depositPrice.trim() === "" || Number(form.depositPrice) < 0) {
        return "נדרש מחיר פיקדון תקין ליחידה";
      }
      // במוצר שנמכר במארזים הכמות נספרת ביחידות, ולכן הפיקדון תמיד ליחידה
      if (!form.packEnabled && (form.depositUnits.trim() === "" || Number(form.depositUnits) < 1)) {
        return "נדרשת כמות יחידות תקינה במארז";
      }
    }
    return null;
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const error = validate();
    if (error) {
      toast.error(error);
      return;
    }
    setBusy(true);
    const price = Number(form.priceTier1);
    const stock = Math.max(0, Math.floor(Number(form.stockQuantity) || 0));
    const common = {
      name: form.name.trim(),
      category: form.category,
      barcode: form.barcode.trim() || null,
      // ברירת מחדל "A0A" אם לא הוזן איתור, כדי שבון הליקוט תמיד יציג משהו
      shelf_location: form.shelfLocation.trim() || "A0A",
      description: form.description.trim() || null,
      image_url: form.imageUrl.trim() || null,
      images: form.imageUrl.trim() ? [form.imageUrl.trim()] : [],
      colors: form.colors,
      price_tier1: price,
      cost_price: form.costPrice.trim() === "" ? null : Number(form.costPrice),
      is_promo: form.isPromo,
      // מבצע כבוי = אין מחיר מבצע (כולל מבצע ישן שהיה שמור בלי סימון)
      sale_price: form.isPromo ? Number(form.salePrice) : null,
      sale_starts_at: form.isPromo ? fromLocalInput(form.saleStartsAt) : null,
      sale_ends_at: form.isPromo ? fromLocalInput(form.saleEndsAt) : null,
      is_hidden: form.isHidden,
      // מוצר דיגיטלי — בלי פיקדון ובלי מארזים (אין מה לשלוח)
      has_deposit: form.hasDeposit && !form.isDigital,
      deposit_price: form.hasDeposit && !form.isDigital ? Number(form.depositPrice) : null,
      deposit_units:
        form.hasDeposit && !form.isDigital
          ? form.packEnabled
            ? 1
            : Math.floor(Number(form.depositUnits))
          : null,
      pack_size: form.packEnabled && !form.isDigital ? Math.floor(Number(form.packSize)) : null,
      is_digital: form.isDigital,
      min_order_quantity: form.minEnabled ? Math.floor(Number(form.minQuantity)) : null,
      is_order_bump: form.isOrderBump,
      order_bump_text: form.orderBumpText.trim() || null,
    };
    // דרגים 2/3: כשהם פעילים — נשמרים מהטופס. כשהם רדומים — מוצר קיים שומר
    // את הערכים שכבר יש לו (לא נמחקים), ומוצר חדש מקבל את אותו מחיר בכולם.
    const tierFields = tiersEnabled
      ? {
          price_tier2: form.uniformPrice ? price : Number(form.priceTier2),
          price_tier3: form.uniformPrice ? price : Number(form.priceTier3),
        }
      : isEdit
        ? {}
        : { price_tier2: price, price_tier3: price, uniform_price: true };

    let saveError: { message: string } | null = null;
    let savedId: string | null = isEdit ? product.id : null;
    if (isEdit) {
      const update: TablesUpdate<"global_products"> = { ...common, ...tierFields };
      // מלאי ו"אזל" נשלחים רק אם המנהל שינה אותם — אחרת הזמנה שנכנסה בזמן
      // שהטופס היה פתוח הייתה נדרסת בכמות הישנה
      if (loaded && stock !== loaded.stock_quantity) update.stock_quantity = stock;
      if (loaded && form.isOutOfStock !== loaded.is_out_of_stock) {
        update.is_out_of_stock = form.isOutOfStock;
      }
      ({ error: saveError } = await supabase
        .from("global_products")
        .update(update)
        .eq("id", product.id));
    } else {
      const insert: TablesInsert<"global_products"> = {
        ...common,
        ...tierFields,
        sku: generateSku(),
        stock_quantity: stock,
        is_out_of_stock: form.isOutOfStock,
      } as TablesInsert<"global_products">;
      productSaved.current = true;
      if (draftTimer.current) {
        clearTimeout(draftTimer.current);
        draftTimer.current = null;
      }
      const { data: created, error: insertError } = await supabase
        .from("global_products")
        .insert(insert)
        .select(PRODUCT_ADMIN_COLUMNS)
        .single();
      saveError = insertError;
      savedId = created ? (created as GlobalProduct).id : null;
      if (saveError) productSaved.current = false;
    }

    if (saveError) {
      setBusy(false);
      // האינדקס הייחודי על ברקוד מחזיר שגיאת duplicate key לא קריאה למשתמש
      const duplicateBarcode =
        /barcode/i.test(saveError.message) && /duplicate|unique/i.test(saveError.message);
      toast.error(duplicateBarcode ? "הברקוד הזה כבר משויך למוצר אחר" : saveError.message);
      return;
    }

    // וריאציות: נשמרות אחרי המוצר (צריך את המזהה שלו), ורק אם השתנו
    const nextVariants = variantsSnapshot(form);
    if (savedId && nextVariants !== loadedVariants.current) {
      const attributes = form.variantAttributes.filter(
        (attribute) => attribute.name.trim() !== "" && attribute.values.length > 0,
      );
      const { error: variantsError } = await supabase.rpc("save_product_variants", {
        _product_id: savedId,
        _attributes: attributes.map((attribute) => ({
          name: attribute.name.trim(),
          values: attribute.values,
        })) as unknown as Json,
        _variants: (attributes.length > 0 ? variantsPayload(form.variants) : []) as unknown as Json,
      });
      if (variantsError) {
        toast.warning(`המוצר נשמר, אבל הוריאציות לא: ${variantsError.message}`);
      } else {
        loadedVariants.current = nextVariants;
      }
    }

    // מוצרים קשורים: נשמרים אחרי המוצר (צריך את המזהה שלו), ורק אם השתנו
    if (savedId && JSON.stringify(form.relatedIds) !== JSON.stringify(loadedRelated.current)) {
      const relationsError = await saveRelatedProducts(savedId, form.relatedIds);
      if (relationsError) toast.warning(`המוצר נשמר, אבל המוצרים הקשורים לא: ${relationsError}`);
      else loadedRelated.current = form.relatedIds;
    }

    if (!isEdit) {
      // המוצר נוסף — הטיוטה שלו כבר לא נחוצה
      await draftChain.current;
      if (draftId.current) {
        await supabase.from("product_drafts").delete().eq("id", draftId.current);
        draftId.current = null;
        onDraftsChanged?.();
      }
    }
    setBusy(false);
    toast.success(
      isEdit
        ? form.isHidden && !loaded?.is_hidden
          ? 'המוצר הוסתר ועבר ללשונית "מוסתרים"'
          : !form.isHidden && loaded?.is_hidden
            ? `המוצר חזר לקטלוג, לקטגוריה "${form.category}"`
            : "המוצר עודכן בהצלחה"
        : form.isHidden
          ? 'המוצר נוסף כמוסתר (לשונית "מוסתרים")'
          : "המוצר נוסף לקטלוג",
    );
    baseline.current = JSON.stringify(form);
    setOpen(false);
    onSaved();
  };

  const remove = async () => {
    if (!product) return;
    setDeleting(true);
    const { error } = await supabase.from("global_products").delete().eq("id", product.id);
    setDeleting(false);
    if (error) {
      toast.error(
        /foreign key|violates/i.test(error.message)
          ? 'אי אפשר למחוק מוצר שמופיע בהזמנות. אפשר להסתיר אותו במקום — הוא יעבור ל"מוסתרים"'
          : error.message,
      );
      return;
    }
    toast.success("המוצר נמחק");
    baseline.current = JSON.stringify(form);
    setOpen(false);
    onSaved();
  };

  const sale = Number(form.salePrice);
  const regular = regularPrice();
  const saleValid =
    form.salePrice.trim() !== "" && Number.isFinite(sale) && sale > 0 && Number.isFinite(regular);
  const legacySale = loaded !== null && loaded.sale_price != null && !loaded.is_promo;
  const saleEndInvalid =
    form.saleEndsAt.trim() !== "" &&
    (fromLocalInput(form.saleEndsAt) === null ||
      new Date(fromLocalInput(form.saleEndsAt) ?? 0).getTime() <= Date.now());
  // מוצר שכבר היה במבצע לפני שהתאריך הפך לחובה (נשמר אז בלי תאריך) — עוזר להסביר
  // למה השמירה נחסמת גם בלי לגעת בשום דבר אחר
  const legacyPromoNoEndDate = loaded !== null && loaded.is_promo && loaded.sale_ends_at == null;

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          {isEdit ? (
            <Button variant="outline" size="sm" className="min-h-11 w-full">
              <Pencil className="size-4" />
              עריכה
            </Button>
          ) : draft ? (
            <Button size="sm" className="min-h-11 w-full">
              <Pencil className="size-4" />
              המשך עריכה
            </Button>
          ) : triggerLabel ? (
            <Button size="sm" variant="outline">
              <Plus className="size-4" />
              {triggerLabel}
            </Button>
          ) : (
            <Button>
              <Plus className="size-4" />
              מוצר חדש
            </Button>
          )}
        </DialogTrigger>
        <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto text-right">
          <DialogHeader>
            <DialogTitle>
              {isEdit ? "עריכת מוצר" : draft ? "המשך טיוטה" : "מוצר חדש בקטלוג"}
            </DialogTitle>
            <DialogDescription>
              {isEdit
                ? product.name
                : 'מלאו את פרטי המוצר. עד שתלחצו "הוספה לקטלוג" הטופס נשמר אוטומטית כטיוטה.'}
            </DialogDescription>
            {!isEdit && (
              <p aria-live="polite" className="text-xs text-muted-foreground">
                {draftStatus === "saving"
                  ? "שומר טיוטה..."
                  : draftStatus === "error"
                    ? "לא הצלחנו לשמור טיוטה כרגע — אל תסגרו את החלון לפני שמירה"
                    : draftSavedAt
                      ? `נשמר כטיוטה · ${draftSavedAt.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}`
                      : null}
              </p>
            )}
          </DialogHeader>

          <form onSubmit={save} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="p-image">תמונת מוצר</Label>
              <div className="flex items-center gap-3">
                <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-secondary">
                  {form.imageUrl ? (
                    <img src={form.imageUrl} alt="" className="size-full object-cover" />
                  ) : (
                    <Package className="size-6 text-muted-foreground" />
                  )}
                </div>
                <Input
                  id="p-image"
                  type="file"
                  accept="image/*"
                  disabled={uploading}
                  onChange={(e) => void uploadImage(e.target.files?.[0])}
                />
                {uploading && <Loader2 className="size-4 shrink-0 animate-spin" />}
              </div>
              <p className="text-xs text-muted-foreground">
                {imageNote ??
                  'התמונה נדחסת אוטומטית לטעינה מהירה, ומוצגת ללקוחות בכיתוב "להמחשה בלבד".'}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="p-name">שם המוצר</Label>
              <Input
                id="p-name"
                required
                value={form.name}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>קטגוריה</Label>
              <div className="flex gap-2">
                <Select value={form.category} onValueChange={(v) => patch({ category: v })}>
                  <SelectTrigger dir="rtl">
                    <SelectValue placeholder="בחרו קטגוריה" />
                  </SelectTrigger>
                  <SelectContent dir="rtl" className="max-h-80">
                    {categoryTree.flat.map((node) => (
                      <SelectItem
                        key={node.name}
                        value={node.name}
                        className={node.depth === 1 ? "font-semibold" : undefined}
                        style={{ paddingRight: `${2 + (node.depth - 1) * 1.25}rem` }}
                      >
                        {formatPath(node)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <CategoryManagerDialog trigger="plus" />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="p-barcode">ברקוד (אופציונלי)</Label>
                <Input
                  id="p-barcode"
                  dir="ltr"
                  inputMode="numeric"
                  value={form.barcode}
                  onChange={(e) => patch({ barcode: e.target.value })}
                  placeholder="7290000000000"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-shelf">איתור במחסן (אופציונלי)</Label>
                <Input
                  id="p-shelf"
                  value={form.shelfLocation}
                  onChange={(e) => patch({ shelfLocation: e.target.value })}
                  placeholder="שורה 3 / מדף B"
                />
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                שני השדות אופציונליים וניתנים לשינוי בכל שלב. הברקוד מופיע בפירוט ההזמנה ובמסמכים,
                והאיתור מופיע בבון הליקוט למחסן.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="p-desc">תיאור (אופציונלי)</Label>
              <Textarea
                id="p-desc"
                rows={2}
                value={form.description}
                onChange={(e) => patch({ description: e.target.value })}
              />
            </div>

            {tiersEnabled ? (
              <div className="grid gap-4 sm:grid-cols-3">
                {(
                  [
                    ["p-t1", "מחיר דרג 1", "priceTier1"],
                    ["p-t2", "מחיר דרג 2", "priceTier2"],
                    ["p-t3", "מחיר דרג 3", "priceTier3"],
                  ] as const
                ).map(([id, label, key]) => (
                  <div key={id} className="space-y-2">
                    <Label htmlFor={id}>{label}</Label>
                    <Input
                      id={id}
                      type="number"
                      min={0}
                      step="any"
                      required
                      value={form[key]}
                      onChange={(e) => patch({ [key]: e.target.value } as Partial<FormState>)}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-2 sm:max-w-[14rem]">
                <Label htmlFor="p-price">מחיר (₪)</Label>
                <Input
                  id="p-price"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  required
                  value={form.priceTier1}
                  onChange={(e) => patch({ priceTier1: e.target.value })}
                />
              </div>
            )}

            <div className="space-y-2 sm:max-w-[14rem]">
              <Label htmlFor="p-cost">מחיר עלות (₪, אופציונלי)</Label>
              <Input
                id="p-cost"
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={form.costPrice}
                onChange={(e) => patch({ costPrice: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">ניהולי בלבד — לא מוצג ללקוחות.</p>
            </div>

            <div className="space-y-3 rounded-lg border border-border p-3">
              <label className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">מבצעים חמים</span>
                <Switch
                  checked={form.isPromo}
                  onCheckedChange={(v) =>
                    patch({
                      isPromo: v,
                      // הפעלה ראשונה — מציעים שבוע קדימה כברירת מחדל, ניתן לשינוי מיד
                      saleEndsAt:
                        v && form.saleEndsAt.trim() === ""
                          ? toLocalInput(
                              new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                            )
                          : form.saleEndsAt,
                    })
                  }
                />
              </label>
              {form.isPromo ? (
                <div className="space-y-3">
                  <div className="grid items-end gap-3 sm:grid-cols-[12rem_1fr]">
                    <div className="space-y-2">
                      <Label htmlFor="p-sale">
                        מחיר אחרי מבצע (₪) <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="p-sale"
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="any"
                        value={form.salePrice}
                        onChange={(e) => patch({ salePrice: e.target.value })}
                        aria-invalid={saleValid && sale >= regular}
                        className={saleValid && sale >= regular ? "border-destructive" : undefined}
                      />
                      {form.packEnabled && Number(form.packSize) >= 2 && (
                        <PackPriceField
                          id="p-pack-sale"
                          label="מחיר מבצע למארז (₪)"
                          unit={form.salePrice}
                          packSize={Number(form.packSize)}
                          onUnitChange={(unit) => patch({ salePrice: unit })}
                        />
                      )}
                    </div>
                    <p
                      className={`text-xs leading-5 ${saleValid && sale >= regular ? "text-destructive" : "text-muted-foreground"}`}
                    >
                      {!saleValid
                        ? `חובה להזין מחיר נמוך מהמחיר הרגיל${Number.isFinite(regular) && form.priceTier1.trim() !== "" ? ` (${formatIls(regular)})` : ""}.`
                        : sale >= regular
                          ? `מחיר המבצע חייב להיות נמוך מהמחיר הרגיל (${formatIls(regular)}).`
                          : `במקום ${formatIls(regular)} — חיסכון של ${Math.round((1 - sale / regular) * 100)}%. ללקוחות יוצג המחיר הרגיל מחוק${form.packEnabled ? " (המחיר ליחידה, כמו המחיר הרגיל)" : ""}.`}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="p-sale-end">
                      תאריך ושעת סיום המבצע <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="p-sale-end"
                      type="datetime-local"
                      value={form.saleEndsAt}
                      onChange={(e) => patch({ saleEndsAt: e.target.value })}
                      aria-invalid={saleEndInvalid}
                      className={saleEndInvalid ? "border-destructive" : undefined}
                    />
                    <p
                      className={`text-xs leading-5 ${saleEndInvalid ? "text-destructive" : "text-muted-foreground"}`}
                    >
                      {form.saleEndsAt.trim() === ""
                        ? "חובה — ברגע שהתאריך עובר, המבצע מתבטל אוטומטית והמוצר חוזר למחיר הרגיל."
                        : saleEndInvalid
                          ? "התאריך חייב להיות בעתיד."
                          : "ברגע שהתאריך הזה עובר, המבצע מתבטל אוטומטית והמוצר חוזר למחיר הרגיל."}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  כבוי: המוצר נמכר במחיר הרגיל ולא מופיע ב"מבצעים חמים".
                </p>
              )}
              {legacySale && !form.isPromo && (
                <p className="rounded-md bg-accent/10 p-2 text-xs text-foreground">
                  למוצר שמור מחיר מבצע ({formatIls(Number(loaded?.sale_price))}) בלי סימון "מבצעים
                  חמים". כדי לשמור אותו — הפעילו את המתג. אחרת הוא יוסר בשמירה.
                </p>
              )}
              {form.isPromo && legacyPromoNoEndDate && (
                <p className="rounded-md bg-accent/10 p-2 text-xs text-foreground">
                  למבצע הזה עדיין אין תאריך סיום (נשמר לפני התוספת הזו). בחרו תאריך כדי לשמור.
                </p>
              )}
            </div>

            <div
              className={`space-y-2 rounded-lg border p-3 ${
                form.isDigital ? "border-sky-300 bg-sky-50/60 dark:bg-sky-950/30" : "border-border"
              }`}
            >
              <label className="flex items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <KeyRound className="size-4 text-sky-700 dark:text-sky-300" aria-hidden="true" />
                  מוצר דיגיטלי
                  {/* בחבילה הבסיסית: אי אפשר להפוך מוצר לדיגיטלי (מוצר שכבר דיגיטלי — אפשר לכבות) */}
                  {!can("digital") && !form.isDigital && <PremiumBadge />}
                </span>
                <Switch
                  checked={form.isDigital}
                  disabled={!can("digital") && !form.isDigital}
                  onCheckedChange={(v) => patch({ isDigital: v })}
                />
              </label>
              <p className="text-xs leading-5 text-muted-foreground">
                {form.isDigital
                  ? "רישיון / קוד / מנוי: בלי מלאי פיזי, בלי פיקדון ובלי ליקוט במחסן. סל שכולו דיגיטלי עובר לתשלום בלי בחירת משלוח, ובהזמנה מזינים את מפתח הרישיון ושולחים ללקוח במייל."
                  : can("digital")
                    ? "כבוי: מוצר פיזי רגיל — נשמר במלאי ונשלח / נאסף."
                    : "מכירת רישיונות, קודים ומנויים דיגיטליים — זמין בחבילת פרימיום."}
              </p>
            </div>

            {!form.isDigital && (
              <div className="space-y-3 rounded-lg border border-border p-3">
                <label className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">נמכר במארזים (מינימום וכפולות)</span>
                  <Switch
                    checked={form.packEnabled}
                    onCheckedChange={(v) => patch({ packEnabled: v })}
                  />
                </label>
                {form.packEnabled && (
                  <div className="grid items-end gap-3 sm:grid-cols-[10rem_1fr]">
                    <div className="space-y-2">
                      <Label htmlFor="p-pack-size">יחידות במארז</Label>
                      <Input
                        id="p-pack-size"
                        type="number"
                        inputMode="numeric"
                        min={2}
                        step="1"
                        value={form.packSize}
                        onChange={(e) => patch({ packSize: e.target.value })}
                        placeholder="24"
                      />
                    </div>
                    <p className="text-xs leading-5 text-muted-foreground">
                      {Number(form.packSize) >= 2
                        ? `הלקוח יזמין ${form.packSize}, ${Number(form.packSize) * 2}, ${Number(form.packSize) * 3} יחידות וכן הלאה.`
                        : "כמה יחידות במארז אחד (למשל 24)."}
                    </p>
                  </div>
                )}
                {form.packEnabled && Number(form.packSize) >= 2 && (
                  <PackPriceField
                    id="p-pack-price"
                    label="מחיר למארז (₪)"
                    unit={form.priceTier1}
                    packSize={Number(form.packSize)}
                    onUnitChange={(unit) => patch({ priceTier1: unit })}
                  />
                )}
                {!form.packEnabled && (
                  <p className="text-xs text-muted-foreground">
                    כבוי: המוצר נמכר ביחידה, בלי מינימום.
                  </p>
                )}
              </div>
            )}

            <div className="space-y-3 rounded-lg border border-border p-3">
              <label className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">הגבלת מינימום יחידות להזמנה</span>
                <Switch
                  checked={form.minEnabled ?? false}
                  onCheckedChange={(v) => patch({ minEnabled: v })}
                />
              </label>
              {form.minEnabled ? (
                <div className="grid items-end gap-3 sm:grid-cols-[10rem_1fr]">
                  <div className="space-y-2">
                    <Label htmlFor="p-min-qty">מינימום יחידות</Label>
                    <Input
                      id="p-min-qty"
                      type="number"
                      inputMode="numeric"
                      min={2}
                      step="1"
                      value={form.minQuantity ?? ""}
                      onChange={(e) => patch({ minQuantity: e.target.value })}
                      placeholder="2"
                    />
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {Number(form.minQuantity) >= 2
                      ? `הלקוח לא יוכל להזמין פחות מ-${form.minQuantity} יחידות; מעל זה — כל כמות (${form.minQuantity}, ${Number(form.minQuantity) + 1}, ${Number(form.minQuantity) + 2}...), בלי חובת כפולות.` +
                        (form.packEnabled && Number(form.packSize) >= 2
                          ? ` יחד עם המארזים: הכמות הקטנה בפועל = ${Math.max(Number(form.packSize), Math.ceil(Number(form.minQuantity) / Number(form.packSize)) * Number(form.packSize))}.`
                          : "")
                      : "סף תחתון בלבד (למשל 2): 1 נחסם, 2 ומעלה מותר. נפרד מהמארזים."}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">כבוי: בלי מינימום להזמנה.</p>
              )}
            </div>

            {form.isDigital ? (
              <p className="rounded-lg bg-secondary/60 px-3 py-2 text-xs leading-5 text-muted-foreground">
                מלאי: מוצר דיגיטלי לא נשמר במלאי הפיזי. כדי להפסיק למכור אותו — "סמן כאזל מהמלאי".
              </p>
            ) : (
              <>
                <div className="space-y-2 sm:max-w-[14rem]">
                  <Label htmlFor="p-stock">כמות במלאי</Label>
                  <Input
                    id="p-stock"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={form.stockQuantity}
                    onChange={(e) => patch({ stockQuantity: e.target.value })}
                  />
                </div>
                <p className="-mt-2 text-xs leading-5 text-muted-foreground">
                  יורד אוטומטית כשלקוח שולח הזמנה (הכמות שמורה לו) וחוזר אם ההזמנה מבוטלת. ב-0 המוצר
                  (או כשנשאר פחות ממארז אחד) מסומן "אזל" ונשלחת התראה. 0 במוצר שלא סומן "אזל" = מלאי
                  שעוד לא נספר (בלי הגבלה).
                  {form.variants.some((variant) => variant.stock.trim() !== "") &&
                    " לוריאציה עם מלאי משלה — המלאי שלה (בטבלת הוריאציות)."}
                </p>
              </>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center justify-between gap-2 rounded-lg border border-border p-3">
                <span className="text-sm font-medium">
                  סמן כאזל מהמלאי
                  {loaded?.out_of_stock_auto && form.isOutOfStock && (
                    <span className="block text-xs font-normal text-muted-foreground">
                      סומן אוטומטית כשהמלאי הגיע ל-0
                    </span>
                  )}
                </span>
                <Switch
                  checked={form.isOutOfStock}
                  onCheckedChange={(v) => patch({ isOutOfStock: v })}
                />
              </label>
              <label className="flex items-center justify-between gap-2 rounded-lg border border-border p-3">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <EyeOff className="size-4 text-muted-foreground" />
                  הסתר מוצר
                </span>
                <Switch checked={form.isHidden} onCheckedChange={(v) => patch({ isHidden: v })} />
              </label>
            </div>
            {form.isHidden && (
              <p className="-mt-2 text-xs leading-5 text-muted-foreground">
                המוצר יעבור ללשונית "מוסתרים" ולא יוצג ללקוחות ולאורחים. הוא נשאר משויך ל"
                {form.category}" — כשמורידים את הסימון הוא חוזר לשם.
              </p>
            )}

            {!form.isDigital && (
              <div className="space-y-3 rounded-lg border border-border p-3">
                <label className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">מוצר חייב בפיקדון</span>
                  <Switch
                    checked={form.hasDeposit}
                    onCheckedChange={(v) => patch({ hasDeposit: v })}
                  />
                </label>
                {form.hasDeposit && (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="p-deposit-price">מחיר פיקדון ליחידה (₪)</Label>
                        <Input
                          id="p-deposit-price"
                          type="number"
                          min={0}
                          step="any"
                          value={form.depositPrice}
                          onChange={(e) => patch({ depositPrice: e.target.value })}
                          placeholder="0.30"
                        />
                      </div>
                      {!form.packEnabled && (
                        <div className="space-y-2">
                          <Label htmlFor="p-deposit-units">כמות יחידות במארז</Label>
                          <Input
                            id="p-deposit-units"
                            type="number"
                            min={1}
                            step="1"
                            value={form.depositUnits}
                            onChange={(e) => patch({ depositUnits: e.target.value })}
                            placeholder="24"
                          />
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {form.packEnabled
                        ? "המוצר נמכר במארזים, ולכן הפיקדון מחושב לכל יחידה שנמכרת (48 פחיות = 48 פיקדונות). אם המחיר כבר כולל פיקדון — לא לסמן פיקדון."
                        : form.depositPrice.trim() !== "" && form.depositUnits.trim() !== ""
                          ? `פיקדון למארז: ${(Number(form.depositPrice) * Number(form.depositUnits)).toFixed(2)} ₪ ` +
                            `(${form.depositUnits} × ${form.depositPrice} ₪) — יתווסף אוטומטית כשורה נוספת בהזמנה`
                          : "מחיר הפיקדון הוא ליחידה בודדת; המערכת מכפילה בכמות היחידות במארז ומוסיפה שורת פיקדון אוטומטית להזמנה."}
                    </p>
                  </>
                )}
              </div>
            )}

            {can("variants") ? (
              <VariantsEditor
                attributes={form.variantAttributes}
                variants={form.variants}
                onChange={(variantAttributes, variants) => patch({ variantAttributes, variants })}
                basePrice={form.priceTier1}
                isDigital={form.isDigital}
              />
            ) : (
              <PremiumLockCard
                compact
                title="וריאציות (צבעים / מידות)"
                description={
                  form.variantAttributes.length > 0
                    ? "למוצר הזה כבר יש וריאציות — הן ממשיכות להימכר כרגיל. עריכה שלהן זמינה בחבילת פרימיום."
                    : "מוצר אחד בכמה צבעים ומידות, עם מק״ט, מחיר ומלאי לכל צירוף — זמין בחבילת פרימיום."
                }
              />
            )}

            {/* אפשרויות פשוטות (נפח / טעם / סוג) — גם הן וריאציות: בחבילה הבסיסית
                נשמרות כמו שהן, בלי עריכה (הנעילה בכרטיס שלמעלה) */}
            {can("variants") && (
              <ColorsInput
                id="p-colors"
                value={form.colors}
                onChange={(colors) => patch({ colors })}
              />
            )}

            <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50/50 p-3">
              <label className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Sparkles className="size-4 text-amber-600" />
                  מוצר קופה (Order Bump)
                </span>
                <Switch
                  checked={form.isOrderBump}
                  onCheckedChange={(v) => patch({ isOrderBump: v })}
                />
              </label>
              <p className="text-xs leading-5 text-muted-foreground">
                יוצע ללקוחות בסל, ממש לפני שליחת ההזמנה, בתיבת סימון אחת שמוסיפה אותו לסל. מתאים
                במיוחד למוצר משלים במחיר נמוך.
              </p>
              {form.isOrderBump && (
                <div className="space-y-1.5">
                  <Label htmlFor="p-bump-text">משפט שיווקי בהצעה (לא חובה)</Label>
                  <Input
                    id="p-bump-text"
                    maxLength={160}
                    value={form.orderBumpText}
                    onChange={(e) => patch({ orderBumpText: e.target.value })}
                    placeholder="למשל: רוב הלקוחות מוסיפים גם את זה להזמנה"
                  />
                  <p className="numeric text-left text-[11px] text-muted-foreground" dir="ltr">
                    {form.orderBumpText.trim().length}/160
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-2 rounded-lg border border-border p-3">
              <Label htmlFor="p-related">מוצרים קשורים — "מוצרים נוספים שאולי תאהבו"</Label>
              <p className="text-xs leading-5 text-muted-foreground">
                יוצגו בחלון המוצר ובסל, לפי הסדר כאן. אם לא תבחרו — יוצגו אוטומטית מוצרים מאותה
                קטגוריה.
              </p>
              <ProductPicker
                id="p-related"
                value={form.relatedIds}
                onChange={(relatedIds) => patch({ relatedIds })}
                excludeIds={product ? [product.id] : []}
                max={12}
              />
            </div>

            <Button type="submit" className="w-full" size="lg" disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {busy ? "שומר..." : isEdit ? "שמירת שינויים" : "הוספה לקטלוג"}
            </Button>

            {isEdit && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="destructive"
                    size="lg"
                    className="w-full"
                    disabled={busy || deleting}
                  >
                    <Trash2 className="size-4" />
                    מחק מוצר
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent dir="rtl" className="text-right">
                  <AlertDialogHeader>
                    <AlertDialogTitle>למחוק את המוצר?</AlertDialogTitle>
                    <AlertDialogDescription>
                      המוצר "{product?.name}" יימחק מהקטלוג לצמיתות. פעולה זו חסומה אם קיימות הזמנות
                      עם מוצר זה — במקרה כזה אפשר להסתיר אותו.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter className="gap-2 sm:flex-row-reverse sm:justify-start">
                    <AlertDialogAction onClick={() => void remove()}>
                      {deleting ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                      כן, מחק
                    </AlertDialogAction>
                    <AlertDialogCancel>ביטול</AlertDialogCancel>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent dir="rtl" className="text-right">
          <AlertDialogHeader>
            <AlertDialogTitle>לצאת בלי לשמור?</AlertDialogTitle>
            <AlertDialogDescription>
              השינויים במוצר "{form.name || product?.name}" עדיין לא נשמרו ויאבדו ביציאה.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:flex-row-reverse sm:justify-start">
            <AlertDialogCancel>המשך עריכה</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void closeNow()}
            >
              יציאה בלי לשמור
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * "מחיר למארז": כותבים את מחיר המארז (למשל 115), והמחיר ליחידה מחושב לבד
 * בדיוק של 10 ספרות (115 / 24 = 4.7916666667) — כך המארז יוצא בדיוק 115.00
 * באתר, בהזמנה ובקבלה. מחיר המארז קובע: שינוי מספר היחידות במארז מחשב מחדש
 * את המחיר ליחידה; עריכה ישירה של המחיר ליחידה מעדכנת את מחיר המארז.
 */
function PackPriceField({
  id,
  label,
  unit,
  packSize,
  onUnitChange,
}: {
  id: string;
  label: string;
  unit: string;
  packSize: number;
  onUnitChange: (unit: string) => void;
}) {
  const unitNumber = Number(unit);
  const derived =
    unit.trim() === "" || !Number.isFinite(unitNumber)
      ? ""
      : String(Math.round(unitNumber * packSize * 100) / 100);
  const [text, setText] = useState(derived);
  const typed = useRef(false);
  const lastSize = useRef(packSize);

  // מספר היחידות במארז השתנה — מחיר המארז נשאר, והמחיר ליחידה מחושב מחדש.
  // רץ לפני האפקט שמסנכרן ממחיר היחידה, ומסמן לו לא לדרוס את מחיר המארז
  // בסיבוב הזה (מחיר היחידה עוד לא התעדכן).
  const skipDerived = useRef(false);
  useEffect(() => {
    if (lastSize.current === packSize) return;
    lastSize.current = packSize;
    if (typed.current && text.trim() !== "" && packSize >= 1) {
      skipDerived.current = true;
      onUnitChange(unitPriceFromPack(Number(text), packSize));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [packSize]);

  // המחיר ליחידה השתנה ממקום אחר (שדה המחיר / טעינת מוצר) — מציגים את מחיר המארז שלו
  useEffect(() => {
    if (skipDerived.current) {
      skipDerived.current = false;
      return;
    }
    const fromText = Math.round(Number(text) * 100) / 100;
    if (typed.current && text.trim() !== "" && Math.abs(fromText - Number(derived)) < 0.005) return;
    typed.current = false;
    setText(derived);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derived]);

  return (
    <div className="space-y-1.5 rounded-md bg-secondary/60 p-2.5">
      <Label htmlFor={id} className="text-sm">
        {label} — מארז של {packSize}
      </Label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min={0}
        step="any"
        value={text}
        placeholder="למשל 115"
        onChange={(e) => {
          typed.current = true;
          setText(e.target.value);
          onUnitChange(
            e.target.value.trim() === "" ? "" : unitPriceFromPack(Number(e.target.value), packSize),
          );
        }}
      />
      <p className="numeric text-xs leading-5 text-muted-foreground">
        {unit.trim() !== "" && Number.isFinite(unitNumber)
          ? `מחיר ליחידה: ₪${unitNumber} · ${packSize} יח׳ = ${formatIls(unitNumber * packSize)}`
          : "כותבים את מחיר המארז — המחיר ליחידה יחושב אוטומטית."}
      </p>
    </div>
  );
}
