// Facts read straight from the original text on the device: dates and money.
// Used for the instant "quick facts" and as a fact gate on the cloud's answer.

const MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec';
const DATE_RE = new RegExp(String.raw`\b(?:(?:${MONTHS})\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})\b`, 'gi');
const MONEY_RE = /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\$\s?\d+(?:\.\d{2})?|\b\d{1,3}(?:,\d{3})*\.\d{2}\s?(?:USD|dollars)\b/gi;
const DUE_WORDS = /\b(due|by|before|no later than|deadline|pay by|respond by|expires?|must be received|appeal by|within \d+ days)\b/i;

const MON_IDX = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

export function parseDate(s) {
  const t = s.trim().toLowerCase().replace(/(\d)(st|nd|rd|th)/, '$1').replace(',', '');
  let m = t.match(/^([a-z]+)\.?\s+(\d{1,2})\s+(\d{4})$/);
  if (m) {
    const mi = MON_IDX[m[1].slice(0, m[1] === 'sept' ? 4 : 3)];
    if (mi === undefined) return null;
    return new Date(Date.UTC(+m[3], mi, +m[2]));
  }
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return new Date(Date.UTC(y, +m[1] - 1, +m[2])); // US order: month/day/year
  }
  return null;
}

export function iso(d) {
  return d ? d.toISOString().slice(0, 10) : '';
}

/** { dates: [{text, iso, due}], money: [{text, value}] } */
export function extractFacts(text) {
  const t = String(text || '');
  const dates = [];
  for (const m of t.matchAll(DATE_RE)) {
    const d = parseDate(m[0]);
    if (!d || isNaN(d)) continue;
    const before = t.slice(Math.max(0, m.index - 40), m.index);
    dates.push({ text: m[0], iso: iso(d), due: DUE_WORDS.test(before) });
  }
  const money = [];
  for (const m of t.matchAll(MONEY_RE)) {
    const value = Number(m[0].replace(/[^\d.]/g, ''));
    if (!isNaN(value)) money.push({ text: m[0].trim(), value });
  }
  return { dates, money };
}

/** The deadline: the earliest date that follows a "due/by/before" word, else none. */
export function deadline(facts, today = new Date()) {
  const due = facts.dates.filter((d) => d.due).sort((a, b) => a.iso.localeCompare(b.iso));
  if (!due.length) return null;
  const d = due[0];
  const t0 = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const days = Math.round((Date.parse(d.iso) - t0) / 86400000);
  return { ...d, days };
}

/**
 * Fact gate for the cloud answer: every dollar amount and date it mentions must appear in
 * the original letter. Returns the ones that do not (shown to the user as "not in your letter").
 */
export function unsupported(answerText, original) {
  const src = extractFacts(original);
  const srcMoney = new Set(src.money.map((m) => m.value.toFixed(2)));
  const srcDates = new Set(src.dates.map((d) => d.iso));
  const ans = extractFacts(answerText);
  const bad = [];
  for (const m of ans.money) if (!srcMoney.has(m.value.toFixed(2))) bad.push(m.text);
  for (const d of ans.dates) if (!srcDates.has(d.iso)) bad.push(d.text);
  return [...new Set(bad)];
}
