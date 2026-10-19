import React, { useState } from 'react';
import { useAutomation } from './useAutomation';
import './App.css';

function normalizeAdAccountId(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.startsWith('act_') ? trimmed : `act_${trimmed}`;
}

function App() {
  const [cookies, setCookies] = useState('');
  const [adAccountId, setAdAccountId] = useState('');
  const [fbDtsg, setFbDtsg] = useState('');
  const { startInterception, loading, error, success, extractedToken, extractedPayerId } = useAutomation();

  const handleStart = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cookies || !adAccountId) return;

    const normalizedAdAccountId = normalizeAdAccountId(adAccountId);
    // Send fbDtsg if provided manually
    startInterception(cookies, normalizedAdAccountId, fbDtsg || undefined);
  };

  return (
    <div className="dark-mode">
      <div className="container">
        <div className="brand-wrap">
          <div>
            <div className="badge">⚡ ClickBridge</div>
            <h1>أداة ربط PayPal بحساب الإعلانات</h1>
          </div>
          <div className="badge">Live</div>
        </div>
        <p className="subtitle">واجهة بسيطة وسريعة لإدخال الكوكيز ومعرف الحساب، مع نتائج واضحة وخطوات واضحة.</p>

        <div className="form-card">
          <form onSubmit={handleStart}>
            <label htmlFor="cookies">ملفات تعريف الارتباط (Cookies)</label>
            <textarea
              id="cookies"
              rows={5}
              value={cookies}
              onChange={e => setCookies(e.target.value)}
              placeholder="الصق الكوكيز كاملة من المتصفح (c_user=...; xs=...; fr=...; datr=...; sb=...)"
              required
            />

            <label htmlFor="adAccount">معرف الحساب الإعلاني (Ad Account ID)</label>
            <input
              id="adAccount"
              type="text"
              value={adAccountId}
              onChange={e => setAdAccountId(e.target.value)}
              placeholder="123456789 أو act_123456789"
              required
            />

            <label htmlFor="fbDtsg">
              fb_dtsg (اختياري - أدخل يدوياً إذا فشل الاستخراج التلقائي)
            </label>
            <input
              id="fbDtsg"
              type="text"
              value={fbDtsg}
              onChange={e => setFbDtsg(e.target.value)}
              placeholder="1:XXXXXXXXXXXXXXXXX"
              style={{ fontSize: '12px', fontFamily: 'monospace' }}
            />
            <small style={{ color: '#999', display: 'block', marginTop: '5px', fontSize: '11px' }}>
              💡 للحصول على fb_dtsg: افتح Facebook.com → اضغط F12 → Application → Cookies → انسخ قيمة fb_dtsg
            </small>

            <button type="submit" disabled={loading} className="paypal-btn">
              {loading ? 'جارٍ المعالجة...' : 'PayPal • بدء الربط'}
            </button>
          </form>
        </div>

        {error && <div className="alert alert-error">❌ {error}</div>}
        {success && <div className="alert alert-success">✅ تم زرع وسيلة الدفع بنجاح!</div>}
        {extractedToken && extractedPayerId && (
          <div className="alert alert-info">
            <div style={{ marginBottom: '10px' }}>🎯 تم خطف البيانات بنجاح!</div>
            <div style={{ background: '#000', padding: '10px', borderRadius: '8px', fontSize: '12px', wordBreak: 'break-all', textAlign: 'left' }}>
              <div><strong>Token:</strong></div>
              <div style={{ color: '#4ade80', direction: 'ltr' }}>{extractedToken}</div>
            </div>
            <div style={{ background: '#000', padding: '10px', borderRadius: '8px', fontSize: '12px', wordBreak: 'break-all', textAlign: 'left', marginTop: '10px' }}>
              <div><strong>Payer ID:</strong></div>
              <div style={{ color: '#60a5fa', direction: 'ltr' }}>{extractedPayerId}</div>
            </div>
            <div style={{ marginTop: '10px', fontSize: '11px', color: '#999' }}>
              💡 يمكنك نسخ هذه البيانات واستخدامها
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
