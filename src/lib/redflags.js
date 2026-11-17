// Scam warning signs: fixed rules, no model involved, run on the device.
// They report warning signs, never a verdict. A rule-raised risk cannot be lowered by a model.

const LINK = /(https?:\/\/|www\.)\S+|\b[a-z0-9-]{2,}\.(com|net|org|info|top|xyz|vip|cc|me|icu|shop|club|live|online|site|click|link|support)\b/i;

export const RULES = [
  {
    id: 'link',
    level: 1,
    test: (t) => LINK.test(t),
    text: 'It contains a web link. Type the official website yourself instead of tapping the link.',
  },
  {
    id: 'link-login',
    level: 2,
    test: (t) => LINK.test(t) && /\b(verify|confirm|update|unlock|reactivate|log ?in|sign ?in|re-?enter|validate)\b/i.test(t),
    text: 'It asks you to follow a link and log in or "verify" details. Real companies rarely ask this by text or email.',
  },
  {
    id: 'urgent',
    level: 2,
    test: (t) => /\b(within 24 hours|within 48 hours|immediately|final notice|last warning|act now|today only|will be suspended|will be closed|legal action|avoid (?:penalt|late fee|suspension))/i.test(t),
    text: 'It pushes you to act right now. Pressure is the most common scam tactic. Real deadlines leave time to check.',
  },
  {
    id: 'gift-card',
    level: 3,
    test: (t) => /\b(gift ?cards?|itunes|google play card|steam card|bitcoin|crypto|btc|usdt|wire transfer|western union|moneygram|zelle|cash app|venmo)\b/i.test(t) && /\b(pay|send|buy|purchase|transfer|settle)\b/i.test(t),
    text: 'It asks for payment by gift card, crypto, wire or a payment app. Government agencies and real companies do not take these.',
  },
  {
    id: 'code',
    level: 3,
    test: (t) => /\b(verification|security|one-time|otp|confirmation) code\b/i.test(t) && /\b(share|tell|send|give|read|provide|reply)\b/i.test(t),
    text: 'It asks you to share a code. Nobody legitimate needs your one-time code, not even "support".',
  },
  {
    id: 'authority',
    level: 3,
    test: (t) => /\b(IRS|social security|SSA|medicare|police|sheriff|FBI|warrant|arrest|court|immigration|ICE|USCIS|DMV)\b/i.test(t) && /\b(arrest|warrant|suspend|deport|gift card|wire|pay (?:now|immediately|today)|call (?:us|now|immediately)|do not tell)\b/i.test(t),
    text: 'It claims to be a government agency and threatens arrest, suspension or demands quick payment. Agencies send letters by mail and never threaten like this.',
  },
  {
    id: 'toll-package',
    level: 2,
    test: (t) => /\b(toll|e-?zpass|sunpass|fastrak|unpaid toll|package|parcel|delivery|redelivery|usps|ups|fedex|dhl)\b/i.test(t) && LINK.test(t) && /\b(fee|pay|unpaid|balance|failed|held|address)\b/i.test(t),
    text: 'Unpaid toll or failed package texts with a link are among the most common scam texts right now.',
  },
  {
    id: 'remote',
    level: 3,
    test: (t) => /\b(anydesk|teamviewer|remote access|screen ?share|download (?:the|our) app|install)\b/i.test(t) && /\b(refund|account|bank|support|virus|security)\b/i.test(t),
    text: 'It asks you to install an app or share your screen. That lets a stranger see your bank and codes.',
  },
  {
    id: 'refund-overpay',
    level: 3,
    test: (t) => /\b(overpaid|over-?payment|refund of|send (?:back|the difference)|accidentally (?:sent|refunded))\b/i.test(t),
    text: '"We refunded you too much, send back the difference" is a classic trick. Check your real balance on the official site.',
  },
  {
    id: 'prize',
    level: 3,
    test: (t) => /\b(you(?:'ve| have) won|winner|lottery|sweepstakes|prize|inheritance|unclaimed funds)\b/i.test(t) && /\b(fee|tax|pay|processing|claim)\b/i.test(t),
    text: 'A prize you must pay a fee to claim is not a prize.',
  },
  {
    id: 'secrecy',
    level: 3,
    test: (t) => /\b(do not (?:tell|share|discuss)|keep (?:this|it) (?:confidential|secret)|don't tell)\b/i.test(t),
    text: 'It tells you to keep it secret. Scammers do this to stop you from asking family or the bank.',
  },
];

export const LEVELS = ['none', 'low', 'medium', 'high'];

/** Returns { level: 0..3, hits: [{id, level, text}] } */
export function checkRedFlags(text) {
  const t = String(text || '');
  const hits = RULES.filter((r) => r.test(t)).map(({ id, level, text }) => ({ id, level, text }));
  const level = hits.reduce((m, h) => Math.max(m, h.level), 0);
  return { level, hits };
}

/** Where to check for real, by topic. Official, well-known channels only. */
export function officialChecks(text) {
  const t = String(text || '');
  const out = [];
  if (/\bIRS\b|tax/i.test(t)) out.push('IRS: log in at irs.gov or call 800-829-1040 (number printed on irs.gov).');
  if (/social security|\bSSA\b/i.test(t)) out.push('Social Security: ssa.gov or 800-772-1213.');
  if (/medicare/i.test(t)) out.push('Medicare: medicare.gov or 1-800-MEDICARE (1-800-633-4227).');
  if (/toll|e-?zpass|sunpass|fastrak/i.test(t)) out.push('Tolls: log in to your toll account by typing its official site yourself.');
  if (/usps|package|parcel|delivery/i.test(t)) out.push('Packages: track on the carrier\'s official site with the number from your receipt.');
  if (/bank|card|account/i.test(t)) out.push('Bank or card: call the number printed on the back of your card.');
  out.push('Report scams: reportfraud.ftc.gov. Forward scam texts to 7726 (SPAM).');
  return out;
}
