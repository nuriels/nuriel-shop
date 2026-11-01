#!/usr/bin/env node
// ============================================================
// נתוני הדגמה ל-Hospitality — תצוגה מקומית בלבד (P0)
//
// שלושה אתרי אירוח לדוגמה: מתחם צימרים, וילה ומלון בוטיק — עם בעלים,
// מנהלת קבלה (במלון), הגדרות עסק, מתחמים ויחידות.
//
// • רק מול ה-Supabase המקומי (e2e/.env.e2e). כתובת שאינה מקומית — עצירה.
// • דרך המסלולים האמיתיים: מנהל הפלטפורמה יוצר אתר (admin_create_site),
//   מדליק דגלים (platform_set_flag) וקובע חבילה (admin_set_subscription);
//   הבעלים — הגדרות (update_settings), מתחמים ויחידות (property_create,
//   unit_create, whole_property_set) וצוות (team_add_manager); כל קריאה עם
//   הטוקן של המשתמש ו-x-tenant-id של האתר, כמו מהאפליקציה.
//   החריג היחיד: שיוך הבעלים לאתר נעשה ישירות במסד (כמו בבדיקות) — המסך לזה
//   הוא חלק מ-P1 (לשונית Hospitality בפאנל הפלטפורמה).
// • חשבונות פיקטיביים בלבד (@demo.test); שום נתון אמיתי.
// • הרצה חוזרת: אתרי ההדגמה נמחקים ונוצרים מחדש (platform_delete_tenant).
//
// שימוש:  node scripts/preview/hospitality-demo.mjs
// ============================================================
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ACCOUNTS, DEMO_PASSWORD, SITES } from "./demo-data.mjs";
import { enrichZimmer } from "./demo-zimmer-details.mjs";
import { assertLocalTargets } from "./local-guard.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const ENV_FILE = `${ROOT}e2e/.env.e2e`;
if (!existsSync(ENV_FILE)) {
  console.error("חסר e2e/.env.e2e — קודם: bun run e2e:up (Supabase מקומי)");
  process.exit(1);
}
const env = Object.fromEntries(
  readFileSync(ENV_FILE, "utf8")
    .split("\n")
    .filter((line) => line.includes("="))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()]),
);
const API = env.SUPABASE_URL;
const ANON = env.SUPABASE_PUBLISHABLE_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
assertLocalTargets({ SUPABASE_URL: API, DB_URL: env.DB_URL });

// ------------------------------------------------------------
// כלים
// ------------------------------------------------------------
const q = (value) => `'${String(value).replace(/'/g, "''")}'`;
function sql(query) {
  return execFileSync(
    "psql",
    [env.DB_URL, "-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1", "-c", query],
    {
      encoding: "utf8",
    },
  ).trim();
}

async function http(method, path, { headers = {}, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

/** קריאה לפונקציה במסד דרך ה-API, עם הטוקן של המשתמש (ו-x-tenant-id של האתר) */
function rpc(fn, args, { token, schema = "hospitality", site } = {}) {
  return http("POST", `/rest/v1/rpc/${fn}`, {
    headers: {
      apikey: ANON,
      authorization: `Bearer ${token}`,
      "content-profile": schema,
      "accept-profile": schema,
      ...(site ? { "x-tenant-id": site } : {}),
    },
    body: args,
  });
}

/** חשבון עם סיסמת ההדגמה (נוצר, או שהסיסמה שלו מתאפסת) */
async function ensureUser(email) {
  const headers = { apikey: SERVICE, authorization: `Bearer ${SERVICE}` };
  const existing = sql(`SELECT id FROM auth.users WHERE lower(email) = ${q(email)}`);
  if (existing) {
    await http("PUT", `/auth/v1/admin/users/${existing}`, {
      headers,
      body: { password: DEMO_PASSWORD, email_confirm: true },
    });
    return existing;
  }
  const user = await http("POST", "/auth/v1/admin/users", {
    headers,
    body: { email, password: DEMO_PASSWORD, email_confirm: true },
  });
  return user.id;
}

async function signIn(email) {
  const session = await http("POST", "/auth/v1/token?grant_type=password", {
    headers: { apikey: ANON },
    body: { email, password: DEMO_PASSWORD },
  });
  return session.access_token;
}

// ------------------------------------------------------------
// הקמה
// ------------------------------------------------------------
export async function seedDemo({ log = console.log } = {}) {
  const ids = {};
  for (const email of Object.values(ACCOUNTS)) ids[email] = await ensureUser(email);

  // מנהל הפלטפורמה של ההדגמה (בסביבה המקומית בלבד)
  sql(
    `INSERT INTO public.platform_admins (user_id) VALUES (${q(ids[ACCOUNTS.admin])}) ON CONFLICT DO NOTHING`,
  );
  const admin = await signIn(ACCOUNTS.admin);

  // המנוע פתוח ברמת הפלטפורמה: המסד, ניהול האתרים, האתר הציבורי והזמנות מהאתר (Stage 4).
  // ברמת העסק — האתר וההזמנות נפתחים רק בעסק שמסומן website (צימרי הגליל).
  for (const key of [
    "hospitality_backend_enabled",
    "hospitality_management_enabled",
    "hospitality_frontend_enabled",
    "hospitality_booking_enabled",
  ]) {
    await rpc(
      "platform_set_flag",
      { _key: key, _enabled: true },
      { token: admin, schema: "public" },
    );
  }

  const created = [];
  for (const site of SITES) {
    const old = sql(`SELECT id FROM public.tenants WHERE slug = ${q(site.slug)}`);
    if (old) {
      await rpc(
        "platform_delete_tenant",
        { _tenant: old, _confirm_slug: site.slug },
        { token: admin, schema: "public" },
      );
    }
    const tenant = await rpc(
      "admin_create_site",
      { _slug: site.slug, _name: site.name, _owner_email: site.owner },
      { token: admin },
    );
    const siteId = tenant.id;

    // הבעלים (P1 יוסיף לזה מסך בפאנל הפלטפורמה)
    sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, is_protected)
         VALUES (${q(siteId)}, ${q(ids[site.owner])}, ${q(site.owner)},
                 ${q(`demo_${site.slug.replace(/-/g, "_")}_owner`)}, 'admin', true, true)`);

    const siteFlags = site.website
      ? ["hospitality_frontend_enabled", "hospitality_booking_enabled"]
      : [];
    for (const key of [
      "hospitality_backend_enabled",
      "hospitality_management_enabled",
      ...siteFlags,
    ]) {
      await rpc(
        "platform_set_flag",
        { _key: key, _enabled: true, _tenant_id: siteId },
        { token: admin, schema: "public" },
      );
    }
    const yearAhead = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
    await rpc(
      "admin_set_subscription",
      {
        _tenant_id: siteId,
        _plan: site.plan,
        _status: "active",
        _current_period_end: yearAhead,
        _note: "הדגמה מקומית",
      },
      { token: admin },
    );

    // מכאן — הבעלים, דרך הפונקציות של אזור הניהול
    const owner = await signIn(site.owner);
    const as = { token: owner, site: siteId };
    if (site.empty) {
      // ריק בכוונה: הבעלים מתחילים ממסך "מה אתם משכירים?"
      created.push({ ...site, id: siteId, units: 0 });
      log(`  ✓ ${site.name} (${site.slug}) — ריק, להתחלה מאפס`);
      continue;
    }
    const current = await rpc("settings_view", {}, as);
    await rpc(
      "update_settings",
      { _changes: site.settings, _expected_revision: current.revision },
      as,
    );

    const property = await rpc("property_create", { _data: site.property }, as);
    const unitIds = [];
    for (const unit of site.units) {
      const saved = await rpc(
        "unit_create",
        {
          _property_id: property.id,
          _data: { ...unit, kind: unit.unit_type === "room" ? "room" : "unit" },
        },
        as,
      );
      unitIds.push(saved.id);
    }
    if (site.wholeProperty) {
      await rpc(
        "whole_property_set",
        { _property_id: property.id, _enabled: true, _member_ids: unitIds },
        as,
      );
    }
    for (const type of site.roomTypes ?? []) {
      const saved = await rpc(
        "room_type_save",
        { _id: null, _property_id: property.id, _name: type.name, _description: type.description },
        as,
      );
      for (const room of type.rooms) {
        const unitId = unitIds[site.units.findIndex((u) => u.name === room)];
        if (unitId) await rpc("room_type_assign", { _unit_id: unitId, _category_id: saved.id }, as);
      }
      await rpc("room_type_apply", { _id: saved.id, _base_price: type.price }, as);
    }
    if (site.full) {
      await enrichZimmer({
        rpc,
        as,
        api: API,
        anon: ANON,
        propertyId: property.id,
        unitIdByName: Object.fromEntries(site.units.map((u, i) => [u.name, unitIds[i]])),
        log,
      });
    }
    if (site.manager) {
      ids[site.manager.email] ??= await ensureUser(site.manager.email);
      try {
        await rpc(
          "team_add_manager",
          { _email: site.manager.email, _display_name: site.manager.displayName },
          as,
        );
      } catch (error) {
        // אין מקום פנוי בחבילה — מנהל הפלטפורמה מוסיף מקום אחד, ואז שוב
        if (!/מקום|מגבלת/.test(String(error))) throw error;
        await rpc("admin_set_extra_managers", { _tenant_id: siteId, _extra: 1 }, { token: admin });
        await rpc(
          "team_add_manager",
          { _email: site.manager.email, _display_name: site.manager.displayName },
          as,
        );
      }
    }
    created.push({ ...site, id: siteId, units: site.units.length });
    log(
      `  ✓ ${site.name} (${site.slug}) — ${site.units.length} יחידות${site.wholeProperty ? " + כל המתחם" : ""}`,
    );
  }
  return created;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log("נתוני הדגמה ל-Hospitality (מקומי בלבד):");
  seedDemo()
    .then(() => {
      const base = "shop.localhost:3100";
      console.log(`
כתובות (בדפדפן; *.localhost מפנה למחשב שלך):
  פאנל הפלטפורמה:  http://platform.${base}/platform     (${ACCOUNTS.admin})
  מתחם צימרים:     http://demo-zimmer.${base}/manage    (${ACCOUNTS.zimmerOwner})
  האתר של המתחם:   http://demo-zimmer.${base}/          (אתר ציבורי + בקשות הזמנה)
  וילה:            http://demo-villa.${base}/manage     (${ACCOUNTS.villaOwner})
  מלון בוטיק:      http://demo-hotel.${base}/manage     (${ACCOUNTS.hotelOwner} / ${ACCOUNTS.hotelManager})
  עסק חדש (ריק):   http://demo-new.${base}/manage       (${ACCOUNTS.newOwner})
  חנות (Ecommerce): http://kobi.${base}/
סיסמה לכל חשבונות ההדגמה: ${DEMO_PASSWORD}`);
    })
    .catch((error) => {
      console.error(
        `נתוני ההדגמה נכשלו: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(1);
    });
}
