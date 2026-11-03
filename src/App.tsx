import React, { useState } from 'react';
import { useAutomation } from './useAutomation';
import './App.css';

function App() {
  const [cookies, setCookies] = useState('');
  const [adAccount, setAdAccount] = useState('');
  const {
    startInterception,
    loading,
    error,
    success,
    extractedToken,
    extractedPayerId,
    captured,
  } = useAutomation();

  const handleStart = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cookies || !adAccount.trim()) return;
    startInterception(cookies, adAccount.trim());
  };

  const flags: Array<[string, boolean]> = captured
    ? [
        ['fb_dtsg', captured.fb_dtsg],
        ['lsd', captured.lsd],
        ['__rev', captured.rev],
        ['__hs', captured.hs],
        ['__s', captured.s],
        ['__hsi', captured.hsi],
      ]
    : [];

  return (
    <div className="dark-mode">
      <div className="container">
        <div className="brand-wrap">
          <div>
            <div className="badge">⚡ ClickBridge</div>
            <h1>أداة ربط PayPal بحساب الإعلانات</h1>
          </div>
          <div className="badge">Auto</div>
        </div>

        <p className="subtitle">
          الصق الكوكيز ورابط أو رقم الحساب الإعلاني فقط — الأداة تفتح جلسة فيسبوك بنفسها وتلتقط كل
          البارامترات المطلوبة تلقائياً.
        </p>

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

            <label htmlFor="adAccount">معرف الحساب الإعلاني أو رابطه</label>
            <input
              id="adAccount"
              type="text"
              value={adAccount}
              onChange={e => setAdAccount(e.target.value)}
              placeholder="123456789 أو act_123456789 أو رابط Ads Manager"
              required
            />
            <small style={{ color: '#999', display: 'block', marginTop: '5px', fontSize: '11px' }}>
              💡 تقدر تلصق رابط الحساب كامل من Ads Manager والأداة تستخرج الرقم لوحدها.
            </small>

            <button type="submit" disabled={loading} className="paypal-btn">
              {loading ? 'جارٍ فتح جلسة فيسبوك والتقاط البيانات...' : 'PayPal • بدء الربط'}
            </button>
          </form>
        </div>

        {flags.length > 0 && (
          <div className="alert alert-info">
            <div style={{ marginBottom: '8px' }}>🔐 التقاط تلقائي</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {flags.map(([name, ok]) => (
                <span
                  key={name}
                  style={{
                    background: ok ? 'rgba(74,222,128,.15)' : 'rgba(248,113,113,.15)',
                    color: ok ? '#4ade80' : '#f87171',
                    padding: '3px 8px',
                    borderRadius: '6px',
                    fontSize: '11px',
                    direction: 'ltr',
                  }}
                >
                  {ok ? '✓' : '✕'} {name}
                </span>
              ))}
            </div>
          </div>
        )}

        {error && <div className="alert alert-error">❌ {error}</div>}
        {success && <div className="alert alert-success">✅ تم زرع وسيلة الدفع بنجاح!</div>}

        {extractedToken && extractedPayerId && (
          <div className="alert alert-info">
            <div style={{ marginBottom: '10px' }}>🎯 تم خطف البيانات بنجاح!</div>
            <div
              style={{
                background: '#000',
                padding: '10px',
                borderRadius: '8px',
                fontSize: '12px',
                wordBreak: 'break-all',
                textAlign: 'left',
              }}
            >
              <div><strong>Token:</strong></div>
              <div style={{ color: '#4ade80', direction: 'ltr' }}>{extractedToken}</div>
            </div>
            <div
              style={{
                background: '#000',
                padding: '10px',
                borderRadius: '8px',
                fontSize: '12px',
                wordBreak: 'break-all',
                textAlign: 'left',
                marginTop: '10px',
              }}
            >
              <div><strong>Payer ID:</strong></div>
              <div style={{ color: '#60a5fa', direction: 'ltr' }}>{extractedPayerId}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
