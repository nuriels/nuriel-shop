// sendOrderEmails had no limit: the order's owner could replay it to flood the staff with the same order e-mail
// (audit finding B-7). The limit is per order and per user, and it is checked only AFTER the permission check
// so a stranger cannot use up somebody else's quota.
import { describe, expect, it } from "vitest";
import { orderEmailsAllowed } from "@/lib/order-email-limit.server";

describe("order e-mails — replay limit", () => {
  it("the normal flow (checkout, then once more after a payment proof) is allowed", () => {
    const order = "order-normal";
    expect(orderEmailsAllowed(order, "user-normal")).toBe(true);
    expect(orderEmailsAllowed(order, "user-normal")).toBe(true);
  });

  it("the sixth send of the same order within the window is refused", () => {
    const order = "order-replay";
    const results = Array.from({ length: 7 }, () => orderEmailsAllowed(order, "user-replay"));
    expect(results).toEqual([true, true, true, true, true, false, false]);
  });

  it("another order of the same user is not affected", () => {
    for (let i = 0; i < 7; i++) orderEmailsAllowed("order-a", "user-two");
    expect(orderEmailsAllowed("order-b", "user-two")).toBe(true);
  });

  it("one user cannot send for many orders without bound (60 per window)", () => {
    const results = Array.from({ length: 65 }, (_, i) =>
      orderEmailsAllowed(`bulk-${i}`, "user-bulk"),
    );
    expect(results.filter(Boolean)).toHaveLength(60);
  });
});
