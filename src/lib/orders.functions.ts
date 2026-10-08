import { staffName } from "@/lib/staff";
import {
  ORDER_CONTACT_COLUMNS,
  billingOf,
  deliveryOf,
  type OrderContactFields,
} from "@/lib/order-details";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireStoreOpen } from "@/lib/rest-window.middleware";

/** פעולות הזמנה בצד השרת: שכפול הזמנה ובון ליקוט למחסן */

/**
 * שכפול הזמנה ("הזמנה חוזרת"): יוצר הזמנה חדשה עם אותם פריטים וכמויות,
 * אבל **במחירים של היום** (כולל מבצע פעיל) ולפי קבוצת המחיר הנוכחית של
 * הלקוח — לא במחירים שהיו בהזמנה המקורית.
 */
export const reorderOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requireStoreOpen])
  .inputValidator((input: { orderId: string }) => {
    const orderId = String(input?.orderId ?? "").trim();
    if (!orderId) throw new Error("חסר מזהה הזמנה");
    return { orderId };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: sourceData } = await supabaseAdmin
      .from("orders")
      .select(
        `id, customer_id, agent_id, note, shipping_method_id, shipping_kind, ${ORDER_CONTACT_COLUMNS}, order_items (product_id, variant_id, quantity, is_deposit, is_gift)`,
      )
      .eq("id", data.orderId)
      .maybeSingle();
    if (!sourceData) throw new Error("ההזמנה לא נמצאה");
    const source = sourceData as unknown as OrderContactFields & {
      id: string;
      customer_id: string | null;
      agent_id: string | null;
      note: string | null;
      shipping_method_id: string | null;
      shipping_kind: string | null;
      order_items: {
        product_id: string;
        variant_id: string | null;
        quantity: number;
        is_deposit: boolean;
        is_gift: boolean;
      }[];
    };
    const customerId = source.customer_id;
    if (!customerId) {
      throw new Error("הזמנת אורח אי אפשר לשכפל — אין לה חשבון לקוח. אפשר ליצור הזמנה ידנית.");
    }

    const { loadCaller } = await import("@/lib/caller.server");
    const caller = await loadCaller(context.userId);
    const isOwner = context.userId === source.customer_id || context.userId === source.agent_id;
    if (!isOwner && caller?.role !== "admin") throw new Error("אין הרשאה");

    // שורות פיקדון נוצרות במסד לפי המוצר, ומתנות — לפי ההטבות של היום
    const items = (source.order_items ?? []).filter((item) => !item.is_deposit && !item.is_gift);
    if (items.length === 0) throw new Error("אין פריטים לשכפול");

    // מחירון פתוח: לקוח מאושר עם דרג — הדרג שלו; כל השאר — המחירון הרגיל (1).
    // אותו חישוב כמו buyer_price_tier במסד.
    const [{ data: profile }, { data: customerRole }, { data: settings }] = await Promise.all([
      supabaseAdmin
        .from("customer_profiles")
        .select("price_tier, price_list_type")
        .eq("user_id", customerId)
        .maybeSingle(),
      supabaseAdmin
        .from("user_roles")
        .select("is_approved, is_blocked")
        .eq("user_id", customerId)
        .maybeSingle(),
      supabaseAdmin
        .from("site_settings")
        .select("prices_include_vat, vat_rate")
        .eq("id", true)
        .maybeSingle(),
    ]);

    if (customerRole?.is_blocked) {
      throw new Error("החשבון חסום — לא ניתן לשלוח הזמנות. לבירור פנו אלינו.");
    }
    const assignedTier = profile?.price_tier ?? null;
    const tier =
      customerRole?.is_approved === true &&
      assignedTier !== null &&
      [1, 2, 3].includes(assignedTier)
        ? assignedTier
        : 1;
    const kind = "order" as "order" | "quote";

    const productIds = [...new Set(items.map((item) => item.product_id))];
    const [{ data: products }, { data: variants }] = await Promise.all([
      supabaseAdmin
        .from("global_products")
        .select(
          "id, price_tier1, price_tier2, price_tier3, sale_price, sale_starts_at, sale_ends_at, is_out_of_stock, is_hidden, stock_quantity, pack_size, is_digital",
        )
        .in("id", productIds),
      supabaseAdmin
        .from("product_variants")
        .select("id, product_id, price, stock_quantity, is_active")
        .in("product_id", productIds),
    ]);
    const productById = new Map((products ?? []).map((product) => [product.id, product]));
    const variantById = new Map((variants ?? []).map((variant) => [variant.id, variant]));
    const productHasVariants = new Set(
      (variants ?? []).filter((variant) => variant.is_active).map((variant) => variant.product_id),
    );

    // מחירון אישי: מחירים שהמנהל קבע ללקוח גוברים על הדרג (רק כשהמחירון פעיל)
    const customPrices = new Map<string, number>();
    if (profile?.price_list_type === "custom") {
      const { data: overrides } = await supabaseAdmin
        .from("user_custom_prices")
        .select("product_id, custom_price")
        .eq("user_id", customerId)
        .in("product_id", productIds);
      for (const row of overrides ?? []) customPrices.set(row.product_id, Number(row.custom_price));
    }

    // המחיר המחייב נקבע שוב בטריגר במסד (snapshot_order_item_product) — כאן
    // אותו חישוב, כדי שהסכום שמוצג מיד יתאים
    const now = Date.now();
    const priceOf = (productId: string, variantId: string | null): number => {
      const variant = variantId ? variantById.get(variantId) : undefined;
      if (variant && variant.price !== null) return Number(variant.price);
      const product = productById.get(productId);
      if (!product) return 0;
      const tierPrice =
        tier === 2
          ? Number(product.price_tier2)
          : tier === 3
            ? Number(product.price_tier3)
            : Number(product.price_tier1);
      const base = customPrices.get(productId) ?? tierPrice;
      const saleActive =
        product.sale_price !== null &&
        (product.sale_starts_at === null || new Date(product.sale_starts_at).getTime() <= now) &&
        (product.sale_ends_at === null || new Date(product.sale_ends_at).getTime() >= now);
      return saleActive ? Math.min(Number(product.sale_price), base) : base;
    };

    // מוצר / אפשרות שהוסתרו, אזלו או נמחקו מאז — לא נכנסים. מוצר שבינתיים
    // קיבל וריאציות (והשורה הישנה בלי בחירה) — גם לא: צריך לבחור מחדש.
    // מוצר שעבר ל"נמכר במארזים": הכמות מתעגלת כלפי מעלה; ומוגבלת למלאי הזמין
    // (של הוריאציה, אם היא סופרת מלאי) — המלאי נשמר ברגע ההזמנה.
    let adjustedCount = 0;
    let skipped = 0;
    const rows: {
      order_id: string;
      product_id: string;
      variant_id: string | null;
      quantity: number;
      unit_price: number;
    }[] = [];
    // מלאי שכבר "נלקח" ע"י שורות קודמות באותה הזמנה (שתי וריאציות של מוצר)
    const usedStock = new Map<string, number>();
    const pendingRows: Omit<(typeof rows)[number], "order_id">[] = [];
    for (const item of items) {
      const product = productById.get(item.product_id);
      const variant = item.variant_id ? variantById.get(item.variant_id) : undefined;
      const unavailable =
        !product ||
        product.is_hidden ||
        product.is_out_of_stock ||
        (item.variant_id
          ? !variant || !variant.is_active
          : productHasVariants.has(item.product_id));
      if (unavailable) {
        skipped += 1;
        continue;
      }
      const pack = product.pack_size && product.pack_size >= 2 ? product.pack_size : null;
      let quantity = pack ? Math.max(pack, Math.ceil(item.quantity / pack) * pack) : item.quantity;
      if (!product.is_digital) {
        const fromVariant = variant && variant.stock_quantity !== null;
        const stockKey = fromVariant ? `v:${variant.id}` : `p:${product.id}`;
        const total = fromVariant ? Number(variant.stock_quantity) : (product.stock_quantity ?? 0);
        const left = total - (usedStock.get(stockKey) ?? 0);
        // מלאי 0 שלא מסומן "אזל" (מוצר בלי ספירה) = לא מגבילים; וריאציה שסופרת מלאי — כן
        const limited = fromVariant || total > 0;
        if (limited && quantity > left) {
          quantity = pack ? Math.floor(Math.max(0, left) / pack) * pack : Math.max(0, left);
          adjustedCount += 1;
        }
        usedStock.set(stockKey, (usedStock.get(stockKey) ?? 0) + quantity);
      }
      if (quantity <= 0) {
        skipped += 1;
        continue;
      }
      pendingRows.push({
        product_id: item.product_id,
        variant_id: item.variant_id,
        quantity,
        unit_price: priceOf(item.product_id, item.variant_id),
      });
    }
    if (pendingRows.length === 0) {
      throw new Error("אף אחד מהמוצרים בהזמנה המקורית אינו זמין כרגע");
    }

    // המשלוח: אותה שיטה (אם היא עדיין פעילה). סל שכולו דיגיטלי — בלי משלוח.
    const allDigital = pendingRows.every((row) => productById.get(row.product_id)?.is_digital);
    let shippingMethodId: string | null = null;
    if (!allDigital && source.shipping_method_id) {
      const { data: method } = await supabaseAdmin
        .from("shipping_methods")
        .select("id")
        .eq("id", source.shipping_method_id)
        .eq("is_active", true)
        .maybeSingle();
      shippingMethodId = method?.id ?? null;
    }

    const { data: created, error: createError } = await supabaseAdmin
      .from("orders")
      .insert({
        customer_id: customerId,
        status: "pending",
        kind,
        total: 0,
        vat_rate: Number(settings?.vat_rate ?? 18),
        prices_include_vat: settings?.prices_include_vat ?? true,
        // אותם פרטי חיוב ומשלוח כמו בהזמנה המקורית (אם נקלטו בקופה)
        customer_name: source.customer_name,
        customer_tax_id: source.customer_tax_id,
        customer_phone: source.customer_phone,
        customer_email: source.customer_email,
        billing_city: source.billing_city,
        billing_address: source.billing_address,
        billing_zip: source.billing_zip,
        ship_to_different: source.ship_to_different,
        shipping_name: source.shipping_name,
        shipping_phone: source.shipping_phone,
        shipping_city: source.shipping_city,
        shipping_address: source.shipping_address,
        shipping_zip: source.shipping_zip,
        shipping_method_id: shippingMethodId,
        shipping_kind: allDigital ? "digital" : null,
      })
      .select("id, order_number")
      .single();
    if (createError || !created) throw new Error(createError?.message ?? "יצירת ההזמנה נכשלה");

    for (const row of pendingRows) rows.push({ order_id: created.id, ...row });
    const { error: itemsError } = await supabaseAdmin.from("order_items").insert(rows);
    if (itemsError) {
      // בלי הזמנה ריקה: אם השורות נדחו, מוחקים את ההזמנה שנפתחה
      await supabaseAdmin.from("orders").delete().eq("id", created.id);
      throw new Error(itemsError.message);
    }

    return {
      orderId: created.id,
      orderNumber: created.order_number,
      kind,
      outOfStockCount: skipped,
      adjustedCount,
    };
  });

/** בון ליקוט למחסן (פורמט צר) — מנהל/סוכן בלבד */
export const downloadPickingSlip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string }) => {
    const orderId = String(input?.orderId ?? "").trim();
    if (!orderId) throw new Error("חסר מזהה הזמנה");
    return { orderId };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { buildPickingSlipPdf } = await import("@/lib/pdf/picking-slip.server");

    const { loadCaller } = await import("@/lib/caller.server");
    const caller = await loadCaller(context.userId);
    if (caller?.role !== "admin" && caller?.role !== "agent") throw new Error("אין הרשאה");

    const { data: order } = await supabaseAdmin
      .from("orders")
      .select(
        `id, order_number, kind, created_at, note, customer_id, agent_id, ${ORDER_CONTACT_COLUMNS}, order_items (quantity, product_name, product_sku, product_barcode, product_shelf_location, product_pack_size, is_deposit, is_digital)`,
      )
      .eq("id", data.orderId)
      .maybeSingle();
    if (!order) throw new Error("ההזמנה לא נמצאה");
    if (caller.role === "agent" && order.agent_id !== context.userId) throw new Error("אין הרשאה");

    const customerId = order.customer_id;
    const [{ data: profile }, agentResult, { data: settings }] = await Promise.all([
      customerId
        ? supabaseAdmin
            .from("customer_profiles")
            .select("business_name, contact_name, phone, business_address, city, zip_code")
            .eq("user_id", customerId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      order.agent_id
        ? supabaseAdmin
            .from("user_roles")
            .select("agent_number, display_name, username, email")
            .eq("user_id", order.agent_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabaseAdmin
        .from("site_settings")
        .select("site_title, logo_path, business_name")
        .eq("id", true)
        .maybeSingle(),
    ]);
    const { loadLogoDataUrl } = await import("@/lib/documents.server");
    const delivery = deliveryOf(order, profile);

    const pdf = await buildPickingSlipPdf({
      orderNumber: order.order_number,
      createdAt: order.created_at,
      kindLabel: order.kind === "quote" ? "בקשת הצעת מחיר" : "הזמנה",
      sellerName: settings?.business_name?.trim() || settings?.site_title?.trim() || "",
      logoDataUrl: await loadLogoDataUrl(settings?.logo_path ?? null),
      // לאן לשלוח בפועל — הכתובת החלופית מהקופה אם נבחרה
      customerBusinessName: billingOf(order, profile).name,
      contactName: delivery.name,
      phone: delivery.phone,
      deliveryAddress: delivery.address,
      alternateDelivery: delivery.isAlternate,
      agentNumber: agentResult.data
        ? [agentResult.data.agent_number, staffName(agentResult.data)].filter(Boolean).join(" · ")
        : null,
      note: order.note,
      // שורת פיקדון אינה פריט נפרד לליקוט — היא כבר נכללת בפריט עצמו; מוצר
      // דיגיטלי נשלח במייל — לא במחסן
      items: (order.order_items ?? [])
        .filter((item) => !item.is_deposit && !item.is_digital)
        .map((item) => ({
          name: item.product_name ?? "מוצר",
          barcode: item.product_barcode,
          sku: item.product_sku,
          shelfLocation: item.product_shelf_location,
          quantity: item.quantity,
          packSize: item.product_pack_size ?? null,
        })),
    });

    return { filename: pdf.filename, base64: pdf.base64 };
  });
