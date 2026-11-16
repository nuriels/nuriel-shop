// מתאם (adapter): בדיקות הדומיין האישי הקיימות של החנויות (src/lib/custom-domain*, חלקים 9 / 17) — לשימוש
// מנועים אחרים (Nuriel Websites), בלי לייבא את קוד החנויות ישירות. בנוסף: שאילתת TXT (הוכחת בעלות), הכתובות
// של המערכת עצמה (שאסור לחבר כדומיין / לבחור כתת-דומיין), ותשובות DNS קבועות לבדיקות — רק לשמות בסיומת
// ‎.test (שמורה, לא קיימת באינטרנט) וכשהסביבה מגדירה DNS_TEST_FIXTURES; לדומיין אמיתי — תמיד DNS אמיתי.
import { readFileSync } from "node:fs";
import {
  customDomainCnameTarget,
  evaluateDns,
  expectedTargets,
  lookupDomain,
  type DnsFindings,
} from "@/lib/custom-domain-dns.server";

export {
  customDomainProblem,
  dnsRecordName,
  domainInputFormatProblem,
  isApexDomain,
  normalizeDomainInput,
  registrableDomain,
} from "@/lib/custom-domain";
export { customDomainCnameTarget, evaluateDns, expectedTargets };
export type { DnsFindings };

type Fixture = { cname?: string[]; a?: string[]; aaaa?: string[]; txt?: string[] };

const isTestName = (name: string) => /\.test$/.test(name);

function fixtures(): Record<string, Fixture> | null {
  const file = process.env["DNS_TEST_FIXTURES"]?.trim();
  if (!file) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, Fixture>;
  } catch {
    return null;
  }
}

function fixtureFor(name: string): Fixture | null {
  if (!isTestName(name)) return null;
  const all = fixtures();
  return all ? (all[name] ?? {}) : null;
}

/** רשומות CNAME / A / AAAA של דומיין */
export async function lookupHost(name: string): Promise<DnsFindings> {
  const f = fixtureFor(name);
  if (f) return { cnames: f.cname ?? [], a: f.a ?? [], aaaa: f.aaaa ?? [] };
  return lookupDomain(name);
}

/** רשומות ה-TXT של שם (כל רשומה מחוברת לשורה אחת); אין רשומה = [] */
export async function lookupTxt(name: string): Promise<string[]> {
  const f = fixtureFor(name);
  if (f) return f.txt ?? [];
  const dns = await import("node:dns");
  const resolver = new dns.promises.Resolver({ timeout: 3000, tries: 2 });
  resolver.setServers(["1.1.1.1", "8.8.8.8", "1.0.0.1"]);
  try {
    return (await resolver.resolveTxt(name)).map((parts) => parts.join(""));
  } catch (error) {
    const code = (error as { code?: string }).code ?? "";
    if (["ENODATA", "ENOTFOUND", "NXDOMAIN", "ENONAME"].includes(code)) return [];
    throw new Error("שרת ה-DNS לא ענה כרגע — נסו שוב בעוד דקה", { cause: error });
  }
}

/** הכתובות של המערכת עצמה (פאנל הפלטפורמה, האתר הראשי, ה-API) */
export function systemHosts(): string[] {
  const hosts: string[] = [];
  for (const key of ["PLATFORM_ADMIN_HOST"]) {
    const value = process.env[key]?.trim().toLowerCase();
    if (value) hosts.push(value);
  }
  for (const key of ["PUBLIC_SITE_URL", "SUPABASE_URL"]) {
    const value = process.env[key]?.trim();
    if (!value) continue;
    try {
      hosts.push(new URL(value).hostname.toLowerCase());
    } catch {
      // כתובת לא תקינה בסביבה — אין מה להוסיף
    }
  }
  return hosts;
}

/**
 * לאן הדומיין צריך להפנות (CNAME ליעד הדומיינים / לתת-הדומיין, או A לכתובות השרת). לשם בדיקה (.test)
 * — בלי שאילתות לרשת: היעדים, וכתובות השרת מ-SERVER_PUBLIC_IPS.
 */
export async function expectedFor(
  domain: string,
  slugHost: string | null,
  cnameTarget: string | null,
): ReturnType<typeof expectedTargets> {
  if (isTestName(domain) && fixtures()) {
    const ips = (process.env["SERVER_PUBLIC_IPS"] ?? "")
      .split(/[,\s]+/)
      .map((ip) => ip.trim())
      .filter(Boolean);
    return {
      host: cnameTarget ?? slugHost,
      ips: ips.filter((ip) => !ip.includes(":")),
      ipv6: ips.filter((ip) => ip.includes(":")),
      aliases: slugHost && slugHost !== cnameTarget ? [slugHost] : [],
    };
  }
  return expectedTargets(slugHost, cnameTarget);
}
