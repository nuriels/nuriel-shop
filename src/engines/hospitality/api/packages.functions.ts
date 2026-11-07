// שלב א' 7: חבילות אירוח וחבילות מיוחדות — לצוות עם הרשאת catalog (מיגרציה 59): הרשימה (גם
// המוסתרות), יצירה / עדכון, הצגה / הסתרה באתר, מחיקה (רק חבילה בלי הזמנות). המסד בודק את ההרשאה,
// את היחידה, את התמונות (רק מהגלריות של העסק) ואת הגרסה; כל שינוי נרשם ביומן הפעולות.
import { createServerFn } from "@tanstack/react-start";
import type { PackagesView, StaffPackage } from "../types/packages";
import { parsePackageActive, parsePackageId, parsePackageSave } from "../validation/packages";

export const hospitalityPackages = createServerFn({ method: "GET" }).handler(
  async (): Promise<PackagesView> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<PackagesView>("packages_view", {});
  },
);

export const hospitalityPackageSave = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parsePackageSave(input))
  .handler(async ({ data }): Promise<StaffPackage> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<StaffPackage>("package_save", {
      _id: data.id,
      _unit_id: data.unitId,
      _kind: data.kind,
      _name: data.name,
      _nights: data.nights,
      _price: data.price,
      _max_guests: data.maxGuests,
      _description: data.description,
      _terms: data.terms,
      _stay_from: data.stayFrom,
      _stay_to: data.stayTo,
      _policy_id: data.policyId,
      _media_ids: data.mediaIds,
      _expected_revision: data.expectedRevision,
    });
  });

export const hospitalityPackageSetActive = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parsePackageActive(input))
  .handler(async ({ data }): Promise<StaffPackage> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<StaffPackage>("package_set_active", { _id: data.id, _active: data.active });
  });

export const hospitalityPackageDelete = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parsePackageId(input))
  .handler(async ({ data }): Promise<boolean> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<boolean>("package_delete", { _id: data.id });
  });
