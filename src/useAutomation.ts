import { useState, useCallback } from 'react';
import { initiatePayPalLinking, insertFundingSource } from './api';

export function useAutomation() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [extractedToken, setExtractedToken] = useState<string | null>(null);
  const [extractedPayerId, setExtractedPayerId] = useState<string | null>(null);
  const [needsManualDtsg, setNeedsManualDtsg] = useState(false);

  const startInterception = useCallback(async (cookies: string, adAccountId: string, fbDtsg?: string) => {
    setLoading(true);
    setError(null);
    setSuccess(false);
    setExtractedToken(null);
    setExtractedPayerId(null);
    setNeedsManualDtsg(false);

    try {
      // 1. الحصول على رابط الموافقة من PayPal عبر السيرفر
      const approvalUrl = await initiatePayPalLinking(cookies, adAccountId, fbDtsg);

      // 2. فتح النافذة المنبثقة
      const width = 600;
      const height = 650;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;

      const popup = window.open(
        approvalUrl,
        'paypal_popup',
        `width=${width},height=${height},left=${left},top=${top},resizable,scrollbars`
      );

      if (!popup) {
        throw new Error('الرجاء السماح بالنوافذ المنبثقة (Pop-ups) في المتصفح');
      }

      // 3. الاستماع للرسالة من النافذة المنبثقة (عبر postMessage)
      const messagePromise = new Promise<{ token: string; payerId: string }>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          window.removeEventListener('message', handler);
          if (!popup.closed) popup.close();
          reject(new Error('انتهى الوقت المسموح (5 دقائق). جرب مرة أخرى.'));
        }, 5 * 60 * 1000); // 5 دقائق

        function handler(event: MessageEvent) {
          // تأكد من أن الرسالة تأتي من النافذة المنبثقة (اختياري: تحقق من origin إذا أردت)
          // يمكن إضافة التحقق: if (event.origin !== window.location.origin) return;
          if (event.data && event.data.type === 'PAYPAL_SUCCESS') {
            const { token, payerId } = event.data;
            if (token && payerId) {
              clearTimeout(timeoutId);
              window.removeEventListener('message', handler);
              resolve({ token, payerId });
            }
          }
        }

        window.addEventListener('message', handler);
      });

      const { token, payerId } = await messagePromise;
      popup.close();

      setExtractedToken(token);
      setExtractedPayerId(payerId);

      // 4. زرع وسيلة الدفع
      await insertFundingSource(cookies, adAccountId, token, payerId);
      setSuccess(true);

    } catch (err: any) {
      const serverMessage = err.response?.data?.error;
      const needsManual = err.response?.data?.needsManualDtsg;

      if (needsManual) {
        setNeedsManualDtsg(true);
      }

      setError(serverMessage || err.message || 'حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }, []);

  return { startInterception, loading, error, success, extractedToken, extractedPayerId, needsManualDtsg };
}
