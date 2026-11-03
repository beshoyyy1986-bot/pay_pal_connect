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

function apiKey() {
  const key = process.env.BROWSER_USE_API_KEY;
  if (!key) {
    const err = new Error('BROWSER_USE_API_KEY غير محدد في متغيرات البيئة.');
    err.status = 500;
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
  const err = new Error(`Browser Use (${status}): ${String(detail).slice(0, 400)}`);
  err.status = status === 402 || status === 429 ? status : 502;
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

module.exports = { createSession, getSession, stopSession, isConfigured, API_BASE };
