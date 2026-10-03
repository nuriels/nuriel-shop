export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

/** סוג מנוי של חנות (tenants.plan) */
export type TenantPlan = "trial" | "basic" | "pro" | "enterprise";
/** סטטוס חנות (tenants.status) — חנות מוקפאת נעולה ללקוחות */
export type TenantStatus = "active" | "suspended";
/** סוג התנאי של הטבת עגלה (cart_promotions.condition_type) */
export type CartPromotionCondition = "min_subtotal" | "category_quantity";
/** מצב תעודת SSL של חנות (tenant_ssl.status) — מדווח ע"י deploy/ssl/store-certs.sh */
export type TenantSslStatus = "active" | "pending" | "error" | "blocked" | "external";
/** יומן המשלוח של הזמנה (order_delivery_events.kind) */
export type DeliveryEventKind = "courier_assigned" | "delivery_failed" | "delivered" | "shipped";

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
      platform_admin_handoffs: {
        Row: {
          token_hash: string;
          user_id: string;
          tenant_id: string;
          created_at: string;
          expires_at: string;
          used_at: string | null;
        };
        Insert: {
          token_hash: string;
          user_id: string;
          tenant_id: string;
          created_at?: string;
          expires_at: string;
          used_at?: string | null;
        };
        Update: {
          token_hash?: string;
          user_id?: string;
          tenant_id?: string;
          created_at?: string;
          expires_at?: string;
          used_at?: string | null;
        };
        Relationships: [];
      };
      platform_admins: {
        Row: { user_id: string; created_at: string };
        Insert: { user_id: string; created_at?: string };
        Update: { user_id?: string; created_at?: string };
        Relationships: [];
      };
      tenant_secrets: {
        Row: {
          tenant_id: string;
          resend_api_key: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          tenant_id?: string;
          resend_api_key?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          tenant_id?: string;
          resend_api_key?: string | null;
          updated_at?: string;
          updated_by?: string | null;
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
          tenant_id: string;
          created_at: string;
          image_url: string | null;
          show_on_home: boolean;
          name: string;
          parent_name: string | null;
          sort_order: number;
        };
        Insert: {
          tenant_id?: string;
          created_at?: string;
          image_url?: string | null;
          show_on_home?: boolean;
          name: string;
          parent_name?: string | null;
          sort_order?: number;
        };
        Update: {
          tenant_id?: string;
          created_at?: string;
          image_url?: string | null;
          show_on_home?: boolean;
          name?: string;
          parent_name?: string | null;
          sort_order?: number;
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
          updated_at: string;
        };
        Insert: {
          tenant_id?: string;
          id?: boolean;
          notify_admin_user_ids?: string[];
          sender_email?: string;
          updated_at?: string;
        };
        Update: {
          tenant_id?: string;
          id?: boolean;
          notify_admin_user_ids?: string[];
          sender_email?: string;
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
          label_width_mm: number;
          label_height_mm: number;
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
          label_width_mm?: number;
          label_height_mm?: number;
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
          label_width_mm?: number;
          label_height_mm?: number;
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
      current_tenant_id: { Args: Record<string, never>; Returns: string | null };
      tenant_for_host: { Args: { _host: string }; Returns: string | null };
      is_platform_admin: { Args: { _user_id?: string }; Returns: boolean };
      platform_slug_problem: { Args: { _slug: string }; Returns: string | null };
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
        }[];
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
      place_guest_order: {
        Args: { _kind: string; _items: Json; _details: Json };
        Returns: { id: string; kind: string; order_number: string; total: number }[];
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
        }[];
      };
      replace_home_banners: { Args: { _slides: Json }; Returns: number };
      price_tiers_enabled: { Args: never; Returns: boolean };
      apply_stock_count: {
        Args: { _count_id: string };
        Returns: { changed: number; counted: number; marked_out_of_stock: number }[];
      };
      stock_reserved_open: { Args: never; Returns: { product_id: string; reserved: number }[] };
      resolve_login_email: { Args: { _identifier: string }; Returns: string | null };
      platform_tenant_email_keys: {
        Args: never;
        Returns: {
          tenant_id: string;
          has_key: boolean;
          key_hint: string | null;
          updated_at: string;
        }[];
      };
      platform_set_tenant_resend_key: {
        Args: { _tenant: string; _key: string | null };
        Returns: string | null;
      };
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
      courier_delivery: { Args: { _token: string }; Returns: Json };
      courier_report: {
        Args: { _token: string; _delivered: boolean; _note?: string | null };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
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
