// Google SEO שלב 4: הסכמה ל-Cookies באתר האירוח — החלק הטהור, השדה של GA4 והמדידה באתר
import { describe, expect, it } from "vitest";
import {
  CONSENT_COOKIE,
  CONSENT_MAX_AGE_DAYS,
  CONSENT_POLICY_VERSION,
  analyticsCookieNames,
  analyticsGranted,
  consentAction,
  consentCookie,
  needsDecision,
  nextConsent,
  parseConsentInput,
  readConsent,
  serializeConsent,
  type ConsentState,
} from "../../src/engines/hospitality/website/consent/consent";
import { GA4_ID, normalizeSeo } from "../../src/engines/hospitality/website/design/schema";
import { embedSrc } from "../../src/engines/hospitality/website/lib/media";
import type { PublicMedia } from "../../src/engines/hospitality/types/website";

const NOW = 1_800_000_000;
const ID = "3f2a6c1e-8b4d-4e0f-9a7b-1c2d3e4f5a6b";
const state = (over: Partial<ConsentState> = {}): ConsentState => ({
  v: CONSENT_POLICY_VERSION,
  id: ID,
  analytics: true,
  at: NOW - 60,
  ...over,
});
const jar = (s: ConsentState, extra = "theme=dark") =>
  `${extra}; ${CONSENT_COOKIE}=${encodeURIComponent(serializeConsent(s))}; other=1`;

describe("consent cookie: read and write", () => {
  it("round-trips the choice — version, anonymous id, analytics yes/no, time", () => {
    expect(readConsent(jar(state()), NOW)).toEqual(state());
    expect(readConsent(jar(state({ analytics: false })), NOW)?.analytics).toBe(false);
  });

  it("no cookie, a broken value or another field — no choice", () => {
    expect(readConsent("theme=dark", NOW)).toBeNull();
    expect(readConsent(`${CONSENT_COOKIE}=garbage`, NOW)).toBeNull();
    expect(
      readConsent(`${CONSENT_COOKIE}=${CONSENT_POLICY_VERSION}:not-a-uuid:1:${NOW}`, NOW),
    ).toBeNull();
    expect(
      readConsent(`${CONSENT_COOKIE}=${CONSENT_POLICY_VERSION}:${ID}:2:${NOW}`, NOW),
    ).toBeNull();
    expect(readConsent(`x${CONSENT_COOKIE}=${serializeConsent(state())}`, NOW)).toBeNull();
  });

  it("another policy version, an old choice (over 6 months) or a time in the future — ask again", () => {
    expect(readConsent(jar(state({ v: "2020-01-01" })), NOW)).toBeNull();
    expect(
      readConsent(jar(state({ at: NOW - CONSENT_MAX_AGE_DAYS * 86_400 - 1 })), NOW),
    ).toBeNull();
    expect(
      readConsent(jar(state({ at: NOW - CONSENT_MAX_AGE_DAYS * 86_400 + 60 })), NOW),
    ).not.toBeNull();
    expect(readConsent(jar(state({ at: NOW + 3 * 86_400 })), NOW)).toBeNull();
  });

  it("the cookie is only for this address (no Domain), for the whole site, Lax, 6 months; Secure on https", () => {
    const c = consentCookie(state(), true);
    expect(c).toMatch(new RegExp(`^${CONSENT_COOKIE}=`));
    expect(c).toContain("Path=/");
    expect(c).toContain(`Max-Age=${CONSENT_MAX_AGE_DAYS * 86_400}`);
    expect(c).toContain("SameSite=Lax");
    expect(c).toContain("Secure");
    expect(c.toLowerCase()).not.toContain("domain=");
    expect(consentCookie(state(), false)).not.toContain("Secure");
  });
});

describe("consent: when to ask, when to measure, how it is recorded", () => {
  it("the banner shows only when the site has something that needs consent and there is no valid choice", () => {
    expect(needsDecision(null, false)).toBe(false);
    expect(needsDecision(null, true)).toBe(true);
    expect(needsDecision(state(), true)).toBe(false);
  });

  it("analytics loads only when it is available on the site and the visitor said yes", () => {
    expect(analyticsGranted(null, true)).toBe(false);
    expect(analyticsGranted(state({ analytics: false }), true)).toBe(false);
    expect(analyticsGranted(state(), false)).toBe(false);
    expect(analyticsGranted(state(), true)).toBe(true);
  });

  it("a new choice keeps the same anonymous id of this browser, with the current version", () => {
    const first = nextConsent(null, false, NOW, () => ID.toUpperCase());
    expect(first).toEqual({ v: CONSENT_POLICY_VERSION, id: ID, analytics: false, at: NOW });
    const second = nextConsent(first, true, NOW + 5, () => "ignored");
    expect(second.id).toBe(ID);
    expect(second.analytics).toBe(true);
  });

  it("banner: accept / reject; settings: save, or withdraw when analytics that was on is turned off", () => {
    expect(consentAction(null, true, "banner")).toBe("accept");
    expect(consentAction(null, false, "banner")).toBe("reject");
    expect(consentAction(null, true, "panel")).toBe("save");
    expect(consentAction(state({ analytics: false }), false, "panel")).toBe("save");
    expect(consentAction(state(), false, "panel")).toBe("withdraw");
  });

  it("finds only the Google Analytics cookies to remove on withdrawal", () => {
    expect(
      analyticsCookieNames(
        `_ga=GA1.1.2; _ga_ABC123=GS1; _gid=x; ${CONSENT_COOKIE}=v; sb-x-auth-token=y; _gat_UA1=1`,
      ),
    ).toEqual(["_ga", "_ga_ABC123", "_gid", "_gat_UA1"]);
  });
});

describe("consent: the input from the browser (the server checks everything)", () => {
  const ok = {
    consentId: ID,
    analytics: true,
    action: "accept",
    policyVersion: CONSENT_POLICY_VERSION,
  };
  it("accepts a consistent choice", () => {
    expect(parseConsentInput(ok)).toEqual(ok);
    expect(parseConsentInput({ ...ok, consentId: ID.toUpperCase() }).consentId).toBe(ID);
    expect(parseConsentInput({ ...ok, analytics: false, action: "withdraw" }).action).toBe(
      "withdraw",
    );
  });
  it.each([
    ["not a uuid", { ...ok, consentId: "x" }],
    ["analytics not a boolean", { ...ok, analytics: "yes" }],
    ["an unknown action", { ...ok, action: "maybe" }],
    ["a version that is not a date", { ...ok, policyVersion: "v2" }],
    ["accept without analytics", { ...ok, analytics: false }],
    ["reject with analytics", { ...ok, action: "reject" }],
    ["withdraw with analytics", { ...ok, action: "withdraw" }],
    ["nothing", null],
  ])("refuses %s", (_label, input) => {
    expect(() => parseConsentInput(input)).toThrow("הבחירה לא תקינה");
  });
});

describe("GA4 id in the site's Google settings (normalizeSeo)", () => {
  it("keeps only a valid measurement id, upper-cased; anything else is dropped", () => {
    expect(GA4_ID.test("G-AB12CD34EF")).toBe(true);
    expect(normalizeSeo({ ga4: " g-ab12cd34ef " })?.ga4).toBe("G-AB12CD34EF");
    for (const bad of ["UA-12345-1", "G-", "GTM-ABC123", "G-ab<script>", "G-12345678901234567", 42])
      expect(normalizeSeo({ ga4: bad })?.ga4, String(bad)).toBeUndefined();
  });
});

describe("video embeds stay privacy-friendly (no consent needed)", () => {
  const media = (provider: "youtube" | "vimeo") =>
    ({ kind: "embed", embed_provider: provider, embed_id: "12345" }) as PublicMedia;
  it("YouTube from the no-cookie domain, Vimeo with do-not-track", () => {
    expect(embedSrc(media("youtube"))).toBe("https://www.youtube-nocookie.com/embed/12345");
    expect(embedSrc(media("vimeo"))).toBe("https://player.vimeo.com/video/12345?dnt=1");
  });
});
