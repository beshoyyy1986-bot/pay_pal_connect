import React, { useState } from 'react';
import { useAutomation } from './useAutomation';
import './App.css';

const box: React.CSSProperties = {
  background: '#000',
  padding: '10px',
  borderRadius: '8px',
  fontSize: '12px',
  direction: 'ltr',
  textAlign: 'left',
  wordBreak: 'break-all',
};

function App() {
  const [cookies, setCookies] = useState('');
  const [adAccount, setAdAccount] = useState('');
  const {
    startInterception,
    testCapture,
    loading,
    capturing,
    error,
    success,
    extractedToken,
    extractedPayerId,
    captured,
    report,
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
        ['__rev', captured.__rev],
        ['__hs', captured.__hs],
        ['__s', captured.__s],
        ['__hsi', captured.__hsi],
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
          الصق الكوكيز ورابط أو رقم الحساب الإعلاني فقط — الأداة تفتح جلسة فيسبوك بنفسها (headless)
          وتلتقط كل البارامترات المطلوبة تلقائياً.
        </p>

        <div className="form-card">
          <form onSubmit={handleStart}>
            <label htmlFor="cookies">ملفات تعريف الارتباط (Cookies)</label>
            <textarea
              id="cookies"
              rows={5}
              value={cookies}
              onChange={e => setCookies(e.target.value)}
              placeholder="c_user=...; xs=...; fr=...; datr=...; sb=...  (أو JSON من إكستنشن)"
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

            <button type="submit" disabled={loading} className="paypal-btn">
              {loading ? 'جارٍ فتح الجلسة والتقاط البيانات...' : 'PayPal • بدء الربط'}
            </button>

            <button
              type="button"
              disabled={capturing || !cookies}
              onClick={() => testCapture(cookies)}
              style={{
                marginTop: '10px',
                width: '100%',
                padding: '12px',
                borderRadius: '10px',
                border: '1px solid #2a3350',
                background: 'transparent',
                color: '#9fb3ff',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              {capturing ? 'جارٍ اختبار الالتقاط...' : '🔍 اختبار الالتقاط فقط (بدون ربط)'}
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

        {report && (
          <div className="alert alert-info">
            <div style={{ marginBottom: '8px' }}>
              🧪 تقرير الالتقاط — {report.ok ? 'ناجح' : 'ناقص'} · {report.elapsedMs}ms · زيارات:{' '}
              {report.visits.join(' → ')}
            </div>
            <div style={{ display: 'grid', gap: '8px' }}>
              <div style={box}>
                <div>
                  <strong>doc_id في الكاش:</strong> {report.docIdCount}
                </div>
                <div>
                  <strong>باندلات ممسوحة:</strong> {report.scannedBundles} /{' '}
                  {report.totalBundleCandidates}
                </div>
                <div>
                  <strong>مصادر البارامترات:</strong>{' '}
                  {Object.entries(report.sources)
                    .map(([k, v]) => `${k}=${v}`)
                    .join(' · ') || '—'}
                </div>
              </div>

              {report.paymentOps.length > 0 && (
                <div style={box}>
                  <div>
                    <strong>عمليات Meta Pay / PayPal المكتشفة:</strong>
                  </div>
                  {report.paymentOps.map(op => (
                    <div key={op.name} style={{ color: '#4ade80' }}>
                      {op.name} → {op.id}
                    </div>
                  ))}
                </div>
              )}

              {report.warnings.length > 0 && (
                <div style={box}>
                  <div>
                    <strong>تحذيرات:</strong>
                  </div>
                  {report.warnings.map((w, i) => (
                    <div key={i} style={{ color: '#fbbf24' }}>
                      • {w}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {error && <div className="alert alert-error">❌ {error}</div>}
        {success && <div className="alert alert-success">✅ تم التقاط بيانات الموافقة بنجاح!</div>}

        {extractedToken && extractedPayerId && (
          <div className="alert alert-info">
            <div style={{ marginBottom: '10px' }}>🎯 بيانات PayPal</div>
            <div style={box}>
              <div>
                <strong>Token:</strong>
              </div>
              <div style={{ color: '#4ade80' }}>{extractedToken}</div>
            </div>
            <div style={{ ...box, marginTop: '10px' }}>
              <div>
                <strong>Payer ID:</strong>
              </div>
              <div style={{ color: '#60a5fa' }}>{extractedPayerId}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
