/**
 * تحويل أي شكل من أشكال الحساب الإعلاني إلى act_<digits>.
 * يقبل: 123456789 | act_123456789 | رابط Ads Manager / Business Suite
 */
function resolveAdAccountId(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';

  const fromUrl =
    raw.match(/\bact=(\d{5,})/i) ||
    raw.match(/\bact_(\d{5,})/i) ||
    raw.match(/account_id["'=:]+(\d{5,})/i) ||
    raw.match(/\/(\d{8,})(?:[/?#]|$)/);
  if (fromUrl) return `act_${fromUrl[1]}`;

  if (/^act_\d+$/i.test(raw)) return raw.toLowerCase();

  const digits = raw.replace(/[^\d]/g, '');
  return digits ? `act_${digits}` : '';
}

module.exports = { resolveAdAccountId };
