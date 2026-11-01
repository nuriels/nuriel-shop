// האתר הציבורי של העסק (Stage 4) — קריאה בלבד, לכל גולש (בלי חשבון). העסק לפי הכתובת
// (x-tenant-id → request_tenant במסד), ופתוח רק כשהאתר של העסק פתוח (hospitality_frontend_enabled).
// המחיר הסופי והזמינות לתאריכים — רק מהשרת (quote / request_booking); כאן "החל מ-" ולילות תפוסים.
import { createServerFn } from "@tanstack/react-start";
import type {
  PublicAvailability,
  PublicMedia,
  PublicSite,
  RawPublicMedia,
  RawPublicSite,
} from "../types/website";
import { isoDate, uuid, InputError } from "../validation/input";

const MAX_RANGE_DAYS = 120;

function mediaUrls(publicUrl: (p: string | null | undefined) => string | null) {
  return ({ path, variants, ...rest }: RawPublicMedia): PublicMedia => {
    const v = variants ?? {};
    return {
      ...rest,
      url: publicUrl(path),
      thumb_url: publicUrl(v["480"] ?? v["thumb"] ?? (rest.kind === "image" ? path : null)),
      srcset:
        rest.kind === "image" && v["480"] && v["960"]
          ? `${publicUrl(v["480"])} 480w, ${publicUrl(v["960"])} 960w, ${publicUrl(path)} ${rest.width ?? 1600}w`
          : null,
    };
  };
}

export const hospitalityPublicSite = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicSite> => {
    const [{ callRpc }, { publicUrl }] = await Promise.all([
      import("../server/rpc.server"),
      import("../server/media.server"),
    ]);
    const raw = await callRpc<RawPublicSite>("public_site", {});
    const urls = mediaUrls(publicUrl);
    return {
      ...raw,
      gallery: raw.gallery.map(urls),
      properties: raw.properties.map((p) => ({ ...p, media: p.media.map(urls) })),
      units: raw.units.map((u) => ({
        ...u,
        base_price: Number(u.base_price),
        media: u.media.map(urls),
      })),
    };
  },
);

export const hospitalityPublicAvailability = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => {
    const unitId = uuid(input?.["unitId"], "היחידה");
    const from = isoDate(input?.["from"]);
    const to = isoDate(input?.["to"]);
    const days = (Date.parse(to) - Date.parse(from)) / 86400000;
    if (days <= 0 || days > MAX_RANGE_DAYS) throw new InputError("טווח התאריכים לא תקין");
    return { unitId, from, to };
  })
  .handler(async ({ data }): Promise<PublicAvailability> => {
    const { callRpc } = await import("../server/rpc.server");
    return callRpc<PublicAvailability>("public_availability", {
      _unit_id: data.unitId,
      _from: data.from,
      _to: data.to,
    });
  });
