/**
 * كاش خريطة الـ doc_id الخاصة بعمليات Relay في فيسبوك.
 *
 * فيسبوك بيحط كل عملية على شكل:
 *   params:{id:"9816934428383981",name:"useMetaPayWalletInitPayPalLinkingMutation",operationKind:"mutation",...}
 *
 * الفكرة: بنمسح كل ملفات JS بنقدر نوصلها + أي طلب GraphQL بيعدّي قدامنا،
 * وبنخزّن كل (اسم العملية → doc_id) في كاش على الديسك.
 * ده بيخلينا نلاقي عمليات Meta Pay / PayPal حتى اللي مش عارفين اسمها.
 */
const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '..', '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'docids.json');
const MAX_ENTRIES = 4000;

let cache = load();

function load() {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function save() {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache), 'utf8');
  } catch (_) {
    /* الكاش مش حرج */
  }
}

function record(name, id) {
  if (!name || !id) return false;
  if (!/^\d{8,}$/.test(String(id))) return false;
  if (cache[name] === id) return false;
  if (!cache[name] && Object.keys(cache).length >= MAX_ENTRIES) return false;
  cache[name] = String(id);
  return true;
}

function get(name) {
  return cache[name] || null;
}

/** بحث بالاسم أو بـ regex */
function search(pattern, limit = 50) {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'i');
  return Object.entries(cache)
    .filter(([name]) => re.test(name))
    .slice(0, limit)
    .map(([name, id]) => ({ name, id }));
}

/** كل عمليات Meta Pay / PayPal المعروفة لحد الآن */
function paymentOps(limit = 100) {
  return search(/MetaPay|PayPal|FundingSource|PaymentMethod|payment_account|BillingHub/i, limit);
}

/**
 * مسح نص (ملف JS أو HTML) واستخراج كل أزواج id/name.
 * بيدعم ترتيبين + صيغة Relay القديمة (queryId/queryName).
 */
function harvestText(text, sink) {
  if (!text || typeof text !== 'string') return 0;
  let added = 0;

  const take = (name, id, strong) => {
    if (!strong && cache[name]) return; // الدليل الضعيف ما يغلبش الدليل القوي
    if (record(name, id)) {
      added += 1;
      if (sink) sink[name] = String(id);
    }
  };

  // (قوي) id قبل الاسم في نفس الكائن
  for (const m of text.matchAll(/id\s*:\s*"(\d{8,})"\s*,\s*name\s*:\s*"([A-Za-z0-9_.$]+)"/g)) {
    take(m[2], m[1], true);
  }

  // (ضعيف) الاسم قبل الـ id — بنقطع النافذة عند أول "}" عشان ما نخلطش عمليتين
  for (const m of text.matchAll(/name\s*:\s*"([A-Za-z0-9_.$]+)"/g)) {
    const after = text.slice(m.index + m[0].length, m.index + 300);
    const close = after.indexOf('}');
    if (close === -1) continue;
    const inside = after.slice(0, close);
    if (/name\s*:/.test(inside)) continue;
    const idm = inside.match(/id\s*:\s*"(\d{8,})"/);
    if (idm) take(m[1], idm[1], false);
  }

  // (قوي) صيغة Relay: "queryId":"123","queryName":"op"
  for (const m of text.matchAll(/"queryId"\s*:\s*"(\d{8,})"\s*,\s*"queryName"\s*:\s*"([A-Za-z0-9_.$]+)"/g)) {
    take(m[2], m[1], true);
  }
  for (const m of text.matchAll(/"queryName"\s*:\s*"([A-Za-z0-9_.$]+)"\s*,\s*"queryId"\s*:\s*"(\d{8,})"/g)) {
    take(m[1], m[2], true);
  }

  if (added) save();
  return added;
}
function size() {
  return Object.keys(cache).length;
}

function snapshot() {
  return { ...cache };
}

module.exports = { record, get, search, paymentOps, harvestText, size, snapshot, save };
