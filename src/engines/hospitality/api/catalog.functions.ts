// מתחמים ויחידות (Stage 2c.2). כל כתיבה רק דרך פונקציות המסד (מיגרציה 10) עם הטוקן
// של המשתמש — ההרשאה, מגבלת החבילה וכללי המבנה נאכפים שם. כאן: בדיקת הקלט (אותם
// כללים והודעות), ו"עודכן בינתיים" כתשובה ולא כשגיאה.
import { createServerFn } from "@tanstack/react-start";
import type {
  CatalogActionResult,
  CatalogSaveResult,
  CatalogView,
  SetupResult,
  UnitFields,
} from "../types/catalog";
import {
  parseCreateProperty,
  parseCreateUnit,
  parseReorder,
  parseSetActive,
  parseSetup,
  parseTarget,
  parseUpdateProperty,
  parseUpdateUnit,
  parseWholeProperty,
} from "../validation/catalog";
import { parseUnitSeoGet, parseUnitSeoSet } from "../validation/unit-seo";

type Saved = { id: string; revision: number };
export type UnitSeo = {
  id: string;
  seo_title: string | null;
  seo_description: string | null;
  revision: number;
};
type Rpc = <T>(fn: string, args: Record<string, unknown>) => Promise<T>;

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

/** כותרת ותיאור לגוגל של יחידה (שלב 2 של פרויקט SEO) — הערכים והגרסה */
export const hospitalityUnitSeo = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseUnitSeoGet(input))
  .handler(async ({ data }): Promise<UnitSeo> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<UnitSeo>("unit_seo_get", { _id: data.id });
  });

/** שמירה עם הגרסה שנטענה; ריק = ברירת המחדל של האתר. "עודכן בינתיים" — תשובה, לא שגיאה */
export const hospitalitySaveUnitSeo = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseUnitSeoSet(input))
  .handler(({ data }): Promise<CatalogSaveResult> =>
    saveWithRevision("unit_seo_set", {
      _id: data.id,
      _seo_title: data.title,
      _seo_description: data.description,
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

// ---------------------------------------------------------------- Stage 2c.3: פעולות

/**
 * פעולה עם בדיקת "עודכן בינתיים": קודם המצב הנוכחי מהמסד; אם מישהו אחר שינה בינתיים את
 * מה שהמשתמש ראה — לא נעשה דבר, ומוחזרים הנתונים העדכניים (לא שגיאה). ההרשאה (בעלים /
 * מנהל) וכללי המבנה — בפונקציות המסד עצמן.
 */
async function guardedAction(
  stale: (view: CatalogView) => string | null,
  act: (rpc: Rpc) => Promise<number | null>,
): Promise<CatalogActionResult> {
  const [{ manageRpc }, { HospitalityError }] = await Promise.all([
    import("../server/manage.server"),
    import("../server/rpc.server"),
  ]);
  const view = await manageRpc<CatalogView>("catalog_view", {});
  const message = stale(view);
  if (message) return { status: "conflict", message, view };
  try {
    return { status: "done", revision: await act(manageRpc) };
  } catch (error) {
    if (error instanceof HospitalityError && error.code === "HS409")
      return {
        status: "conflict",
        message: error.message,
        view: await manageRpc<CatalogView>("catalog_view", {}),
      };
    throw error;
  }
}

const model = () => import("../management/catalog/model");

/** הפעלה / השבתה של יחידה (בעלים ומנהלים) */
export const hospitalitySetUnitActive = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseSetActive(input))
  .handler(async ({ data }): Promise<CatalogActionResult> => {
    const { staleUnit } = await model();
    return guardedAction(
      (view) => staleUnit(view, data.id, data.revision),
      async (rpc) =>
        (await rpc<Saved>("unit_set_active", { _id: data.id, _active: data.active })).revision,
    );
  });

/** מחיקה לצמיתות של יחידה שלא הוזמנה / נחסמה (בעלים בלבד — נאכף במסד) */
export const hospitalityDeleteUnit = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseTarget(input, "היחידה"))
  .handler(async ({ data }): Promise<CatalogActionResult> => {
    const { staleUnit } = await model();
    return guardedAction(
      (view) => staleUnit(view, data.id, data.revision),
      async (rpc) => {
        await rpc<boolean>("unit_delete", { _id: data.id });
        return null;
      },
    );
  });

/** העברת מתחם לארכיון — היחידות שלו מושבתות (בעלים בלבד — נאכף במסד) */
export const hospitalityArchiveProperty = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseTarget(input, "המתחם"))
  .handler(async ({ data }): Promise<CatalogActionResult> => {
    const { staleProperty } = await model();
    return guardedAction(
      (view) => staleProperty(view, data.id, data.revision),
      async (rpc) => (await rpc<Saved>("property_archive", { _id: data.id })).revision,
    );
  });

/** מחיקה לצמיתות של מתחם שאף יחידה בו לא הוזמנה / נחסמה (בעלים בלבד — נאכף במסד) */
export const hospitalityDeleteProperty = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseTarget(input, "המתחם"))
  .handler(async ({ data }): Promise<CatalogActionResult> => {
    const { staleProperty } = await model();
    return guardedAction(
      (view) => staleProperty(view, data.id, data.revision),
      async (rpc) => {
        await rpc<boolean>("property_delete", { _id: data.id });
        return null;
      },
    );
  });

/** "השכרת המתחם כולו": הפעלה עם היחידות שנבחרו, או כיבוי (בעלים ומנהלים) */
export const hospitalitySetWholeProperty = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseWholeProperty(input))
  .handler(async ({ data }): Promise<CatalogActionResult> => {
    const { staleWhole } = await model();
    return guardedAction(
      (view) => staleWhole(view, data.propertyId, data.revision),
      async (rpc) =>
        (
          await rpc<{ id: string | null; revision: number | null }>("whole_property_set", {
            _property_id: data.propertyId,
            _enabled: data.enabled,
            _member_ids: data.memberIds,
          })
        ).revision,
    );
  });

/** סדר היחידות הפעילות של מתחם — בטרנזקציה אחת (בעלים ומנהלים) */
export const hospitalityReorderUnits = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseReorder(input))
  .handler(async ({ data }): Promise<CatalogActionResult> => {
    const { staleOrder } = await model();
    return guardedAction(
      (view) => staleOrder(view, data.propertyId, data.expected),
      async (rpc) => {
        await rpc<boolean>("catalog_reorder", { _kind: "units", _ids: data.ids });
        return null;
      },
    );
  });
