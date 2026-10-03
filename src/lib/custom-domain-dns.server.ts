/**
 * בדיקת ה-DNS של דומיין מותאם — צד שרת בלבד (מודול dns של Node).
 *
 * הדומיין מחובר נכון אם:
 *  - יש לו רשומת CNAME אל תת-הדומיין של החנות (<slug>.nuri1.fit), או
 *  - כל רשומות ה-A שלו מפנות לכתובת השרת (הכתובת של <slug>.nuri1.fit, או
 *    SERVER_PUBLIC_IPS מהסביבה).
 * רשומת AAAA (IPv6) שמפנה לשרת אחר מכשילה את הבדיקה: Let's Encrypt מעדיף
 * IPv6, וההנפקה של תעודת ה-SSL הייתה נכשלת.
 *
 * השאילתות נשלחות לשרתי DNS ציבוריים (1.1.1.1, 8.8.8.8) — כדי לקבל את המצב
 * העדכני, לא מטמון מקומי של השרת. אם הם לא זמינים — שרת ה-DNS של המערכת.
 */

export type DnsFindings = { cnames: string[]; a: string[]; aaaa: string[] };
export type DnsExpected = { host: string | null; ips: string[]; ipv6: string[] };
export type DnsVerdict = {
  ok: boolean;
  method: "cname" | "a" | null;
  message: string;
  findings: DnsFindings;
  expected: DnsExpected;
};

const PUBLIC_DNS = ["1.1.1.1", "8.8.8.8", "1.0.0.1"];
/** "אין רשומה" — תשובה, לא תקלה */
const NO_RECORD = new Set(["ENODATA", "ENOTFOUND", "NXDOMAIN", "ENONAME"]);

const clean = (value: string) => value.trim().toLowerCase().replace(/\.+$/, "");
const list = (values: string[]) => [...new Set(values.map(clean))].sort();

type Kind = "CNAME" | "A" | "AAAA";

async function query(name: string, kind: Kind): Promise<string[]> {
  const dns = await import("node:dns");
  const resolver = new dns.promises.Resolver({ timeout: 3000, tries: 2 });
  resolver.setServers(PUBLIC_DNS);
  const run = (r: {
    resolveCname: (n: string) => Promise<string[]>;
    resolve4: (n: string) => Promise<string[]>;
    resolve6: (n: string) => Promise<string[]>;
  }) =>
    kind === "CNAME" ? r.resolveCname(name) : kind === "A" ? r.resolve4(name) : r.resolve6(name);
  try {
    return list(await run(resolver));
  } catch (error) {
    const code = (error as { code?: string }).code ?? "";
    if (NO_RECORD.has(code)) return [];
    // השרתים הציבוריים לא זמינים מהשרת — שרת ה-DNS של המערכת
    try {
      return list(await run(dns.promises));
    } catch (fallbackError) {
      const fallbackCode = (fallbackError as { code?: string }).code ?? "";
      if (NO_RECORD.has(fallbackCode)) return [];
      throw new Error("שרת ה-DNS לא ענה כרגע — נסו שוב בעוד דקה", { cause: fallbackError });
    }
  }
}

/** מה רשום ב-DNS לדומיין */
export async function lookupDomain(domain: string): Promise<DnsFindings> {
  const [cnames, a, aaaa] = await Promise.all([
    query(domain, "CNAME"),
    query(domain, "A"),
    query(domain, "AAAA"),
  ]);
  return { cnames, a, aaaa };
}

/** לאן הדומיין צריך להפנות: תת-הדומיין של החנות וכתובות השרת */
export async function expectedTargets(storeHost: string | null): Promise<DnsExpected> {
  const fromEnv = (process.env["SERVER_PUBLIC_IPS"] ?? "")
    .split(/[,\s]+/)
    .map(clean)
    .filter(Boolean);
  let ips: string[] = [];
  let ipv6: string[] = [];
  if (storeHost) {
    [ips, ipv6] = await Promise.all([
      query(storeHost, "A").catch(() => []),
      query(storeHost, "AAAA").catch(() => []),
    ]);
  }
  return {
    host: storeHost ? clean(storeHost) : null,
    ips: list([...ips, ...fromEnv.filter((ip) => !ip.includes(":"))]),
    ipv6: list([...ipv6, ...fromEnv.filter((ip) => ip.includes(":"))]),
  };
}

/** ההחלטה עצמה — פונקציה טהורה (נבדקת בלי רשת) */
export function evaluateDns(
  domain: string,
  findings: DnsFindings,
  expected: DnsExpected,
): DnsVerdict {
  const verdict = (ok: boolean, method: DnsVerdict["method"], message: string): DnsVerdict => ({
    ok,
    method,
    message,
    findings,
    expected,
  });
  const target = expected.host ?? "תת-הדומיין של החנות";
  const ipsText = expected.ips.join(", ");

  // 1. CNAME ישירות לתת-הדומיין של החנות
  if (expected.host && findings.cnames.includes(expected.host)) {
    return verdict(true, "cname", `נמצאה רשומת CNAME תקינה: ${domain} → ${expected.host}`);
  }

  // 2. כתובות A (גם דרך שרשרת CNAME — ה-A שמתקבל בסוף)
  const foreignAaaa =
    findings.aaaa.length > 0 && findings.aaaa.some((ip) => !expected.ipv6.includes(ip));
  if (findings.a.length > 0 && expected.ips.length > 0) {
    const foreign = findings.a.filter((ip) => !expected.ips.includes(ip));
    if (foreign.length === 0) {
      if (foreignAaaa) {
        return verdict(
          false,
          null,
          `רשומת ה-A תקינה, אבל יש לדומיין גם רשומת AAAA (IPv6) שמפנה לשרת אחר (${findings.aaaa.join(", ")}). מחקו את רשומת ה-AAAA ונסו שוב.`,
        );
      }
      return verdict(true, "a", `הדומיין מפנה לשרת שלנו (${findings.a.join(", ")})`);
    }
    if (foreign.length < findings.a.length) {
      return verdict(
        false,
        null,
        `חלק מרשומות ה-A מפנות לשרת אחר (${foreign.join(", ")}). השאירו רק רשומה אחת אל ${ipsText}.`,
      );
    }
  }

  // 3. לא מחובר — הסבר מה רשום כרגע ומה צריך
  if (findings.cnames.length > 0) {
    return verdict(
      false,
      null,
      `הדומיין מפנה כרגע (CNAME) אל ${findings.cnames.join(", ")} — צריך להפנות אל ${target}.`,
    );
  }
  if (findings.a.length > 0) {
    return verdict(
      false,
      null,
      expected.ips.length > 0
        ? `הדומיין מפנה כרגע לכתובת ${findings.a.join(", ")} — צריך CNAME אל ${target} (או רשומת A אל ${ipsText}).`
        : `הדומיין מפנה כרגע לכתובת ${findings.a.join(", ")} — צריך רשומת CNAME אל ${target}.`,
    );
  }
  return verdict(
    false,
    null,
    `לא נמצאה עדיין רשומת DNS ל-${domain}. אם הוספתם אותה עכשיו — עדכון DNS לוקח לרוב כמה דקות (לפעמים עד כמה שעות). נסו שוב בעוד כמה דקות.`,
  );
}
