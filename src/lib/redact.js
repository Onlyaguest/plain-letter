// Privacy gate, layer 1: deterministic redaction that runs on the user's device.
// It always runs, with or without an on-device model, so personal details never
// reach the cloud even on browsers that have no local model.
//
// Each sensitive value becomes a stable placeholder like [NAME_1] or [ACCOUNT_2].
// The map (placeholder -> original) never leaves the device; restore() puts the
// originals back into the cloud's answer locally.

const LABEL_ID = String.raw`(?:account|acct|member|subscriber|policy|group|claim|patient|medical record|mrn|case|reference|ref|invoice|customer|tracking|license|id|identification|enrollment|beneficiary|medicare|medicaid|taxpayer|ein|itin)`;

// Order matters: specific patterns first, so a card number is not tagged as a phone.
const RULES = [
  { kind: 'SSN', re: /\b(?!000|666|9\d\d)\d{3}[- ]\d{2}[- ]\d{4}\b/g },
  { kind: 'CARD', re: /\b(?:\d[ -]?){13,19}\b/g, check: (v) => luhn(v.replace(/\D/g, '')) },
  { kind: 'EMAIL', re: /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g },
  // "Account number: 1234-5678", "Member ID W123456789", "Claim # 2026-88-1"
  {
    kind: 'ACCOUNT',
    re: new RegExp(String.raw`\b${LABEL_ID}\s*(?:no\.?|number|num\.?|#|id)?\s*(?:ending in|ends in)?\s*[:#]?\s*((?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{3,})\b`, 'gi'),
    group: 1,
  },
  // Partially masked numbers like "ending in 4821" or "****4821"
  { kind: 'ACCOUNT', re: /(?:ending in|ends in|\*{2,}|x{3,})\s?(\d{4})\b/gi, group: 1 },
  {
    kind: 'DOB',
    re: /\b(?:DOB|D\.O\.B\.|date of birth|birth ?date|born)\s*[:]?\s*((?:\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})|(?:[A-Z][a-z]{2,8}\.? \d{1,2},? \d{4}))/gi,
    group: 1,
  },
  {
    kind: 'ADDRESS',
    re: /\b\d{1,6}\s+(?:[NSEW]\.?\s+)?(?:[A-Z][a-zA-Z]+\s){1,4}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl|Terrace|Ter|Circle|Cir|Parkway|Pkwy|Highway|Hwy)\.?(?:,?\s*(?:Apt|Unit|Suite|Ste|#)\.?\s*[\w-]+)?/g,
  },
  { kind: 'ADDRESS', re: /\b[A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?,\s?[A-Z]{2}\s\d{5}(?:-\d{4})?\b/g },
  // Toll-free numbers (800, 888, ...) belong to businesses and agencies: keep them, they help judge the letter.
  { kind: 'PHONE', re: /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, check: (v) => !/^(?:\+?1[\s.-]?)?\(?8(00|88|77|66|55|44|33)\b/.test(v.trim()) },
  // Names after a salutation or a label.
  {
    kind: 'NAME',
    re: /\b(?:Dear|Hi|Hello|Attn:?|Attention:?|To:|Patient(?: name)?:|Name:|Member(?: name)?:|Insured:|Subscriber:|Beneficiary:|Guarantor:|Account holder:|Taxpayer:|Recipient:|Notice for:|Prepared for:)[ \t]+((?:(?:Mr|Mrs|Ms|Miss|Dr)\.?[ \t]+)?[A-Z][a-z'’-]+(?:[A-Z][a-z'’-]+)?(?:[ \t]+[A-Z]\.?(?=[ \t]))?(?:[ \t]+[A-Z][a-z'’-]+(?:[A-Z][a-z'’-]+)?){0,2})/g,
    group: 1,
  },
  { kind: 'NAME', re: /\b(?:Mr|Mrs|Ms|Miss|Dr)\.?[ \t]+[A-Z][a-z'’-]+(?:[A-Z][a-z'’-]+)?(?:[ \t]+[A-Z][a-z'’-]+(?:[A-Z][a-z'’-]+)?)?/g },
  {
    kind: 'HEALTH',
    re: /\b(?:diagnosis|diagnosed with|condition|dx)\s*[:]?\s*([A-Za-z][A-Za-z ,'-]{2,60}?)(?=[.;\n]|$)/gi,
    group: 1,
  },
];

// Links: keep the domain (needed to judge look-alike scam sites), hide the path and query
// (they often carry tracking tokens or personal identifiers).
const URL_RE = /\b((?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24})(\/[^\s)>\]]*)/gi;

function luhn(num) {
  if (num.length < 13 || num.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < num.length; i++) {
    let d = Number(num[num.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

function norm(v) {
  return String(v).trim().replace(/[\s,.;:]+$/, '');
}

/**
 * Find sensitive spans with rules. Returns [{start, end, kind, value}], non-overlapping.
 */
export function findSpans(text) {
  const spans = [];
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(text))) {
      const full = m[0];
      const value = rule.group ? m[rule.group] : full;
      if (!value) continue;
      if (rule.check && !rule.check(value)) continue;
      const offset = rule.group ? m.index + full.indexOf(value) : m.index;
      const v = norm(value);
      if (v.length < 2) continue;
      spans.push({ start: offset, end: offset + v.length, kind: rule.kind, value: v });
    }
  }
  URL_RE.lastIndex = 0;
  let m;
  while ((m = URL_RE.exec(text))) {
    const path = m[2];
    if (path.length <= 1) continue;
    const start = m.index + m[1].length;
    spans.push({ start, end: start + path.length, kind: 'LINK_PATH', value: path });
  }
  return dedupe(spans);
}

function dedupe(spans) {
  spans.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const out = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && s.start < last.end) continue;
    out.push(s);
  }
  return out;
}

/**
 * Add spans found by the on-device model (it returns exact strings it thinks are personal).
 * Every occurrence of each string is redacted.
 */
export function spansFromStrings(text, items) {
  const spans = [];
  for (const it of items || []) {
    const value = norm(it.text || '');
    if (value.length < 3 || !text.includes(value)) continue;
    const kind = String(it.kind || 'PERSONAL').toUpperCase().replace(/[^A-Z]/g, '') || 'PERSONAL';
    let i = text.indexOf(value);
    while (i !== -1) {
      spans.push({ start: i, end: i + value.length, kind, value });
      i = text.indexOf(value, i + value.length);
    }
  }
  return spans;
}

/**
 * Redact text. extraSpans (e.g. from the on-device model) are merged with rule spans.
 * Returns { text, map, items } where map is { '[NAME_1]': 'Maria Lopez', ... }.
 */
export function redact(text, extraSpans = []) {
  const spans = dedupe([...findSpans(text), ...extraSpans]);
  // Same value -> same placeholder, so the cloud can still tell "the same person" apart.
  const byValue = new Map();
  const counters = {};
  const map = {};
  const items = [];
  let out = '';
  let pos = 0;
  for (const s of spans) {
    const key = s.kind + '|' + s.value.toLowerCase();
    let ph = byValue.get(key);
    if (!ph) {
      counters[s.kind] = (counters[s.kind] || 0) + 1;
      ph = `[${s.kind}_${counters[s.kind]}]`;
      byValue.set(key, ph);
      map[ph] = s.value;
      items.push({ placeholder: ph, kind: s.kind, value: s.value });
    }
    out += text.slice(pos, s.start) + ph;
    pos = s.end;
  }
  out += text.slice(pos);
  return { text: out, map, items };
}

/** Put the originals back, locally. Works on strings, arrays and plain objects. */
export function restore(value, map) {
  if (typeof value === 'string') {
    return value.replace(/\[[A-Z]+_\d+\]/g, (ph) => (ph in map ? map[ph] : ph));
  }
  if (Array.isArray(value)) return value.map((v) => restore(v, map));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, restore(v, map)]));
  }
  return value;
}

/**
 * Last check before anything goes to the cloud: no original value may appear in the payload,
 * and the rules must find nothing new in it. Returns a list of problems (empty = safe).
 */
export function leakCheck(payload, map) {
  const problems = [];
  const lower = payload.toLowerCase();
  for (const [ph, original] of Object.entries(map)) {
    if (original.length >= 3 && lower.includes(original.toLowerCase())) problems.push(`${ph} still visible`);
  }
  for (const s of findSpans(payload)) {
    if (s.kind === 'LINK_PATH') continue;
    problems.push(`unredacted ${s.kind.toLowerCase()}`);
  }
  return problems;
}
