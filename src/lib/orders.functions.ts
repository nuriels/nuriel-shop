import { staffName } from "@/lib/staff";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** פעולות הזמנה בצד השרת: שכפול הזמנה ובון ליקוט למחסן */

/**
 * שכפול הזמנה ("הזמנה חוזרת"): יוצר הזמנה חדשה עם אותם פריטים וכמויות,
 * אבל **במחירים של היום** (כולל מבצע פעיל) ולפי קבוצת המחיר הנוכחית של
 * הלקוח — לא במחירים שהיו בהזמנה המקורית.
 */
export const reorderOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string }) => {
    const orderId = String(input?.orderId ?? "").trim();
    if (!orderId) throw new Error("חסר מזהה הזמנה");
    return { orderId };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: source } = await supabaseAdmin
      .from("orders")
      .select("id, customer_id, agent_id, order_items (product_id, quantity, is_deposit)")
      .eq("id", data.orderId)
      .maybeSingle();
    if (!source) throw new Error("ההזמנה לא נמצאה");

    const { data: caller } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .maybeSingle();
    const isOwner = context.userId === source.customer_id || context.userId === source.agent_id;
    if (!isOwner && caller?.role !== "admin") throw new Error("אין הרשאה");

    const items = source.order_items ?? [];
    if (items.length === 0) throw new Error("אין פריטים לשכפול");

    // האם ללקוח יש מחירים בכלל (מאושר + לא חסום + קבוצת מחיר משויכת)
    const [{ data: profile }, { data: customerRole }, { data: settings }] = await Promise.all([
      supabaseAdmin
        .from("customer_profiles")
        .select("price_tier, price_list_type")
        .eq("user_id", source.customer_id)
        .maybeSingle(),
      supabaseAdmin
        .from("user_roles")
        .select("is_approved, is_blocked")
        .eq("user_id", source.customer_id)
        .maybeSingle(),
      supabaseAdmin
        .from("site_settings")
        .select("prices_include_vat, vat_rate")
        .eq("id", true)
        .maybeSingle(),
    ]);

    const tier = profile?.price_tier ?? null;
    const hasPrices =
      tier !== null && customerRole?.is_approved === true && customerRole?.is_blocked === false;
    const kind = hasPrices ? "order" : "quote";

    const { data: products } = await supabaseAdmin
      .from("global_products")
      .select(
        "id, price_tier1, price_tier2, price_tier3, sale_price, sale_starts_at, sale_ends_at, is_out_of_stock, is_hidden, stock_quantity, deposit_price, deposit_units, pack_size",
      )
      .in(
        "id",
        items.map((item) => item.product_id),
      );

    // מחירון אישי: מחירים שהמנהל קבע ללקוח גוברים על הדרג (רק כשהמחירון פעיל)
    const customPrices = new Map<string, number>();
    if (hasPrices && profile?.price_list_type === "custom") {
      const { data: overrides } = await supabaseAdmin
        .from("user_custom_prices")
        .select("product_id, custom_price")
        .eq("user_id", source.customer_id)
        .in(
          "product_id",
          items.map((item) => item.product_id),
        );
      for (const row of overrides ?? []) customPrices.set(row.product_id, Number(row.custom_price));
    }

    // המחיר המחייב נקבע שוב בטריגר במסד (snapshot_order_item_product) — כאן
    // אותו חישוב, כדי שהסכום שמוצג מיד יתאים
    const now = Date.now();
    const priceOf = (productId: string): number => {
      const product = products?.find((candidate) => candidate.id === productId);
      if (!product || !hasPrices) return 0;
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
    // שורת פיקדון מתומחרת בטריגר בשרת (snapshot_order_item_product) לפי
    // deposit_price * deposit_units של המוצר — הערך כאן הוא רק ברירת מחדל
    const depositPriceOf = (productId: string): number => {
      const product = products?.find((candidate) => candidate.id === productId);
      if (!product || !hasPrices || !product.deposit_price || !product.deposit_units) return 0;
      return Number(product.deposit_price) * Number(product.deposit_units);
    };

    const { data: created, error: createError } = await supabaseAdmin
      .from("orders")
      .insert({
        customer_id: source.customer_id,
        status: "pending",
        kind,
        total: 0,
        vat_rate: Number(settings?.vat_rate ?? 18),
        prices_include_vat: settings?.prices_include_vat ?? true,
      })
      .select("id, order_number")
      .single();
    if (createError || !created) throw new Error(createError?.message ?? "יצירת ההזמנה נכשלה");

    // מוצר שעבר בינתיים ל"נמכר במארזים": מעגלים את הכמות הישנה כלפי מעלה
    // לכפולה שלמה (אחרת המסד ידחה אותה). בהזמנה (לא בקשה) גם מגבילים למלאי
    // הזמין — המלאי נשמר ללקוח ברגע ההזמנה, והמסד דוחה כמות שאין.
    let adjustedCount = 0;
    const quantityFor = (productId: string): number => {
      const product = products?.find((candidate) => candidate.id === productId);
      const productRow = items.find((row) => row.product_id === productId && !row.is_deposit);
      const base = productRow?.quantity ?? 0;
      const pack = product?.pack_size && product.pack_size >= 2 ? product.pack_size : null;
      let quantity = pack ? Math.max(pack, Math.ceil(base / pack) * pack) : base;
      const stock = product?.stock_quantity ?? 0;
      // מלאי 0 שלא מסומן "אזל" = מלאי שלא נספר — לא מגבילים (כמו במסד)
      if (kind === "order" && stock > 0 && quantity > stock) {
        quantity = pack ? Math.floor(stock / pack) * pack : stock;
        adjustedCount += 1;
      }
      return quantity;
    };

    // מוצר שהוסתר / אזל / נמחק מאז ההזמנה המקורית — לא נכנס להזמנה החדשה
    const unavailable = new Set(
      items
        .map((item) => item.product_id)
        .filter((productId) => {
          const product = products?.find((candidate) => candidate.id === productId);
          return !product || product.is_hidden || (kind === "order" && product.is_out_of_stock);
        }),
    );
    const quantities = new Map<string, number>();
    for (const item of items) {
      if (!item.is_deposit && !unavailable.has(item.product_id)) {
        quantities.set(item.product_id, quantityFor(item.product_id));
      }
    }
    const rows = items
      .filter((item) => (quantities.get(item.product_id) ?? 0) > 0)
      .map((item) => ({
        order_id: created.id,
        product_id: item.product_id,
        quantity: quantities.get(item.product_id) ?? 0,
        unit_price: item.is_deposit ? depositPriceOf(item.product_id) : priceOf(item.product_id),
        is_deposit: item.is_deposit,
      }));
    const skipped = new Set(
      items
        .filter(
          (item) => !item.is_deposit && !rows.some((row) => row.product_id === item.product_id),
        )
        .map((item) => item.product_id),
    ).size;

    if (rows.length === 0) {
      await supabaseAdmin.from("orders").delete().eq("id", created.id);
      throw new Error("אף אחד מהמוצרים בהזמנה המקורית אינו זמין כרגע");
    }

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

    const { data: caller } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (caller?.role !== "admin" && caller?.role !== "agent") throw new Error("אין הרשאה");

    const { data: order } = await supabaseAdmin
      .from("orders")
      .select(
        "id, order_number, kind, created_at, note, customer_id, agent_id, order_items (quantity, product_name, product_sku, product_barcode, product_shelf_location, product_pack_size, is_deposit)",
      )
      .eq("id", data.orderId)
      .maybeSingle();
    if (!order) throw new Error("ההזמנה לא נמצאה");
    if (caller.role === "agent" && order.agent_id !== context.userId) throw new Error("אין הרשאה");

    const [{ data: profile }, agentResult, { data: settings }] = await Promise.all([
      supabaseAdmin
        .from("customer_profiles")
        .select("business_name, contact_name, phone")
        .eq("user_id", order.customer_id)
        .maybeSingle(),
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

    const pdf = await buildPickingSlipPdf({
      orderNumber: order.order_number,
      createdAt: order.created_at,
      kindLabel: order.kind === "quote" ? "בקשת הצעת מחיר" : "הזמנה",
      sellerName: settings?.business_name?.trim() || settings?.site_title?.trim() || "",
      logoDataUrl: await loadLogoDataUrl(settings?.logo_path ?? null),
      customerBusinessName: profile?.business_name ?? "",
      contactName: profile?.contact_name ?? "",
      phone: profile?.phone ?? "",
      agentNumber: agentResult.data
        ? [agentResult.data.agent_number, staffName(agentResult.data)].filter(Boolean).join(" · ")
        : null,
      note: order.note,
      // שורת פיקדון אינה פריט נפרד לליקוט — היא כבר נכללת בפריט עצמו
      items: (order.order_items ?? [])
        .filter((item) => !item.is_deposit)
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
