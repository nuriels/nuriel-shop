// מה שה-root של האתר מקבל באתר אירוח (R-1) — שם העסק בלבד, בלי שום נתון של חנות
export interface SiteHead {
  /** שם העסק (או שם האתר); null = לא זמין */
  name: string | null;
}
