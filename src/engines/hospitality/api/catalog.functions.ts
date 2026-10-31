// מתחמים ויחידות (Stage 2c.2). כל כתיבה רק דרך פונקציות המסד (מיגרציה 10) עם הטוקן
// של המשתמש — ההרשאה, מגבלת החבילה וכללי המבנה נאכפים שם. כאן: בדיקת הקלט (אותם
// כללים והודעות), ו"עודכן בינתיים" כתשובה ולא כשגיאה.
import { createServerFn } from "@tanstack/react-start";
import type { CatalogSaveResult, CatalogView, SetupResult, UnitFields } from "../types/catalog";
import {
  parseCreateProperty,
  parseCreateUnit,
  parseSetup,
  parseUpdateProperty,
  parseUpdateUnit,
} from "../validation/catalog";

type Saved = { id: string; revision: number };

/** יחידה מסוג "חדר" נשמרת כחדר; השאר — יחידה. נקבע ביצירה בלבד (לא משנה התנהגות) */
const kindFor = (unitType: UnitFields["unit_type"] | undefined) =>
  unitType === "room" ? "room" : "unit";

export const hospitalityCatalog = createServerFn({ method: "GET" }).handler(
  async (): Promise<CatalogView> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<CatalogView>("catalog_view", {});
  },
);

/** שמירה עם הגרסה שנטענה; מישהו אחר שמר בינתיים → הנתונים העדכניים (לא שגיאה) */
async function saveWithRevision(
  fn: string,
  args: Record<string, unknown>,
): Promise<CatalogSaveResult> {
  const [{ manageRpc }, { HospitalityError }] = await Promise.all([
    import("../server/manage.server"),
    import("../server/rpc.server"),
  ]);
  try {
    const saved = await manageRpc<Saved>(fn, args);
    return { status: "saved", id: saved.id, revision: saved.revision };
  } catch (error) {
    if (error instanceof HospitalityError && error.code === "HS409") {
      const view = await manageRpc<CatalogView>("catalog_view", {});
      return { status: "conflict", message: error.message, view };
    }
    throw error;
  }
}

export const hospitalityCreateProperty = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseCreateProperty(input))
  .handler(async ({ data }): Promise<Saved> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<Saved>("property_create", { _data: data.data });
  });

export const hospitalityUpdateProperty = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseUpdateProperty(input))
  .handler(({ data }): Promise<CatalogSaveResult> =>
    saveWithRevision("property_update", {
      _id: data.id,
      _changes: data.changes,
      _expected_revision: data.revision,
    }),
  );

export const hospitalityCreateUnit = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseCreateUnit(input))
  .handler(async ({ data }): Promise<Saved> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<Saved>("unit_create", {
      _property_id: data.propertyId,
      _data: { ...data.data, kind: kindFor(data.data.unit_type) },
    });
  });

export const hospitalityUpdateUnit = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseUpdateUnit(input))
  .handler(({ data }): Promise<CatalogSaveResult> =>
    saveWithRevision("unit_update", {
      _id: data.id,
      _changes: data.changes,
      _expected_revision: data.revision,
    }),
  );

/**
 * ההקמה הראשונה ("מה אתם משכירים?"): המקום עצמו ואחריו היחידות, אחת אחרי השנייה.
 * אם יחידה נדחית (למשל מגבלת החבילה) — עוצרים ומחזירים כמה נוצרו ואת ההסבר מהמסד;
 * מה שכבר נוצר נשאר, ואפשר להמשיך מהרשימה.
 */
export const hospitalitySetupPlace = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseSetup(input))
  .handler(async ({ data }): Promise<SetupResult> => {
    const [{ manageRpc }, { HospitalityError }, { setupUnitType }] = await Promise.all([
      import("../server/manage.server"),
      import("../server/rpc.server"),
      import("../management/catalog/labels"),
    ]);
    const property = await manageRpc<Saved>("property_create", {
      _data: { name: data.name, property_type: data.propertyType, status: "active" },
    });
    const unitType = setupUnitType(data.propertyType);
    let created = 0;
    for (const unit of data.units) {
      try {
        await manageRpc<Saved>("unit_create", {
          _property_id: property.id,
          _data: {
            name: unit.name,
            unit_type: unitType,
            kind: kindFor(unitType),
            capacity: unit.capacity,
            base_occupancy: Math.min(2, unit.capacity),
            bedrooms: unit.bedrooms,
          },
        });
        created += 1;
      } catch (error) {
        if (error instanceof HospitalityError)
          return {
            propertyId: property.id,
            created,
            requested: data.units.length,
            message: error.message,
          };
        throw error;
      }
    }
    return { propertyId: property.id, created, requested: data.units.length, message: null };
  });
