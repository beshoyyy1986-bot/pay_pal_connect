/**
 * Browser Use Cloud (browser-use.com) — متصفح Chromium سحابي حقيقي عبر CDP.
 *
 *   POST  /api/v2/browsers          ← إنشاء جلسة (بيرجّع cdpUrl + liveUrl)
 *   PATCH /api/v2/browsers/{id}     ← إيقاف الجلسة { action: "stop" }
 *
 * - البروكسي الافتراضي: الولايات المتحدة (proxyCountryCode: 'us')
 * - كل جلسة بتتحاسب بالساعة ($0.02/ساعة، بأقل دقيقة) → بنوقفها فوراً بعد الانتهاء.
 */
const axios = require('axios');

const API_BASE = process.env.BROWSER_USE_API_URL || 'https://api.browser-use.com/api/v2';

/**
 * تنقية المفتاح من أخطاء اللصق الشائعة:
 * مسافات/newline، علامات تنصيص، "BROWSER_USE_API_KEY=" في أول القيمة، أو "Bearer ".
 */
function cleanKey(rawValue) {
  let key = String(rawValue || "");

  // بنكرر التنقية: القيمة ممكن تكون "BROWSER_USE_API_KEY=..." جوه علامات تنصيص
  for (let i = 0; i < 3; i += 1) {
    const before = key;
    key = key.trim();

    const dq = key.charAt(0) === String.fromCharCode(34) && key.charAt(key.length - 1) === String.fromCharCode(34);
    const sq = key.charAt(0) === String.fromCharCode(39) && key.charAt(key.length - 1) === String.fromCharCode(39);
    if (dq || sq) key = key.slice(1, -1);

    const upper = key.toUpperCase();
    if (upper.indexOf("BROWSER_USE_API_KEY") === 0) {
      const eq = key.indexOf("=");
      if (eq !== -1) key = key.slice(eq + 1);
    }
    if (upper.indexOf("BEARER") === 0) {
      key = key.slice(6);
    }

    if (key === before) break;
  }

  return key.trim();
}

function readKey() {
  return cleanKey(process.env.BROWSER_USE_API_KEY);
}

/** تشخيص آمن للمفتاح (بدون كشفه) — بيظهر في /health */
function keyDiagnostics() {
  const raw = String(process.env.BROWSER_USE_API_KEY || '');
  const key = cleanKey(raw);
  return {
    present: raw.length > 0,
    length: key.length,
    rawLength: raw.length,
    prefix: key.slice(0, 3),
    looksValid: /^bu_[A-Za-z0-9_-]{16,}$/.test(key),
    hadQuotes: /^["']/.test(raw.trim()),
    hadWhitespace: raw !== raw.trim(),
    hadKeyName: /^BROWSER_USE_API_KEY\s*=/i.test(raw.trim()),
  };
}

function apiKey() {
  const key = readKey();
  if (!key) {
    const err = new Error('BROWSER_USE_API_KEY غير محدد في متغيرات البيئة.');
    err.status = 500;
    throw err;
  }
  if (!key.startsWith('bu_')) {
    const err = new Error(
      `المفتاح مش بالشكل الصحيح (لازم يبدأ بـ bu_) — القيمة الحالية تبدأ بـ "${key.slice(0, 3)}..." وطولها ${key.length}. راجع متغير BROWSER_USE_API_KEY.`
    );
    err.status = 401;
    throw err;
  }
  return key;
}

function headers() {
  return {
    'X-Browser-Use-API-Key': apiKey(),
    'Content-Type': 'application/json',
  };
}

function failFrom(status, data, fallback) {
  const detail =
    (data && (data.detail || data.message || data.error)) ||
    (typeof data === 'string' ? data : '') ||
    fallback;

  let hint = '';
  if (status === 401 || status === 403) {
    const diag = keyDiagnostics();
    hint =
      ' — المفتاح وصل للـ API لكنه مرفوض. راجع: (1) إنه متسجل في نفس البيئة (Production) على Vercel، ' +
      '(2) إنك عملت Redeploy بعد إضافته، (3) إن مفيش مسافات أو علامات تنصيص، ' +
      '(4) إنه لسه شغال من cloud.browser-use.com/settings?tab=api-keys. ' +
      `(تشخيص: prefix=${diag.prefix} length=${diag.length} quotes=${diag.hadQuotes} whitespace=${diag.hadWhitespace} looksValid=${diag.looksValid})`;
  } else if (status === 402) {
    hint = ' — الرصيد غير كافي في حساب Browser Use.';
  } else if (status === 429) {
    hint = ' — في جلسة شغالة بالفعل (حد التوازي). استنى شوية أو اقفل جلسة من الداشبورد.';
  }

  const err = new Error(`Browser Use (${status}): ${String(detail).slice(0, 300)}${hint}`);
  err.status = status === 401 || status === 402 || status === 429 ? status : 502;
  err.upstream = status;
  return err;
}

/**
 * @param {{country?: string, timeoutMinutes?: number, metadata?: object}} opts
 * @returns {Promise<{id: string, cdpUrl: string, liveUrl: string|null, timeoutAt: string}>}
 */
async function createSession(opts = {}) {
  const country = (opts.country || process.env.BU_PROXY_COUNTRY || 'us').toLowerCase();
  const timeoutMinutes = Number(opts.timeoutMinutes || process.env.BU_SESSION_TIMEOUT_MIN || 5);

  const body = {
    proxyCountryCode: country === 'none' ? null : country,
    timeout: timeoutMinutes,
    browserScreenWidth: Number(process.env.BU_SCREEN_WIDTH || 1366),
    browserScreenHeight: Number(process.env.BU_SCREEN_HEIGHT || 900),
    allowResizing: false,
    solveCaptchas: process.env.BU_SOLVE_CAPTCHAS !== 'false',
    metadata: { app: 'clickbridge', ...(opts.metadata || {}) },
  };

  const res = await axios.post(`${API_BASE}/browsers`, body, {
    headers: headers(),
    timeout: Number(process.env.BU_API_TIMEOUT || 60000),
    validateStatus: () => true,
  });

  if (res.status >= 400 || !res.data || !res.data.cdpUrl) {
    if (res.data && res.data.id) {
      // الجلسة اتفتحت لكن بدون cdpUrl — بنقفلها عشان ما تتحاسبش
      await stopSession(res.data.id).catch(() => {});
    }
    throw failFrom(res.status, res.data, 'لم يتم الحصول على cdpUrl');
  }

  return {
    id: res.data.id,
    cdpUrl: res.data.cdpUrl,
    liveUrl: res.data.liveUrl || null,
    timeoutAt: res.data.timeoutAt || null,
  };
}

async function getSession(id) {
  const res = await axios.get(`${API_BASE}/browsers/${id}`, {
    headers: headers(),
    timeout: 30000,
    validateStatus: () => true,
  });
  if (res.status >= 400) throw failFrom(res.status, res.data, 'فشل جلب الجلسة');
  return res.data;
}

async function stopSession(id) {
  if (!id) return false;
  try {
    const res = await axios.patch(
      `${API_BASE}/browsers/${id}`,
      { action: 'stop' },
      { headers: headers(), timeout: 30000, validateStatus: () => true }
    );
    return res.status < 400;
  } catch (_) {
    return false;
  }
}

function isConfigured() {
  return !!process.env.BROWSER_USE_API_KEY;
}

module.exports = { createSession, getSession, stopSession, isConfigured, keyDiagnostics, API_BASE };
