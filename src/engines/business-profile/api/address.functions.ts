// "הגדרות האתר → כתובת האתר" בממשק הניהול (מיגרציה 197): תת-הדומיין של Nuriel (בדיקה אם פנוי, שינוי עם
// הפניית 301 מהכתובת הישנה) ודומיין אישי (הוראות DNS, הוכחת בעלות ב-TXT, בדיקת DNS אמיתית בשרת, SSL, הצורה
// השנייה — www / בלי www). ההרשאות במסד (settings.owner — בעל העסק / מנהל הפלטפורמה); אימות הדומיין נרשם
// רק מכאן (service_role) — לא מהדפדפן. בלי שינויי DNS ובלי נגיעה בדומיין עצמו.
import { createServerFn } from "@tanstack/react-start";
import type { AddressRow, AddressState, DnsRecordHint, DomainCheckResult } from "../types";

const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;
const slugOf = (v: unknown) => {
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  if (s.length > 63) throw new Error("כתובת: עד 63 תווים");
  return s;
};

/** הצורה השנייה של הדומיין: www.x.co.il ↔ x.co.il (רק לדומיין ראשי / www שלו) */
export function alternateHostOf(domain: string, isApex: (d: string) => boolean): string | null {
  if (domain.startsWith("www.")) {
    const bare = domain.slice(4);
    return isApex(bare) ? bare : null;
  }
  return isApex(domain) ? `www.${domain}` : null;
}

async function buildState(row: AddressRow): Promise<AddressState> {
  const [{ siteAddressesOf }, domains] = await Promise.all([
    import("@/platform/tenancy/current-site.server"),
    import("@/platform/tenancy/domains.server"),
  ]);
  const addresses = await siteAddressesOf(row);
  const domain = row.custom_domain;
  const alternateHost = domain ? alternateHostOf(domain, domains.isApexDomain) : null;
  const records: DnsRecordHint[] = [];
  if (domain && row.verify_token) {
    const cnameTarget = domains.customDomainCnameTarget(addresses.baseDomain);
    const slugHost = addresses.baseDomain ? `${row.slug}.${addresses.baseDomain}` : null;
    const host = domains.dnsRecordName(domain);
    records.push({
      type: "TXT",
      name: `_nuriel-verify.${domain}`,
      host: host === "@" ? "_nuriel-verify" : `_nuriel-verify.${host}`,
      value: `nuriel-verify=${row.verify_token}`,
      purpose: "הוכחת בעלות על הדומיין",
    });
    const ips = (process.env["SERVER_PUBLIC_IPS"] ?? "")
      .split(/[,\s]+/)
      .map((ip) => ip.trim())
      .filter((ip) => ip && !ip.includes(":"));
    const pointTo = (name: string, purpose: string) => {
      if (domains.isApexDomain(name)) {
        for (const ip of ips.length ? ips : ["<כתובת ה-IP של השרת>"])
          records.push({ type: "A", name, host: "@", value: ip, purpose });
      } else {
        records.push({
          type: "CNAME",
          name,
          host: domains.dnsRecordName(name),
          value: cnameTarget ?? slugHost ?? "",
          purpose,
        });
      }
    };
    pointTo(domain, "הפניית הדומיין לאתר");
    if (alternateHost && row.alternate_redirect)
      pointTo(alternateHost, "הצורה השנייה (מפנה לדומיין)");
  }
  return { ...row, ...addresses, alternateHost, records };
}

export const studioAddress = createServerFn({ method: "GET" }).handler(
  async (): Promise<AddressState> => {
    const { studioRpc } = await import("../data/rpc.server");
    return buildState(await studioRpc<AddressRow>("bp_address_state"));
  },
);

/** כתובת של המערכת עצמה (הפאנל, האתר הראשי, ה-API) לא נבחרת כתת-דומיין */
async function systemSlugProblem(slug: string): Promise<string | null> {
  const [{ systemHosts }, { sitesBaseDomain }] = await Promise.all([
    import("@/platform/tenancy/domains.server"),
    import("@/platform/tenancy/current-site.server"),
  ]);
  const base = await sitesBaseDomain();
  if (base && systemHosts().includes(`${slug}.${base}`))
    return "הכתובת הזו שמורה למערכת — בחרו כתובת אחרת";
  return null;
}

export const studioSlugCheck = createServerFn({ method: "POST" })
  .inputValidator((input: { slug?: unknown }) => ({ slug: slugOf(input?.slug) }))
  .handler(async ({ data }): Promise<{ available: boolean; message: string; slug: string }> => {
    const [{ studioRpc }, { allowAction }, { requireSession }] = await Promise.all([
      import("../data/rpc.server"),
      import("@/platform/security/rate-limit.server"),
      import("@/platform/auth/session.server"),
    ]);
    const session = await requireSession();
    if (!allowAction(`bp-slug-check:${session.userId}`, 60, 10 * 60 * 1000))
      throw new Error("יותר מדי בדיקות בזמן קצר — נסו שוב בעוד כמה דקות");
    const system = SLUG.test(data.slug) ? await systemSlugProblem(data.slug) : null;
    if (system) return { available: false, message: system, slug: data.slug };
    const r = await studioRpc<{ available: boolean; message: string; slug: string }>(
      "bp_slug_check",
      { _slug: data.slug },
    );
    return { available: r.available, message: r.message, slug: r.slug };
  });

export const studioSlugChange = createServerFn({ method: "POST" })
  .inputValidator((input: { slug?: unknown; current?: unknown }) => ({
    slug: slugOf(input?.slug),
    current: slugOf(input?.current),
  }))
  .handler(async ({ data }): Promise<AddressState> => {
    const [{ studioRpc, businessSiteId }, { allowAction }, { invalidateSiteCache }] =
      await Promise.all([
        import("../data/rpc.server"),
        import("@/platform/security/rate-limit.server"),
        import("@/platform/tenancy/current-site.server"),
      ]);
    const siteId = await businessSiteId();
    if (!allowAction(`bp-slug-change:${siteId}`, 10, 60 * 60 * 1000))
      throw new Error("יותר מדי ניסיונות בזמן קצר — נסו שוב מאוחר יותר");
    const system = SLUG.test(data.slug) ? await systemSlugProblem(data.slug) : null;
    if (system) throw new Error(system);
    const row = await studioRpc<AddressRow>("bp_slug_change", {
      _slug: data.slug,
      _current: data.current,
    });
    // הכתובת החדשה מזוהה מיד, והישנה מפנה (במקום מטמון של 15 שניות)
    await invalidateSiteCache(siteId);
    return buildState(row);
  });

export const studioCustomDomainSave = createServerFn({ method: "POST" })
  .inputValidator((input: { domain?: unknown; alternateRedirect?: unknown }) => ({
    domain: String(input?.domain ?? "").slice(0, 300),
    alternateRedirect: input?.alternateRedirect !== false,
  }))
  .handler(async ({ data }): Promise<AddressState> => {
    const [{ studioRpc, businessSiteId }, domains, { sitesBaseDomain, invalidateSiteCache }] =
      await Promise.all([
        import("../data/rpc.server"),
        import("@/platform/tenancy/domains.server"),
        import("@/platform/tenancy/current-site.server"),
      ]);
    const raw = data.domain.trim();
    let domain = "";
    if (raw) {
      const format = domains.domainInputFormatProblem(raw);
      if (format) throw new Error(format);
      domain = domains.normalizeDomainInput(raw);
      const problem = domains.customDomainProblem(domain, await sitesBaseDomain());
      if (problem) throw new Error(problem);
      if (domains.systemHosts().includes(domain))
        throw new Error("הכתובת הזו שייכת למערכת — הזינו דומיין שרכשתם בעצמכם");
    }
    const row = await studioRpc<AddressRow>("bp_custom_domain_set", {
      _domain: domain,
      _alternate_redirect: data.alternateRedirect,
    });
    await invalidateSiteCache(await businessSiteId());
    return buildState(row);
  });

/** "בדיקת חיבור": בעלות (TXT), הפניה לשרת (CNAME / A), והצורה השנייה — שאילתות DNS אמיתיות מהשרת */
export const studioCustomDomainCheck = createServerFn({ method: "POST" }).handler(
  async (): Promise<DomainCheckResult> => {
    const [{ studioRpc, businessSiteId }, domains, current, { allowAction }, { serviceRpc }] =
      await Promise.all([
        import("../data/rpc.server"),
        import("@/platform/tenancy/domains.server"),
        import("@/platform/tenancy/current-site.server"),
        import("@/platform/security/rate-limit.server"),
        import("../inquiries/service.server"),
      ]);
    // ההרשאה: רק מי שמורשה לראות את הגדרות הכתובת של האתר הזה
    const row = await studioRpc<AddressRow>("bp_address_state");
    const siteId = await businessSiteId();
    const domain = row.custom_domain;
    if (!domain || !row.verify_token) throw new Error("קודם שמרו את הדומיין שברצונכם לחבר");
    if (!allowAction(`bp-domain-check:${siteId}`, 30, 10 * 60 * 1000))
      throw new Error("יותר מדי בדיקות בזמן קצר — נסו שוב בעוד כמה דקות");

    const base = await current.sitesBaseDomain();
    const slugHost = base ? `${row.slug}.${base}` : null;
    const cnameTarget = domains.customDomainCnameTarget(base);
    const expected = await domains.expectedFor(domain, slugHost, cnameTarget);
    const [txt, findings] = await Promise.all([
      domains.lookupTxt(`_nuriel-verify.${domain}`),
      domains.lookupHost(domain),
    ]);
    const txtOk = txt.some((v) => v.trim() === `nuriel-verify=${row.verify_token}`);
    const verdict = domains.evaluateDns(domain, findings, expected);
    const alternate = row.alternate_redirect ? alternateHostOf(domain, domains.isApexDomain) : null;
    let alternateOk: boolean | null = null;
    if (alternate) {
      alternateOk = domains.evaluateDns(
        alternate,
        await domains.lookupHost(alternate),
        expected,
      ).ok;
    }
    const lines = [
      txtOk
        ? "בעלות: נמצאה רשומת ה-TXT"
        : `בעלות: לא נמצאה רשומת ה-TXT ‏_nuriel-verify.${domain} עם הערך שלכם`,
      verdict.ok ? "הפניה לשרת: תקינה" : `הפניה לשרת: ${verdict.message}`,
    ];
    if (alternate)
      lines.push(
        alternateOk
          ? `${alternate}: מפנה לשרת — יופנה לדומיין`
          : `${alternate}: עדיין לא מפנה לשרת (לא חובה)`,
      );
    const message = lines.join(" · ");
    const recorded = await serviceRpc<AddressRow>("bp_custom_domain_record_check", {
      _tenant: siteId,
      _domain: domain,
      _txt_ok: txtOk,
      _dns_ok: verdict.ok,
      _alternate: alternate,
      _alternate_ok: alternateOk ?? false,
      _message: message,
    });
    await current.invalidateSiteCache(siteId);
    return {
      ok: txtOk && verdict.ok,
      txtOk,
      dnsOk: verdict.ok,
      alternateOk,
      message,
      state: await buildState(recorded),
    };
  },
);
