// פרטי היחידה והמתחם (Stage 2d): קטלוג המתקנים של העסק ומידע פרטי להגעה. כל כתיבה רק
// דרך פונקציות המסד (מיגרציה 11) עם הטוקן של המשתמש — ההרשאה, הבידוד והיומן נאכפים שם.
// המידע הפרטי להגעה לא חלק מ-catalog_view: נקרא ונשמר כאן בלבד, ולא נשמר בשום לוג.
import { createServerFn } from "@tanstack/react-start";
import type { ArrivalInfoView, ArrivalSaveResult } from "../types/catalog";
import { uuid } from "../validation/input";
import {
  parseAmenityCreate,
  parseAmenityUpdate,
  parseArrivalSave,
  parsePresetCode,
} from "../validation/details";

type Created = { id: string; created: boolean };

export const hospitalityAddPresetAmenity = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parsePresetCode(input))
  .handler(async ({ data }): Promise<Created> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<Created>("amenity_add_preset", { _code: data.code });
  });

export const hospitalityCreateAmenity = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseAmenityCreate(input))
  .handler(async ({ data }): Promise<Created> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<Created>("amenity_create", { _data: data });
  });

export const hospitalityUpdateAmenity = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseAmenityUpdate(input))
  .handler(async ({ data }): Promise<{ id: string }> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<{ id: string }>("amenity_update", { _id: data.id, _data: data.data });
  });

export const hospitalityDeleteAmenity = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => ({ id: uuid((input ?? {})["id"], "המתקן") }))
  .handler(async ({ data }): Promise<{ units: number; properties: number }> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<{ units: number; properties: number }>("amenity_delete", { _id: data.id });
  });

export const hospitalityArrivalInfo = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => ({
    propertyId: uuid((input ?? {})["propertyId"], "המתחם"),
  }))
  .handler(async ({ data }): Promise<ArrivalInfoView> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<ArrivalInfoView>("arrival_info_view", { _property_id: data.propertyId });
  });

/** שמירה עם הגרסה שנטענה; מישהו אחר שמר בינתיים → המידע העדכני (לא שגיאה) */
export const hospitalitySaveArrivalInfo = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseArrivalSave(input))
  .handler(async ({ data }): Promise<ArrivalSaveResult> => {
    const [{ manageRpc }, { HospitalityError }] = await Promise.all([
      import("../server/manage.server"),
      import("../server/rpc.server"),
    ]);
    try {
      const saved = await manageRpc<{ revision: number | null }>("arrival_info_set", {
        _property_id: data.propertyId,
        _unit_id: data.unitId,
        _values: data.values,
        _expected_revision: data.revision,
      });
      return { status: "saved", revision: saved.revision };
    } catch (error) {
      if (error instanceof HospitalityError && error.code === "HS409") {
        const view = await manageRpc<ArrivalInfoView>("arrival_info_view", {
          _property_id: data.propertyId,
        });
        return { status: "conflict", message: error.message, view };
      }
      throw error;
    }
  });
