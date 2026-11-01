// שלב E2: בקשה לאתר צימר מהשער — אותם כללים כמו hospitality.site_request_submit במסד,
// והטיפול בבקשה בפאנל (אותם כללים כמו admin_site_request_set)
import { describe, expect, it } from "vitest";
import { parseSiteRequestSet } from "@/engines/hospitality/validation/platform-admin";
import {
  cleanZimmerRequest,
  shekels,
  ZIMMER_AREA_MAX,
  ZIMMER_MESSAGE_MAX,
  zimmerRequestProblems,
  type ZimmerRequest,
} from "@/lib/portal";

const valid: ZimmerRequest = {
  business_name: "צימרים בגליל",
  phone: "0501234567",
  units: 3,
  plan_code: "basic",
  area: "גליל עליון",
  message: "",
};

describe("cleanZimmerRequest", () => {
  it("normalizes like the database: spaces, phone symbols, units as a number", () => {
    expect(
      cleanZimmerRequest({
        business_name: "  צימרים   בגליל ",
        phone: " +972 (50) 123-4567 ",
        units: " 4 ",
        plan_code: " premium ",
        area: " גליל   עליון ",
        message: "  נשמח לשיחה \n בערב  ",
      }),
    ).toEqual({
      business_name: "צימרים בגליל",
      phone: "+972501234567",
      units: 4,
      plan_code: "premium",
      area: "גליל עליון",
      message: "נשמח לשיחה \n בערב",
    });
  });

  it("treats a missing or empty units field as 'not given', and junk as invalid", () => {
    expect(cleanZimmerRequest({ ...valid, units: "" }).units).toBeNull();
    expect(cleanZimmerRequest({ ...valid, units: undefined }).units).toBeNull();
    expect(cleanZimmerRequest({ ...valid, units: 7 }).units).toBe(7);
    expect(Number.isNaN(cleanZimmerRequest({ ...valid, units: "abc" }).units)).toBe(true);
  });

  it("survives a missing body (no crash, everything empty)", () => {
    expect(cleanZimmerRequest(null)).toEqual({
      business_name: "",
      phone: "",
      units: null,
      plan_code: "",
      area: "",
      message: "",
    });
  });
});

describe("zimmerRequestProblems", () => {
  it("accepts a complete request, and one without the optional fields", () => {
    expect(zimmerRequestProblems(valid)).toEqual({});
    expect(
      zimmerRequestProblems({ ...valid, units: null, plan_code: "", area: "", message: "" }),
    ).toEqual({});
  });

  it("requires a business name of 2–120 characters", () => {
    expect(zimmerRequestProblems({ ...valid, business_name: "" }).business_name).toBeTruthy();
    expect(zimmerRequestProblems({ ...valid, business_name: "א" }).business_name).toBeTruthy();
    expect(
      zimmerRequestProblems({ ...valid, business_name: "א".repeat(121) }).business_name,
    ).toBeTruthy();
    expect(zimmerRequestProblems({ ...valid, business_name: "א".repeat(120) })).toEqual({});
  });

  it("requires a phone of 9–15 digits (optional leading +)", () => {
    expect(zimmerRequestProblems({ ...valid, phone: "" }).phone).toBeTruthy();
    expect(zimmerRequestProblems({ ...valid, phone: "12345678" }).phone).toBeTruthy();
    expect(zimmerRequestProblems({ ...valid, phone: "1".repeat(16) }).phone).toBeTruthy();
    expect(zimmerRequestProblems({ ...valid, phone: "+972501234567" })).toEqual({});
    expect(zimmerRequestProblems({ ...valid, phone: "041234567" })).toEqual({});
  });

  it("limits units to whole numbers 1–500", () => {
    for (const units of [0, -1, 501, 2.5, Number.NaN]) {
      expect(zimmerRequestProblems({ ...valid, units }).units).toBeTruthy();
    }
    expect(zimmerRequestProblems({ ...valid, units: 1 })).toEqual({});
    expect(zimmerRequestProblems({ ...valid, units: 500 })).toEqual({});
  });

  it("limits the area and the message", () => {
    expect(
      zimmerRequestProblems({ ...valid, area: "א".repeat(ZIMMER_AREA_MAX + 1) }).area,
    ).toBeTruthy();
    expect(zimmerRequestProblems({ ...valid, area: "א".repeat(ZIMMER_AREA_MAX) })).toEqual({});
    expect(
      zimmerRequestProblems({ ...valid, message: "א".repeat(ZIMMER_MESSAGE_MAX + 1) }).message,
    ).toBeTruthy();
    expect(zimmerRequestProblems({ ...valid, message: "א".repeat(ZIMMER_MESSAGE_MAX) })).toEqual(
      {},
    );
  });
});

describe("shekels", () => {
  it("formats whole shekels and leaves 'no price' empty", () => {
    expect(shekels(200)).toBe("200 ₪");
    expect(shekels(2000)).toBe(`${(2000).toLocaleString("he-IL")} ₪`);
    expect(shekels(null)).toBeNull();
    expect(shekels(undefined)).toBeNull();
  });
});

describe("parseSiteRequestSet", () => {
  const id = "3f1c2b9a-6d4e-4f8a-9b1c-2d3e4f5a6b7c";

  it("accepts handled / new, with or without a note", () => {
    expect(parseSiteRequestSet({ id, status: "handled", note: "  דיברנו, נפתח מחר " })).toEqual({
      id,
      status: "handled",
      note: "דיברנו, נפתח מחר",
    });
    expect(parseSiteRequestSet({ id, status: "new", note: "  " })).toEqual({
      id,
      status: "new",
      note: null,
    });
  });

  it("rejects an unknown status, a long note and a bad id", () => {
    expect(() => parseSiteRequestSet({ id, status: "done" })).toThrow(/מצב/);
    expect(() => parseSiteRequestSet({ id, status: "handled", note: "א".repeat(501) })).toThrow(
      /500/,
    );
    expect(() => parseSiteRequestSet({ id: "x", status: "handled" })).toThrow();
    expect(() => parseSiteRequestSet(null)).toThrow();
  });
});
