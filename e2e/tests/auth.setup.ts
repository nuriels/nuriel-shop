import { test as setup } from "@playwright/test";
import { A, AUTH, login, platformUrl, USERS } from "./helpers";

// כל משתמש מתחבר פעם אחת דרך מסך ההתחברות האמיתי; שאר הבדיקות משתמשות במצב שנשמר
const SESSIONS = [
  { file: AUTH.customerA, base: A(), user: USERS.customerA },
  { file: AUTH.ownerA, base: A(), user: USERS.ownerA },
  { file: AUTH.platform, base: platformUrl(), user: USERS.platform },
  { file: AUTH.ownerAOnPlatform, base: platformUrl(), user: USERS.ownerA },
];

for (const session of SESSIONS) {
  setup(`login ${session.user.email} @ ${new URL(session.base).hostname}`, async ({ page }) => {
    await login(page, session.base, session.user);
    await page.context().storageState({ path: session.file });
  });
}
