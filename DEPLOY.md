# النشر — Vercel / Replit / Docker

الفكرة: نفس الكود يشتغل في أي بيئة، والمتصفح بيتحدد بمتغير واحد `BROWSER_MODE`.

| الوضع | البيئة | إيه اللي بيحصل |
|---|---|---|
| `local` (افتراضي) | Docker · VPS · Railway · Render | بيشغّل Chromium المثبت محلياً |
| `cdp` | **Vercel** · Replit · أي سيرفر | بيتصل بمتصفح سحابي عبر WebSocket (Browserless/Browserbase/Steel) |
| `serverless` | Vercel | `@sparticuz/chromium` كـ binary مضغوط جوه الـ Function |

---

## 1) Vercel

> ⚠️ Vercel Functions مش بتسمح بتشغيل Chromium كامل (حد 250MB غير مضغوط + مدة قصوى).
> لازم تختار **إما** متصفح سحابي (`cdp`) **أو** `serverless`.

### الطريقة A — متصفح سحابي (الأفضل ✅)

1. اعمل حساب على واحد من دول وخد الـ WebSocket endpoint:
   - **Browserless** → `wss://production-sfo.browserless.io?token=XXXX`
   - **Browserbase** → `wss://connect.browserbase.com?apiKey=XXXX&projectId=YYYY`
   - **Steel.dev** → `wss://connect.steel.dev?apiKey=XXXX`
2. Vercel → **New Project** → اختار الريبو (Auto-detected: Vite).
3. Environment Variables:

```
BASE_URL            = https://<project>.vercel.app
BROWSER_MODE        = cdp
BROWSER_WS_ENDPOINT = wss://...
FB_SCAN_FILES       = 40
```

4. Deploy. جرّب `https://<project>.vercel.app/health` → لازم تشوف `"browserMode":"cdp"`.

### الطريقة B — `@sparticuz/chromium`

```
BASE_URL     = https://<project>.vercel.app
BROWSER_MODE = serverless
```

الحزمة موجودة في `optionalDependencies`، لكن لو النشر فشل:

```bash
npm i @sparticuz/chromium
```

> سلبيات: كولد ستارت بطيء (~5-10 ثواني)، وأحياناً فيسبوك بيتعامل مع البصمة بحذر.
> مزاياه: مش محتاج خدمة خارجية ولا فلوس زيادة.

### ملاحظات مهمة على Vercel

- `vercel.json` فيه `maxDuration: 60` — أعلى قيمة مسموحة على Hobby. لو التقاط الجلسة طال، قلّل `FB_SCAN_FILES` أو `FB_SETTLE_MS`.
- كاش `doc_id` بيتكتب في `/tmp` وده **لكل instance** — يعني ممكن يتكرر الاكتشاف بعد cold start (طبيعي، مش مشكلة).
- `/paypal-callback` متمرّر على نفس الـ function، فتأكد إن `BASE_URL` مطابق للدومين الفعلي.

---

## 2) Replit

1. استورد الريبو في Repl (Node.js).
2. في الـ **Shell**:

```bash
npm install
npx playwright install chromium
npm run build
```

3. شغّل:

```bash
npm start        # build + node server.js
```

4. اضبط Secrets: `BASE_URL=https://<repl>.replit.dev` و`PORT=3000` (أو اللي Replit بيحدده).
5. خلي الـ Repl **Always On** (Deployment) عشان ما ينامش.

> لو `npx playwright install chromium` فشل بسبب مكتبات النظام، ده لأن Replit بيستخدم Nix:
> الحل الأسرع إنك تستخدم `BROWSER_MODE=cdp` مع متصفح سحابي — بيشتغل من غير أي اعتماديات نظام.

---

## 3) Docker / VPS / Railway / Render

```bash
docker build -t paypal-linker .
docker run -p 8080:8080 --env-file .env paypal-linker
```

`Dockerfile` مبني على صورة Playwright الرسمية → المتصفح وكل مكتبات النظام جاهزة.

---

## متغيرات البيئة الكاملة

| المتغير | الافتراضي | الوصف |
|---|---|---|
| `PORT` | `8080` | منفذ السيرفر (محلياً) |
| `BASE_URL` | `http://localhost:PORT` | **لازم** يكون الدومين الحقيقي |
| `BROWSER_MODE` | تلقائي | `local` / `cdp` / `serverless` |
| `BROWSER_WS_ENDPOINT` | — | مطلوب لو `cdp` |
| `BROWSER_CONNECT_TIMEOUT` | `30000` | مهلة الاتصال بالمتصفح السحابي |
| `HEADLESS` | `true` | للديباج فقط |
| `MAX_CONCURRENT_SESSIONS` | `2` | كل جلسة = متصفح كامل |
| `FB_NAV_TIMEOUT` | `45000` | مهلة التصفح |
| `FB_SETTLE_MS` | `3500` | انتظار بعد تحميل الصفحة |
| `FB_SCAN_FILES` | `90` | عدد ملفات JS الممسوحة للبحث عن `doc_id` |
| `FB_EVAL_TIMEOUT` | `60000` | مهلة تنفيذ الـ eval داخل الصفحة |
| `PAYPAL_INIT_OP` | `useMetaPayWalletInitPayPalLinkingMutation` | اسم عملية بدء الربط |
| `PAYPAL_INIT_DOC_ID` | — | احتياطي لو الاكتشاف التلقائي فشل |
| `DOCIDS_CACHE_DIR` | `.cache` أو `/tmp` | مكان كاش `doc_id` |

---

## التحقق بعد أي نشر

```bash
curl https://<domain>/health
# → {"ok":true,"browserMode":"cdp",...}

curl -X POST https://<domain>/api/capture \
  -H 'Content-Type: application/json' \
  -d '{"cookies":"c_user=...; xs=...; datr=...; sb=...; fr=..."}'
```

لو رجع `captured` كله `true` يبقى النشر سليم وجاهز لخطوة الربط.
