// הנתונים הקבועים של בדיקות ה-E2E — משותף ל-seed ולבדיקות. פיקטיבי בלבד.
export const PASSWORD = "E2e-Test-Pass-1!";

export const STORE_A = { id: "00000000-0000-0000-0000-000000000001", slug: "kobi" };
export const STORE_B = { id: "7e2e0000-0000-0000-0000-00000000000b", slug: "store-b" };

export const USERS = {
  platform: {
    id: "e2e00000-0000-0000-0000-0000000000f0",
    email: "platform@e2e.test",
    password: PASSWORD,
  },
  ownerA: {
    id: "e2e00000-0000-0000-0000-0000000000a1",
    email: "owner.a@e2e.test",
    password: PASSWORD,
  },
  customerA: {
    id: "e2e00000-0000-0000-0000-0000000000a3",
    email: "customer.a@e2e.test",
    password: PASSWORD,
  },
  ownerB: {
    id: "e2e00000-0000-0000-0000-0000000000b1",
    email: "owner.b@e2e.test",
    password: PASSWORD,
  },
};

export const PRODUCTS = {
  a1: { id: "e2e0a000-0000-0000-0000-000000000001", name: "יין אדום בדיקה", sku: "90000001" },
  a2: { id: "e2e0a000-0000-0000-0000-000000000002", name: "מיץ ענבים בדיקה", sku: "90000002" },
  b1: { id: "e2e0b000-0000-0000-0000-000000000001", name: "מוצר סודי של חנות B", sku: "90000101" },
};
