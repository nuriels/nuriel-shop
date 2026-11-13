import { expect, test, type APIRequestContext } from "@playwright/test";
import { hostGet, hostOf, PORT, STORE_A, STORE_B, supabaseEnv, USERS } from "./helpers";
import {
  accessToken,
  asPlatform,
  callServerFn,
  ensureUser,
  expectAccessible,
  loadSession,
  passwordSession,
  sql,
  type Account,
  type SavedSession,
} from "./hospitality-helpers";

// לוח הבקרה (F3): ברכה לפי השעה אצל העסק ושם המשתמש — "ערב טוב, דנה"
const DASHBOARD_GREETING = /^(בוקר טוב|צהריים טובים|ערב טוב|לילה טוב), /;

// Hospitality Stage 2b.4 — בדיקות אינטגרציה של כל אזור הניהול (2a–2b.3) יחד, על השרת הבנוי:
//   • טבלת הרשאות מלאה: כל פונקציית שרת של הניהול × כל סוג חשבון (אנונימי, לקוח חנות, בעל חנות,
//     בעלים של אתר אירוח אחר, מנהל פלטפורמה, מנהל, חשבון משותף חנות + אירוח, בעלים) — ובין אתרים;
//   • PostgREST ישירות (סכמת hospitality): קריאה / כתיבה / RPC לפי חשבון ולפי x-tenant-id מזויף;
//   • כל המסכים במחשב ובטלפון: בעלים, מנהל, מסך כניסה — RTL, נגישות, בלי גלילה לצד;
//   • חשבון משותף: בעלים של חנות Ecommerce ומנהל באתר אירוח — כל צד רואה רק את שלו, והחנות לא משתנה.

test.describe.configure({ mode: "serial" });

const OWNER_A = { email: "h2b4.owner.a@e2e.test", password: "H2b4-OwnerA-Pass-1!" };
const MANAGER_A = { email: "h2b4.manager.a@e2e.test", password: "H2b4-ManagerA-Pass-1!" };
const OWNER_B = { email: "h2b4.owner.b@e2e.test", password: "H2b4-OwnerB-Pass-1!" };
const EXTRA = { email: "h2b4.extra@e2e.test", password: "H2b4-Extra-Pass-1!" };
const SHARED = USERS.ownerB; // the owner of the Ecommerce store "store-b"

const FILES = {
  management: "src/engines/hospitality/api/management.functions.ts",
  settings: "src/engines/hospitality/api/settings.functions.ts",
  team: "src/engines/hospitality/api/team.functions.ts",
  owner: "src/engines/hospitality/server/owner.functions.ts",
  catalog: "src/engines/hospitality/api/catalog.functions.ts",
} as const;

let SLUG_A = "h2b-int-a";
let SLUG_B = "h2b-int-b";
const url = (slug: string, path = "") => `http://${hostOf(slug)}:${PORT}${path}`;
let siteA = "";
let siteB = "";
let storeHash = "";

const storeDataHash = () =>
  sql(`SELECT md5(concat_ws('|',
         (SELECT string_agg(ur::text, ',' ORDER BY ur.tenant_id, ur.user_id) FROM public.user_roles ur
            JOIN public.tenants t ON t.id = ur.tenant_id WHERE t.site_type = 'ecommerce'),
         (SELECT string_agg(s::text, ',' ORDER BY s::text) FROM public.site_settings s
            JOIN public.tenants t ON t.id = s.tenant_id WHERE t.site_type = 'ecommerce')))`);

function cleanup() {
  for (const slug of [SLUG_A, SLUG_B]) {
    const id = sql(`SELECT id FROM public.tenants WHERE slug = '${slug}'`);
    if (id) asPlatform(`SELECT public.platform_delete_tenant('${id}', '${slug}')`);
  }
}

function addStaff(site: string, email: string, username: string) {
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
       SELECT '${site}', id, email, '${username}', 'admin', true FROM auth.users WHERE email = '${email}'`);
}

/** תוצאה של קריאה לפונקציית שרת: "404", "refused" (שגיאה מסודרת עם הודעה), או "ok" */
async function outcome(res: Awaited<ReturnType<typeof callServerFn>>): Promise<string> {
  if (res.status() === 404) return "404";
  const text = await res.text();
  expect(res.status(), text).toBe(200);
  if (text.includes("$TSR/Error")) return "refused";
  // management context: the answer itself says who you are here
  const state = /"k":\["state"[^\]]*\],"v":\[\{"t":1,"s":"(\w+)"/.exec(text)?.[1];
  if (state === "ok") return `ok:${/"role".*?"s":"(owner|manager)"/.exec(text)?.[1]}`;
  return state ?? "ok";
}

const fn = (
  request: APIRequestContext,
  slug: string,
  file: keyof typeof FILES,
  name: string,
  token: string | undefined,
  opts: { method?: "GET" | "POST"; data?: unknown } = {},
) =>
  callServerFn(request, {
    host: hostOf(slug),
    file: FILES[file],
    name,
    method: opts.method ?? "POST",
    data: opts.data,
    token,
  });

const revisionOf = (site: string) =>
  Number(sql(`SELECT revision FROM hospitality.settings WHERE tenant_id = '${site}'`));
const unitRev = (id: string) =>
  Number(sql(`SELECT revision FROM hospitality.units WHERE id = '${id}'`));
const propertyRev = (id: string) =>
  Number(sql(`SELECT revision FROM hospitality.properties WHERE id = '${id}'`));
const wholeRev = (property: string) => {
  const r = sql(`SELECT revision FROM hospitality.units
                  WHERE property_id = '${property}' AND kind = 'whole_property'`);
  return r === "" ? null : Number(r);
};
const activeIdsOf = (property: string) =>
  sql(`SELECT string_agg(id::text, ',' ORDER BY sort_order, created_at) FROM hospitality.units
        WHERE property_id = '${property}' AND kind <> 'whole_property' AND is_active`).split(",");

test.beforeAll(async ({ request }, testInfo) => {
  const mobile = testInfo.project.name === "mobile";
  SLUG_A = mobile ? "h2b-int-a-m" : "h2b-int-a";
  SLUG_B = mobile ? "h2b-int-b-m" : "h2b-int-b";
  cleanup();
  storeHash = storeDataHash();
  for (const u of [OWNER_A, MANAGER_A, OWNER_B, EXTRA]) await ensureUser(request, u);
  asPlatform(`SELECT hospitality.admin_create_site('${SLUG_A}', 'צימרים בגליל')`);
  asPlatform(`SELECT hospitality.admin_create_site('${SLUG_B}', 'בקתות בגולן')`);
  siteA = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG_A}'`);
  siteB = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG_B}'`);
  const n = SLUG_A.length;
  addStaff(siteA, OWNER_A.email, `h2b4_owner_a_${n}`);
  addStaff(siteA, MANAGER_A.email, `h2b4_manager_a_${n}`);
  addStaff(siteB, OWNER_B.email, `h2b4_owner_b_${n}`);
  // two seats in use on site A (trial: 3) + the shared account below + one temporary addition
  asPlatform(`SELECT hospitality.admin_set_extra_managers('${siteA}', 2)`);
  sql(`UPDATE public.platform_feature_flags SET enabled = true
        WHERE key IN ('hospitality_backend_enabled', 'hospitality_management_enabled')`);
  sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES
       ('${siteA}', 'hospitality_backend_enabled', true), ('${siteA}', 'hospitality_management_enabled', true),
       ('${siteB}', 'hospitality_backend_enabled', true), ('${siteB}', 'hospitality_management_enabled', true)`);
  for (const slug of [SLUG_A, SLUG_B]) {
    await expect
      .poll(async () => (await hostGet(request, hostOf(slug), "/manage")).status(), {
        timeout: 20_000,
      })
      .toBe(200);
  }
});

test.afterAll(() => {
  cleanup();
  sql(`UPDATE public.platform_feature_flags SET enabled = false WHERE key LIKE 'hospitality%'`);
});

test("shared account: an Ecommerce store owner becomes a manager here through the team function", async ({
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "API flow once");
  const storeRow = () =>
    sql(
      `SELECT ur::text FROM public.user_roles ur WHERE tenant_id = '${STORE_B.id}' AND user_id = '${SHARED.id}'`,
    );
  const before = storeRow();
  const res = await fn(
    request,
    SLUG_A,
    "team",
    "hospitalityAddManager",
    await accessToken(request, OWNER_A),
    { data: { email: SHARED.email, displayName: "חשבון משותף" } },
  );
  expect(await res.text()).toContain('"added"');
  expect(storeRow()).toBe(before);
});

test("permission matrix: every management function × every kind of account", async ({
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "API checks once");
  const callers: Record<string, string | undefined> = {
    anonymous: undefined,
    storeCustomer: await accessToken(request, USERS.customerA),
    storeOwner: await accessToken(request, USERS.ownerA),
    otherSiteOwner: await accessToken(request, OWNER_B),
    platformAdmin: await accessToken(request, USERS.platform),
    manager: await accessToken(request, MANAGER_A),
    sharedManager: await accessToken(request, SHARED as Account),
    owner: await accessToken(request, OWNER_A),
  };
  const R = "refused";
  // platform admins act as the owner on every site (the existing platform rule, store_staff_role)
  const expected: Record<string, Record<string, string>> = {
    context: {
      anonymous: "signed_out",
      storeCustomer: "forbidden",
      storeOwner: "forbidden",
      otherSiteOwner: "forbidden",
      platformAdmin: "ok:owner",
      manager: "ok:manager",
      sharedManager: "ok:manager",
      owner: "ok:owner",
    },
    settingsView: {},
    settingsSaveBusiness: {},
    settingsSaveOwnerField: {},
    team: {},
    activity: {},
    entitlements: {},
    catalogView: {},
    catalogCreateProperty: {},
    catalogSetActive: {},
    catalogReorder: {},
    catalogWholeProperty: {},
    catalogDeleteUnit: {},
    catalogArchive: {},
    catalogDeleteProperty: {},
    addManager: {},
    removeManager: {},
  };
  const staff = ["platformAdmin", "manager", "sharedManager", "owner"];
  const owners = ["platformAdmin", "owner"];
  for (const who of Object.keys(callers)) {
    const may = (list: string[]) => (list.includes(who) ? "ok" : R);
    expected["settingsView"]![who] = may(staff);
    expected["settingsSaveBusiness"]![who] = may(staff);
    expected["settingsSaveOwnerField"]![who] = may(owners);
    expected["team"]![who] = may(owners);
    expected["activity"]![who] = may(owners);
    expected["entitlements"]![who] = may(staff);
    // properties and units (2c.2): owner and managers alike
    expected["catalogView"]![who] = may(staff);
    expected["catalogCreateProperty"]![who] = may(staff);
    // 2c.3: activation, order and "the whole property" — owner and managers; archive and
    // permanent delete — owners only (the platform admin acts as the owner)
    expected["catalogSetActive"]![who] = may(staff);
    expected["catalogReorder"]![who] = may(staff);
    expected["catalogWholeProperty"]![who] = may(staff);
    expected["catalogDeleteUnit"]![who] = may(owners);
    expected["catalogArchive"]![who] = may(owners);
    expected["catalogDeleteProperty"]![who] = may(owners);
    // mutations of the team: run for the owner only on a temporary addition (below)
    expected["addManager"]![who] = may(["owner"]);
    expected["removeManager"]![who] = may(["owner"]);
  }

  // a property with two units for the 2c.3 actions (written directly — test data)
  const table =
    sql(`INSERT INTO hospitality.properties (tenant_id, name, slug, status, property_type)
                     VALUES ('${siteA}', 'מתחם הטבלה', 'matrix', 'active', 'other') RETURNING id`);
  for (const [n, name] of ["יחידה א", "יחידה ב"].entries())
    sql(`INSERT INTO hospitality.units (tenant_id, property_id, kind, unit_type, name, slug, sort_order)
         VALUES ('${siteA}', '${table}', 'unit', 'zimmer', '${name}', 'matrix-${n}', ${n})`);
  const tableUnit = sql(
    `SELECT id FROM hospitality.units WHERE property_id = '${table}' AND name = 'יחידה א'`,
  );
  const originalOrder = activeIdsOf(table);

  const managerId = sql(`SELECT id FROM auth.users WHERE email = '${MANAGER_A.email}'`);
  const extraId = sql(`SELECT id FROM auth.users WHERE email = '${EXTRA.email}'`);
  const observed: Record<string, Record<string, string>> = {};
  for (const key of Object.keys(expected)) observed[key] = {};
  for (const [who, token] of Object.entries(callers)) {
    const call = (file: keyof typeof FILES, name: string, opts = {}) =>
      fn(request, SLUG_A, file, name, token, opts).then(outcome);
    observed["context"]![who] = await call("management", "hospitalityManagementContext", {
      method: "GET",
    });
    observed["settingsView"]![who] = await call("settings", "hospitalitySettings", {
      method: "GET",
    });
    observed["settingsSaveBusiness"]![who] = await call("settings", "hospitalityUpdateSettings", {
      data: { changes: { address: `כתובת של ${who}` }, revision: revisionOf(siteA) },
    });
    observed["settingsSaveOwnerField"]![who] = await call("settings", "hospitalityUpdateSettings", {
      data: {
        changes: { notification_emails: [`${who.toLowerCase()}@int.test`] },
        revision: revisionOf(siteA),
      },
    });
    observed["team"]![who] = await call("team", "hospitalityTeam", { method: "GET" });
    observed["activity"]![who] = await call("team", "hospitalityTeamActivity", { method: "GET" });
    observed["entitlements"]![who] = await call("owner", "hospitalityMyEntitlements");
    observed["catalogView"]![who] = await call("catalog", "hospitalityCatalog", { method: "GET" });
    observed["catalogCreateProperty"]![who] = await call("catalog", "hospitalityCreateProperty", {
      data: { data: { name: `מתחם של ${who}`, property_type: "other" } },
    });
    // 2c.3 actions (each with the current revision / order, so "ok" means it was really done)
    observed["catalogSetActive"]![who] = await call("catalog", "hospitalitySetUnitActive", {
      data: { id: tableUnit, active: true, revision: unitRev(tableUnit) },
    });
    const order = activeIdsOf(table);
    observed["catalogReorder"]![who] = await call("catalog", "hospitalityReorderUnits", {
      data: { propertyId: table, expected: order, ids: [...order].reverse() },
    });
    observed["catalogWholeProperty"]![who] = await call("catalog", "hospitalitySetWholeProperty", {
      data: { propertyId: table, enabled: true, memberIds: order, revision: wholeRev(table) },
    });
    // archive and delete: each staff caller on the property it created above (with a unit in
    // it); everyone else on the table's property and unit
    const own =
      sql(
        `SELECT id FROM hospitality.properties WHERE tenant_id = '${siteA}' AND name = 'מתחם של ${who}'`,
      ) || table;
    const ownUnit =
      own === table
        ? tableUnit
        : sql(`INSERT INTO hospitality.units (tenant_id, property_id, kind, unit_type, name, slug)
               VALUES ('${siteA}', '${own}', 'unit', 'zimmer', 'יחידה של ${who}', 'mx-${who.toLowerCase()}')
               RETURNING id`);
    observed["catalogDeleteUnit"]![who] = await call("catalog", "hospitalityDeleteUnit", {
      data: { id: ownUnit, revision: unitRev(ownUnit) },
    });
    observed["catalogArchive"]![who] = await call("catalog", "hospitalityArchiveProperty", {
      data: { id: own, revision: propertyRev(own) },
    });
    observed["catalogDeleteProperty"]![who] = await call("catalog", "hospitalityDeleteProperty", {
      data: { id: own, revision: propertyRev(own) },
    });
    if (who === "platformAdmin") {
      observed["addManager"]![who] = R; // not exercised (see above)
      observed["removeManager"]![who] = R;
      continue;
    }
    observed["addManager"]![who] = await call("team", "hospitalityAddManager", {
      data: { email: EXTRA.email },
    });
    // the owner removes the temporary addition; everyone else tries to remove the manager
    observed["removeManager"]![who] = await call("team", "hospitalityRemoveManager", {
      data: { userId: who === "owner" ? extraId : managerId },
    });
  }
  // platform admin rows of the mutations are not exercised: keep the table honest
  expected["addManager"]!["platformAdmin"] = R;
  expected["removeManager"]!["platformAdmin"] = R;
  expect(observed).toEqual(expected);

  // nothing a refused caller tried stuck: the manager is still here, the extra account is not,
  // and the owner-only field holds only what an owner (or platform admin) saved
  expect(
    sql(`SELECT string_agg(u.email, ',' ORDER BY u.email) FROM public.user_roles ur
           JOIN auth.users u ON u.id = ur.user_id WHERE ur.tenant_id = '${siteA}'`),
  ).toBe([MANAGER_A.email, OWNER_A.email, SHARED.email].sort().join(","));
  expect(
    sql(`SELECT notification_emails::text FROM hospitality.settings WHERE tenant_id = '${siteA}'`),
  ).toBe("{owner@int.test}");
  // properties: only staff created one (platform admin, manager, shared manager, owner); the
  // owners deleted theirs (after archiving them); the managers' are still here as created
  // (draft, not archived), with their unit — archive and delete were refused
  expect(
    sql(
      `SELECT string_agg(p.name || ':' || p.status || ':' || (SELECT count(*) FROM hospitality.units u
                                                              WHERE u.property_id = p.id), ','
                         ORDER BY p.name)
         FROM hospitality.properties p WHERE p.tenant_id = '${siteA}'`,
    ),
  ).toBe(
    ["מתחם הטבלה:active:3", "מתחם של manager:draft:1", "מתחם של sharedManager:draft:1"]
      .sort()
      .join(","),
  );
  // the table's property: reversed by each of the four staff callers (back to the start), and
  // "the whole property" made once with both units
  expect(activeIdsOf(table)).toEqual(originalOrder);
  expect(
    sql(`SELECT count(*) || ':' || bool_and(w.is_active) FROM hospitality.unit_members m
           JOIN hospitality.units w ON w.id = m.parent_unit_id WHERE w.property_id = '${table}'`),
  ).toBe("2:true");
});

test("between sites: a site's owner has no power on another site; Hospitality functions do not exist on a store", async ({
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "API checks once");
  const ownerA = await accessToken(request, OWNER_A);
  // owner of A on B's address
  expect(
    await fn(request, SLUG_B, "management", "hospitalityManagementContext", ownerA, {
      method: "GET",
    }).then(outcome),
  ).toBe("forbidden");
  for (const [file, name, method] of [
    ["settings", "hospitalitySettings", "GET"],
    ["team", "hospitalityTeam", "GET"],
    ["team", "hospitalityTeamActivity", "GET"],
    ["owner", "hospitalityMyEntitlements", "POST"],
  ] as const) {
    expect(await fn(request, SLUG_B, file, name, ownerA, { method }).then(outcome), name).toBe(
      "refused",
    );
  }
  const revB = revisionOf(siteB);
  expect(
    await fn(request, SLUG_B, "settings", "hospitalityUpdateSettings", ownerA, {
      data: { changes: { address: "פלישה" }, revision: revB },
    }).then(outcome),
  ).toBe("refused");
  expect(revisionOf(siteB)).toBe(revB);

  // on an Ecommerce store every management function is unknown (engine guard → 404)
  for (const [file, name, method] of [
    ["management", "hospitalityManagementContext", "GET"],
    ["settings", "hospitalitySettings", "GET"],
    ["settings", "hospitalityUpdateSettings", "POST"],
    ["team", "hospitalityTeam", "GET"],
    ["team", "hospitalityTeamActivity", "GET"],
    ["team", "hospitalityAddManager", "POST"],
    ["team", "hospitalityRemoveManager", "POST"],
    ["owner", "hospitalityMyEntitlements", "POST"],
  ] as const) {
    expect(
      await fn(request, STORE_A.slug, file, name, await accessToken(request, USERS.ownerA), {
        method,
      }).then(outcome),
      name,
    ).toBe("404");
  }
});

test("PostgREST directly: reads, writes and RPCs follow the account and ignore a forged site header", async ({
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "API checks once");
  const { url: api, anonKey } = supabaseEnv();
  const rest = (
    token: string,
    site: string,
    path: string,
    init: { method?: string; data?: unknown } = {},
  ) =>
    request.fetch(`${api}/rest/v1/${path}`, {
      method: init.method ?? "GET",
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${token}`,
        "x-tenant-id": site,
        "accept-profile": "hospitality",
        "content-profile": "hospitality",
        "content-type": "application/json",
      },
      ...(init.data === undefined ? {} : { data: init.data }),
    });
  const tokens = {
    owner: await accessToken(request, OWNER_A),
    manager: await accessToken(request, MANAGER_A),
    otherSiteOwner: await accessToken(request, OWNER_B),
    storeOwner: await accessToken(request, USERS.ownerA),
  };
  const rows = async (res: Awaited<ReturnType<typeof rest>>) =>
    res.ok() ? ((await res.json()) as unknown[]).length : -1;

  for (const [who, token] of Object.entries(tokens)) {
    const staff = who === "owner" || who === "manager";
    // settings: staff of A read their row; anyone else (also with a forged x-tenant-id) sees nothing
    expect(await rows(await rest(token, siteA, `settings?tenant_id=eq.${siteA}`)), who).toBe(
      staff ? 1 : 0,
    );
    // nobody writes settings directly (only through update_settings)
    const patch = await rest(token, siteA, `settings?tenant_id=eq.${siteA}`, {
      method: "PATCH",
      data: { address: "ישירות" },
    });
    expect(patch.status(), `${who} PATCH settings`).toBeGreaterThanOrEqual(400);
    // the action log and the notification outbox are never readable directly
    for (const table of ["audit_log", "notifications"]) {
      const res = await rest(token, siteA, `${table}?limit=1`);
      expect(res.status(), `${who} ${table}`).toBeGreaterThanOrEqual(400);
    }
    // team RPC: the owner only
    const team = await rest(token, siteA, "rpc/team_members", { method: "POST", data: {} });
    expect(team.ok(), `${who} team_members`).toBe(who === "owner");
    const add = await rest(token, siteA, "rpc/team_add_manager", {
      method: "POST",
      data: { _email: EXTRA.email },
    });
    if (who !== "owner") expect(add.ok(), `${who} team_add_manager`).toBe(false);
  }
  // the owner's call above really added EXTRA — take it back through the owner's RPC
  const extraId = sql(`SELECT id FROM auth.users WHERE email = '${EXTRA.email}'`);
  expect(
    (
      await rest(tokens.owner, siteA, "rpc/team_remove_manager", {
        method: "POST",
        data: { _user_id: extraId },
      })
    ).ok(),
  ).toBe(true);

  // the owner of A with B's id in the header: no rows, no team, no settings change
  expect(await rows(await rest(tokens.owner, siteB, `settings?tenant_id=eq.${siteB}`))).toBe(0);
  expect(
    (await rest(tokens.owner, siteB, "rpc/team_members", { method: "POST", data: {} })).ok(),
  ).toBe(false);
  const revB = revisionOf(siteB);
  expect(
    (
      await rest(tokens.owner, siteB, "rpc/update_settings", {
        method: "POST",
        data: { _changes: { address: "פלישה" }, _expected_revision: revB },
      })
    ).ok(),
  ).toBe(false);
  expect(revisionOf(siteB)).toBe(revB);
});

for (const who of ["owner", "manager"] as const) {
  test(`@mobile every screen as the ${who}: RTL, accessible, no sideways scroll`, async ({
    page,
    request,
  }, testInfo) => {
    const account = who === "owner" ? OWNER_A : MANAGER_A;
    const session: SavedSession = await passwordSession(request, url(SLUG_A), account);
    const screens = [
      { path: "/manage", heading: DASHBOARD_GREETING },
      { path: "/manage/settings", heading: "הגדרות העסק" },
      { path: "/manage/team", heading: "צוות ניהול" },
      { path: "/manage/units", heading: "יחידות ומתחמים" },
    ];
    for (const [i, screen] of screens.entries()) {
      if (i === 0) await loadSession(page, session, screen.path);
      else await page.goto(url(SLUG_A, screen.path));
      await expect(page.getByRole("heading", { level: 1, name: screen.heading })).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await expect(page.locator("html")).toHaveAttribute("lang", "he");
      if (screen.path === "/manage/team" && who === "manager") {
        await expect(page.getByText("המסך הזה זמין לבעל העסק ולמנהלי עסק בלבד.")).toBeVisible();
      }
      if (screen.path === "/manage") {
        await expect(
          page.getByText(who === "owner" ? "בעלים" : "מנהל/ת", { exact: true }),
        ).toBeVisible();
      }
      await page.waitForLoadState("networkidle");
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
        `${screen.path}: no sideways scroll`,
      ).toBe(true);
      await expectAccessible(page, `${testInfo.project.name} ${who} ${screen.path}`);
    }
  });
}

test("@mobile the sign-in screen: RTL, accessible, no sideways scroll", async ({
  page,
}, testInfo) => {
  await page.goto(url(SLUG_A, "/manage/login"));
  await expect(page.getByRole("heading", { level: 1, name: "כניסה לניהול העסק" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  await expect(page.getByRole("button", { name: /google/i })).toHaveCount(0);
  await expectAccessible(page, `${testInfo.project.name} sign-in`);
});

test("shared account in the browser: manager here, store owner there — each side shows only its own", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  // Hospitality side: the management area as a manager
  await loadSession(
    page,
    await passwordSession(request, url(SLUG_A), SHARED as Account),
    "/manage",
  );
  await expect(page.getByRole("heading", { level: 1, name: DASHBOARD_GREETING })).toBeVisible();
  await expect(page.getByText("מנהל/ת", { exact: true })).toBeVisible();
  // /admin on a Hospitality site goes to /manage, never to the store panel
  const admin = await hostGet(request, hostOf(SLUG_A), "/admin");
  expect(admin.status()).toBe(302);
  expect(admin.headers()["location"]).toMatch(/\/manage$/);

  // Ecommerce side: the same account's own store panel, unchanged and without Hospitality
  const storeUrl = `http://${hostOf(STORE_B.slug)}:${PORT}`;
  await loadSession(
    page,
    await passwordSession(request, storeUrl, SHARED as Account),
    "/admin?tab=dashboard",
  );
  for (const section of ["לוח בקרה", "הזמנות", "מוצרים וקטגוריות", "הגדרות אתר"]) {
    await expect(page.getByText(section, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByText(/hospitality|צימר|אירוח|צוות ניהול/i)).toHaveCount(0);
  // the store's own staff function still answers for the store
  const { url: api, anonKey } = supabaseEnv();
  const seats = await request.post(`${api}/rest/v1/rpc/store_admin_seats`, {
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${await accessToken(request, SHARED as Account)}`,
      "x-tenant-id": STORE_B.id,
    },
    data: {},
  });
  expect(seats.status()).toBe(200);
});

test("removing the shared account here leaves its store intact; Ecommerce data unchanged overall", async ({
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "API flow once");
  const res = await fn(
    request,
    SLUG_A,
    "team",
    "hospitalityRemoveManager",
    await accessToken(request, OWNER_A),
    { data: { userId: SHARED.id } },
  );
  expect(res.status()).toBe(200);
  const sharedToken = await accessToken(request, SHARED as Account);
  expect(
    await fn(request, SLUG_A, "management", "hospitalityManagementContext", sharedToken, {
      method: "GET",
    }).then(outcome),
  ).toBe("forbidden");
  expect(
    sql(
      `SELECT role || '|' || is_protected FROM public.user_roles WHERE tenant_id = '${STORE_B.id}' AND user_id = '${SHARED.id}'`,
    ),
  ).toBe("admin|true");
  expect(storeDataHash()).toBe(storeHash);
});
