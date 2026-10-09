export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

/** סוג מנוי של חנות (tenants.plan) */
/** שיקוף של tenant_subscriptions.plan_type (חלק 13) */
export type TenantPlan = "trial" | "basic" | "premium";
/** סטטוס חנות (tenants.status) — חנות מוקפאת נעולה ללקוחות */
export type TenantStatus = "active" | "suspended";
/** סוג התנאי של הטבת עגלה (cart_promotions.condition_type) */
export type CartPromotionCondition = "min_subtotal" | "category_quantity";
/** מצב תעודת SSL של חנות (tenant_ssl.status) — מדווח ע"י deploy/ssl/store-certs.sh */
export type TenantSslStatus = "active" | "pending" | "error" | "blocked" | "external";
/** יומן המשלוח של הזמנה (order_delivery_events.kind) */
export type DeliveryEventKind = "courier_assigned" | "delivery_failed" | "delivered" | "shipped";
/** סוג שיטת משלוח (shipping_methods.kind) */
export type ShippingMethodKind = "delivery" | "pickup";
/** סוג המשלוח על ההזמנה (orders.shipping_kind) — digital = סל דיגיטלי בלבד */
export type OrderShippingKind = "delivery" | "pickup" | "digital";
/** הסטטוס של שורה בהזמנה (order_items.item_status) */
export type OrderItemStatus =
  | "awaiting_courier"
  | "awaiting_pickup"
  | "shipped"
  | "delivered"
  | "awaiting_license"
  | "delivered_email"
  | "cancelled";

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      tenants: {
        Row: {
          created_at: string;
          domain: string | null;
          id: string;
          is_default: boolean;
          name: string;
          slug: string;
          owner_email: string | null;
          tax_id: string | null;
          plan: TenantPlan;
          status: TenantStatus;
          status_changed_at: string | null;
          custom_domain: string | null;
          custom_domain_status: string | null;
          custom_domain_error: string | null;
          custom_domain_verified_at: string | null;
          custom_domain_checked_at: string | null;
          custom_domain_ssl_expires_at: string | null;
          custom_domain_updated_at: string | null;
        };
        Insert: {
          created_at?: string;
          domain?: string | null;
          id?: string;
          is_default?: boolean;
          name: string;
          slug: string;
          owner_email?: string | null;
          tax_id?: string | null;
          plan?: TenantPlan;
          status?: TenantStatus;
          status_changed_at?: string | null;
          custom_domain?: string | null;
          custom_domain_status?: string | null;
          custom_domain_error?: string | null;
          custom_domain_verified_at?: string | null;
          custom_domain_checked_at?: string | null;
          custom_domain_ssl_expires_at?: string | null;
          custom_domain_updated_at?: string | null;
        };
        Update: {
          created_at?: string;
          domain?: string | null;
          id?: string;
          is_default?: boolean;
          name?: string;
          slug?: string;
          owner_email?: string | null;
          tax_id?: string | null;
          plan?: TenantPlan;
          status?: TenantStatus;
          status_changed_at?: string | null;
          custom_domain?: string | null;
          custom_domain_status?: string | null;
          custom_domain_error?: string | null;
          custom_domain_verified_at?: string | null;
          custom_domain_checked_at?: string | null;
          custom_domain_ssl_expires_at?: string | null;
          custom_domain_updated_at?: string | null;
        };
        Relationships: [];
      };
      coupons: {
        Row: {
          id: string;
          tenant_id: string;
          code: string;
          discount_type: "percent" | "fixed" | "free_shipping";
          discount_value: number;
          is_active: boolean;
          description: string | null;
          min_order_total: number | null;
          max_uses: number | null;
          starts_at: string | null;
          expires_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id?: string;
          code: string;
          discount_type: "percent" | "fixed" | "free_shipping";
          discount_value: number;
          is_active?: boolean;
          description?: string | null;
          min_order_total?: number | null;
          max_uses?: number | null;
          starts_at?: string | null;
          expires_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          code?: string;
          discount_type?: "percent" | "fixed" | "free_shipping";
          discount_value?: number;
          is_active?: boolean;
          description?: string | null;
          min_order_total?: number | null;
          max_uses?: number | null;
          starts_at?: string | null;
          expires_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      abandoned_carts: {
        Row: {
          id: string;
          tenant_id: string;
          session_key: string;
          restore_token: string;
          email: string;
          customer_name: string | null;
          phone: string | null;
          items: Json;
          item_count: number;
          total: number;
          status: "open" | "recovered" | "dismissed";
          recovered_order_id: string | null;
          reminder_count: number;
          last_reminder_at: string | null;
          last_reminder_coupon: string | null;
          restored_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id?: string;
          session_key: string;
          restore_token?: string;
          email: string;
          customer_name?: string | null;
          phone?: string | null;
          items: Json;
          item_count?: number;
          total?: number;
          status?: "open" | "recovered" | "dismissed";
          recovered_order_id?: string | null;
          reminder_count?: number;
          last_reminder_at?: string | null;
          last_reminder_coupon?: string | null;
          restored_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: "open" | "recovered" | "dismissed";
          reminder_count?: number;
          last_reminder_at?: string | null;
          last_reminder_coupon?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      contact_messages: {
        Row: {
          id: string;
          tenant_id: string;
          full_name: string;
          phone: string;
          email: string;
          message: string;
          order_number: string | null;
          order_id: string | null;
          attachment_path: string | null;
          attachment_name: string | null;
          attachment_type: string | null;
          attachment_size: number | null;
          status: "new" | "handled";
          admin_note: string | null;
          handled_at: string | null;
          handled_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id?: string;
          full_name: string;
          phone: string;
          email: string;
          message: string;
          order_number?: string | null;
          order_id?: string | null;
          attachment_path?: string | null;
          attachment_name?: string | null;
          attachment_type?: string | null;
          attachment_size?: number | null;
          status?: "new" | "handled";
          admin_note?: string | null;
          created_at?: string;
        };
        Update: {
          status?: "new" | "handled";
          admin_note?: string | null;
        };
        Relationships: [];
      };
      cancellation_requests: {
        Row: {
          id: string;
          tenant_id: string;
          first_name: string;
          last_name: string;
          phone: string;
          email: string;
          message: string | null;
          order_number: string;
          order_id: string | null;
          order_contact_match: boolean;
          status: "new" | "in_progress" | "completed" | "rejected";
          admin_note: string | null;
          handled_at: string | null;
          handled_by: string | null;
          confirmation_sent_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id?: string;
          first_name: string;
          last_name: string;
          phone: string;
          email: string;
          message?: string | null;
          order_number: string;
          order_id?: string | null;
          order_contact_match?: boolean;
          status?: "new" | "in_progress" | "completed" | "rejected";
          admin_note?: string | null;
          confirmation_sent_at?: string | null;
          created_at?: string;
        };
        Update: {
          status?: "new" | "in_progress" | "completed" | "rejected";
          admin_note?: string | null;
        };
        Relationships: [];
      };
      tenant_email_secrets: {
        Row: {
          tenant_id: string;
          resend_api_key: string;
          sender_email: string;
          domain_status: "verified" | "unverified" | "unknown";
          checked_at: string | null;
          last_error: string | null;
          last_error_at: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          tenant_id: string;
          resend_api_key: string;
          sender_email: string;
          domain_status?: "verified" | "unverified" | "unknown";
          checked_at?: string | null;
          last_error?: string | null;
          last_error_at?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          tenant_id?: string;
          resend_api_key?: string;
          sender_email?: string;
          domain_status?: "verified" | "unverified" | "unknown";
          checked_at?: string | null;
          last_error?: string | null;
          last_error_at?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      notification_logs: {
        Row: {
          id: string;
          tenant_id: string;
          order_id: string | null;
          type: "email";
          template: "order_confirmation" | "order_staff" | "order_shipped" | "test";
          recipient: string;
          subject: string;
          status: "sent" | "failed" | "skipped";
          provider: "tenant" | "platform" | null;
          provider_message_id: string | null;
          error: string | null;
          sent_at: string;
        };
        Insert: {
          id?: string;
          tenant_id?: string;
          order_id?: string | null;
          type?: "email";
          template?: "order_confirmation" | "order_staff" | "order_shipped" | "test";
          recipient?: string;
          subject?: string;
          status: "sent" | "failed" | "skipped";
          provider?: "tenant" | "platform" | null;
          provider_message_id?: string | null;
          error?: string | null;
          sent_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          order_id?: string | null;
          type?: "email";
          template?: "order_confirmation" | "order_staff" | "order_shipped" | "test";
          recipient?: string;
          subject?: string;
          status?: "sent" | "failed" | "skipped";
          provider?: "tenant" | "platform" | null;
          provider_message_id?: string | null;
          error?: string | null;
          sent_at?: string;
        };
        Relationships: [];
      };
      tenant_billing_profile: {
        Row: {
          tenant_id: string;
          business_type: "exempt" | "licensed" | "company";
          company_name: string;
          tax_id: string;
          address: string;
          billing_email: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          tenant_id?: string;
          business_type: "exempt" | "licensed" | "company";
          company_name: string;
          tax_id: string;
          address: string;
          billing_email?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          tenant_id?: string;
          business_type?: "exempt" | "licensed" | "company";
          company_name?: string;
          tax_id?: string;
          address?: string;
          billing_email?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      platform_addons: {
        Row: {
          addon_name: "google_sso" | "custom_domain" | "digital_products" | "zapier";
          title: string;
          description: string;
          billing: "monthly" | "one_time";
          price: number;
          feature: string;
          included_in_premium: boolean;
          available: boolean;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          addon_name: "google_sso" | "custom_domain" | "digital_products" | "zapier";
          title: string;
          description?: string;
          billing: "monthly" | "one_time";
          price: number;
          feature: string;
          included_in_premium?: boolean;
          available?: boolean;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          addon_name?: "google_sso" | "custom_domain" | "digital_products" | "zapier";
          title?: string;
          description?: string;
          billing?: "monthly" | "one_time";
          price?: number;
          feature?: string;
          included_in_premium?: boolean;
          available?: boolean;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      tenant_addons: {
        Row: {
          id: string;
          tenant_id: string;
          addon_name: "google_sso" | "custom_domain" | "digital_products" | "zapier";
          status: "active" | "canceled";
          expires_at: string | null;
          amount: number;
          source: "purchase" | "grant";
          purchased_by: string | null;
          purchased_at: string;
          canceled_at: string | null;
          ended_reason: "expired" | "canceled" | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id?: string;
          addon_name: "google_sso" | "custom_domain" | "digital_products" | "zapier";
          status?: "active" | "canceled";
          expires_at?: string | null;
          amount?: number;
          source?: "purchase" | "grant";
          purchased_by?: string | null;
          purchased_at?: string;
          canceled_at?: string | null;
          ended_reason?: "expired" | "canceled" | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          addon_name?: "google_sso" | "custom_domain" | "digital_products" | "zapier";
          status?: "active" | "canceled";
          expires_at?: string | null;
          amount?: number;
          source?: "purchase" | "grant";
          purchased_by?: string | null;
          purchased_at?: string;
          canceled_at?: string | null;
          ended_reason?: "expired" | "canceled" | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      platform_plans: {
        Row: {
          plan_type: "basic" | "premium";
          title: string;
          tagline: string;
          monthly_price: number;
          features: string[];
          badge: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          plan_type: "basic" | "premium";
          title: string;
          tagline?: string;
          monthly_price: number;
          features?: string[];
          badge?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          plan_type?: "basic" | "premium";
          title?: string;
          tagline?: string;
          monthly_price?: number;
          features?: string[];
          badge?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      platform_pricing_settings: {
        Row: {
          id: boolean;
          payment_note: string;
          vat_note: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          id?: boolean;
          payment_note?: string;
          vat_note?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          id?: boolean;
          payment_note?: string;
          vat_note?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      shipping_methods: {
        Row: {
          id: string;
          tenant_id: string;
          name: string;
          description: string;
          kind: ShippingMethodKind;
          price: number;
          is_active: boolean;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id?: string;
          name: string;
          description?: string;
          kind?: ShippingMethodKind;
          price?: number;
          is_active?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          name?: string;
          description?: string;
          kind?: ShippingMethodKind;
          price?: number;
          is_active?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      product_variants: {
        Row: {
          id: string;
          tenant_id: string;
          product_id: string;
          options: Json;
          sku: string | null;
          price: number | null;
          stock_quantity: number | null;
          is_active: boolean;
          sort_order: number;
          created_at: string;
          updated_at: string;
          low_stock_alerted: boolean;
        };
        Insert: {
          id?: string;
          tenant_id?: string;
          product_id: string;
          options: Json;
          sku?: string | null;
          price?: number | null;
          stock_quantity?: number | null;
          is_active?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
          low_stock_alerted?: boolean;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          product_id?: string;
          options?: Json;
          sku?: string | null;
          price?: number | null;
          stock_quantity?: number | null;
          is_active?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
          low_stock_alerted?: boolean;
        };
        Relationships: [];
      };
      cart_promotions: {
        Row: {
          id: string;
          tenant_id: string;
          name: string;
          is_active: boolean;
          condition_type: CartPromotionCondition;
          min_subtotal: number | null;
          category: string | null;
          min_quantity: number | null;
          gift_product_id: string;
          gift_quantity: number;
          starts_at: string | null;
          ends_at: string | null;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id?: string;
          name: string;
          is_active?: boolean;
          condition_type: CartPromotionCondition;
          min_subtotal?: number | null;
          category?: string | null;
          min_quantity?: number | null;
          gift_product_id: string;
          gift_quantity?: number;
          starts_at?: string | null;
          ends_at?: string | null;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          name?: string;
          is_active?: boolean;
          condition_type?: CartPromotionCondition;
          min_subtotal?: number | null;
          category?: string | null;
          min_quantity?: number | null;
          gift_product_id?: string;
          gift_quantity?: number;
          starts_at?: string | null;
          ends_at?: string | null;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      pages: {
        Row: {
          id: string;
          tenant_id: string;
          slug: string;
          title: string;
          content_html: string;
          is_published: boolean;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id?: string;
          slug: string;
          title: string;
          content_html?: string;
          is_published?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          slug?: string;
          title?: string;
          content_html?: string;
          is_published?: boolean;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      product_stickers: {
        Row: {
          id: string;
          tenant_id: string;
          image_url: string;
          name: string;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id?: string;
          image_url: string;
          name?: string;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          image_url?: string;
          name?: string;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      product_reviews: {
        Row: {
          id: string;
          tenant_id: string;
          product_id: string;
          customer_name: string;
          rating: number;
          content: string;
          is_approved: boolean;
          created_at: string;
          user_id: string | null;
          verified_purchase: boolean;
          approved_at: string | null;
          approved_by: string | null;
        };
        Insert: {
          id?: string;
          tenant_id?: string;
          product_id: string;
          customer_name: string;
          rating: number;
          content: string;
          is_approved?: boolean;
          created_at?: string;
          user_id?: string | null;
          verified_purchase?: boolean;
          approved_at?: string | null;
          approved_by?: string | null;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          product_id?: string;
          customer_name?: string;
          rating?: number;
          content?: string;
          is_approved?: boolean;
          created_at?: string;
          user_id?: string | null;
          verified_purchase?: boolean;
          approved_at?: string | null;
          approved_by?: string | null;
        };
        Relationships: [];
      };
      product_serials: {
        Row: {
          id: string;
          tenant_id: string;
          product_id: string;
          serial_number: string;
          status: "in_stock" | "sold";
          received_at: string;
          received_by: string | null;
          order_id: string | null;
          order_item_id: string | null;
          sold_at: string | null;
          warranty_until: string | null;
        };
        Insert: {
          id?: string;
          tenant_id?: string;
          product_id: string;
          serial_number: string;
          status?: "in_stock" | "sold";
          received_at?: string;
          received_by?: string | null;
          order_id?: string | null;
          order_item_id?: string | null;
          sold_at?: string | null;
          warranty_until?: string | null;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          product_id?: string;
          serial_number?: string;
          status?: "in_stock" | "sold";
          received_at?: string;
          received_by?: string | null;
          order_id?: string | null;
          order_item_id?: string | null;
          sold_at?: string | null;
          warranty_until?: string | null;
        };
        Relationships: [];
      };
      product_relations: {
        Row: {
          tenant_id: string;
          product_id: string;
          related_product_id: string;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          tenant_id?: string;
          product_id: string;
          related_product_id: string;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          tenant_id?: string;
          product_id?: string;
          related_product_id?: string;
          sort_order?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      tenant_subscriptions: {
        Row: {
          tenant_id: string;
          plan_type: "trial" | "basic" | "premium";
          status: "trialing" | "active" | "canceled";
          trial_ends_at: string | null;
          current_period_end: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          tenant_id: string;
          plan_type?: "trial" | "basic" | "premium";
          status?: "trialing" | "active" | "canceled";
          trial_ends_at?: string | null;
          current_period_end?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          tenant_id?: string;
          plan_type?: "trial" | "basic" | "premium";
          status?: "trialing" | "active" | "canceled";
          trial_ends_at?: string | null;
          current_period_end?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tenant_subscriptions_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: true;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      billing_history: {
        Row: {
          id: string;
          tenant_id: string;
          kind: "payment" | "trial_extension" | "plan_change" | "addon";
          plan_type: "trial" | "basic" | "premium";
          amount: number;
          currency: string;
          months: number | null;
          days: number | null;
          payment_method: "annual" | "installments" | "monthly" | "other" | "credit_card" | null;
          period_start: string | null;
          period_end: string | null;
          reference: string | null;
          note: string | null;
          recorded_by: string | null;
          recorded_by_email: string | null;
          created_at: string;
          addon_name: string | null;
          payment_status: "paid" | "due";
          paid_at: string | null;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          kind?: "payment" | "trial_extension" | "plan_change" | "addon";
          plan_type: "trial" | "basic" | "premium";
          amount?: number;
          currency?: string;
          months?: number | null;
          days?: number | null;
          payment_method?: "annual" | "installments" | "monthly" | "other" | "credit_card" | null;
          period_start?: string | null;
          period_end?: string | null;
          reference?: string | null;
          note?: string | null;
          recorded_by?: string | null;
          recorded_by_email?: string | null;
          created_at?: string;
          addon_name?: string | null;
          payment_status?: "paid" | "due";
          paid_at?: string | null;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          kind?: "payment" | "trial_extension" | "plan_change" | "addon";
          plan_type?: "trial" | "basic" | "premium";
          amount?: number;
          currency?: string;
          months?: number | null;
          days?: number | null;
          payment_method?: "annual" | "installments" | "monthly" | "other" | "credit_card" | null;
          period_start?: string | null;
          period_end?: string | null;
          reference?: string | null;
          note?: string | null;
          recorded_by?: string | null;
          recorded_by_email?: string | null;
          created_at?: string;
          addon_name?: string | null;
          payment_status?: "paid" | "due";
          paid_at?: string | null;
        };
        Relationships: [];
      };
      support_tickets: {
        Row: {
          id: string;
          tenant_id: string;
          subject: string;
          status: "open" | "answered" | "closed";
          opened_by: string | null;
          opened_by_email: string | null;
          created_at: string;
          updated_at: string;
          last_message_at: string;
          last_sender_type: "tenant" | "admin" | null;
          tenant_read_at: string | null;
          admin_read_at: string | null;
          admin_notified_at: string | null;
          tenant_notified_at: string | null;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          subject: string;
          status?: "open" | "answered" | "closed";
          opened_by?: string | null;
          opened_by_email?: string | null;
          created_at?: string;
          updated_at?: string;
          last_message_at?: string;
          last_sender_type?: "tenant" | "admin" | null;
          tenant_read_at?: string | null;
          admin_read_at?: string | null;
          admin_notified_at?: string | null;
          tenant_notified_at?: string | null;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          subject?: string;
          status?: "open" | "answered" | "closed";
          opened_by?: string | null;
          opened_by_email?: string | null;
          created_at?: string;
          updated_at?: string;
          last_message_at?: string;
          last_sender_type?: "tenant" | "admin" | null;
          tenant_read_at?: string | null;
          admin_read_at?: string | null;
          admin_notified_at?: string | null;
          tenant_notified_at?: string | null;
        };
        Relationships: [];
      };
      support_messages: {
        Row: {
          id: string;
          ticket_id: string;
          tenant_id: string;
          sender_type: "tenant" | "admin";
          sender_id: string | null;
          sender_name: string | null;
          message: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          ticket_id: string;
          tenant_id?: string;
          sender_type: "tenant" | "admin";
          sender_id?: string | null;
          sender_name?: string | null;
          message: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          ticket_id?: string;
          tenant_id?: string;
          sender_type?: "tenant" | "admin";
          sender_id?: string | null;
          sender_name?: string | null;
          message?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      platform_admin_handoffs: {
        Row: {
          token_hash: string;
          user_id: string;
          tenant_id: string;
          created_at: string;
          expires_at: string;
          used_at: string | null;
          /** platform_admin = מנהל-על מהפאנל; store_owner = בעל החנות משער הפלטפורמה */
          kind: "platform_admin" | "store_owner" | "store_switch";
        };
        Insert: {
          token_hash: string;
          user_id: string;
          tenant_id: string;
          created_at?: string;
          expires_at: string;
          used_at?: string | null;
          kind?: "platform_admin" | "store_owner" | "store_switch";
        };
        Update: {
          token_hash?: string;
          user_id?: string;
          tenant_id?: string;
          created_at?: string;
          expires_at?: string;
          used_at?: string | null;
          kind?: "platform_admin" | "store_owner" | "store_switch";
        };
        Relationships: [];
      };
      platform_admins: {
        Row: { user_id: string; created_at: string };
        Insert: { user_id: string; created_at?: string };
        Update: { user_id?: string; created_at?: string };
        Relationships: [];
      };
      login_codes: {
        Row: {
          id: string;
          tenant_id: string;
          email: string;
          code_hash: string;
          attempts: number;
          created_at: string;
          expires_at: string;
          consumed_at: string | null;
          ip: string | null;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          email: string;
          code_hash: string;
          attempts?: number;
          created_at?: string;
          expires_at: string;
          consumed_at?: string | null;
          ip?: string | null;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          email?: string;
          code_hash?: string;
          attempts?: number;
          created_at?: string;
          expires_at?: string;
          consumed_at?: string | null;
          ip?: string | null;
        };
        Relationships: [];
      };
      order_courier_links: {
        Row: {
          order_id: string;
          tenant_id: string;
          token: string;
          courier_name: string | null;
          courier_phone: string | null;
          created_at: string;
          created_by: string | null;
          expires_at: string;
          opened_count: number;
          last_opened_at: string | null;
        };
        Insert: {
          order_id: string;
          tenant_id?: string;
          token: string;
          courier_name?: string | null;
          courier_phone?: string | null;
          created_at?: string;
          created_by?: string | null;
          expires_at?: string;
          opened_count?: number;
          last_opened_at?: string | null;
        };
        Update: {
          order_id?: string;
          tenant_id?: string;
          token?: string;
          courier_name?: string | null;
          courier_phone?: string | null;
          created_at?: string;
          created_by?: string | null;
          expires_at?: string;
          opened_count?: number;
          last_opened_at?: string | null;
        };
        Relationships: [];
      };
      order_delivery_events: {
        Row: {
          id: string;
          tenant_id: string;
          order_id: string;
          kind: DeliveryEventKind;
          attempt: number | null;
          note: string | null;
          actor: "staff" | "courier";
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tenant_id?: string;
          order_id: string;
          kind: DeliveryEventKind;
          attempt?: number | null;
          note?: string | null;
          actor: "staff" | "courier";
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          order_id?: string;
          kind?: DeliveryEventKind;
          attempt?: number | null;
          note?: string | null;
          actor?: "staff" | "courier";
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      categories: {
        Row: {
          id: string;
          tenant_id: string;
          created_at: string;
          image_url: string | null;
          show_on_home: boolean;
          show_on_homepage: boolean;
          name: string;
          parent_name: string | null;
          sort_order: number;
        };
        Insert: {
          id?: string;
          tenant_id?: string;
          created_at?: string;
          image_url?: string | null;
          show_on_home?: boolean;
          show_on_homepage?: boolean;
          name: string;
          parent_name?: string | null;
          sort_order?: number;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          created_at?: string;
          image_url?: string | null;
          show_on_home?: boolean;
          show_on_homepage?: boolean;
          name?: string;
          parent_name?: string | null;
          sort_order?: number;
        };
        Relationships: [];
      };
      product_categories: {
        Row: {
          tenant_id: string;
          product_id: string;
          category_id: string;
          created_at: string;
        };
        Insert: {
          tenant_id?: string;
          product_id: string;
          category_id: string;
          created_at?: string;
        };
        Update: {
          tenant_id?: string;
          product_id?: string;
          category_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      customer_invites: {
        Row: {
          tenant_id: string;
          agent_id: string | null;
          created_at: string;
          created_by: string | null;
          email: string | null;
          expires_at: string;
          id: string;
          price_tier: number | null;
          revoked_at: string | null;
          token_hash: string;
          used_at: string | null;
          used_by: string | null;
        };
        Insert: {
          tenant_id?: string;
          agent_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          email?: string | null;
          expires_at: string;
          id?: string;
          price_tier?: number | null;
          revoked_at?: string | null;
          token_hash: string;
          used_at?: string | null;
          used_by?: string | null;
        };
        Update: {
          tenant_id?: string;
          agent_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          email?: string | null;
          expires_at?: string;
          id?: string;
          price_tier?: number | null;
          revoked_at?: string | null;
          token_hash?: string;
          used_at?: string | null;
          used_by?: string | null;
        };
        Relationships: [];
      };
      customer_profiles: {
        Row: {
          tenant_id: string;
          agent_id: string | null;
          age_confirmed: boolean;
          business_address: string | null;
          business_name: string;
          city: string | null;
          zip_code: string | null;
          contact_name: string | null;
          created_at: string;
          phone: string | null;
          price_tier: number | null;
          price_list_type: string;
          profile_completed: boolean;
          tax_id: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          tenant_id?: string;
          agent_id?: string | null;
          age_confirmed?: boolean;
          business_address: string | null;
          business_name: string;
          city?: string | null;
          zip_code?: string | null;
          contact_name: string | null;
          created_at?: string;
          phone: string | null;
          price_tier?: number | null;
          price_list_type?: string;
          profile_completed?: boolean;
          tax_id: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          tenant_id?: string;
          agent_id?: string | null;
          age_confirmed?: boolean;
          business_address?: string | null;
          business_name?: string;
          city?: string | null;
          zip_code?: string | null;
          contact_name?: string | null;
          created_at?: string;
          phone?: string | null;
          price_tier?: number | null;
          price_list_type?: string;
          profile_completed?: boolean;
          tax_id?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "customer_profiles_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne: false;
            referencedRelation: "user_roles";
            referencedColumns: ["user_id"];
          },
          {
            foreignKeyName: "customer_profiles_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "user_roles";
            referencedColumns: ["user_id"];
          },
        ];
      };
      email_settings: {
        Row: {
          tenant_id: string;
          id: boolean;
          notify_admin_user_ids: string[];
          sender_email: string;
          sender_local_part: string;
          reply_to_email: string;
          updated_at: string;
        };
        Insert: {
          tenant_id?: string;
          id?: boolean;
          notify_admin_user_ids?: string[];
          sender_email?: string;
          sender_local_part?: string;
          reply_to_email?: string;
          updated_at?: string;
        };
        Update: {
          tenant_id?: string;
          id?: boolean;
          notify_admin_user_ids?: string[];
          sender_email?: string;
          sender_local_part?: string;
          reply_to_email?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      customer_emails: {
        Row: {
          tenant_id: string;
          created_at: string;
          error: string | null;
          html: string;
          id: string;
          kind: string;
          sent: boolean;
          sent_by: string | null;
          subject: string;
          to_email: string;
          user_id: string;
        };
        Insert: {
          tenant_id?: string;
          created_at?: string;
          error?: string | null;
          html: string;
          id?: string;
          kind?: string;
          sent: boolean;
          sent_by?: string | null;
          subject: string;
          to_email: string;
          user_id: string;
        };
        Update: {
          tenant_id?: string;
          created_at?: string;
          error?: string | null;
          html?: string;
          id?: string;
          kind?: string;
          sent?: boolean;
          sent_by?: string | null;
          subject?: string;
          to_email?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "customer_emails_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "user_roles";
            referencedColumns: ["user_id"];
          },
        ];
      };
      customer_carts: {
        Row: {
          tenant_id: string;
          items: Json;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          tenant_id?: string;
          items?: Json;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          tenant_id?: string;
          items?: Json;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "customer_carts_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "user_roles";
            referencedColumns: ["user_id"];
          },
        ];
      };
      global_products: {
        Row: {
          tenant_id: string;
          barcode: string | null;
          category: string;
          colors: string[];
          cost_price: number | null;
          created_at: string;
          created_by: string;
          deposit_price: number | null;
          deposit_units: number | null;
          description: string | null;
          has_deposit: boolean;
          id: string;
          image_url: string | null;
          images: string[];
          is_out_of_stock: boolean;
          is_order_bump: boolean;
          order_bump_text: string | null;
          is_promo: boolean;
          name: string;
          price_tier1: number;
          price_tier2: number;
          price_tier3: number;
          sale_ends_at: string | null;
          sale_price: number | null;
          sale_starts_at: string | null;
          shelf_location: string | null;
          sku: string;
          uniform_price: boolean;
          stock_quantity: number;
          updated_at: string;
          pack_size: number | null;
          min_order_quantity: number | null;
          sort_order: number | null;
          is_hidden: boolean;
          out_of_stock_auto: boolean;
          is_digital: boolean;
          variant_attributes: Json;
          seo_title: string | null;
          seo_description: string | null;
          show_in_zap: boolean;
          low_stock_alerted: boolean;
          is_featured: boolean;
          sticker_id: string | null;
          sticker_size: number;
          sticker_opacity: number;
          requires_serial: boolean;
          warranty_months: number;
        };
        Insert: {
          tenant_id?: string;
          barcode?: string | null;
          category: string;
          colors?: string[];
          cost_price?: number | null;
          created_at?: string;
          created_by?: string;
          deposit_price?: number | null;
          deposit_units?: number | null;
          description?: string | null;
          has_deposit?: boolean;
          id?: string;
          image_url?: string | null;
          images?: string[];
          is_out_of_stock?: boolean;
          is_order_bump?: boolean;
          order_bump_text?: string | null;
          is_promo?: boolean;
          name: string;
          price_tier1?: number;
          price_tier2?: number;
          price_tier3?: number;
          sale_ends_at?: string | null;
          sale_price?: number | null;
          sale_starts_at?: string | null;
          shelf_location?: string | null;
          sku: string;
          uniform_price?: boolean;
          stock_quantity?: number;
          updated_at?: string;
          pack_size?: number | null;
          min_order_quantity?: number | null;
          sort_order?: number | null;
          is_hidden?: boolean;
          out_of_stock_auto?: boolean;
          is_digital?: boolean;
          variant_attributes?: Json;
          seo_title?: string | null;
          seo_description?: string | null;
          show_in_zap?: boolean;
          low_stock_alerted?: boolean;
          is_featured?: boolean;
          sticker_id?: string | null;
          sticker_size?: number;
          sticker_opacity?: number;
          requires_serial?: boolean;
          warranty_months?: number;
        };
        Update: {
          tenant_id?: string;
          barcode?: string | null;
          category?: string;
          colors?: string[];
          cost_price?: number | null;
          created_at?: string;
          created_by?: string;
          deposit_price?: number | null;
          deposit_units?: number | null;
          description?: string | null;
          has_deposit?: boolean;
          id?: string;
          image_url?: string | null;
          images?: string[];
          is_out_of_stock?: boolean;
          is_order_bump?: boolean;
          order_bump_text?: string | null;
          is_promo?: boolean;
          name?: string;
          price_tier1?: number;
          price_tier2?: number;
          price_tier3?: number;
          sale_ends_at?: string | null;
          sale_price?: number | null;
          sale_starts_at?: string | null;
          shelf_location?: string | null;
          sku?: string;
          uniform_price?: boolean;
          stock_quantity?: number;
          updated_at?: string;
          pack_size?: number | null;
          min_order_quantity?: number | null;
          sort_order?: number | null;
          is_hidden?: boolean;
          out_of_stock_auto?: boolean;
          is_digital?: boolean;
          variant_attributes?: Json;
          seo_title?: string | null;
          seo_description?: string | null;
          show_in_zap?: boolean;
          low_stock_alerted?: boolean;
          is_featured?: boolean;
          sticker_id?: string | null;
          sticker_size?: number;
          sticker_opacity?: number;
          requires_serial?: boolean;
          warranty_months?: number;
        };
        Relationships: [
          {
            foreignKeyName: "global_products_category_fkey";
            columns: ["category"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["name"];
          },
        ];
      };
      order_items: {
        Row: {
          tenant_id: string;
          created_at: string;
          id: string;
          is_deposit: boolean;
          is_gift: boolean;
          promotion_id: string | null;
          order_id: string;
          product_barcode: string | null;
          product_category: string | null;
          product_id: string;
          product_image_url: string | null;
          product_name: string | null;
          product_shelf_location: string | null;
          product_sku: string | null;
          quantity: number;
          picked: boolean;
          picked_qty: number | null;
          picked_at: string | null;
          unit_price: number;
          product_pack_size: number | null;
          reserved_quantity: number;
          is_digital: boolean;
          item_status: OrderItemStatus | null;
          digital_license_key: string | null;
          license_sent_at: string | null;
          license_sent_to: string | null;
          variant_id: string | null;
          variant_label: string | null;
          reserved_from_variant: boolean;
          serial_number: string | null;
          warranty_until: string | null;
          serial_required: boolean;
        };
        Insert: {
          tenant_id?: string;
          created_at?: string;
          id?: string;
          is_deposit?: boolean;
          is_gift?: boolean;
          promotion_id?: string | null;
          order_id: string;
          product_barcode?: string | null;
          product_category?: string | null;
          product_id: string;
          product_image_url?: string | null;
          product_name?: string | null;
          product_shelf_location?: string | null;
          product_sku?: string | null;
          quantity?: number;
          picked?: boolean;
          picked_qty?: number | null;
          picked_at?: string | null;
          unit_price?: number;
          product_pack_size?: number | null;
          reserved_quantity?: number;
          is_digital?: boolean;
          item_status?: OrderItemStatus | null;
          digital_license_key?: string | null;
          license_sent_at?: string | null;
          license_sent_to?: string | null;
          variant_id?: string | null;
          variant_label?: string | null;
          reserved_from_variant?: boolean;
          serial_number?: string | null;
          warranty_until?: string | null;
          serial_required?: boolean;
        };
        Update: {
          tenant_id?: string;
          created_at?: string;
          id?: string;
          is_deposit?: boolean;
          is_gift?: boolean;
          promotion_id?: string | null;
          order_id?: string;
          product_barcode?: string | null;
          product_category?: string | null;
          product_id?: string;
          product_image_url?: string | null;
          product_name?: string | null;
          product_shelf_location?: string | null;
          product_sku?: string | null;
          quantity?: number;
          picked?: boolean;
          picked_qty?: number | null;
          picked_at?: string | null;
          unit_price?: number;
          product_pack_size?: number | null;
          reserved_quantity?: number;
          is_digital?: boolean;
          item_status?: OrderItemStatus | null;
          digital_license_key?: string | null;
          license_sent_at?: string | null;
          license_sent_to?: string | null;
          variant_id?: string | null;
          variant_label?: string | null;
          reserved_from_variant?: boolean;
          serial_number?: string | null;
          warranty_until?: string | null;
          serial_required?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "global_products";
            referencedColumns: ["id"];
          },
        ];
      };
      orders: {
        Row: {
          tenant_id: string;
          agent_id: string | null;
          created_at: string;
          customer_id: string | null;
          id: string;
          kind: string;
          note: string | null;
          order_number: string;
          prices_include_vat: boolean;
          status: string;
          is_urgent: boolean;
          picker_id: string | null;
          picking_paused: boolean;
          picking_claimed_at: string | null;
          picked_at: string | null;
          picking_approved_by: string | null;
          total: number;
          updated_at: string;
          vat_rate: number;
          customer_name: string | null;
          customer_tax_id: string | null;
          customer_phone: string | null;
          customer_email: string | null;
          billing_city: string | null;
          billing_address: string | null;
          billing_zip: string | null;
          ship_to_different: boolean;
          shipping_name: string | null;
          shipping_phone: string | null;
          shipping_city: string | null;
          shipping_address: string | null;
          shipping_zip: string | null;
          terms_accepted_at: string | null;
          delivery_attempts: number;
          last_delivery_failure_at: string | null;
          last_delivery_failure_note: string | null;
          courier_assigned_at: string | null;
          shipped_at: string | null;
          delivered_at: string | null;
          shipping_method_id: string | null;
          shipping_method_name: string | null;
          shipping_kind: OrderShippingKind | null;
          shipping_base_price: number;
          shipping_free_threshold: number | null;
          shipping_price: number;
          coupon_id: string | null;
          coupon_code: string | null;
          tracking_number: string | null;
          shipping_provider: string | null;
          tracking_url: string | null;
          tracking_updated_at: string | null;
          tracking_notified_number: string | null;
          coupon_discount_type: string | null;
          coupon_discount_value: number | null;
          coupon_min_order: number | null;
          discount_amount: number;
          payment_method: "offline" | "credit_card" | "bit";
          payment_status:
            "not_required" | "awaiting" | "awaiting_verification" | "paid" | "expired" | "rejected";
          payment_due_at: string | null;
          paid_at: string | null;
          bit_transaction_id: string | null;
          order_source: string;
          created_by_staff_id: string | null;
          manual_discount_type: string | null;
          manual_discount_value: number | null;
          manual_discount_amount: number;
          pos_payment_method: string | null;
          bit_receipt_url: string | null;
          payment_reported_at: string | null;
          payment_confirmed_by: string | null;
        };
        Insert: {
          tenant_id?: string;
          agent_id?: string | null;
          created_at?: string;
          customer_id?: string | null;
          id?: string;
          kind?: string;
          note?: string | null;
          order_number?: string;
          prices_include_vat?: boolean;
          status?: string;
          is_urgent?: boolean;
          picker_id?: string | null;
          picking_paused?: boolean;
          picking_claimed_at?: string | null;
          picked_at?: string | null;
          picking_approved_by?: string | null;
          total?: number;
          updated_at?: string;
          vat_rate?: number;
          customer_name?: string | null;
          customer_tax_id?: string | null;
          customer_phone?: string | null;
          customer_email?: string | null;
          billing_city?: string | null;
          billing_address?: string | null;
          billing_zip?: string | null;
          ship_to_different?: boolean;
          shipping_name?: string | null;
          shipping_phone?: string | null;
          shipping_city?: string | null;
          shipping_address?: string | null;
          shipping_zip?: string | null;
          terms_accepted_at?: string | null;
          delivery_attempts?: number;
          last_delivery_failure_at?: string | null;
          last_delivery_failure_note?: string | null;
          courier_assigned_at?: string | null;
          shipped_at?: string | null;
          delivered_at?: string | null;
          shipping_method_id?: string | null;
          shipping_method_name?: string | null;
          shipping_kind?: OrderShippingKind | null;
          shipping_base_price?: number;
          shipping_free_threshold?: number | null;
          shipping_price?: number;
          coupon_id?: string | null;
          coupon_code?: string | null;
          tracking_number?: string | null;
          shipping_provider?: string | null;
          tracking_url?: string | null;
          tracking_updated_at?: string | null;
          tracking_notified_number?: string | null;
          coupon_discount_type?: string | null;
          coupon_discount_value?: number | null;
          coupon_min_order?: number | null;
          discount_amount?: number;
          payment_method?: "offline" | "credit_card" | "bit";
          payment_status?:
            "not_required" | "awaiting" | "awaiting_verification" | "paid" | "expired" | "rejected";
          payment_due_at?: string | null;
          paid_at?: string | null;
          bit_transaction_id?: string | null;
          order_source?: string;
          created_by_staff_id?: string | null;
          manual_discount_type?: string | null;
          manual_discount_value?: number | null;
          manual_discount_amount?: number;
          pos_payment_method?: string | null;
          bit_receipt_url?: string | null;
          payment_reported_at?: string | null;
          payment_confirmed_by?: string | null;
        };
        Update: {
          tenant_id?: string;
          agent_id?: string | null;
          created_at?: string;
          customer_id?: string | null;
          id?: string;
          kind?: string;
          note?: string | null;
          order_number?: string;
          prices_include_vat?: boolean;
          status?: string;
          is_urgent?: boolean;
          picker_id?: string | null;
          picking_paused?: boolean;
          picking_claimed_at?: string | null;
          picked_at?: string | null;
          picking_approved_by?: string | null;
          total?: number;
          updated_at?: string;
          vat_rate?: number;
          customer_name?: string | null;
          customer_tax_id?: string | null;
          customer_phone?: string | null;
          customer_email?: string | null;
          billing_city?: string | null;
          billing_address?: string | null;
          billing_zip?: string | null;
          ship_to_different?: boolean;
          shipping_name?: string | null;
          shipping_phone?: string | null;
          shipping_city?: string | null;
          shipping_address?: string | null;
          shipping_zip?: string | null;
          terms_accepted_at?: string | null;
          delivery_attempts?: number;
          last_delivery_failure_at?: string | null;
          last_delivery_failure_note?: string | null;
          courier_assigned_at?: string | null;
          shipped_at?: string | null;
          delivered_at?: string | null;
          shipping_method_id?: string | null;
          shipping_method_name?: string | null;
          shipping_kind?: OrderShippingKind | null;
          shipping_base_price?: number;
          shipping_free_threshold?: number | null;
          shipping_price?: number;
          coupon_id?: string | null;
          coupon_code?: string | null;
          tracking_number?: string | null;
          shipping_provider?: string | null;
          tracking_url?: string | null;
          tracking_updated_at?: string | null;
          tracking_notified_number?: string | null;
          coupon_discount_type?: string | null;
          coupon_discount_value?: number | null;
          coupon_min_order?: number | null;
          discount_amount?: number;
          payment_method?: "offline" | "credit_card" | "bit";
          payment_status?:
            "not_required" | "awaiting" | "awaiting_verification" | "paid" | "expired" | "rejected";
          payment_due_at?: string | null;
          paid_at?: string | null;
          bit_transaction_id?: string | null;
          order_source?: string;
          created_by_staff_id?: string | null;
          manual_discount_type?: string | null;
          manual_discount_value?: number | null;
          manual_discount_amount?: number;
          pos_payment_method?: string | null;
          bit_receipt_url?: string | null;
          payment_reported_at?: string | null;
          payment_confirmed_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "orders_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne: false;
            referencedRelation: "user_roles";
            referencedColumns: ["user_id"];
          },
          {
            foreignKeyName: "orders_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "user_roles";
            referencedColumns: ["user_id"];
          },
        ];
      };
      password_reset_requests: {
        Row: {
          tenant_id: string;
          admin_note: string | null;
          created_at: string;
          email: string;
          id: string;
          message: string | null;
          phone: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          tenant_id?: string;
          admin_note?: string | null;
          created_at?: string;
          email: string;
          id?: string;
          message?: string | null;
          phone?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          tenant_id?: string;
          admin_note?: string | null;
          created_at?: string;
          email?: string;
          id?: string;
          message?: string | null;
          phone?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      pending_products: {
        Row: {
          tenant_id: string;
          barcode: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          image_url: string | null;
          note: string | null;
          scanned_count: number;
          status: string;
          suggested_name: string;
          updated_at: string;
        };
        Insert: {
          tenant_id?: string;
          barcode?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          image_url?: string | null;
          note?: string | null;
          scanned_count?: number;
          status?: string;
          suggested_name?: string;
          updated_at?: string;
        };
        Update: {
          tenant_id?: string;
          barcode?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          image_url?: string | null;
          note?: string | null;
          scanned_count?: number;
          status?: string;
          suggested_name?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "pending_products_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "user_roles";
            referencedColumns: ["user_id"];
          },
        ];
      };
      password_reset_tokens: {
        Row: {
          tenant_id: string;
          created_at: string;
          created_by: string | null;
          expires_at: string;
          id: string;
          token_hash: string;
          used_at: string | null;
          user_id: string;
        };
        Insert: {
          tenant_id?: string;
          created_at?: string;
          created_by?: string | null;
          expires_at: string;
          id?: string;
          token_hash: string;
          used_at?: string | null;
          user_id: string;
        };
        Update: {
          tenant_id?: string;
          created_at?: string;
          created_by?: string | null;
          expires_at?: string;
          id?: string;
          token_hash?: string;
          used_at?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "password_reset_tokens_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "user_roles";
            referencedColumns: ["user_id"];
          },
        ];
      };
      staff_notifications: {
        Row: {
          tenant_id: string;
          body: string;
          created_at: string;
          id: string;
          is_read: boolean;
          kind: string;
          link: string | null;
          title: string;
          user_id: string;
        };
        Insert: {
          tenant_id?: string;
          body?: string;
          created_at?: string;
          id?: string;
          is_read?: boolean;
          kind: string;
          link?: string | null;
          title: string;
          user_id: string;
        };
        Update: {
          tenant_id?: string;
          body?: string;
          created_at?: string;
          id?: string;
          is_read?: boolean;
          kind?: string;
          link?: string | null;
          title?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "staff_notifications_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "user_roles";
            referencedColumns: ["user_id"];
          },
        ];
      };
      service_agreements: {
        Row: {
          tenant_id: string;
          created_at: string;
          sent_at: string | null;
          signature_svg: string | null;
          signed_at: string | null;
          signer_ip: string | null;
          signer_name: string | null;
          terms_snapshot: string | null;
          token_expires_at: string | null;
          token_hash: string | null;
          user_agent: string | null;
          user_id: string;
        };
        Insert: {
          tenant_id?: string;
          created_at?: string;
          sent_at?: string | null;
          signature_svg?: string | null;
          signed_at?: string | null;
          signer_ip?: string | null;
          signer_name?: string | null;
          terms_snapshot?: string | null;
          token_expires_at?: string | null;
          token_hash?: string | null;
          user_agent?: string | null;
          user_id: string;
        };
        Update: {
          tenant_id?: string;
          created_at?: string;
          sent_at?: string | null;
          signature_svg?: string | null;
          signed_at?: string | null;
          signer_ip?: string | null;
          signer_name?: string | null;
          terms_snapshot?: string | null;
          token_expires_at?: string | null;
          token_hash?: string | null;
          user_agent?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "service_agreements_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "user_roles";
            referencedColumns: ["user_id"];
          },
        ];
      };
      product_drafts: {
        Row: {
          tenant_id: string;
          created_at: string;
          created_by: string | null;
          data: Json;
          id: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          tenant_id?: string;
          created_at?: string;
          created_by?: string | null;
          data?: Json;
          id?: string;
          title?: string;
          updated_at?: string;
        };
        Update: {
          tenant_id?: string;
          created_at?: string;
          created_by?: string | null;
          data?: Json;
          id?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      home_banner_slides: {
        Row: {
          tenant_id: string;
          alt_text: string;
          created_at: string;
          desktop_height: number | null;
          desktop_image_url: string | null;
          desktop_width: number | null;
          id: string;
          link_url: string | null;
          mobile_height: number | null;
          mobile_image_url: string | null;
          mobile_width: number | null;
          placement: string;
          position: number;
          show_desktop: boolean;
          show_mobile: boolean;
          updated_at: string;
        };
        Insert: {
          tenant_id?: string;
          alt_text?: string;
          created_at?: string;
          desktop_height?: number | null;
          desktop_image_url?: string | null;
          desktop_width?: number | null;
          id?: string;
          link_url?: string | null;
          mobile_height?: number | null;
          mobile_image_url?: string | null;
          mobile_width?: number | null;
          placement: string;
          position?: number;
          show_desktop?: boolean;
          show_mobile?: boolean;
          updated_at?: string;
        };
        Update: {
          tenant_id?: string;
          alt_text?: string;
          created_at?: string;
          desktop_height?: number | null;
          desktop_image_url?: string | null;
          desktop_width?: number | null;
          id?: string;
          link_url?: string | null;
          mobile_height?: number | null;
          mobile_image_url?: string | null;
          mobile_width?: number | null;
          placement?: string;
          position?: number;
          show_desktop?: boolean;
          show_mobile?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      stock_counts: {
        Row: {
          tenant_id: string;
          applied_at: string | null;
          applied_by: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          scope_category: string | null;
          status: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          tenant_id?: string;
          applied_at?: string | null;
          applied_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          scope_category?: string | null;
          status?: string;
          title?: string;
          updated_at?: string;
        };
        Update: {
          tenant_id?: string;
          applied_at?: string | null;
          applied_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          scope_category?: string | null;
          status?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      stock_count_lines: {
        Row: {
          tenant_id: string;
          applied_quantity: number | null;
          count_id: string;
          counted_at: string;
          counted_by: string | null;
          counted_units: number;
          id: string;
          loose_units: number | null;
          packs: number | null;
          product_id: string;
          recorded_before: number | null;
          reserved_open: number | null;
          unit_value: number | null;
          value_source: "cost" | "price" | null;
        };
        Insert: {
          tenant_id?: string;
          applied_quantity?: number | null;
          count_id: string;
          counted_at?: string;
          counted_by?: string | null;
          counted_units: number;
          id?: string;
          loose_units?: number | null;
          packs?: number | null;
          product_id: string;
          recorded_before?: number | null;
          reserved_open?: number | null;
          unit_value?: number | null;
          value_source?: "cost" | "price" | null;
        };
        Update: {
          tenant_id?: string;
          applied_quantity?: number | null;
          count_id?: string;
          counted_at?: string;
          counted_by?: string | null;
          counted_units?: number;
          id?: string;
          loose_units?: number | null;
          packs?: number | null;
          product_id?: string;
          recorded_before?: number | null;
          reserved_open?: number | null;
          unit_value?: number | null;
          value_source?: "cost" | "price" | null;
        };
        Relationships: [];
      };
      site_settings: {
        Row: {
          tenant_id: string;
          about_content: string;
          brand_color: string | null;
          is_sabbath_mode: boolean;
          business_address: string;
          business_email: string;
          business_name: string;
          business_phone: string;
          free_shipping_threshold: number | null;
          business_tax_id: string;
          contact_content: string;
          email_signature: string;
          id: boolean;
          logo_path: string | null;
          maintenance_message: string;
          maintenance_mode: boolean;
          prices_include_vat: boolean;
          price_tiers_enabled: boolean;
          privacy_content: string;
          sells_alcohol: boolean;
          site_title: string;
          support_phone: string;
          terms_content: string;
          updated_at: string;
          vat_rate: number;
          business_type: "exempt" | "authorized";
          label_width_mm: number;
          barcode_label_width_mm: number;
          barcode_label_height_mm: number;
          /** חלק 34: הצגת ביקורות הלקוחות וטופס "כתוב ביקורת" בעמוד המוצר */
          reviews_enabled: boolean;
          shabbat_auto_enabled: boolean;
          shabbat_start_time: string;
          shabbat_end_time: string;
          holidays: Json;
          minimum_order_amount: number | null;
          shabbat_message: string | null;
          shabbat_image_url: string | null;
          label_height_mm: number;
          seo_title: string;
          seo_description: string;
          promo_popup_enabled: boolean;
          promo_popup_text: string;
          promo_popup_coupon: string | null;
          facebook_pixel_id: string | null;
          google_analytics_id: string | null;
          zap_delivery_days: number;
          cancellation_policy_content: string;
          custom_domain: string | null;
          payment_phone_enabled: boolean;
          payment_bit_enabled: boolean;
          payment_bit_phone: string | null;
          desktop_banner_active: boolean;
          desktop_banner_image_url: string | null;
          desktop_banner_link: string | null;
          business_hours: string;
        };
        Insert: {
          tenant_id?: string;
          about_content?: string;
          brand_color?: string | null;
          is_sabbath_mode?: boolean;
          business_address?: string;
          business_email?: string;
          business_name?: string;
          business_phone?: string;
          free_shipping_threshold?: number | null;
          business_tax_id?: string;
          contact_content?: string;
          email_signature?: string;
          id?: boolean;
          logo_path?: string | null;
          maintenance_message?: string;
          maintenance_mode?: boolean;
          prices_include_vat?: boolean;
          price_tiers_enabled?: boolean;
          privacy_content?: string;
          sells_alcohol?: boolean;
          site_title?: string;
          support_phone?: string;
          terms_content?: string;
          updated_at?: string;
          vat_rate?: number;
          business_type?: "exempt" | "authorized";
          label_width_mm?: number;
          barcode_label_width_mm?: number;
          barcode_label_height_mm?: number;
          /** חלק 34: הצגת ביקורות הלקוחות וטופס "כתוב ביקורת" בעמוד המוצר */
          reviews_enabled?: boolean;
          shabbat_auto_enabled?: boolean;
          shabbat_start_time?: string;
          shabbat_end_time?: string;
          holidays?: Json;
          minimum_order_amount?: number | null;
          shabbat_message?: string | null;
          shabbat_image_url?: string | null;
          label_height_mm?: number;
          seo_title?: string;
          seo_description?: string;
          promo_popup_enabled?: boolean;
          promo_popup_text?: string;
          promo_popup_coupon?: string | null;
          facebook_pixel_id?: string | null;
          google_analytics_id?: string | null;
          zap_delivery_days?: number;
          cancellation_policy_content?: string;
          custom_domain?: string | null;
          payment_phone_enabled?: boolean;
          payment_bit_enabled?: boolean;
          payment_bit_phone?: string | null;
          desktop_banner_active?: boolean;
          desktop_banner_image_url?: string | null;
          desktop_banner_link?: string | null;
          business_hours?: string;
        };
        Update: {
          tenant_id?: string;
          about_content?: string;
          brand_color?: string | null;
          is_sabbath_mode?: boolean;
          business_address?: string;
          business_email?: string;
          business_name?: string;
          business_phone?: string;
          free_shipping_threshold?: number | null;
          business_tax_id?: string;
          contact_content?: string;
          email_signature?: string;
          id?: boolean;
          logo_path?: string | null;
          maintenance_message?: string;
          maintenance_mode?: boolean;
          prices_include_vat?: boolean;
          price_tiers_enabled?: boolean;
          privacy_content?: string;
          sells_alcohol?: boolean;
          site_title?: string;
          support_phone?: string;
          terms_content?: string;
          updated_at?: string;
          vat_rate?: number;
          business_type?: "exempt" | "authorized";
          label_width_mm?: number;
          barcode_label_width_mm?: number;
          barcode_label_height_mm?: number;
          /** חלק 34: הצגת ביקורות הלקוחות וטופס "כתוב ביקורת" בעמוד המוצר */
          reviews_enabled?: boolean;
          shabbat_auto_enabled?: boolean;
          shabbat_start_time?: string;
          shabbat_end_time?: string;
          holidays?: Json;
          minimum_order_amount?: number | null;
          shabbat_message?: string | null;
          shabbat_image_url?: string | null;
          label_height_mm?: number;
          seo_title?: string;
          seo_description?: string;
          promo_popup_enabled?: boolean;
          promo_popup_text?: string;
          promo_popup_coupon?: string | null;
          facebook_pixel_id?: string | null;
          google_analytics_id?: string | null;
          zap_delivery_days?: number;
          cancellation_policy_content?: string;
          custom_domain?: string | null;
          payment_phone_enabled?: boolean;
          payment_bit_enabled?: boolean;
          payment_bit_phone?: string | null;
          desktop_banner_active?: boolean;
          desktop_banner_image_url?: string | null;
          desktop_banner_link?: string | null;
          business_hours?: string;
        };
        Relationships: [];
      };
      user_custom_prices: {
        Row: {
          tenant_id: string;
          custom_price: number;
          product_id: string;
          updated_at: string;
          updated_by: string | null;
          user_id: string;
        };
        Insert: {
          tenant_id?: string;
          custom_price: number;
          product_id: string;
          updated_at?: string;
          updated_by?: string | null;
          user_id: string;
        };
        Update: {
          tenant_id?: string;
          custom_price?: number;
          product_id?: string;
          updated_at?: string;
          updated_by?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          tenant_id: string;
          agent_number: string | null;
          created_at: string;
          email: string;
          is_approved: boolean;
          is_blocked: boolean;
          is_protected: boolean;
          must_change_password: boolean;
          role: string;
          user_id: string;
          username: string;
          display_name: string | null;
        };
        Insert: {
          tenant_id?: string;
          agent_number?: string | null;
          created_at?: string;
          email: string;
          is_approved?: boolean;
          is_blocked?: boolean;
          is_protected?: boolean;
          must_change_password?: boolean;
          role?: string;
          user_id: string;
          username?: string;
          display_name?: string | null;
        };
        Update: {
          tenant_id?: string;
          agent_number?: string | null;
          created_at?: string;
          email?: string;
          is_approved?: boolean;
          is_blocked?: boolean;
          is_protected?: boolean;
          must_change_password?: boolean;
          role?: string;
          user_id?: string;
          username?: string;
          display_name?: string | null;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      abandoned_carts_due: {
        Args: { _min_age_hours?: number; _limit?: number };
        Returns: string[];
      };
      store_analytics: { Args: { _period?: string }; Returns: Json };
      order_claim_tracking_email: { Args: { _order_id: string }; Returns: Json };
      order_release_tracking_email: {
        Args: { _order_id: string; _previous: string | null };
        Returns: undefined;
      };
      upgrade_request_claim_notification: { Args: { _request_id: string }; Returns: boolean };
      upgrade_request_release_notification: { Args: { _request_id: string }; Returns: undefined };
      store_admin_seats: { Args: Record<PropertyKey, never>; Returns: Json };
      request_extra_admin: { Args: Record<PropertyKey, never>; Returns: Json };
      platform_upgrade_requests: { Args: Record<PropertyKey, never>; Returns: Json };
      platform_send_upgrade_link: {
        Args: { _request_id: string; _payment_url: string };
        Returns: undefined;
      };
      platform_approve_upgrade: { Args: { _request_id: string }; Returns: Json };
      platform_delete_upgrade_request: { Args: { _request_id: string }; Returns: undefined };
      tenant_admin_limit: { Args: { _tenant: string }; Returns: number };
      current_tenant_id: { Args: Record<string, never>; Returns: string | null };
      tenant_for_host: { Args: { _host: string }; Returns: string | null };
      is_platform_admin: { Args: { _user_id?: string }; Returns: boolean };
      platform_slug_problem: { Args: { _slug: string }; Returns: string | null };
      tenant_slug_problem: { Args: { _slug: string }; Returns: string | null };
      portal_account: { Args: { _email: string }; Returns: Json };
      portal_create_store: {
        Args: { _email: string; _name: string; _slug: string };
        Returns: Database["public"]["Tables"]["tenants"]["Row"];
      };
      portal_store_state: { Args: { _email: string; _tenant: string }; Returns: Json };
      platform_list_tenants: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          slug: string;
          name: string;
          domain: string | null;
          is_default: boolean;
          created_at: string;
          owner_email: string | null;
          tax_id: string | null;
          plan: TenantPlan;
          status: TenantStatus;
          status_changed_at: string | null;
          admins: number;
          customers: number;
          products: number;
          orders: number;
          ssl_host: string | null;
          ssl_status: TenantSslStatus | null;
          ssl_issued_at: string | null;
          ssl_expires_at: string | null;
          ssl_error: string | null;
          ssl_checked_at: string | null;
          ssl_renew_requested_at: string | null;
          /** המנוי (חלק 13) */
          sub_plan: "trial" | "basic" | "premium";
          sub_status: "trialing" | "active" | "canceled";
          sub_trial_ends_at: string | null;
          sub_period_end: string | null;
          sub_ends_at: string | null;
          sub_active: boolean;
          open_tickets: number;
        }[];
      };
      platform_delete_tenant: {
        Args: { _tenant: string; _confirm_slug: string };
        Returns: { slug: string; rows: number; user_ids: string[] };
      };
      platform_request_ssl_renewal: { Args: { _tenant: string }; Returns: string };
      platform_create_tenant: {
        Args: {
          _slug: string;
          _name: string;
          _owner_email?: string | null;
          _tax_id?: string | null;
          _plan?: TenantPlan;
          _status?: TenantStatus;
          _domain?: string | null;
        };
        Returns: Database["public"]["Tables"]["tenants"]["Row"];
      };
      platform_set_tenant_status: {
        Args: { _tenant: string; _status: TenantStatus };
        Returns: Database["public"]["Tables"]["tenants"]["Row"];
      };
      platform_set_tenant_plan: {
        Args: { _tenant: string; _plan: TenantPlan };
        Returns: Database["public"]["Tables"]["tenants"]["Row"];
      };
      plan_features: { Args: { _plan: string }; Returns: Json };
      tenant_subscription_state: { Args: { _tenant: string }; Returns: Json };
      tenant_subscription_active: { Args: { _tenant: string }; Returns: boolean };
      tenant_has_feature: { Args: { _tenant: string; _feature: string }; Returns: boolean };
      store_billing: { Args: never; Returns: Json };
      israeli_id_valid: { Args: { _value: string }; Returns: boolean };
      bit_payment_info: { Args: { _order: string }; Returns: Json };
      bit_payment_submit: {
        Args: { _order: string; _reference: string | null; _receipt_path: string | null };
        Returns: Json;
      };
      bit_payment_review: { Args: { _order: string; _approve: boolean }; Returns: Json };
      bit_payments_active: { Args: { _tenant: string }; Returns: boolean };
      order_amount_due: {
        Args: { _total: number; _prices_include_vat: boolean; _vat_rate: number };
        Returns: number;
      };
      billing_profile_json: { Args: { _tenant: string }; Returns: Json };
      normalize_phone: { Args: { _phone: string }; Returns: string | null };
      normalize_order_number: { Args: { _value: string }; Returns: string | null };
      order_by_number: { Args: { _tenant: string; _order_number: string }; Returns: string | null };
      contact_message_submit: {
        Args: {
          _id: string;
          _full_name: string;
          _phone: string;
          _email: string;
          _message: string;
          _order_number?: string | null;
          _attachment_path?: string | null;
          _attachment_name?: string | null;
          _attachment_type?: string | null;
          _attachment_size?: number | null;
        };
        Returns: Json;
      };
      cancellation_request_submit: {
        Args: {
          _first_name: string;
          _last_name: string;
          _phone: string;
          _email: string;
          _message: string | null;
          _order_number: string;
        };
        Returns: Json;
      };
      cancellation_request_confirmed: { Args: { _id: string }; Returns: undefined };
      store_legal_identity: { Args: never; Returns: Json };
      site_inbox_counts: { Args: never; Returns: Json };
      expire_unpaid_orders: { Args: never; Returns: number };
      tenant_active_addons: { Args: { _tenant: string }; Returns: string[] };
      tenant_addon_active: { Args: { _tenant: string; _addon: string }; Returns: boolean };
      tenant_features: { Args: { _tenant: string }; Returns: Json };
      addon_quote_for: { Args: { _tenant: string; _addon: string }; Returns: Json };
      addon_quote: { Args: { _addon: string }; Returns: Json };
      addons_store: { Args: never; Returns: Json };
      addon_purchase: { Args: { _addon: string; _expected?: number | null }; Returns: Json };
      platform_grant_addon: { Args: { _tenant: string; _addon: string }; Returns: Json };
      platform_cancel_addon: { Args: { _id: string }; Returns: Json };
      platform_mark_billing_paid: {
        Args: { _id: string; _reference?: string | null };
        Returns: undefined;
      };
      addon_purchase_notify_targets: { Args: { _tenant: string }; Returns: Json };
      platform_extend_trial: { Args: { _tenant: string; _days: number }; Returns: Json };
      platform_record_payment: {
        Args: {
          _tenant: string;
          _plan: string;
          _amount: number;
          _months?: number;
          _method?: string;
          _reference?: string | null;
          _note?: string | null;
        };
        Returns: Json;
      };
      platform_billing_history: { Args: { _tenant: string }; Returns: Json };
      support_my_tickets: { Args: never; Returns: Json };
      support_unread_count: { Args: never; Returns: number };
      support_open_ticket: { Args: { _subject: string; _message: string }; Returns: Json };
      support_post_message: { Args: { _ticket: string; _message: string }; Returns: Json };
      support_thread: { Args: { _ticket: string }; Returns: Json };
      support_set_status: { Args: { _ticket: string; _status: string }; Returns: Json };
      platform_support_tickets: { Args: { _filter?: string }; Returns: Json };
      platform_support_counts: { Args: never; Returns: Json };
      support_notify_targets: { Args: { _ticket: string }; Returns: Json };
      platform_list_admins: {
        Args: Record<string, never>;
        Returns: { user_id: string; email: string; created_at: string }[];
      };
      platform_add_admin: { Args: { _email: string }; Returns: string };
      platform_remove_admin: { Args: { _user_id: string }; Returns: undefined };
      tenant_is_active: { Args: { _tenant: string }; Returns: boolean };
      get_order_bumps: {
        Args: Record<string, never>;
        Returns: { product_id: string; pitch: string | null }[];
      };
      apply_order_gifts: { Args: { _order_id: string }; Returns: number };
      picking_manager_approve: { Args: { _order_id: string }; Returns: Record<string, unknown> };
      picking_return: { Args: { _order_id: string }; Returns: undefined };
      stock_lookup: { Args: { _query: string }; Returns: Record<string, unknown>[] };
      locations_list: { Args: Record<string, never>; Returns: Record<string, unknown>[] };
      transfer_create: { Args: { _note?: string | null }; Returns: string };
      transfer_line_save: {
        Args: {
          _transfer_id: string;
          _line_id: string | null;
          _product_id: string;
          _from: string;
          _to: string;
          _quantity: number;
        };
        Returns: string;
      };
      transfer_line_delete: { Args: { _line_id: string }; Returns: undefined };
      transfer_cancel: { Args: { _transfer_id: string }; Returns: undefined };
      transfer_approve: { Args: { _transfer_id: string }; Returns: number };
      transfers_list: { Args: { _status: string }; Returns: Record<string, unknown>[] };
      transfer_lines: { Args: { _transfer_id: string }; Returns: Record<string, unknown>[] };
      picking_orders: { Args: Record<string, never>; Returns: Record<string, unknown>[] };
      picking_order_lines: { Args: { _order_id: string }; Returns: Record<string, unknown>[] };
      picking_workers: { Args: Record<string, never>; Returns: Record<string, unknown>[] };
      picking_stats: { Args: { _user_id?: string }; Returns: Record<string, unknown>[] };
      picking_leaderboard: { Args: Record<string, never>; Returns: Record<string, unknown>[] };
      picking_claim: { Args: { _order_id: string }; Returns: undefined };
      picking_release: { Args: { _order_id: string }; Returns: undefined };
      picking_transfer: { Args: { _order_id: string; _to_user: string }; Returns: undefined };
      picking_set_paused: { Args: { _order_id: string; _paused: boolean }; Returns: undefined };
      picking_mark_item: {
        Args: { _item_id: string; _picked_qty: number | null };
        Returns: undefined;
      };
      set_order_urgent: { Args: { _order_id: string; _urgent: boolean }; Returns: undefined };
      picking_approve: { Args: { _order_id: string }; Returns: Record<string, unknown> };
      reorder_products: {
        Args: { _category: string; _product_ids: string[] };
        Returns: number;
      };
      can_view_order: {
        Args: { _agent_id: string; _customer_id: string };
        Returns: boolean;
      };
      generate_sku: { Args: never; Returns: string };
      get_catalog: {
        Args: never;
        Returns: {
          barcode: string | null;
          category: string;
          colors: string[];
          created_at: string;
          deposit_price: number | null;
          deposit_units: number | null;
          description: string | null;
          has_deposit: boolean;
          id: string;
          image_url: string | null;
          images: string[];
          is_out_of_stock: boolean;
          is_promo: boolean;
          name: string;
          original_price: number | null;
          price: number | null;
          sale_ends_at: string | null;
          sku: string;
          pack_size: number | null;
          min_order_quantity: number | null;
          is_custom_price: boolean;
          is_digital: boolean;
          variant_attributes: Json;
          variants: Json;
          categories: string[];
          is_featured: boolean;
          sticker: Json | null;
        }[];
      };
      admin_dashboard: { Args: never; Returns: Json };
      import_ensure_category_path: { Args: { _tenant: string; _path: Json }; Returns: Json };
      save_product_variants: {
        Args: { _product_id: string; _attributes: Json; _variants: Json };
        Returns: number;
      };
      customer_has_prices: { Args: { _user_id: string }; Returns: boolean };
      is_admin: { Args: { _user_id: string }; Returns: boolean };
      sale_is_active: {
        Args: { _ends: string | null; _sale_price: number | null; _starts: string | null };
        Returns: boolean;
      };
      is_agent: { Args: { _user_id: string }; Returns: boolean };
      is_agent_of_customer: {
        Args: { _agent_id: string; _customer_id: string };
        Returns: boolean;
      };
      is_approved: { Args: { _user_id: string }; Returns: boolean };
      is_staff: { Args: { _user_id: string }; Returns: boolean };
      is_super_admin: { Args: { _user_id: string }; Returns: boolean };
      rename_category: { Args: { _new: string; _old: string }; Returns: number };
      set_category_order: { Args: { _names: string[] }; Returns: undefined };
      handler_monthly_stats: {
        Args: { _year: number };
        Returns: { agent_id: string | null; month: number; orders: number; revenue: number }[];
      };
      staff_display_names: {
        Args: { _ids: string[] };
        Returns: { user_id: string; display_name: string | null; agent_number: string | null }[];
      };
      order_activity_years: {
        Args: never;
        Returns: { year: number; orders: number; revenue: number }[];
      };
      category_product_counts: {
        Args: never;
        Returns: { category: string; products: number }[];
      };
      admin_create_order: {
        Args: { _customer_id: string | null; _items: Json; _details: Json };
        Returns: { id: string; order_number: string; total: number; status: string }[];
      };
      admin_search_customers: {
        Args: { _term?: string };
        Returns: {
          kind: string;
          customer_id: string | null;
          name: string;
          phone: string | null;
          email: string | null;
          city: string | null;
          address: string | null;
          zip: string | null;
          price_tier: number;
          price_list_type: string;
          orders_count: number;
          last_order_at: string | null;
        }[];
      };
      pos_unit_price: {
        Args: { _customer_id: string | null; _product_id: string; _variant_id?: string | null };
        Returns: number;
      };
      place_order: {
        Args: {
          _items: Json;
          _kind: string;
          _prices_include_vat: boolean;
          _vat_rate: number;
          _details?: Json | null;
        };
        Returns: { id: string; kind: string; order_number: string }[];
      };
      storefront_feed_products: {
        Args: never;
        Returns: {
          id: string;
          sku: string;
          name: string;
          category: string;
          description: string | null;
          image_url: string | null;
          barcode: string | null;
          price: number;
          regular_price: number;
          in_stock: boolean;
          is_digital: boolean;
          show_in_zap: boolean;
          seo_title: string | null;
          seo_description: string | null;
          updated_at: string;
        }[];
      };
      import_products: {
        Args: { _rows: Json };
        Returns: Json;
      };
      check_coupon: {
        Args: { _code: string; _subtotal?: number | null };
        Returns: Json;
      };
      coupon_usage: {
        Args: never;
        Returns: { coupon_id: string; uses: number; discount_total: number }[];
      };
      order_coupon_verify: {
        Args: { _order: string };
        Returns: undefined;
      };
      save_abandoned_cart: {
        Args: { _session: string; _email: string; _name: string; _phone: string; _items: Json };
        Returns: string | null;
      };
      abandoned_cart_restore: {
        Args: { _token: string };
        Returns: Json;
      };
      claim_low_stock_alerts: {
        Args: { _order: string; _threshold?: number };
        Returns: {
          alert_product_id: string;
          alert_name: string;
          alert_variant: string | null;
          alert_sku: string | null;
          alert_stock: number;
        }[];
      };
      platform_save_pricing: {
        Args: { _plans: Json; _notes: Json | null };
        Returns: undefined;
      };
      place_guest_order: {
        Args: { _kind: string; _items: Json; _details: Json };
        Returns: { id: string; kind: string; order_number: string; total: number }[];
      };
      my_stores: {
        Args: never;
        Returns: {
          tenant_id: string;
          slug: string;
          name: string;
          role: string;
          is_owner: boolean;
          status: string;
          is_default: boolean;
          domain: string | null;
          custom_domain: string | null;
          custom_domain_status: string | null;
          is_current: boolean;
        }[];
      };
      store_link_existing_account: {
        Args: { _email: string; _role: string; _display_name?: string | null };
        Returns: string | null;
      };
      platform_link_store_admin: {
        Args: { _tenant: string; _email: string };
        Returns: string | null;
      };
      my_store_role: {
        Args: never;
        Returns: {
          user_id: string;
          email: string;
          username: string;
          role: string;
          is_approved: boolean;
          is_blocked: boolean;
          must_change_password: boolean;
          is_platform_admin: boolean;
          is_member: boolean;
          /** חלק 33: owner / manager / cashier / warehouse / agent — או null */
          staff_role: "owner" | "manager" | "cashier" | "warehouse" | "agent" | null;
        }[];
      };
      reviews_enabled: { Args: never; Returns: boolean };
      product_review_submit: {
        Args: {
          _product_id: string;
          _customer_name: string;
          _rating: number;
          _content: string;
          _user_id?: string | null;
        };
        Returns: Json;
      };
      product_reviews_public: {
        Args: { _product_id: string; _limit?: number; _offset?: number };
        Returns: {
          id: string;
          customer_name: string;
          rating: number;
          content: string;
          created_at: string;
          verified_purchase: boolean;
        }[];
      };
      product_review_summary: { Args: { _product_id: string }; Returns: Json };
      product_rating_summaries: {
        Args: never;
        Returns: { product_id: string; review_count: number; average_rating: number }[];
      };
      admin_product_reviews: {
        Args: { _status?: string };
        Returns: {
          id: string;
          product_id: string;
          product_name: string;
          product_image_url: string | null;
          product_hidden: boolean;
          customer_name: string;
          customer_email: string | null;
          rating: number;
          content: string;
          is_approved: boolean;
          verified_purchase: boolean;
          created_at: string;
          approved_at: string | null;
          approved_by_name: string | null;
        }[];
      };
      admin_review_moderate: { Args: { _ids: string[]; _action: string }; Returns: number };
      serial_products: {
        Args: never;
        Returns: {
          product_id: string;
          name: string;
          sku: string;
          barcode: string | null;
          warranty_months: number;
          stock_quantity: number;
          in_stock_serials: number;
          sold_serials: number;
          missing_serials: number;
        }[];
      };
      product_serial_gap: { Args: { _product_id: string }; Returns: number };
      product_serials_receive: {
        Args: { _product_id: string; _serials: string[]; _mode?: string };
        Returns: Json;
      };
      product_serial_update: { Args: { _serial_id: string; _serial: string }; Returns: string };
      product_serial_remove: { Args: { _serial_id: string; _write_off?: boolean }; Returns: Json };
      product_serials_list: {
        Args: { _product_id: string; _status?: string; _search?: string; _limit?: number };
        Returns: {
          id: string;
          serial_number: string;
          status: string;
          received_at: string;
          sold_at: string | null;
          warranty_until: string | null;
          order_id: string | null;
          order_number: string | null;
          customer_name: string | null;
        }[];
      };
      product_serials_available: {
        Args: { _product_id: string; _search?: string; _limit?: number };
        Returns: { id: string; serial_number: string; received_at: string }[];
      };
      serial_lookup: {
        Args: { _serial: string };
        Returns: {
          id: string;
          serial_number: string;
          status: string;
          product_id: string;
          product_name: string;
          product_sku: string;
          received_at: string;
          sold_at: string | null;
          warranty_until: string | null;
          warranty_active: boolean;
          order_id: string | null;
          order_number: string | null;
          customer_name: string | null;
          customer_phone: string | null;
        }[];
      };
      order_item_assign_serial: {
        Args: { _order_item_id: string; _serial: string };
        Returns: Json;
      };
      order_item_unassign_serial: {
        Args: { _order_item_id: string; _serial_id: string };
        Returns: undefined;
      };
      order_item_serials: {
        Args: { _order_item_id: string };
        Returns: {
          id: string;
          serial_number: string;
          sold_at: string;
          warranty_until: string | null;
        }[];
      };
      order_serial_lines: {
        Args: { _order_id: string };
        Returns: {
          item_id: string;
          product_id: string;
          product_name: string | null;
          quantity: number;
          serial_required: boolean;
          serial_number: string | null;
          warranty_until: string | null;
        }[];
      };
      orders_missing_serials: {
        Args: { _order_ids: string[] };
        Returns: {
          order_id: string;
          product_name: string | null;
          assigned: number;
          required: number;
        }[];
      };
      store_rest_state: { Args: { _tenant?: string | null; _at?: string }; Returns: Json };
      store_staff_role: { Args: { _user_id?: string }; Returns: string | null };
      staff_can: { Args: { _permission: string; _user_id?: string }; Returns: boolean };
      is_cashier: { Args: { _user_id: string }; Returns: boolean };
      store_set_staff_role: { Args: { _user_id: string; _staff_role: string }; Returns: string };
      staff_product_catalog: {
        Args: never;
        Returns: {
          id: string;
          sku: string;
          name: string;
          category: string;
          barcode: string | null;
          image_url: string | null;
          price_tier1: number;
          price_tier2: number | null;
          price_tier3: number | null;
          sale_price: number | null;
          sale_starts_at: string | null;
          sale_ends_at: string | null;
          stock_quantity: number;
          is_hidden: boolean;
          is_digital: boolean;
          has_deposit: boolean;
          deposit_price: number | null;
          deposit_units: number | null;
          variant_attributes: Json;
          category_ids: string[];
        }[];
      };
      staff_product_variants: {
        Args: never;
        Returns: {
          id: string;
          product_id: string;
          options: Json;
          sku: string | null;
          price: number | null;
          stock_quantity: number | null;
          is_active: boolean;
          sort_order: number;
        }[];
      };
      save_barcode_label_size: {
        Args: { _width_mm: number; _height_mm: number };
        Returns: undefined;
      };
      fulfillment_orders: {
        Args: { _include_delivered?: boolean };
        Returns: {
          id: string;
          order_number: string;
          created_at: string;
          status: string;
          is_urgent: boolean;
          customer_name: string | null;
          customer_phone: string | null;
          city: string | null;
          address: string | null;
          zip: string | null;
          shipping_method_name: string | null;
          shipping_kind: string | null;
          tracking_number: string | null;
          shipping_provider: string | null;
          delivery_attempts: number;
          items_count: number;
          units_count: number;
          order_source: string;
          note: string | null;
          updated_at: string;
        }[];
      };
      fulfillment_set_status: {
        Args: {
          _order_id: string;
          _status: string;
          _tracking_number?: string;
          _shipping_provider?: string;
        };
        Returns: Json;
      };
      replace_home_banners: { Args: { _slides: Json }; Returns: number };
      price_tiers_enabled: { Args: never; Returns: boolean };
      apply_stock_count: {
        Args: { _count_id: string };
        Returns: { changed: number; counted: number; marked_out_of_stock: number }[];
      };
      stock_reserved_open: { Args: never; Returns: { product_id: string; reserved: number }[] };
      resolve_login_email: { Args: { _identifier: string }; Returns: string | null };
      assign_order_courier: {
        Args: {
          _order_ids: string[];
          _courier_name?: string | null;
          _courier_phone?: string | null;
          _renew?: boolean;
        };
        Returns: {
          order_id: string;
          order_number: string;
          token: string;
          expires_at: string;
          delivery_attempts: number;
        }[];
      };
      issue_login_code: {
        Args: { _email: string; _code_hash: string; _ip?: string | null };
        Returns: string;
      };
      consume_login_code: { Args: { _email: string; _code_hash: string }; Returns: Json };
      courier_delivery: { Args: { _token: string }; Returns: Json };
      courier_report: {
        Args: { _token: string; _delivered: boolean; _note?: string | null };
        Returns: Json;
      };
    };
    Enums: {
      product_serial_status: "in_stock" | "sold";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
