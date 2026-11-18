# Recent issue verification / אימות האישוז האחרונים

Scope: all 9 open upstream issues at review time on 2026-11-18, based on main `65158546a62937526bf1417508d2c100b53fb0cc`. Closed issues and merged PRs were checked for context, not reopened.

היקף הבדיקה: כל תשעת האישוז הפתוחים בפרויקט המקורי ב־18.11.2026, על בסיס הקומיט המצוין למעלה. אישוז סגורים ו־PR שמוזגו נבדקו לצורך ההקשר, ולא נפתחו מחדש.

## Issue status / מצב לפי אישיו

- **#16:** Added standard PDF `/Text` notes linked to `/Popup`, page-position placement, comment editing/deletion, comments panel and navigation. Hebrew multiline contents survive save/reopen in PDF.js and low-level PDF tests. Ink/Highlight/FreeText stay on the existing PDF.js save path, then only touched Text annotations are rewritten. Encrypted PDFs are not rewritten by the note serializer. Acrobat/Edge interoperability is still unverified.
  **#16 בעברית:** נוספו פתקיות תקניות מסוג Text עם Popup, מיקום בעמוד, עריכה ומחיקה, חלונית תגובות וניווט. תוכן בעברית ובכמה שורות נשמר ונפתח מחדש בבדיקות PDF.js ובבדיקות מבנה PDF. כלי השרבוט, ההדגשה והטקסט הקיימים נשמרו בנפרד. קובץ מוצפן אינו נכתב מחדש באמצעות מנגנון הפתקיות. תאימות ל־Acrobat ול־Edge עדיין לא נבדקה.
- **#17:** Print resolution no longer depends on document length. Print uses original PDF content with a separate 150/300-DPI raster pipeline, not preview canvases. Individual pages remain limited to 16 MP and 8192 pixels. Jobs above a 128-MP retained-image budget are rejected with a translated explanation instead of downscaling. Users must split such jobs. Preview has separate 8/4/2/1-MP page caps at <=50/<=200/<=500/>500 pages, with PDF.js visible-page/detail rendering. This does not promise vector printing, unlimited all-page jobs, or bounded total process memory.
  **#17 בעברית:** רזולוציית ההדפסה אינה יורדת לפי מספר עמודי המקור. ההדפסה משתמשת בתוכן המקורי ובמסלול נפרד של 150 או 300 DPI, לא בתמונות התצוגה. עמוד בודד מוגבל ל־16 מגה־פיקסל ול־8192 פיקסלים. עבודה שחורגת מתקציב תמונות של 128 מגה־פיקסל נעצרת עם הסבר מתורגם ויש לפצלה, במקום להוריד איכות. לתצוגה מגבלות נפרדות של 8/4/2/1 מגה־פיקסל לפי ספי העמודים לעיל. זו אינה הבטחה להדפסה וקטורית, לעבודות ללא הגבלה או להגבלת כלל זיכרון התהליך.
- **#18:** Added hand-pan mode, safe interactive-control exclusions and persistent pointer preference. Verified dragging and restart persistence in real Chromium. Touch keeps its native scrolling.
  **#18 בעברית:** נוסף מצב יד לגרירה, ללא השתלטות על פקדים אינטראקטיביים, עם שמירת הבחירה להפעלה הבאה. גרירה ושחזור אחרי רענון נבדקו ב־Chromium אמיתי. גלילת מגע נשארה טבעית.
- **#19:** Clicking Print immediately opens a translated page setup dialog without rendering. All/current/custom ranges are supported; only selected pages are prepared. Printer settings still follow in the system print dialog. Windows-specific WebView2 feasibility was not tested. A small raster job with mixed portrait/landscape pages was rendered and exported through headless Chromium print-to-PDF, then visually inspected. This is not Windows print-to-PDF or physical-printer validation.
  **#19 בעברית:** לחיצה על הדפסה פותחת מיד חלון בחירת עמודים מתורגם, ללא רינדור מוקדם. ניתן לבחור את כל העמודים, עמוד נוכחי או טווח; רק העמודים שנבחרו מוכנים להדפסה. בחירת המדפסת עדיין נעשית בחלון המערכת לאחר ההכנה. היתכנות המסלול הייעודי של WebView2 לא נבדקה. עבודה קצרה עם עמוד לרוחב ועמוד לאורך יוצאה ל־PDF ב־Chromium ונבדקה חזותית. זו אינה בדיקת הדפסה ב־Windows או במדפסת פיזית.
- **#20:** Added transparent PNG source and ICO frames at 16/24/32/48/64/128/256 pixels, using the image linked in the issue. Existing Tauri configuration points to `icons/icon.ico`, shared by the app, NSIS/MSI and portable EXE. Icon previews were visually inspected. Actual EXE/installer/taskbar/shortcut/clean-install validation remains required; no release is published.
  **#20 בעברית:** נוסף מקור PNG שקוף וקובץ ICO עם הגדלים לעיל, לפי התמונה המצורפת לאישיו. הגדרות Tauri הקיימות משתמשות באותו ICO עבור התוכנה וחבילות ההתקנה וה־EXE הנייד. תצוגות האייקון נבדקו חזותית. עדיין נדרש אימות בפועל של EXE, מתקינים, שורת משימות, קיצורי דרך והתקנה נקייה. לא פורסמה גרסת הפצה.
- **#8 and #13:** Single-instance routing and light theme already exist in upstream main. No duplicate replacement was introduced. Light theme was exercised in the browser; Windows shell routing is still unverified.
  **#8 ו־#13 בעברית:** ניתוב למופע יחיד ותצוגה בהירה כבר קיימים ב־main המקורי. לא נוסף מימוש כפול. התצוגה הבהירה נבדקה בדפדפן; ניתוב קבצים דרך מעטפת Windows עדיין לא אומת.
- **#9:** Still open. A synthetic 20-page PDF showed 1/5/10 workers at 1/5/10 tabs, 3/12/22 canvases and approximately 2.66/13.83/27.73 million canvas pixels. Main JS heap snapshots were about 14.1/15.5/16.5 MB, without forced GC; these exclude worker heaps, native/GPU memory and are not leak measurements. A separate 20-tab attempt crashed the Linux headless renderer while opening tab 17. No unsafe worker suspension that would lose undo history was introduced. Windows/scanned-document profiling remains necessary.
  **#9 בעברית:** נשאר פתוח. בקובץ בדיקה סינתטי בן 20 עמודים, ב־1/5/10 כרטיסיות היו 1/5/10 עובדים ו־3/12/22 משטחי ציור, עם כ־2.66/13.83/27.73 מיליון פיקסלים. מדידות ערימת JavaScript הראשית היו כ־14.1/15.5/16.5 MB ללא איסוף זבל כפוי; הן אינן כוללות עובדים, זיכרון מקומי או GPU ואינן מדידות דליפה. בניסיון נפרד של 20 כרטיסיות, תהליך הרינדור של Chromium בלינוקס קרס בפתיחת כרטיסייה 17. לא הוכנסה השעיה מסוכנת שעלולה לאבד היסטוריית ביטול. נדרש פרופיל זיכרון ב־Windows ובמסמכים סרוקים.
- **#10:** Still open. Existing packaged-Windows checklist remains the source for installation, shell, WebView2, save/print and close validation. Browser tests do not replace it.
  **#10 בעברית:** נשאר פתוח. רשימת הבדיקות הקיימת לחבילות Windows נשארה הבסיס לבדיקות התקנה, פתיחת קבצים, WebView2, שמירה, הדפסה וסגירה. בדיקות הדפדפן אינן מחליפות אותה.

## Reproduce / שחזור

```sh
npm ci --ignore-scripts
npm test
npm run check
npm run build
npx playwright install chromium
# Terminal 1 / מסוף 1:
npm run dev
# Terminal 2 / מסוף 2:
npm run test:browser
# Optional installed Chrome / Chrome מותקן, אופציונלי:
CHROME_PATH=/usr/bin/google-chrome npm run test:browser
```

The browser script creates synthetic fixtures and saves screenshots/results under ignored `test-results/`. It tests actual PDF.js rendering and application behavior, but stubs the native `window.print` dialog. Browser executable and platform can change memory results. Unit tests use boundary fakes where rendering/OS integration is not needed.

סקריפט הדפדפן יוצר קובצי בדיקה סינתטיים ושומר צילומים ותוצאות בתיקיית `test-results/` שאינה נכללת ב־Git. הוא מפעיל את PDF.js ואת התנהגות הממשק בפועל, אך מחליף את חלון ההדפסה המקורי בפונקציית בדיקה. גרסת הדפדפן ומערכת ההפעלה עשויות לשנות את מדידות הזיכרון. בדיקות היחידה משתמשות בתחליפים בנקודות הגבול כשאין צורך ברינדור או במערכת הפעלה.

All added app strings have English and Hebrew entries. Hebrew/RTL print setup, note editor and comments panel were visually inspected. Windows tests, installer builds and third-party PDF-reader interoperability must be reported separately from frontend success.

לכל הטקסטים שנוספו בממשק יש ערכים באנגלית ובעברית. חלון ההדפסה, עורך הפתקית וחלונית התגובות נבדקו חזותית בעברית ובכיווניות RTL. יש לדווח בנפרד על בדיקות Windows, בניית מתקינים ותאימות לקוראי PDF אחרים, ולא להסיק אותן מהצלחת בדיקות הממשק.

Sources / מקורות: upstream issues `https://github.com/hasharferyf-hash/OpenPDF/issues/8`, `/9`, `/10`, `/13`, `/16`, `/17`, `/18`, `/19`, `/20`; icon image linked in #20. No issues were closed, no upstream code was pushed and no PR was opened.

לא נסגרו אישוז, לא נדחף קוד לפרויקט המקורי ולא נפתח PR.
