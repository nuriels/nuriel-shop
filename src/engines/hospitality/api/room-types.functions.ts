// סוגי חדרים (RT, מלונות) — לצוות עם הרשאת catalog: הסוגים וחדריהם, יצירה / עדכון, מחיקה (רק בלי
// חדרים), שיוך חדר לסוג, והחלת מחיר / תפוסה / מינימום לילות על כל החדרים של הסוג.
// הזמנה תמיד נשארת על חדר פיזי; העברה לחדר אחר — "שינוי הזמנה" הקיים.
import { createServerFn } from "@tanstack/react-start";
import type { PublicRoomType } from "../types/website";
import { InputError, intInRange, optionalText, text, uuid } from "../validation/input";

export const hospitalityRoomTypes = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicRoomType[]> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<PublicRoomType[]>("room_types_view", {});
  },
);

export const hospitalityRoomTypeSave = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => {
    const id = input?.["id"] ? uuid(input["id"], "סוג החדר") : null;
    const rev = input?.["expectedRevision"];
    return {
      id,
      propertyId: uuid(input?.["propertyId"], "המתחם"),
      name: text(input?.["name"], 80, "שם הסוג", { min: 2 }),
      description: optionalText(input?.["description"], 4000, "התיאור"),
      expectedRevision: typeof rev === "number" && Number.isInteger(rev) ? rev : null,
    };
  })
  .handler(async ({ data }): Promise<{ id: string; slug: string; revision: number }> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<{ id: string; slug: string; revision: number }>("room_type_save", {
      _id: data.id,
      _property_id: data.propertyId,
      _name: data.name,
      _description: data.description,
      _expected_revision: data.expectedRevision,
    });
  });

export const hospitalityRoomTypeDelete = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => ({ id: uuid(input?.["id"], "סוג החדר") }))
  .handler(async ({ data }): Promise<boolean> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<boolean>("room_type_delete", { _id: data.id });
  });

export const hospitalityRoomTypeAssign = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => ({
    unitId: uuid(input?.["unitId"], "החדר"),
    categoryId: input?.["categoryId"] ? uuid(input["categoryId"], "סוג החדר") : null,
  }))
  .handler(async ({ data }): Promise<{ id: string; category_id: string | null }> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<{ id: string; category_id: string | null }>("room_type_assign", {
      _unit_id: data.unitId,
      _category_id: data.categoryId,
    });
  });

export const hospitalityRoomTypeApply = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => {
    const opt = (key: string, min: number, max: number, label: string) =>
      input?.[key] === undefined || input[key] === null || input[key] === ""
        ? null
        : intInRange(input[key], min, max, label, min);
    const price = input?.["basePrice"];
    let basePrice: number | null = null;
    if (price !== undefined && price !== null && price !== "") {
      basePrice = Number(price);
      if (!Number.isFinite(basePrice) || basePrice < 0 || basePrice > 1_000_000)
        throw new InputError("המחיר לא תקין");
    }
    return {
      id: uuid(input?.["id"], "סוג החדר"),
      basePrice,
      minNights: opt("minNights", 1, 60, "מינימום לילות"),
      capacity: opt("capacity", 1, 100, "מספר האורחים"),
      maxAdults: opt("maxAdults", 1, 100, "מספר המבוגרים"),
      maxChildren: opt("maxChildren", 0, 100, "מספר הילדים"),
    };
  })
  .handler(async ({ data }): Promise<{ rooms: number }> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<{ rooms: number }>("room_type_apply", {
      _id: data.id,
      _base_price: data.basePrice,
      _min_nights: data.minNights,
      _capacity: data.capacity,
      _base_occupancy: data.capacity,
      _max_adults: data.maxAdults,
      _max_children: data.maxChildren,
    });
  });
