// פונקציות השרת של מנוע Hospitality (בלי ממשק בשלב הזה). שורש ההרכבה מצרף
// אותן לבנייה; כל קריאה עוברת דרך המתג (engine-guard): רק באתר אירוח, עם מתג
// הסביבה HOSPITALITY_ENGINE=on והדגל hospitality_backend_enabled.
export * from "./public.functions";
export * from "./guest.functions";
export * from "./owner.functions";
