/**
 * طبقة المتصفح — نفس الكود يشتغل في 3 بيئات:
 *
 *   BROWSER_MODE=local       → Chromium مثبت محلياً (Docker / VPS / Replit)   [افتراضي]
 *   BROWSER_MODE=cdp         → خدمة متصفح سحابي عبر WebSocket
 *                              (Browserless / Browserbase / Steel / أي CDP endpoint)
 *                              يتفعّل تلقائياً لو فيه BROWSER_WS_ENDPOINT
 *   BROWSER_MODE=serverless  → @sparticuz/chromium على Vercel Functions
 *                              يتفعّل تلقائياً لو كنا على VERCEL
 *
 * كل حاجة فوق ده بتتمسك من lib/session.js — مش محتاج تغيّر أي منطق.
 */

const COMMON_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-blink-features=AutomationControlled',
  '--disable-features=IsolateOrigins,site-per-process',
  '--no-first-run',
  '--no-default-browser-check',
];

function resolveMode() {
  if (process.env.BROWSER_MODE) return String(process.env.BROWSER_MODE).toLowerCase();
  if (process.env.BROWSER_WS_ENDPOINT) return 'cdp';
  if (process.env.VERCEL) return 'serverless';
  return 'local';
}

function playwright() {
  try {
    // playwright فيه المتصفح جوه؛ playwright-core أخف وبيكفي للـ CDP/serverless
    return require('playwright');
  } catch (_) {
    try {
      return require('playwright-core');
    } catch (_) {
      const err = new Error(
        'browser_lib_missing: نزّل playwright أو playwright-core — npm install && npx playwright install --with-deps chromium'
      );
      err.status = 500;
      throw err;
    }
  }
}

function fail(message) {
  const err = new Error(message);
  err.status = 500;
  return err;
}

/**
 * @returns {Promise<{browser: object, mode: string, remote: boolean}>}
 */
async function connect() {
  const mode = resolveMode();
  const pw = playwright();

  if (mode === 'cdp') {
    const endpoint = process.env.BROWSER_WS_ENDPOINT;
    if (!endpoint) {
      throw fail('BROWSER_MODE=cdp لكن BROWSER_WS_ENDPOINT غير محدد (wss://...).');
    }
    const browser = await pw.chromium.connectOverCDP(endpoint, {
      timeout: Number(process.env.BROWSER_CONNECT_TIMEOUT || 30000),
    });
    return { browser, mode, remote: true };
  }

  if (mode === 'serverless') {
    let chromium;
    try {
      chromium = require('@sparticuz/chromium');
    } catch (_) {
      throw fail('BROWSER_MODE=serverless محتاج الحزمة @sparticuz/chromium (npm i @sparticuz/chromium).');
    }
    const executablePath = await chromium.executablePath();
    const browser = await pw.chromium.launch({
      executablePath,
      args: [...chromium.args, ...COMMON_ARGS],
      headless: true,
      timeout: 60000,
    });
    return { browser, mode, remote: false };
  }

  const browser = await pw.chromium.launch({
    headless: process.env.HEADLESS !== 'false',
    args: COMMON_ARGS,
    timeout: 60000,
  });
  return { browser, mode, remote: false };
}

module.exports = { connect, resolveMode, COMMON_ARGS };
