/**
 * server.js — ربط PayPal كوسيلة دفع داخل حساب Meta الإعلاني
 * v3.1 — التقاط شامل (Playwright headless) بدون أي إدخال يدوي
 *
 * البنية:
 *   lib/cookies.js   → تحليل وفحص الكوكيز
 *   lib/adaccount.js → استخراج معرف الحساب من رقم/رابط
 *   lib/session.js   → جلسة فيسبوك + التقاط البارامترات + GraphQL
 *   lib/docids.js    → كاش خريطة doc_id لعمليات Relay
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const cookieLib = require('./lib/cookies');
const { resolveAdAccountId } = require('./lib/adaccount');
const sessionLib = require('./lib/session');
const docids = require('./lib/docids');

const app = express();
const PORT = process.env.PORT || 8080;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

const OP_INIT = process.env.PAYPAL_INIT_OP || 'useMetaPayWalletInitPayPalLinkingMutation';
const PROFILE_ID =
  process.env.PAYPAL_PROFILE_ID ||
  'FXACINFRAOBIDPERVIEWERAVMwhxCKmjhHOsHYDHD2jJttp4MJMP0zcJb-tOnHowAUfL3PcWtQEL4CVskvwI4eC03vgkFlaYWgsVgu8VTFoQzDkQ';

app.use(cors());
app.use(express.json({ limit: '12mb' }));

// نسمح للطلبات الطويلة (فتح متصفح + مسح باندلات)
app.use((req, res, next) => {
  res.setTimeout(Number(process.env.REQUEST_TIMEOUT_MS || 180000));
  next();
});

/* ============================ أدوات مساعدة ============================ */

function mask(value) {
  const v = String(value || '');
  if (!v) return null;
  if (v.length <= 10) return `${v.slice(0, 2)}***`;
  return `${v.slice(0, 6)}...${v.slice(-4)} (${v.length})`;
}

function maskParams(params) {
  const out = {};
  for (const [k, v] of Object.entries(params || {})) out[k] = mask(v);
  return out;
}

function publicReport(report, reveal = false) {
  return {
    ok: report.ok,
    loggedIn: report.loggedIn,
    elapsedMs: report.elapsedMs,
    visits: report.visits,
    captured: {
      fb_dtsg: !!report.params.fb_dtsg,
      lsd: !!report.params.lsd,
      __rev: !!report.params.__rev,
      __hs: !!report.params.__hs,
      __s: !!report.params.__s,
      __hsi: !!report.params.__hsi,
    },
    sources: report.sources,
    missing: report.missing,
    paramsMasked: reveal
      ? undefined
      : maskParams({
          fb_dtsg: report.params.fb_dtsg,
          lsd: report.params.lsd,
          __rev: report.params.__rev,
          __hs: report.params.__hs,
          __s: report.params.__s,
          __hsi: report.params.__hsi,
        }),
    params: reveal ? report.params : undefined,
    docIdCount: report.docIdCount,
    paymentOps: report.paymentOps,
    netOps: report.netOps,
    hits: report.hits,
    scannedBundles: report.scannedBundles,
    totalBundleCandidates: report.totalBundleCandidates,
    warnings: report.warnings,
  };
}

function validateCookies(cookies) {
  const audit = cookieLib.audit(cookies);
  if (audit.requiredMissing.length) {
    const err = new Error(
      `الكوكيز ناقصة: ${audit.requiredMissing.join(', ')} — انسخ الكوكيز كاملة من المتصفح.`
    );
    err.status = 400;
    err.audit = audit;
    throw err;
  }
  return audit;
}

/* ================================ Routes ================================ */

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    version: '3.1.0',
    mode: 'playwright-headless-auto-capture',
    baseUrl: BASE_URL,
    headless: process.env.HEADLESS !== 'false',
    docIdsCached: docids.size(),
  });
});

/** بحث في كاش عمليات Relay — مفيد لهندسة Meta Pay العكسية */
app.get('/api/docids', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) {
    return res.json({ total: docids.size(), payment: docids.paymentOps(80) });
  }
  res.json({ query: q, results: docids.search(q, 80) });
});

/**
 * التقاط فقط (بدون أي mutation) — بيتحقق من صحة الكوكيز ويعرض كل اللي اتعلم.
 * استخدمه للتحقق قبل أي عملية ربط.
 */
app.post('/api/capture', async (req, res) => {
  const { cookies, reveal = false, visitBusiness = true, scan = true } = req.body || {};
  let session;
  await sessionLib.acquire();
  try {
    validateCookies(cookies);
    session = await sessionLib.startSession(cookies);
    const report = await sessionLib.captureAll(session, { visitBusiness, scan });
    res.json(publicReport(report, !!reveal));
  } catch (err) {
    console.error('CAPTURE ERROR:', err.message);
    res.status(err.status || 500).json({ error: err.message, audit: err.audit });
  } finally {
    await sessionLib.closeSession(session);
    sessionLib.release();
  }
});

/**
 * بدء ربط PayPal:
 *   { cookies, adAccountId }  →  { approvalUrl, ... }
 */
app.post('/api/start-linking', async (req, res) => {
  const startedAt = Date.now();
  const { cookies, adAccountId: adAccountInput, reveal = false } = req.body || {};

  let session;
  await sessionLib.acquire();
  try {
    validateCookies(cookies);

    const adAccountId = resolveAdAccountId(adAccountInput);
    if (!adAccountId) {
      return res.status(400).json({
        error: 'معرف الحساب الإعلاني غير صالح. الصق الرقم أو رابط الـ Ads Manager.',
      });
    }

    console.log(`\n[${new Date().toISOString()}] start-linking → ${adAccountId}`);
    session = await sessionLib.startSession(cookies);
    const report = await sessionLib.captureAll(session, { scan: true });

    if (!report.ok) {
      return res.status(500).json({
        error: 'فشل التقاط fb_dtsg من الجلسة. جرّب /api/capture لمعرفة السبب بالتفصيل.',
        report: publicReport(report, false),
      });
    }

    const docId = report.netOps[OP_INIT] || docids.get(OP_INIT) || process.env.PAYPAL_INIT_DOC_ID || null;
    if (!docId) {
      return res.status(500).json({
        error: `مش لاقي doc_id للعملية ${OP_INIT}. جرّب /api/capture ثم حدّد PAYPAL_INIT_DOC_ID.`,
        report: publicReport(report, false),
      });
    }

    const variables = {
      input: {
        mutation_params: {
          close_url: `${BASE_URL}/paypal-callback`,
          login_ref_id: crypto.randomUUID(),
        },
        profile_id: PROFILE_ID,
        actor_id: cookieLib.get(cookies, 'c_user'),
        client_mutation_id: String(Date.now()).slice(-6),
      },
    };

    const data = await sessionLib.postGraphQL(session, report.params, {
      docId,
      friendlyName: OP_INIT,
      variables,
    });

    const approvalUrl =
      data?.data?.meta_pay_wallet_init_paypal_linking?.paypal_approval_url ||
      data?.data?.meta_pay_wallet_init_paypal_linking?.redirect_url ||
      data?.data?.paypal_approval_url ||
      data?.data?.redirect_url;

    if (!approvalUrl) {
      const msg =
        data?.errors?.[0]?.message ||
        data?.error?.message ||
        data?.errorSummary ||
        data?.raw ||
        'استجابة غير مفهومة من فيسبوك';
      return res.status(502).json({
        error: `فيسبوك رفض العملية: ${String(msg).slice(0, 500)}`,
        docId,
        response: typeof data === 'object' ? JSON.parse(JSON.stringify(data).slice(0, 4000)) : data,
      });
    }

    console.log(`✅ approval ready in ${Date.now() - startedAt}ms (doc_id=${docId})`);

    res.json({
      approvalUrl,
      adAccountId,
      docId,
      captured: publicReport(report, !!reveal).captured,
      sources: report.sources,
      docIdCount: report.docIdCount,
    });
  } catch (err) {
    console.error('START-LINKING ERROR:', err.message);
    res.status(err.status || 500).json({ error: err.message, audit: err.audit });
  } finally {
    await sessionLib.closeSession(session);
    sessionLib.release();
  }
});

/**
 * منفّذ GraphQL عام — للهندسة العكسية وخطوة الربط القادمة.
 * body: { cookies, friendlyName, docId?, variables?, reveal? }
 * لو docId مش مبعوت، بيروح للكاش أو يكتشفه من الباندلات.
 */
app.post('/api/graphql', async (req, res) => {
  const { cookies, friendlyName, docId: docIdInput, variables } = req.body || {};

  if (!friendlyName) return res.status(400).json({ error: 'friendlyName مطلوب.' });

  let session;
  await sessionLib.acquire();
  try {
    validateCookies(cookies);
    session = await sessionLib.startSession(cookies);
    const report = await sessionLib.captureAll(session, { scan: !docIdInput });

    const docId = docIdInput || report.netOps[friendlyName] || docids.get(friendlyName);
    if (!docId) {
      return res.status(404).json({
        error: `مفيش doc_id معروف للعملية ${friendlyName}.`,
        paymentOps: report.paymentOps,
        docIdCount: report.docIdCount,
      });
    }

    const data = await sessionLib.postGraphQL(session, report.params, {
      docId,
      friendlyName,
      variables: variables || {},
    });

    res.json({ friendlyName, docId, response: data });
  } catch (err) {
    console.error('GRAPHQL ERROR:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  } finally {
    await sessionLib.closeSession(session);
    sessionLib.release();
  }
});

/** legacy — هيتم استبداله في خطوة الربط النهائية */
app.post('/api/insert-funding-source', async (req, res) => {
  const { adAccountId, paymentToken, payerId } = req.body || {};
  if (!adAccountId || !paymentToken || !payerId) {
    return res.status(400).json({ error: 'بيانات ناقصة.' });
  }
  res.status(501).json({
    error:
      'الـ endpoint القديم اتشال: graph.facebook.com مش بيقبل كوكيز. الربط هيتم عبر /api/graphql بعد تثبيت عملية Meta Pay.',
    next: 'POST /api/graphql { cookies, friendlyName, docId, variables }',
  });
});

/* ============================== Callback ============================== */

app.get('/paypal-callback', (req, res) => {
  const { token, payer_id, PayerID } = req.query;
  const payerId = payer_id || PayerID;
  const safe = (v) => String(v || '').replace(/[^A-Za-z0-9._-]/g, '');

  console.log('PAYPAL CALLBACK:', { token: mask(token), payerId: mask(payerId) });

  if (!token || !payerId) {
    return res.status(400).send(`<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>PayPal</title></head>
      <body style="font-family:sans-serif;text-align:center;padding:40px">
      <h2>لم يتم استلام التوكن أو معرف الدافع</h2><p>ارجع للتطبيق وحاول مرة أخرى.</p>
      <script>setTimeout(function(){window.close()},3000)</script></body></html>`);
  }

  const t = safe(token);
  const p = safe(payerId);

  res.send(`<!DOCTYPE html>
<html dir="rtl"><head><meta charset="utf-8"><title>تم الربط</title>
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
  var payload = {type:'PAYPAL_SUCCESS', token:${JSON.stringify(t)}, payerId:${JSON.stringify(p)}};
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
  console.log(`Server v3.1.0 on :${PORT} | BASE_URL=${BASE_URL} | headless=${process.env.HEADLESS !== 'false'}`);
  console.log(`Health: ${BASE_URL}/health`);
});
