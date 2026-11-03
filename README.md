# ClickBridge — ربط PayPal بحساب Meta الإعلاني

أداة ويب (React + Express + Playwright headless) تربط PayPal كوسيلة دفع داخل حساب Meta الإعلاني،
عن طريق كوكيز فيسبوك — **بدون أي إدخال يدوي للتوكنات**.

## المعمارية

```
server.js            ← الـ routes والتحقق من المدخلات
lib/cookies.js       ← تحليل/فحص الكوكيز (هيدر خام أو JSON)
lib/adaccount.js     ← رقم / act_xxx / رابط Ads Manager  →  act_<id>
lib/session.js       ← جلسة Chromium + التقاط البارامترات + تنفيذ GraphQL
lib/docids.js        ← كاش خريطة doc_id لكل عمليات Relay
```

## إزاي بنضمن إن الالتقاط ما يفشلش

البارامترات (`fb_dtsg`, `lsd`, `__rev`, `__hs`, `__s`, `__hsi`) بتتجمع من **4 مصادر**
وبتُدمج بالأولوية — لو مصدر فشل التاني بيكمّل:

| # | المصدر | الثقة |
|---|---|---|
| 1 | طلبات GraphQL حقيقية يعملها المتصفح بنفسه (`page.on('request')`) | الأعلى |
| 2 | DOM وموديولات فيسبوك (`require('DTSGInitialData')` / `LSD` / `SiteData`) | عالية |
| 3 | HTML الصفحة (عدة أنماط لكل بارامتر) | متوسطة |
| 4 | صفحات بديلة: `mbasic.facebook.com` ثم `business.facebook.com` | احتياطي |

و`jazoest` بيتحسب من `fb_dtsg`، والطلب نفسه بيخرج من **داخل الصفحة** (`fetch` + `credentials: include`)
فنفس الجلسة ونفس البصمة.

## اكتشاف `doc_id`

فيسبوك بيحط كل عملية Relay بالشكل:

```js
params:{id:"9816934428383981",name:"useMetaPayWalletInitPayPalLinkingMutation",...}
```

الأداة بتمسح كل ملفات JS المحمّلة (script tags + `performance.getEntriesByType('resource')`)،
وأي طلب GraphQL بيعدّي، وبتخزّن كل زوج (اسم العملية → doc_id) في كاش على الديسك `.cache/docids.json`.
يعني أي عملية Meta Pay / PayPal بتظهر، بتتسجل تلقائياً حتى لو مش عارفين اسمها.

## الـ API

| Endpoint | الوصف |
|---|---|
| `GET /health` | حالة السيرفر وعدد الـ doc_id المكشوفة |
| `GET /api/docids?q=` | بحث في كاش العمليات (مفيد للهندسة العكسية) |
| `POST /api/capture` | `{ cookies }` → تقرير التقاط كامل (بدون أي mutation) |
| `POST /api/start-linking` | `{ cookies, adAccountId }` → `{ approvalUrl }` |
| `POST /api/graphql` | `{ cookies, friendlyName, docId?, variables? }` → تنفيذ أي عملية Relay |
| `GET /paypal-callback` | استقبال token + payer_id من PayPal |

### مثال: اختبار الالتقاط

```bash
curl -X POST https://your-domain.com/api/capture \
  -H 'Content-Type: application/json' \
  -d '{"cookies":"c_user=...; xs=...; datr=...; sb=...; fr=..."}'
```

بيرجّع حالة كل بارامتر + مصدره + العمليات اللي اكتشفها + تحذيرات.

### مثال: تنفيذ عملية Relay

```bash
curl -X POST https://your-domain.com/api/graphql \
  -H 'Content-Type: application/json' \
  -d '{"cookies":"...","friendlyName":"useMetaPayWalletInitPayPalLinkingMutation","variables":{...}}'
```

## التشغيل

```bash
npm install
npx playwright install --with-deps chromium
cp .env.example .env      # وعدّل BASE_URL
npm run build && npm start
```

### Docker (مستحسن)

```bash
docker build -t paypal-linker .
docker run -p 8080:8080 --env-file .env paypal-linker
```

> ⚠️ Playwright محتاج نظام تشغيل كامل — مش هينفع على Vercel Functions. استخدم Docker / VPS / Railway / Render.
> ⚠️ `BASE_URL` لازم يكون الدومين الحقيقي، وإلا كولباك PayPal هيفشل.

## الخطوة الثانية (قيد العمل)

استكمال الربط على جهة Meta: تثبيت عملية إضافة وسيلة الدفع (`funding source`) وتنفيذها عبر
`/api/graphql` بدل `graph.facebook.com/funding_sources` (اللي مش بيقبل كوكيز).
