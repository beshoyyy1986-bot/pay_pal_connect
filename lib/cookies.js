/**
 * أدوات الكوكيز: تحليل، تحقق، وتحويل لصيغة Playwright.
 * بتقبل 3 صيغ:
 *   1) هيدر خام:  c_user=123; xs=abc; ...
 *   2) JSON مصدّر من إكستنشن:  [{ name, value, domain, ... }]
 *   3) JSON ككائن:  { c_user: "123", xs: "abc" }
 */
const crypto = require('crypto');

const REQUIRED = ['c_user', 'xs'];
const IMPORTANT = ['datr', 'sb', 'fr'];
const SESSION_COOKIES = ['c_user', 'xs', 'datr', 'sb', 'fr', 'presence', 'wd', 'dpr'];

function parse(raw) {
  const text = String(raw || '').trim();
  if (!text) return [];

  // JSON
  if (text.startsWith('[') || text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      const arr = Array.isArray(parsed) ? parsed : Object.entries(parsed).map(([name, value]) => ({ name, value }));
      return arr
        .filter((c) => c && c.name !== undefined && c.value !== undefined)
        .map((c) => ({ name: String(c.name).trim(), value: String(c.value) }));
    } catch (_) {
      /* نكمل كـ هيدر عادي */
    }
  }

  return text
    .split(';')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const i = chunk.indexOf('=');
      if (i < 1) return null;
      const name = chunk.slice(0, i).trim();
      let value = chunk.slice(i + 1).trim();
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      try {
        value = decodeURIComponent(value);
      } catch (_) {
        /* كما هي */
      }
      return { name, value };
    })
    .filter(Boolean);
}

function toObject(raw) {
  const out = {};
  for (const c of parse(raw)) if (!(c.name in out)) out[c.name] = c.value;
  return out;
}

function get(raw, name) {
  return toObject(raw)[name] || null;
}

/** بيرجّع قائمة أسماء المفاتيح الناقصة مقسّمة (إجباري / مهم) */
function audit(raw) {
  const map = toObject(raw);
  return {
    total: Object.keys(map).length,
    requiredMissing: REQUIRED.filter((k) => !map[k]),
    importantMissing: IMPORTANT.filter((k) => !map[k]),
  };
}

/** تحويل لصيغة context.addCookies في Playwright */
function toPlaywrightCookies(raw) {
  const seen = new Set();
  const out = [];
  for (const { name, value } of parse(raw)) {
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({
      name,
      value,
      domain: '.facebook.com',
      path: '/',
      secure: true,
      httpOnly: false,
      sameSite: 'None',
    });
  }
  return out;
}

/** بصمة مختصرة للكوكيز (تستخدم كمفتاح كاش للجلسة) */
function fingerprint(raw) {
  const relevant = SESSION_COOKIES.map((k) => `${k}=${get(raw, k) || ''}`).join('|');
  return crypto.createHash('sha256').update(relevant).digest('hex').slice(0, 16);
}

module.exports = { parse, toObject, get, audit, toPlaywrightCookies, fingerprint, REQUIRED, IMPORTANT };
