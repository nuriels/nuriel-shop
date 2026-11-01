// מחירים, כללי מחיר ומדיניות ביטול (Stage 2f) — מה שפונקציות המסד מחזירות (מיגרציה 13)
export type RuleKind = "weekday" | "weekend" | "season" | "holiday";
export type PriceMode = "fixed" | "percent" | "amount";
export type FeeKind = "none" | "percent_total" | "percent_deposit" | "fixed" | "deposit" | "full";

export interface PricedUnit {
  id: string;
  name: string;
  kind: "unit" | "room" | "whole_property";
  property_id: string;
  property_name: string;
  is_active: boolean;
  capacity: number;
  base_occupancy: number;
  base_price: number;
  extra_adult_price: number;
  extra_child_price: number;
  min_nights: number;
  price_floor: number | null;
  price_ceiling: number | null;
  policy_id: string | null;
  revision: number;
}

export interface RateRule {
  id: string;
  name: string;
  kind: RuleKind;
  property_id: string | null;
  unit_id: string | null;
  date_from: string | null;
  date_to: string | null;
  /** ביט 0 = ראשון … ביט 6 = שבת */
  days_mask: number;
  price_mode: PriceMode;
  value: number;
  min_nights: number | null;
  priority: number;
  policy_id: string | null;
  is_active: boolean;
}

export interface FeeTier {
  from_days: number;
  fee: FeeKind;
  value?: number;
}

export interface PolicyRules {
  deposit_kind: "none" | "percent" | "fixed";
  deposit_value: number;
  deposit_due: "booking" | "approval";
  free_cancel_days: number | null;
  free_cancel_time: string | null;
  fee_tiers: FeeTier[];
  no_show_fee: "deposit" | "percent_total" | "fixed" | "full";
  no_show_value: number;
  auto_cancel: "never" | "within_free_window" | "always";
  guest_text: string | null;
}

export interface Policy {
  id: string;
  name: string;
  version: number;
  is_default: boolean;
  is_archived: boolean;
  updated_at: string;
  rules: PolicyRules;
}

export interface PricingView {
  currency: string;
  weekend_nights: number[];
  timezone: string;
  check_in_time: string;
  can_policies: boolean;
  units: PricedUnit[];
  properties: { id: string; name: string }[];
  rules: RateRule[];
  policies: Policy[];
}

export interface PolicyPeriod {
  from: string | null;
  until: string | null;
  fee: number;
  kind: string;
  from_days?: number;
}
export interface PolicyPreview {
  total: number;
  deposit_amount: number;
  currency: string;
  check_in_time: string;
  schedule: {
    arrival: string;
    free_until: string | null;
    periods: PolicyPeriod[];
    no_show_fee: number;
  };
}

export interface PolicyVersion {
  version: number;
  name: string;
  rules: PolicyRules;
  saved_at: string;
}

/** הצעת מחיר מהשרת (quote) — לתצוגה בלבד */
export interface PriceQuote {
  available: boolean;
  unit_name: string;
  check_in: string;
  check_out: string;
  nights_count: number;
  adults: number;
  children: number;
  min_nights: number;
  nights: {
    night: string;
    base_rate: number;
    extras: number;
    price: number;
    rule_applied: string;
  }[];
  subtotal: number;
  discount: number;
  total: number;
  currency: string;
  deposit_amount: number;
  policy: { name: string; schedule: PolicyPreview["schedule"] };
}

export type PricingSaveResult<T> =
  { status: "saved"; value: T } | { status: "conflict"; message: string; view: PricingView };
