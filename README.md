# ClickBridge — ربط PayPal بحساب Meta الإعلاني

أداة ويب (React + Express + Playwright) تربط حساب PayPal كوسيلة دفع داخل حساب Meta الإعلاني،
عن طريق كوكيز فيسبوك — **بدون أي إدخال يدوي للتوكنات**.

## إيه الجديد في v3

- ❌ اتشال حقل `fb_dtsg` اليدوي بالكامل (من الواجهة والـ API).
- ✅ الأداة بتفتح جلسة فيسبوك حقيقية بـ **Playwright** وبتلتقط لايف:
  `fb_dtsg` · `lsd` · `__rev` · `__hs` · `__s` · `__hsi` — ويُحسب `jazoest` منها.
- ✅ بتقبل **رابط الحساب الإعلاني** (Ads Manager) أو `act_123456789` أو الرقم فقط.
- ✅ اكتشاف `doc_id` الخاص بالـ mutation تلقائياً من ملفات JS (مع fallback من env).
- ✅ الطلب بيتم من **داخل المتصفح** نفسه → نفس الجلسة ونفس البصمة.
- ✅ التحقق من `origin` في `postMessage` + تنقية قيم الكولباك.

## التشغيل محلياً

```bash
npm install
npx playwright install --with-deps chromium
cp .env.example .env      # وعدّل BASE_URL
npm run build
npm start
```

## النشر

Playwright محتاج نظام تشغيل كامل، فمش هينفع على Vercel Functions.
استخدم Docker أو أي VPS / Railway / Render:

```bash
docker build -t paypal-linker .
docker run -p 8080:8080 --env-file .env paypal-linker
```

> ⚠️ `BASE_URL` لازم يكون الدومين الحقيقي، وإلا كولباك PayPal هيفشل.

## الـ API

| Endpoint | الوصف |
|---|---|
| `GET /health` | فحص سريع للسيرفر |
| `POST /api/start-linking` | `{ cookies, adAccountId }` → `{ approvalUrl, captured }` |
| `GET /paypal-callback` | كولباك PayPal (بيرجّع token + payerId للتطبيق) |
| `POST /api/insert-funding-source` | (legacy — سيتم استبداله في الخطوة الثانية) |

## الخطوة الثانية (قادمة)

إكمال الربط على جهة Meta بـ mutation صحيحة بدل `graph.facebook.com/funding_sources`
(الـ endpoint ده مش بيقبل كوكيز).
