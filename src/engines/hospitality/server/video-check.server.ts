// בדיקה ברקע של סרטונים שהועלו לפני מיגרציה 62 (או שהרישום שלהם נכשל): השרת מוריד את הקובץ
// מהדלי במפתח השירות, קורא את האורך וה-codec מהקובץ עצמו (video-info.ts) ורושם במסד. קובץ שלא
// נמצא / גדול מהמותר / לא נקרא — נרשם "נבדק, אורך לא ידוע" (לא חוזרים עליו בכל סבב, ולא מוצג בפתיח).
// תקלת רשת — לא נרשם כלום, ומנסים שוב בסבב הבא. נקרא מתהליך הרקע (outbox/worker.server.ts).
import { serviceHeaders, supabaseUrl } from "@/platform/supabase/env.server";
import { HOSPITALITY_SCHEMA } from "../config";
import { videoInfo } from "../media/video-info";
import { MEDIA_BUCKET, VIDEO_UPLOAD_MAX_BYTES } from "./media.server";

interface PendingVideo {
  tenant_id: string;
  id: string;
  storage_path: string;
  size_bytes: number | null;
}

const PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(mp4|mov|webm)$/i;

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${supabaseUrl()}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      ...serviceHeaders(),
      "Content-Profile": HOSPITALITY_SCHEMA,
      "Accept-Profile": HOSPITALITY_SCHEMA,
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`${fn}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

/** הקובץ מהדלי; null — לא קיים / גדול מהמותר (אז "לא נקרא"). תקלת רשת — חריגה (ננסה שוב) */
async function download(path: string): Promise<Uint8Array | null> {
  const res = await fetch(`${supabaseUrl()}/storage/v1/object/${MEDIA_BUCKET}/${path}`, {
    headers: serviceHeaders(),
  });
  if (res.status === 400 || res.status === 404) return null;
  if (!res.ok) throw new Error(`storage ${res.status}`);
  const length = Number(res.headers.get("content-length") ?? "0");
  if (length > VIDEO_UPLOAD_MAX_BYTES + 1024) {
    await res.body?.cancel();
    return null;
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  return bytes.length > VIDEO_UPLOAD_MAX_BYTES + 1024 ? null : bytes;
}

/** סבב אחד: עד כמה סרטונים, אחד אחרי השני (בלי להעמיס זיכרון). מחזיר כמה נבדקו */
export async function checkPendingVideos(limit = 3): Promise<number> {
  const pending = await rpc<PendingVideo[]>("media_videos_to_check", { _limit: limit });
  let done = 0;
  for (const v of pending ?? []) {
    const bytes = PATH.test(v.storage_path) ? await download(v.storage_path) : null;
    const info = bytes ? videoInfo(bytes) : null;
    await rpc("media_video_verified", {
      _tenant: v.tenant_id,
      _id: v.id,
      _seconds: info?.seconds ?? null,
      _codec: info?.codec ?? null,
    });
    done++;
  }
  return done;
}
