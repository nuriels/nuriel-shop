// פונקציות השרת של מנוע Hospitality. שורש ההרכבה מצרף אותן לבנייה. פונקציות
// שהממשק קורא להן ישירות נמצאות ב-../api (הדפדפן לא מייבא מתיקיות server/). כל קריאה
// עוברת דרך המתג (engine-guard): רק באתר אירוח, עם מתג הסביבה HOSPITALITY_ENGINE=on
// והדגל hospitality_backend_enabled (ופונקציות אזור הניהול — גם hospitality_management_enabled).
export * from "./public.functions";
export * from "./guest.functions";
export * from "./owner.functions";
export * from "../api/management.functions";
