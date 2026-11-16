// Google Tag Manager (מיגרציה 192) — פונקציות השרת למסך של בעל העסק (שני המנועים). המזהה נבדק כאן
// (normalizeGtmId) ושוב במסד; הטעינה באתר עצמו עוברת דרך ה-loader של כל מנוע (siteTagManager).
import { createServerFn } from "@tanstack/react-start";
import { GtmInputError, normalizeGa4Id, normalizeGtmId, type MyTagManager } from "./gtm";

const server = () => import("./gtm.server");

export const getMyTagManager = createServerFn({ method: "POST" }).handler(
  async (): Promise<MyTagManager> => (await server()).myTagManager(),
);

export const saveMyTagManagerFn = createServerFn({ method: "POST" })
  .inputValidator((input: { containerId?: unknown; enabled?: unknown }) => {
    const containerId = normalizeGtmId(input?.containerId);
    const enabled = input?.enabled === true;
    if (enabled && !containerId) throw new GtmInputError("כדי להפעיל צריך מזהה Container");
    return { containerId, enabled };
  })
  .handler(async ({ data }): Promise<MyTagManager> =>
    (await server()).saveMyTagManager(data.containerId, data.enabled),
  );

/** מיגרציה 199: מזהה Google Analytics 4 בהגדרות העסק — נבדק כאן (normalizeGa4Id) ושוב במסד */
export const saveMyGa4Fn = createServerFn({ method: "POST" })
  .inputValidator((input: { measurementId?: unknown }) => ({
    measurementId: normalizeGa4Id(input?.measurementId),
  }))
  .handler(async ({ data }): Promise<MyTagManager> =>
    (await server()).saveMyGa4(data.measurementId),
  );
