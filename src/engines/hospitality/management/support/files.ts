// פתיחת קובץ מצורף (E4): הקישור החתום נוצר בשרת רק אחרי בדיקת הרשאה, ותקף 2 דקות.
// תמונה — בחלון חדש (נפתח מיד, לפני ההמתנה לשרת, כדי שחוסם החלונות לא יחסום); PDF — הורדה.

export async function openSupportFile(
  mime: string,
  getUrl: () => Promise<{ url: string }>,
): Promise<void> {
  const win = mime === "application/pdf" ? null : window.open("", "_blank");
  if (win) win.opener = null;
  try {
    const { url } = await getUrl();
    if (win) win.location.replace(url);
    else window.location.assign(url);
  } catch (error) {
    win?.close();
    throw error;
  }
}
