import axios from 'axios';
const API_BASE = import.meta.env.VITE_API_URL || '';

// بدء ربط PayPal - الـ fbDtsg اختياري (السيرفر يستخرجه تلقائياً لو مبعوتش)
export async function initiatePayPalLinking(cookies: string, adAccountId: string, fbDtsg?: string) {
  const { data } = await axios.post(`${API_BASE}/api/start-linking`, {
    cookies,
    adAccountId,
    fbDtsg: fbDtsg || undefined // مبنعملش send null عشان ما يعملش مشاكل
  });
  return data.approvalUrl as string;
}

export async function insertFundingSource(
  cookies: string,
  adAccountId: string,
  paymentToken: string,
  payerId: string
) {
  const { data } = await axios.post(`${API_BASE}/api/insert-funding-source`, {
    cookies,
    adAccountId,
    paymentToken,
    payerId
  });
  return data;
}
