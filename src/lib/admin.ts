import type { UserRole } from "@/hooks/useAuthState";

export type Role = "admin" | "agent" | "customer" | "warehouse" | "cashier";

export const ROLE_LABEL: Record<Role, string> = {
  admin: "מנהל",
  agent: "סוכן",
  warehouse: "מחסנאי",
  cashier: "קופאי",
  customer: "לקוח",
};

export function isAdmin(role: UserRole | null | undefined): boolean {
  return role?.role === "admin";
}

export function isAgent(role: UserRole | null | undefined): boolean {
  return role?.role === "agent";
}

export function isCustomer(role: UserRole | null | undefined): boolean {
  return role?.role === "customer";
}

export function isStaff(role: UserRole | null | undefined): boolean {
  return isAdmin(role) || isAgent(role);
}
