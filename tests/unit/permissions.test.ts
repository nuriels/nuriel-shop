import { describe, expect, it } from "vitest";
import {
  ASSIGNABLE_STAFF_ROLES,
  canOpenAdminTab,
  dbRoleForStaffRole,
  effectiveStaffRole,
  staffCan,
  staffRoleOf,
  type StaffPermission,
  type StaffRole,
} from "@/lib/permissions";

const PERMISSIONS: StaffPermission[] = [
  "pos",
  "products.view",
  "inventory",
  "orders.fulfill",
  "admin",
  "staff.manage",
  "staff.managers",
  "billing.manage",
];
const ROLES: StaffRole[] = ["owner", "manager", "cashier", "warehouse", "agent"];

describe("staff permission matrix (mirror of staff_can in the DB)", () => {
  it("matches the baseline matrix", () => {
    const matrix = Object.fromEntries(
      ROLES.map((role) => [role, PERMISSIONS.filter((p) => staffCan(role, p))]),
    );
    expect(matrix).toEqual({
      owner: PERMISSIONS,
      manager: ["pos", "products.view", "inventory", "orders.fulfill", "admin", "staff.manage"],
      cashier: ["pos", "products.view"],
      warehouse: ["products.view", "inventory", "orders.fulfill"],
      agent: ["products.view"],
    });
  });

  it("denies everything without a role", () => {
    for (const p of PERMISSIONS) {
      expect(staffCan(null, p)).toBe(false);
      expect(staffCan(undefined, p)).toBe(false);
    }
  });
});

describe("role mapping", () => {
  it("maps user_roles rows to staff roles", () => {
    expect(staffRoleOf("admin", true)).toBe("owner");
    expect(staffRoleOf("admin", false)).toBe("manager");
    expect(staffRoleOf("cashier", false)).toBe("cashier");
    expect(staffRoleOf("warehouse", false)).toBe("warehouse");
    expect(staffRoleOf("agent", false)).toBe("agent");
    expect(staffRoleOf("customer", false)).toBeNull();
    expect(staffRoleOf("admin", true, true)).toBeNull();
  });

  it("maps assignable roles back to DB roles", () => {
    expect(ASSIGNABLE_STAFF_ROLES.map(dbRoleForStaffRole)).toEqual([
      "admin",
      "cashier",
      "warehouse",
      "agent",
    ]);
  });

  it("treats an old DB row without staff_role as owner (backward compatibility)", () => {
    expect(effectiveStaffRole({ role: "admin" })).toBe("owner");
    expect(effectiveStaffRole({ role: "admin", staff_role: "manager" })).toBe("manager");
    expect(effectiveStaffRole(null)).toBeNull();
  });

  it("does not open admin tabs for roles without permission", () => {
    expect(canOpenAdminTab(null, "orders")).toBe(false);
    expect(canOpenAdminTab("owner", "orders")).toBe(true);
  });
});
