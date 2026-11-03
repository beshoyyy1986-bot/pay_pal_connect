/**
 * تحميل Chromium محلياً فقط.
 * على Vercel / CI بنتخطاه: هناك بنستخدم متصفح سحابي (CDP) أو @sparticuz/chromium.
 */
const { execSync } = require('child_process');

const skip =
  process.env.VERCEL ||
  process.env.SKIP_PLAYWRIGHT_DOWNLOAD === '1' ||
  process.env.BROWSER_MODE === 'cdp';

if (skip) {
  console.log('[postinstall] تم تخطي تحميل Chromium (بيئة سحابية).');
  process.exit(0);
}

let hasPlaywright = true;
try {
  require.resolve('playwright');
} catch (_) {
  hasPlaywright = false;
}

if (!hasPlaywright) {
  console.log('[postinstall] playwright غير مثبت — تخطي.');
  process.exit(0);
}

try {
  console.log('[postinstall] تحميل Chromium...');
  execSync('npx playwright install chromium', { stdio: 'inherit' });
} catch (err) {
  console.warn('[postinstall] فشل تحميل Chromium:', err.message);
  console.warn('[postinstall] شغّله يدوياً: npx playwright install --with-deps chromium');
}
