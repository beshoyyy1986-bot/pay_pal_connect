import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || '';

export type CapturedFlags = {
  fb_dtsg: boolean;
  lsd: boolean;
  rev: boolean;
  hs: boolean;
  s: boolean;
  hsi: boolean;
};

export type StartLinkingResponse = {
  approvalUrl: string;
  adAccountId: string;
  userId: string;
  docId: string;
  captured: CapturedFlags;
};

/**
 * بدء الربط: السيرفر هو اللي يفتح جلسة فيسبوك (Playwright) ويقرأ كل البارامترات بنفسه.
 * مفيش أي إدخال يدوي للتوكنات.
 */
export async function initiatePayPalLinking(
  cookies: string,
  adAccount: string
): Promise<StartLinkingResponse> {
  const { data } = await axios.post(`${API_BASE}/api/start-linking`, {
    cookies,
    adAccountId: adAccount,
  });
  return data as StartLinkingResponse;
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
    payerId,
  });
  return data;
}
