// שלב E1: פרטי העסק בהקמת חנות מהשער — אותם כללים כמו portal_create_store_business במסד
import { describe, expect, it } from "vitest";
import {
  businessDetailsProblems,
  cleanBusinessDetails,
  PORTAL_BUSINESS_TYPES,
  type PortalBusinessDetails,
} from "@/lib/portal";

const valid: PortalBusinessDetails = {
  legal_name: "דנה כהן",
  business_type: "authorized",
  tax_id: "034567891",
  prices_include_vat: true,
  phone: "0501234567",
  address: "",
};

describe("cleanBusinessDetails", () => {
  it("normalizes like the database: spaces, tax-id dashes, phone symbols", () => {
    expect(
      cleanBusinessDetails({
        legal_name: "  דנה   כהן ",
        business_type: "company",
        tax_id: "51-400000 1",
        prices_include_vat: false,
        phone: " +972 (52) 123-4567 ",
        address: " הרצל  1 ",
      }),
    ).toEqual({
      legal_name: "דנה כהן",
      business_type: "company",
      tax_id: "514000001",
      prices_include_vat: false,
      phone: "+972521234567",
      address: "הרצל 1",
    });
  });

  it("unknown business type → empty; VAT-included defaults to true", () => {
    const cleaned = cleanBusinessDetails({ business_type: "other" });
    expect(cleaned.business_type).toBe("");
    expect(cleaned.prices_include_vat).toBe(true);
  });

  it("garbage input → empty details (no throw)", () => {
    expect(cleanBusinessDetails(null).legal_name).toBe("");
    expect(cleanBusinessDetails("x").tax_id).toBe("");
  });
});

describe("businessDetailsProblems", () => {
  it("valid details → no problems", () => {
    expect(businessDetailsProblems(valid)).toEqual({});
  });

  it("required: legal name, business type, tax id, customer-service phone", () => {
    const problems = businessDetailsProblems({
      ...valid,
      legal_name: "א",
      business_type: "",
      tax_id: "12ab",
      phone: "123",
    });
    expect(Object.keys(problems).sort()).toEqual(
      ["business_type", "legal_name", "phone", "tax_id"].sort(),
    );
  });

  it("address is optional but limited to 200 characters", () => {
    expect(businessDetailsProblems({ ...valid, address: "" })).toEqual({});
    expect(businessDetailsProblems({ ...valid, address: "א".repeat(201) }).address).toBeTruthy();
  });

  it("tax id: 5-12 digits; phone: 9-15 digits with optional +", () => {
    expect(businessDetailsProblems({ ...valid, tax_id: "1234" }).tax_id).toBeTruthy();
    expect(businessDetailsProblems({ ...valid, tax_id: "1234567890123" }).tax_id).toBeTruthy();
    expect(businessDetailsProblems({ ...valid, tax_id: "12345" }).tax_id).toBeUndefined();
    expect(businessDetailsProblems({ ...valid, phone: "+972521234567" }).phone).toBeUndefined();
    expect(businessDetailsProblems({ ...valid, phone: "05+01234567" }).phone).toBeTruthy();
  });
});

describe("PORTAL_BUSINESS_TYPES", () => {
  it("offers authorized dealer, exempt dealer and company", () => {
    expect(PORTAL_BUSINESS_TYPES.map((t) => t.value)).toEqual(["authorized", "exempt", "company"]);
  });
});
