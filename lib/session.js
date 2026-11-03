/**
 * جلسة فيسبوك حقيقية عبر Playwright (headless) + التقاط شامل لكل ما نحتاجه.
 *
 * مبدأ التصميم: "ما نتوقفش في نقطة التقاط" — بنجمع البارامترات من 4 مصادر
 * وبنرتّبها بالأولوية، ولو مصدر فشل التاني بيكمّل:
 *   1) طلبات GraphQL حقيقية يعملها المتصفح بنفسه  (أعلى ثقة)
 *   2) DOM + موديولات فيسبوك (DTSGInitialData / LSD / SiteData)
 *   3) HTML الصفحة (أنماط متعددة)
 *   4) صفحات بديلة: mbasic.facebook.com ثم business.facebook.com
 *
 * وكل ما نشوف عملية Relay بنسجّلها في كاش doc_id (مفيد لهندسة Meta Pay العكسية).
 */
const axios = require('axios');
const cookieLib = require('./cookies');
const docids = require('./docids');
const browserLib = require('./browser');

const UA =
  process.env.FB_USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const NAV_TIMEOUT = Number(process.env.FB_NAV_TIMEOUT || 45000);
const SETTLE_MS = Number(process.env.FB_SETTLE_MS || 3500);
const MAX_FILES = Number(process.env.FB_SCAN_FILES || 90);
const EVAL_TIMEOUT = Number(process.env.FB_EVAL_TIMEOUT || 60000);

const NET_KEYS = ['fb_dtsg', 'jazoest', 'lsd', '__rev', '__hs', '__s', '__hsi', '__ccg', 'dpr', '__req', '__a', '__user'];

const HOSTS = {
  www: 'https://www.facebook.com/',
  mbasic: 'https://mbasic.facebook.com/',
  business: 'https://business.facebook.com/latest/home',
  adsmanager: 'https://adsmanager.facebook.com/adsmanager/manage/campaigns',
};

/* ============================ تحديد التوازي ============================ */

let active = 0;
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT_SESSIONS || 2);

async function acquire() {
  while (active >= MAX_CONCURRENT) await new Promise((r) => setTimeout(r, 150));
  active += 1;
}

function release() {
  active = Math.max(0, active - 1);
}

/* ============================== ستيلث ============================== */

function stealthInit() {
  try {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    if (!window.chrome) window.chrome = { runtime: {} };
    const origQuery = window.navigator.permissions && window.navigator.permissions.query;
    if (origQuery) {
      window.navigator.permissions.query = (p) =>
        p && p.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : origQuery.call(window.navigator.permissions, p);
    }
  } catch (_) {
    /* مش حرج */
  }
}

/* ============================ مراقبة الشبكة ============================ */

function inspectRequest(req, net) {
  let url = '';
  try {
    url = req.url();
  } catch (_) {
    return;
  }
  if (!/\/api\/graphql/i.test(url)) return;

  let body = '';
  try {
    body = req.postData() || '';
  } catch (_) {
    return;
  }
  if (!body) return;

  const sp = new URLSearchParams(body);
  for (const key of NET_KEYS) {
    const v = sp.get(key);
    if (v && !net.params[key]) net.params[key] = v;
  }

  const name = sp.get('fb_api_req_friendly_name');
  const docId = sp.get('doc_id');
  if (name && docId) {
    net.ops[name] = docId;
    docids.record(name, docId);
  }

  const vars = sp.get('variables') || '';
  if (/meta_?pay|paypal|funding|payment|payer/i.test(vars) || /MetaPay|PayPal|Funding/i.test(name || '')) {
    net.hits.push({
      name: name || null,
      docId: docId || null,
      variables: vars.slice(0, 5000),
      at: new Date().toISOString(),
    });
  }
}

/* ============================== إنشاء جلسة ============================== */

async function startSession(cookieHeader) {
  const launched = await browserLib.connect();
  const browser = launched.browser;

  const context = await browser.newContext({
    userAgent: UA,
    locale: 'en-US',
    timezoneId: process.env.FB_TZ || 'Africa/Cairo',
    viewport: { width: 1366, height: 900 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    javaScriptEnabled: true,
    bypassCSP: true,
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'Upgrade-Insecure-Requests': '1',
    },
    ignoreHTTPSErrors: true,
  });

  await context.addInitScript(stealthInit);
  await context.addCookies(cookieLib.toPlaywrightCookies(cookieHeader));

  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(NAV_TIMEOUT);

  const net = { params: {}, ops: {}, hits: [] };
  page.on('request', (req) => inspectRequest(req, net));

  return { browser, context, page, net, cookieHeader, mode: launched.mode, remote: launched.remote };
}

async function closeSession(session) {
  if (!session) return;
  try {
    if (session.context) await session.context.close();
  } catch (_) {
    /* ignore */
  }
  try {
    if (session.browser) await session.browser.close();
  } catch (_) {
    /* ignore */
  }
}

/* ============================ التقاط البارامترات ============================ */

function pick(html, patterns) {
  for (const re of patterns) {
    const m = String(html).match(re);
    if (m && m[1]) return m[1];
  }
  return null;
}

function extractFromHtml(html) {
  return {
    fb_dtsg: pick(html, [
      /"DTSGInitialData",\[\],\{"token":"([^"]+)"/,
      /"DTSGInitData",\[\],\{"token":"([^"]+)"/,
      /name="fb_dtsg"\s+value="([^"]+)"/,
    ]),
    lsd: pick(html, [/"LSD",\[\],\{"token":"([^"]+)"/, /"lsd"\s*:\s*"([^"]+)"/]),
    __rev: pick(html, [
      /"__spin_rev"\s*:\s*"?(\d+)"?/,
      /"server_revision"\s*:\s*"?(\d+)"?/,
      /"rev"\s*:\s*(\d{6,})/,
    ]),
    __hs: pick(html, [/"__hs"\s*:\s*"([^"]+)"/, /"haste_session"\s*:\s*"([^"]+)"/]),
    __hsi: pick(html, [/"hsi"\s*:\s*"(\d+)"/, /"__hsi"\s*:\s*"(\d+)"/]),
    __s: pick(html, [
      /"__s"\s*:\s*"([^"]+)"/,
      /"s"\s*:\s*"([a-z0-9]{6}:[a-z0-9]{6}:[a-z0-9]{6})"/,
      /([a-z0-9]{6}:[a-z0-9]{6}:[a-z0-9]{6})/,
    ]),
  };
}

async function extractFromDom(page) {
  return page
    .evaluate(() => {
      const out = {};
      const req = window.require;
      const el = document.querySelector('input[name="fb_dtsg"]');
      if (el && el.value) out.fb_dtsg = el.value;

      try {
        if (req) {
          const dtsg = req('DTSGInitialData');
          if (dtsg && dtsg.token && !out.fb_dtsg) out.fb_dtsg = dtsg.token;
        }
      } catch (_) {}
      try {
        if (req) {
          const lsd = req('LSD');
          if (lsd && lsd.token) out.lsd = lsd.token;
        }
      } catch (_) {}
      try {
        if (req) {
          const site = req('SiteData');
          if (site) {
            if (site.rev) out.__rev = String(site.rev);
            if (site.hsi) out.__hsi = String(site.hsi);
            if (site.haste_session) out.__hs = String(site.haste_session);
            if (site.server_ld && site.server_ld.s) out.__s = String(site.server_ld.s);
          }
        }
      } catch (_) {}
      try {
        const m = document.documentElement.innerHTML.match(/"server_ld",\[\],\{"s":"([^"]+)"/);
        if (m) out.__s = out.__s || m[1];
      } catch (_) {}
      return out;
    })
    .catch(() => ({}));
}

const PRIORITY = ['network', 'dom', 'html'];

/**
 * بيدمج المصادر بالأولوية ويحدد لكل بارامتر مصدره.
 */
function mergeParams(sources) {
  const params = {};
  const from = {};

  for (const sourceName of PRIORITY) {
    const source = sources[sourceName] || {};
    for (const [key, value] of Object.entries(source)) {
      if (value && !params[key]) {
        params[key] = value;
        from[key] = sourceName;
      }
    }
  }

  return { params, from };
}

/* ============================ فحص تسجيل الدخول ============================ */

async function assertLoggedIn(page) {
  const url = page.url();
  if (/\/login|\/checkpoint|two_step|recover|confirmemail/i.test(url)) {
    throw new Error('JOIN_LOGIN: الكوكيز منتهية أو الحساب محتاج تحقق (تم التحويل لصفحة دخول/checkpoint).');
  }

  const text = await page
    .evaluate(() => (document.body ? document.body.innerText.slice(0, 5000) : ''))
    .catch(() => '');

  if (/log in to continue|log into facebook|session (has )?expired|كلمة السر/i.test(text)) {
    throw new Error('JOIN_LOGIN: فيسبوك بيرجّع صفحة تسجيل دخول — الكوكيز مش صالحة.');
  }
}

/* ============================ مسح الباندلات ============================ */

async function scanBundles(page, limitFiles = MAX_FILES) {
  const found = {};
  const urls = await page
    .evaluate(() => {
      const set = new Set();
      document.querySelectorAll('script[src]').forEach((s) => s.src && set.add(s.src));
      try {
        performance.getEntriesByType('resource').forEach((e) => {
          if (/\.js(\?|$)/.test(e.name) || /\/rsrc\.php/.test(e.name)) set.add(e.name);
        });
      } catch (_) {}
      return Array.from(set);
    })
    .catch(() => []);

  const list = urls.slice(0, limitFiles);
  if (!list.length) return { found, scanned: 0, total: 0 };

  const pairs = await Promise.race([
    page.evaluate(async (urls) => {
      const res = {};
      const scan = (text) => {
        for (const m of text.matchAll(/id\s*:\s*"(\d{8,})"\s*,\s*name\s*:\s*"([A-Za-z0-9_.$]+)"/g)) {
          res[m[2]] = m[1];
        }
        for (const m of text.matchAll(/"queryId"\s*:\s*"(\d{8,})"\s*,\s*"queryName"\s*:\s*"([A-Za-z0-9_.$]+)"/g)) {
          res[m[2]] = m[1];
        }
      };
      const chunks = [];
      for (let i = 0; i < urls.length; i += 6) chunks.push(urls.slice(i, i + 6));
      for (const chunk of chunks) {
        await Promise.all(
          chunk.map(async (u) => {
            try {
              const r = await fetch(u, { credentials: 'include' });
              if (!r.ok) return;
              const t = await r.text();
              if (t) scan(t);
            } catch (_) {}
          })
        );
      }
      return res;
    }, list),
    new Promise((resolve) => setTimeout(() => resolve({}), EVAL_TIMEOUT)),
  ]).catch(() => ({}));

  for (const [name, id] of Object.entries(pairs || {})) {
    found[name] = id;
    docids.record(name, id);
  }

  return { found, scanned: list.length, total: urls.length };
}

/* ============================ التقاط شامل ============================ */

/**
 * @returns {Promise<object>} تقرير كامل بالبارامترات ومصادرها والعمليات المكتشفة
 */
async function captureAll(session, opts = {}) {
  const startedAt = Date.now();
  const report = {
    ok: false,
    elapsedMs: 0,
    url: null,
    loggedIn: false,
    params: {},
    sources: {},
    missing: [],
    docIdCount: 0,
    paymentOps: [],
    netOps: {},
    hits: [],
    warnings: [],
    visits: [],
  };

  const { page, net } = session;

  // 1) الصفحة الأساسية
  report.visits.push('www');
  await page.goto(HOSTS.www, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
  await page.waitForTimeout(SETTLE_MS);
  await assertLoggedIn(page);
  report.loggedIn = true;
  report.url = page.url();

  let html = await page.content();
  let dom = await extractFromDom(page);
  let htmlParams = extractFromHtml(html);

  let merged = mergeParams({ network: net.params, dom, html: htmlParams });

  // 2) لو ناقص شيء مهم → mbasic
  if (!merged.params.fb_dtsg || !merged.params.lsd) {
    report.warnings.push('www ناقص — بنجرب mbasic.facebook.com');
    try {
      await page.goto(HOSTS.mbasic, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
      await page.waitForTimeout(1800);
      const htmlM = await page.content();
      const domM = await extractFromDom(page);
      merged = mergeParams({
        network: net.params,
        dom: { ...domM, ...dom },
        html: { ...extractFromHtml(htmlM), ...htmlParams },
      });
      report.visits.push('mbasic');
    } catch (err) {
      report.warnings.push(`mbasic فشل: ${err.message}`);
    }
  }

  // 3) لو لسه في نقص → business.facebook.com (بيحمّل باندلات Meta Pay)
  if (opts.visitBusiness !== false) {
    try {
      await page.goto(HOSTS.business, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
      await page.waitForTimeout(SETTLE_MS);
      const htmlB = await page.content();
      const domB = await extractFromDom(page);
      merged = mergeParams({
        network: net.params,
        dom: { ...dom, ...domB },
        html: { ...htmlParams, ...extractFromHtml(htmlB) },
      });
      report.visits.push('business');
    } catch (err) {
      report.warnings.push(`business فشل: ${err.message}`);
    }
  }

  // 4) مسح الباندلات (لو لسه محتاجين doc_id أو بنبني الكاش)
  let scanResult = { found: {}, scanned: 0, total: 0 };
  if (opts.scan !== false) {
    try {
      scanResult = await scanBundles(page, opts.scanFiles || MAX_FILES);
    } catch (err) {
      report.warnings.push(`مسح الباندلات فشل: ${err.message}`);
    }
  }

  // 5) دمج عمليات الشبكة + الكاش
  const ops = { ...scanResult.found, ...net.ops, ...opts.extraDocIds };
  for (const [name, id] of Object.entries(ops)) docids.record(name, id);

  report.params = merged.params;
  report.sources = merged.from;
  report.missing = ['fb_dtsg', 'lsd', '__rev', '__hs', '__s', '__hsi'].filter((k) => !merged.params[k]);
  report.docIdCount = docids.size();
  report.netOps = ops;
  report.paymentOps = docids.paymentOps(60);
  report.hits = net.hits;
  report.scannedBundles = scanResult.scanned;
  report.totalBundleCandidates = scanResult.total;
  report.ok = !!merged.params.fb_dtsg;
  report.elapsedMs = Date.now() - startedAt;

  return report;
}

/* ============================ استدعاء GraphQL ============================ */

function parseResponse(text) {
  let body = String(text || '').trim();
  if (body.startsWith('for (;;);')) body = body.slice('for (;;);'.length);
  try {
    return JSON.parse(body);
  } catch (_) {
    return { raw: body.slice(0, 1200) };
  }
}

function jazoestFrom(dtsg) {
  let sum = 0;
  for (const ch of String(dtsg)) sum += ch.charCodeAt(0);
  return `2${sum}`;
}

async function postGraphQL(session, params, { docId, friendlyName, variables, extra = {} }) {
  const fbDtsg = params.fb_dtsg;
  if (!fbDtsg) throw new Error('fb_dtsg غير متوفر — أعد تشغيل التقاط الجلسة.');

  const body = new URLSearchParams({
    __a: '1',
    __req: extra.__req || '1a',
    __hs: params.__hs || process.env.FB_HS || '20618.HYP:accounts_center_pkg.2.1..0',
    dpr: '1',
    __ccg: 'UNKNOWN',
    __rev: params.__rev || '',
    __s: params.__s || '',
    __hsi: params.__hsi || '',
    fb_dtsg: fbDtsg,
    jazoest: jazoestFrom(fbDtsg),
    lsd: params.lsd || '',
    fb_api_caller_class: 'RelayModern',
    fb_api_req_friendly_name: friendlyName,
    server_timestamps: 'true',
    variables: JSON.stringify(variables || {}),
    doc_id: docId,
  }).toString();

  let text = null;
  try {
    text = await Promise.race([
      session.page.evaluate(
        async ({ b, op, lsd }) => {
          const res = await fetch('https://www.facebook.com/api/graphql/', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'X-FB-Friendly-Name': op,
              'X-FB-LSD': lsd || '',
            },
            body: b,
            credentials: 'include',
          });
          return await res.text();
        },
        { b: body, op: friendlyName, lsd: params.lsd || '' }
      ),
      new Promise((resolve) => setTimeout(() => resolve(null), 30000)),
    ]);
  } catch (_) {
    text = null;
  }

  if (!text) {
    const res = await axios.post('https://www.facebook.com/api/graphql/', body, {
      headers: {
        Cookie: session.cookieHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': UA,
        'X-FB-Friendly-Name': friendlyName,
        'X-FB-LSD': params.lsd || '',
        Origin: 'https://www.facebook.com',
        Referer: 'https://www.facebook.com/',
      },
      timeout: 30000,
      validateStatus: () => true,
    });
    text = res.data;
  }

  return parseResponse(text);
}

module.exports = {
  acquire,
  release,
  startSession,
  closeSession,
  captureAll,
  postGraphQL,
  parseResponse,
  jazoestFrom,
  scanBundles,
  assertLoggedIn,
  extractFromDom,
  extractFromHtml,
  mergeParams,
  HOSTS,
};
