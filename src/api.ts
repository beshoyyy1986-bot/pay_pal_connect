import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || '';

export type CapturedFlags = {
  fb_dtsg: boolean;
  lsd: boolean;
  __rev: boolean;
  __hs: boolean;
  __s: boolean;
  __hsi: boolean;
};

export type CaptureReport = {
  ok: boolean;
  loggedIn: boolean;
  elapsedMs: number;
  visits: string[];
  captured: CapturedFlags;
  sources: Record<string, string>;
  missing: string[];
  paramsMasked: Record<string, string | null>;
  docIdCount: number;
  paymentOps: Array<{ name: string; id: string }>;
  netOps: Record<string, string>;
  hits: Array<{ name: string | null; docId: string | null; variables: string }>;
  scannedBundles: number;
  totalBundleCandidates: number;
  warnings: string[];
};

export type StartLinkingResponse = {
  approvalUrl: string;
  adAccountId: string;
  docId: string;
  captured: CapturedFlags;
  sources: Record<string, string>;
  docIdCount: number;
};

/** اختبار التقاط فقط — بدون أي عملية ربط */
export async function captureSession(cookies: string): Promise<CaptureReport> {
  const { data } = await axios.post(`${API_BASE}/api/capture`, { cookies });
  return data as CaptureReport;
}

/**
 * بدء الربط: السيرفر يفتح جلسة فيسبوك (Playwright) ويقرأ كل البارامترات بنفسه.
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

/** منفّذ GraphQL عام — لهندسة Meta Pay العكسية وخطوة الربط */
export async function runGraphQL(
  cookies: string,
  friendlyName: string,
  variables: Record<string, unknown> = {},
  docId?: string
) {
  const { data } = await axios.post(`${API_BASE}/api/graphql`, {
    cookies,
    friendlyName,
    variables,
    docId,
  });
  return data;
}
