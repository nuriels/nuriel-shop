// Google Tag Manager (מיגרציה 192) — פונקציות השרת למסך של בעל העסק (שני המנועים). המזהה נבדק כאן
// (normalizeGtmId) ושוב במסד; הטעינה באתר עצמו עוברת דרך ה-loader של כל מנוע (siteTagManager).
import { createServerFn } from "@tanstack/react-start";
import { GtmInputError, normalizeGtmId, type MyTagManager } from "./gtm";

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
