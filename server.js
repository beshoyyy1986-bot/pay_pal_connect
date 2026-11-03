/**
 * server.js — ربط PayPal كوسيلة دفع داخل حساب Meta الإعلاني
 * النسخة: 3.0.0
 *
 * أهم تغييرات هذه النسخة:
 *  1) لا يوجد أي إدخال يدوي لـ fb_dtsg (تم حذفه بالكامل من الواجهة والـ API).
 *  2) كل البارامترات تُقرأ لايف من جلسة فيسبوك حقيقية مفتوحة بـ Playwright:
 *     fb_dtsg / lsd / __rev / __hs / __s / __hsi — ثم يُحسب jazoest منها.
 *  3) اكتشاف doc_id الخاص بالـ mutation تلقائياً من ملفات JS المحمّلة في الصفحة
 *     (مع fallback من الـ env لو فيسبوك غيّر الباندل).
 *  4) القبول برابط الحساب الإعلاني (Ads Manager) بدل الرقم فقط.
 */
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 8080;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

const UA =
  process.env.FB_USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const OP_INIT = 'useMetaPayWalletInitPayPalLinkingMutation';
const FALLBACK_DOC_ID = process.env.PAYPAL_INIT_DOC_ID || '';
const FALLBACK_HS = process.env.FB_HS || '20618.HYP:accounts_center_pkg.2.1..0';
const FALLBACK_PROFILE_ID =
  process.env.PAYPAL_PROFILE_ID ||
  'FXACINFRAOBIDPERVIEWERAVMwhxCKmjhHOsHYDHD2jJttp4MJMP0zcJb-tOnHowAUfL3PcWtQEL4CVskvwI4eC03vgkFlaYWgsVgu8VTFoQzDkQ';

app.use(cors());
app.use(express.json({ limit: '10mb' }));

/* ============================ أدوات مساعدة ============================ */

function parseCookieHeader(raw) {
  return String(raw || '')
    .split(';')
    .map((c) => c.trim())
    .filter(Boolean)
    .map((chunk) => {
      const i = chunk.indexOf('=');
      if (i < 1) return null;
      const name = chunk.slice(0, i).trim();
      let value = chunk.slice(i + 1).trim();
      try {
        value = decodeURIComponent(value);
      } catch (_) {
        /* نتركها كما هي */
      }
      return { name, value };
    })
    .filter(Boolean);
}

function getCookieValue(raw, name) {
  const hit = parseCookieHeader(raw).find((c) => c.name === name);
  return hit ? hit.value : null;
}

/**
 * يقبل أي شكل من أشكال الحساب الإعلاني:
 *   123456789 | act_123456789 | https://adsmanager.facebook.com/...?act=123456789
 */
function resolveAdAccountId(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';

  const fromUrl =
    raw.match(/\bact=(\d{5,})/i) ||
    raw.match(/\bact_(\d{5,})/i) ||
    raw.match(/account_id["'=:]+(\d{5,})/i);
  if (fromUrl) return `act_${fromUrl[1]}`;

  if (/^act_\d+$/i.test(raw)) return raw.toLowerCase();

  const digits = raw.replace(/[^\d]/g, '');
  return digits ? `act_${digits}` : '';
}

/** jazoest = "2" + مجموع أكواد حروف fb_dtsg */
function jazoestFrom(dtsg) {
  let sum = 0;
  for (const ch of String(dtsg)) sum += ch.charCodeAt(0);
  return `2${sum}`;
}

function pick(html, patterns) {
  for (const re of patterns) {
    const m = String(html).match(re);
    if (m && m[1]) return m[1];
  }
  return null;
}

function normalizeCookieForBrowser(raw) {
  const seen = new Set();
  const out = [];
  for (const { name, value } of parseCookieHeader(raw)) {
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, value, domain: '.facebook.com', path: '/', secure: true, sameSite: 'None' });
  }
  return out;
}

/* ======================= قراءة بارامترات الجلسة ======================= */

function extractClientParams(html) {
  const dtsg = pick(html, [
    /"DTSGInitialData",\[\],\{"token":"([^"]+)"/,
    /"DTSGInitData",\[\],\{"token":"([^"]+)"/,
    /name="fb_dtsg"\s+value="([^"]+)"/,
  ]);

  const lsd = pick(html, [/"LSD",\[\],\{"token":"([^"]+)"/, /"lsd"\s*:\s*"([^"]+)"/]);

  const rev = pick(html, [
    /"__spin_rev"\s*:\s*"?(\d+)"?/,
    /"server_revision"\s*:\s*"?(\d+)"?/,
    /"rev"\s*:\s*(\d{6,})/,
  ]);

  const hs = pick(html, [
    /"__hs"\s*:\s*"([^"]+)"/,
    /"haste_session"\s*:\s*"([^"]+)"/,
    /"hsi"\s*:\s*"([^"]+)"/,
  ]);

  const hsi = pick(html, [/"hsi"\s*:\s*"(\d+)"/, /"__hsi"\s*:\s*"(\d+)"/]);

  const s = pick(html, [
    /"__s"\s*:\s*"([^"]+)"/,
    /"s"\s*:\s*"([a-z0-9]{6}:[a-z0-9]{6}:[a-z0-9]{6})"/,
    /([a-z0-9]{6}:[a-z0-9]{6}:[a-z0-9]{6})/,
  ]);

  return { dtsg, lsd, rev, hs, hsi, s };
}

/* ============================== Playwright ============================== */

async function openFacebookSession(cookieHeader) {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (_) {
    throw new Error(
      'مكتبة playwright غير مثبتة على السيرفر. شغّل: npm install && npx playwright install --with-deps chromium'
    );
  }

  const browser = await chromium.launch({
    headless: process.env.HEADLESS !== 'false',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'],
  });

  try {
    const context = await browser.newContext({
      userAgent: UA,
      locale: 'en-US',
      timezoneId: 'Africa/Cairo',
      viewport: { width: 1366, height: 900 },
      extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
    });
    await context.addCookies(normalizeCookieForBrowser(cookieHeader));

    const page = await context.newPage();
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3000);

    const url = page.url();
    const html = await page.content();
    const domDtsg = await page
      .evaluate(() => {
        const el = document.querySelector('input[name="fb_dtsg"]');
        return el ? el.value : null;
      })
      .catch(() => null);

    const params = extractClientParams(html);
    if (domDtsg) params.dtsg = domDtsg;

    if (/\/login|checkpoint|two_step/i.test(url) || !params.dtsg) {
      throw new Error('انتهت صلاحية الكوكيز أو الحساب يحتاج تحقق — جدّد الكوكيز من المتصفح ثم أعد المحاولة.');
    }

    return { browser, context, page, params };
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
}

/**
 * يبحث عن doc_id الخاص بالـ mutation داخل ملفات JS المحمّلة في الصفحة.
 * فيسبوك يضع البارامترات على شكل: params:{id:"981...",name:"useMetaPay...",...}
 */
async function discoverDocId(page, cookieHeader, operationName) {
  if (FALLBACK_DOC_ID) return FALLBACK_DOC_ID;

  const sources = await page
    .$$eval('script[src]', (els) => els.map((e) => e.src).filter(Boolean))
    .catch(() => []);

  const re = /\.js(\?|$)/;
  for (const src of sources.filter((u) => re.test(u)).slice(0, 60)) {
    try {
      const { data } = await axios.get(src, {
        headers: { Cookie: cookieHeader, 'User-Agent': UA },
        timeout: 8000,
        responseType: 'text',
      });
      const text = String(data || '');
      const idx = text.indexOf(operationName);
      if (idx === -1) continue;
      const windowText = text.slice(Math.max(0, idx - 800), idx + 800);
      const m =
        windowText.match(/id\s*:\s*"(\d{8,})"/) ||
        windowText.match(/queryId\s*:\s*"(\d{8,})"/) ||
        windowText.match(/doc_id\s*[:=]\s*"?(\d{8,})"?/);
      if (m) return m[1];
    } catch (_) {
      /* نتجاهل الملف ونكمل */
    }
  }
  return null;
}

/* ============================ استدعاء GraphQL ============================ */

function parseGraphQLResponse(text) {
  let body = String(text || '').trim();
  if (body.startsWith('for (;;);')) body = body.slice('for (;;);'.length);
  try {
    return JSON.parse(body);
  } catch (_) {
    return { raw: body.slice(0, 800) };
  }
}

async function initPayPalLink({ page, params, docId, userId, returnUrl }) {
  const fbDtsg = params.dtsg;
  const body = new URLSearchParams({
    __a: '1',
    __req: '1a',
    __hs: params.hs || FALLBACK_HS,
    dpr: '1',
    __ccg: 'UNKNOWN',
    __rev: params.rev || '',
    __s: params.s || '',
    __hsi: params.hsi || '',
    fb_dtsg: fbDtsg,
    jazoest: jazoestFrom(fbDtsg),
    lsd: params.lsd || '',
    fb_api_caller_class: 'RelayModern',
    fb_api_req_friendly_name: OP_INIT,
    server_timestamps: 'true',
    variables: JSON.stringify({
      input: {
        mutation_params: {
          close_url: returnUrl,
          login_ref_id: crypto.randomUUID(),
        },
        profile_id: FALLBACK_PROFILE_ID,
        actor_id: userId,
        client_mutation_id: '3',
      },
    }),
    doc_id: docId,
  }).toString();

  // الطلب بيتم من داخل المتصفح نفسه حتى تُستخدم نفس الجلسة والبصمة
  let text = null;
  try {
    text = await page.evaluate(
      async ({ b, op }) => {
        const res = await fetch('https://www.facebook.com/api/graphql/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-FB-Friendly-Name': op,
          },
          body: b,
          credentials: 'include',
        });
        return await res.text();
      },
      { b: body, op: OP_INIT }
    );
  } catch (_) {
    /* نرجع لـ axios تحت */
  }

  if (!text) {
    const res = await axios.post('https://www.facebook.com/api/graphql/', body, {
      headers: {
        Cookie: params.cookieHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': UA,
        Origin: 'https://www.facebook.com',
        Referer: 'https://www.facebook.com/',
      },
      timeout: 25000,
      validateStatus: () => true,
    });
    text = res.data;
  }

  const data = parseGraphQLResponse(text);
  const approvalUrl =
    data?.data?.meta_pay_wallet_init_paypal_linking?.paypal_approval_url ||
    data?.data?.meta_pay_wallet_init_paypal_linking?.redirect_url ||
    data?.data?.paypal_approval_url ||
    data?.data?.redirect_url;

  if (!approvalUrl) {
    const fbError =
      data?.errors?.[0]?.message ||
      data?.error?.message ||
      data?.errorSummary ||
      data?.raw ||
      'استجابة غير مفهومة من فيسبوك';
    const err = new Error(`تعذّر الحصول على رابط PayPal: ${String(fbError).slice(0, 400)}`);
    err.debug = { docId, hasDtsg: !!fbDtsg, hasLsd: !!params.lsd, hasRev: !!params.rev, hasS: !!params.s };
    throw err;
  }

  return approvalUrl;
}

/* ================================ Routes ================================ */

app.get('/health', (_req, res) => {
  res.json({ ok: true, version: '3.0.0', mode: 'playwright-auto-capture', baseUrl: BASE_URL });
});

app.post('/api/start-linking', async (req, res) => {
  const startedAt = Date.now();
  const { cookies, adAccountId: adAccountInput } = req.body || {};

  console.log('\n========================================');
  console.log('NEW PAYPAL LINKING REQUEST');
  console.log('========================================');
  console.log('Ad Account input:', adAccountInput);
  console.log('Cookies length:', cookies ? String(cookies).length : 0);
  console.log('========================================\n');

  if (!cookies || !adAccountInput) {
    return res.status(400).json({ error: 'بيانات ناقصة: الكوكيز ومعرف/رابط الحساب الإعلاني مطلوبان.' });
  }

  const adAccountId = resolveAdAccountId(adAccountInput);
  const userId = getCookieValue(cookies, 'c_user');

  console.log('c_user:', userId);
  console.log('Resolved Ad Account:', adAccountId);

  if (!adAccountId) {
    return res.status(400).json({ error: 'معرف الحساب الإعلاني غير صالح. الصق الرقم أو رابط الـ Ads Manager.' });
  }
  if (!userId) {
    return res.status(400).json({ error: 'الكوكيز غير صالحة (لا يوجد c_user).' });
  }

  let session;
  try {
    console.log('فتح جلسة فيسبوك عبر Playwright...');
    session = await openFacebookSession(cookies);
    session.params.cookieHeader = cookies;

    console.log('البارامترات الملتقطة:', {
      fb_dtsg: !!session.params.dtsg,
      lsd: !!session.params.lsd,
      rev: !!session.params.rev,
      hs: !!session.params.hs,
      s: !!session.params.s,
      hsi: !!session.params.hsi,
    });

    const docId = await discoverDocId(session.page, cookies, OP_INIT);
    console.log('doc_id:', docId || '(غير مكتشف — لازم PAYPAL_INIT_DOC_ID)');

    if (!docId) {
      return res.status(500).json({
        error: 'لم يتم العثور على doc_id الخاص بعملية الربط. حدّد PAYPAL_INIT_DOC_ID في متغيرات البيئة.',
      });
    }

    const approvalUrl = await initPayPalLink({
      page: session.page,
      params: session.params,
      docId,
      userId,
      returnUrl: `${BASE_URL}/paypal-callback`,
    });

    console.log(`approval URL ready in ${Date.now() - startedAt}ms`);

    res.json({
      approvalUrl,
      adAccountId,
      userId,
      docId,
      captured: {
        fb_dtsg: !!session.params.dtsg,
        lsd: !!session.params.lsd,
        rev: !!session.params.rev,
        hs: !!session.params.hs,
        s: !!session.params.s,
        hsi: !!session.params.hsi,
      },
    });
  } catch (err) {
    console.error('Server Error:', err.message);
    res.status(500).json({ error: err.message, debug: err.debug });
  } finally {
    if (session && session.browser) await session.browser.close().catch(() => {});
  }
});

/**
 * legacy: إدخال وسيلة الدفع مباشرة عبر graph.facebook.com
 * الـ endpoint ده مش بيقبل كوكيز، وغالباً مش محتاجه أصلاً لأن فيسبوك بيكمّل الربط
 * بنفسه بعد موافقة PayPal. سيتم استبداله في الخطوة الثانية بـ mutation صحيحة.
 */
app.post('/api/insert-funding-source', async (req, res) => {
  const { cookies, adAccountId, paymentToken, payerId } = req.body || {};
  if (!cookies || !adAccountId || !paymentToken || !payerId) {
    return res.status(400).json({ error: 'بيانات ناقصة.' });
  }

  try {
    const { data } = await axios.post(
      `https://graph.facebook.com/v18.0/${resolveAdAccountId(adAccountId)}/funding_sources`,
      { payment_method_type: 'paypal', paypal_account: { token: paymentToken, payer_id: payerId } },
      {
        headers: {
          Cookie: cookies,
          'Content-Type': 'application/json',
          'User-Agent': UA,
        },
        timeout: 20000,
      }
    );
    res.json({ success: true, data });
  } catch (err) {
    const msg = (err.response && err.response.data && err.response.data.error && err.response.data.error.message) || err.message;
    res.status(500).json({ error: `فشل إدخال وسيلة الدفع: ${msg}` });
  }
});

/* ============================== Callback ============================== */

app.get('/paypal-callback', (req, res) => {
  const { token, payer_id, PayerID } = req.query;
  const payerId = payer_id || PayerID;

  const safe = (v) => String(v || '').replace(/[^A-Za-z0-9._-]/g, '');

  console.log('\n========================================');
  console.log('PAYPAL CALLBACK DATA RECEIVED');
  console.log('Token:', token);
  console.log('PayerID:', payerId);
  console.log('========================================\n');

  if (!token || !payerId) {
    return res.status(400).send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>PayPal</title></head>
      <body style="font-family:sans-serif;text-align:center;padding:40px">
      <h2>لم يتم استلام التوكن أو معرف الدافع</h2>
      <p>ارجع للتطبيق وحاول مرة أخرى.</p>
      <script>setTimeout(function(){window.close()},3000)</script></body></html>`);
  }

  const t = safe(token);
  const p = safe(payerId);

  res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>تم الربط</title>
<style>
 body{font-family:'Segoe UI',Tahoma,sans-serif;text-align:center;padding:50px;background:#0b1020;color:#edf4ff}
 .card{background:#166534;border-radius:12px;padding:24px;max-width:420px;margin:0 auto}
 h1{color:#ffbf00;font-size:22px}
 .spin{display:inline-block;width:20px;height:20px;border:3px solid rgba(255,255,255,.3);border-radius:50%;border-top-color:#ffbf00;animation:sp 1s linear infinite}
 @keyframes sp{to{transform:rotate(360deg)}}
</style></head><body>
<div class="card"><h1>تم الربط بنجاح</h1><p>جارٍ نقل البيانات إلى التطبيق...</p><div class="spin"></div></div>
<script>
(function(){
  var payload = {type:'PAYPAL_SUCCESS', token:'${t}', payerId:'${p}'};
  try {
    if (window.opener) {
      window.opener.postMessage(payload, window.location.origin);
      setTimeout(function(){window.close()}, 1200);
    } else {
      document.body.innerHTML = '<div class="card"><h1>تم الربط</h1><p>يمكنك إغلاق هذه النافذة.</p></div>';
    }
  } catch (e) {
    document.body.innerHTML = '<div class="card"><h1>حدث خطأ</h1><p>ارجع للتطبيق وحاول مرة أخرى.</p></div>';
  }
})();
</script></body></html>`);
});

/* ============================ Static files ============================ */

app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));

app.listen(PORT, () => {
  console.log(`Server v3.0.0 running on port ${PORT}`);
  console.log(`BASE_URL=${BASE_URL}`);
  console.log(`HEALTH=${BASE_URL}/health`);
});
