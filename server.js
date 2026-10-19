// server.js (نسخة معدلة بالكامل مع تحسين extractFbDtsg)
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 8080;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ========== دوال مساعدة ==========
function getCookieValue(cookies, name) {
  const cleanCookies = cookies.replace(/;\s*/g, ';');
  const match = cleanCookies.match(new RegExp(`(?:^|;)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function normalizeAdAccountId(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  return trimmed.startsWith('act_') ? trimmed : `act_${trimmed}`;
}

// ========== استخراج fb_dtsg من الكوكيز (دون رمي استثناء) ==========
async function extractFbDtsg(cookies) {
  console.log('\n========================================');
  console.log('🔍 بدء استخراج fb_dtsg...');
  console.log('========================================');

  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
  const targets = [
    'https://www.facebook.com/',
    'https://mbasic.facebook.com/'
  ];

  for (const target of targets) {
    try {
      console.log(`📡 جاري الاتصال بـ: ${target}`);
      const { data: html } = await axios.get(target, {
        headers: {
          'Cookie': cookies,
          'User-Agent': userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        timeout: 15000,
        maxRedirects: 5
      });

      console.log(`✅ تم استلام HTML من ${target} - طول: ${html.length} حرف`);

      const $ = cheerio.load(html);
      const inputDtsg = $('input[name="fb_dtsg"]').val();
      if (inputDtsg) {
        console.log(`✅ تم العثور على fb_dtsg من input tag: ${inputDtsg.substring(0, 20)}...`);
        return inputDtsg;
      }

      const match = html.match(/"DTSGInitialData",\[\],\{"token":"([^"]+)"/);
      if (match) {
        console.log(`✅ تم العثور على fb_dtsg من DTSGInitialData: ${match[1].substring(0, 20)}...`);
        return match[1];
      }

      const match2 = html.match(/"DTSGInitData",\[\],\{"token":"([^"]+)"/);
      if (match2) {
        console.log(`✅ تم العثور على fb_dtsg من DTSGInitData: ${match2[1].substring(0, 20)}...`);
        return match2[1];
      }

      console.log(`❌ لم يتم العثور على fb_dtsg في ${target}`);
    } catch (err) {
      console.log(`❌ خطأ في ${target}: ${err.message}`);
      // نستمر للمحاولة التالية
    }
  }

  console.log('========================================');
  console.log('❌ فشل استخراج fb_dtsg من جميع المصادر');
  console.log('💡 الحل: أدخل fb_dtsg يدوياً من الكوكيز');
  console.log('========================================\n');
  return null;
}

// ========== تنفيذ GraphQL لربط PayPal مع close_url مخصص ==========
async function initPayPalLink(cookies, fbDtsg, userId, returnUrl) {
  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

  const variables = {
    input: {
      mutation_params: {
        close_url: returnUrl,
        login_ref_id: "6fe12dd2-c2e2-4ab0-a842-a01e094fbd9b"
      },
      profile_id: "FXACINFRAOBIDPERVIEWERAVMwhxCKmjhHOsHYDHD2jJttp4MJMP0zcJb-tOnHowAUfL3PcWtQEL4CVskvwI4eC03vgkFlaYWgsVgu8VTFoQzDkQ",
      actor_id: userId,
      client_mutation_id: "3"
    }
  };

  const body = new URLSearchParams({
    __a: "1",
    __req: "17",
    __hs: "20618.HYP:accounts_center_pkg.2.1..0",
    dpr: "1",
    __ccg: "UNKNOWN",
    __rev: "1041437765",
    __s: "3zgi2m:uc0vqk:jd0d7n",
    __hsi: "7651186107637418310",
    fb_dtsg: fbDtsg,
    jazoest: "25481",
    lsd: "KwP0jGeBpHXvN5AOyE1svL",
    fb_api_caller_class: "RelayModern",
    fb_api_req_friendly_name: "useMetaPayWalletInitPayPalLinkingMutation",
    server_timestamps: "true",
    variables: JSON.stringify(variables),
    doc_id: "9816934428383981"
  }).toString();

  try {
    const { data } = await axios.post(
      'https://www.facebook.com/api/graphql/',
      body,
      {
        headers: {
          Cookie: cookies,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': userAgent,
          'Origin': 'https://www.facebook.com',
          'Referer': 'https://www.facebook.com/'
        },
        timeout: 20000
      }
    );

    const approvalUrl =
      data?.data?.meta_pay_wallet_init_paypal_linking?.paypal_approval_url ||
      data?.data?.paypal_approval_url ||
      data?.data?.redirect_url;

    if (!approvalUrl) {
      console.error('Facebook Response:', JSON.stringify(data).substring(0, 2000));
      throw new Error('لم يتم العثور على رابط PayPal. تأكد من صحة الكوكيز والـ fb_dtsg.');
    }
    return approvalUrl;
  } catch (error) {
    if (error.response) {
      console.error('Facebook Error:', error.response.status, JSON.stringify(error.response.data).substring(0, 1000));
      throw new Error(`خطأ من فيسبوك (${error.response.status}): ${JSON.stringify(error.response.data).substring(0, 500)}`);
    }
    throw new Error('فشل الاتصال بـ Facebook API: ' + error.message);
  }
}

// ========== زرع وسيلة الدفع ==========
async function insertFundingSource(cookies, adAccountId, paymentToken, payerId) {
  const payloads = [
    { payment_method_type: 'paypal', paypal_account: { token: paymentToken, payer_id: payerId } },
    { payment_method_type: 'paypal', payment_method_token: { token: paymentToken, payer_id: payerId } }
  ];

  const endpoints = [
    `/v18.0/${adAccountId}/funding_sources`,
    `/v18.0/me/funding_sources`
  ];

  let lastError = null;

  for (const endpoint of endpoints) {
    for (const payload of payloads) {
      try {
        const { data } = await axios.post(
          `https://graph.facebook.com${endpoint}`,
          payload,
          {
            headers: {
              Cookie: cookies,
              'Content-Type': 'application/json',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
            },
            timeout: 20000
          }
        );
        return { success: true, data, endpoint };
      } catch (err) {
        lastError = err;
      }
    }
  }

  const errorMsg = lastError?.response?.data?.error?.message || lastError?.message || 'Unknown error';
  throw new Error(`فشلت جميع محاولات الزرع: ${errorMsg}`);
}

// ========== API Routes ==========
app.post('/api/start-linking', async (req, res) => {
  try {
    const { cookies, adAccountId, fbDtsg: manualDtsg } = req.body;

    console.log('\n========================================');
    console.log('🚀 NEW PAYPAL LINKING REQUEST');
    console.log('========================================');
    console.log('📧 Ad Account ID:', adAccountId);
    console.log('🍪 Cookies length:', cookies ? cookies.length : 0);
    console.log('🔑 Manual fb_dtsg provided:', manualDtsg ? 'YES' : 'NO');
    console.log('========================================\n');

    if (!cookies || !adAccountId) {
      return res.status(400).json({ error: 'بيانات ناقصة: الكوكيز ومعرف الحساب الإعلاني مطلوبان' });
    }

    const normalizedAdAccountId = normalizeAdAccountId(adAccountId);
    const userId = getCookieValue(cookies, 'c_user');

    console.log('👤 Extracted User ID (c_user):', userId);

    if (!userId) {
      return res.status(400).json({ error: 'الكوكيز غير صالحة (لا يوجد c_user)' });
    }

    let fbDtsg = manualDtsg || null;
    if (!fbDtsg) {
      console.log('جاري استخراج fb_dtsg تلقائياً...');
      fbDtsg = await extractFbDtsg(cookies);
    }

    if (!fbDtsg) {
      return res.status(400).json({
        error: 'لم يتم العثور على fb_dtsg. جرب إدخاله يدوياً في الحقل المخصص.',
        needsManualDtsg: true
      });
    }

    console.log('fb_dtsg extracted successfully, length:', fbDtsg.length);
    const callbackUrl = `${BASE_URL}/paypal-callback`;
    const approvalUrl = await initPayPalLink(cookies, fbDtsg, userId, callbackUrl);
    res.json({ approvalUrl });
  } catch (err) {
    console.error('Server Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/insert-funding-source', async (req, res) => {
  try {
    const { cookies, adAccountId, paymentToken, payerId } = req.body;
    if (!cookies || !adAccountId || !paymentToken || !payerId) {
      return res.status(400).json({ error: 'بيانات ناقصة' });
    }
    const result = await insertFundingSource(cookies, normalizeAdAccountId(adAccountId), paymentToken, payerId);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('Insert Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ========== صفحة Callback ==========
app.get('/paypal-callback', (req, res) => {
  const { token, payer_id, PayerID } = req.query;
  const payerId = payer_id || PayerID;

  // Log extracted data to server console
  console.log('\n========================================');
  console.log('🎉 PAYPAL CALLBACK DATA RECEIVED 🎉');
  console.log('========================================');
  console.log('📧 Token:', token);
  console.log('🆔 PayerID:', payerId);
  console.log('📊 Full Query Parameters:', JSON.stringify(req.query, null, 2));
  console.log('========================================\n');

  if (!token || !payerId) {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
        <head><title>PayPal Callback - Missing Data</title></head>
        <body style="font-family: sans-serif; text-align: center; padding: 40px;">
          <h2>⚠️ لم يتم استلام التوكن أو معرف الدافع</h2>
          <p>الرجاء العودة إلى التطبيق والمحاولة مرة أخرى.</p>
          <script>setTimeout(() => window.close(), 3000);</script>
        </body>
      </html>
    `);
  }

  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>PayPal Linked Successfully</title>
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; text-align: center; padding: 50px; background: #0b1020; color: #edf4ff; }
          .success { background: #166534; border-radius: 12px; padding: 20px; max-width: 400px; margin: 0 auto; }
          h1 { color: #ffbf00; }
          p { margin: 15px 0; }
          .spinner { display: inline-block; width: 20px; height: 20px; border: 3px solid rgba(255,255,255,0.3); border-radius: 50%; border-top-color: #ffbf00; animation: spin 1s ease-in-out infinite; }
          @keyframes spin { to { transform: rotate(360deg); } }
        </style>
      </head>
      <body>
        <div class="success">
          <h1>✅ تم الربط بنجاح</h1>
          <p>جاري نقل البيانات إلى التطبيق...</p>
          <div class="spinner"></div>
        </div>
        <script>
          (function() {
            try {
              if (window.opener) {
                window.opener.postMessage({
                  type: 'PAYPAL_SUCCESS',
                  token: '${token}',
                  payerId: '${payerId}'
                }, '*');
                setTimeout(() => window.close(), 1000);
              } else {
                document.body.innerHTML = '<div class="success"><h1>✅ تم الربط</h1><p>يمكنك الآن إغلاق هذه النافذة والعودة إلى التطبيق.</p><button onclick="window.close()">إغلاق</button></div>';
              }
            } catch (err) {
              console.error(err);
              document.body.innerHTML = '<div class="success"><h1>⚠️ حدث خطأ</h1><p>الرجاء العودة إلى التطبيق والمحاولة مرة أخرى.</p><button onclick="window.close()">إغلاق</button></div>';
            }
          })();
        </script>
      </body>
    </html>
  `);
});

// ========== Static Files ==========
app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));

app.listen(PORT, () => console.log(`Server running on port ${PORT}, BASE_URL=${BASE_URL}`));
