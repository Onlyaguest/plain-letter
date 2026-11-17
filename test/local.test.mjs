import test from 'node:test';
import assert from 'node:assert/strict';
import { redact, restore, leakCheck, findSpans } from '../src/lib/redact.js';
import { checkRedFlags } from '../src/lib/redflags.js';
import { extractFacts, deadline, unsupported } from '../src/lib/facts.js';
import { analyzeLocal, askExpert, askFollowUp, mergeRisk, SOURCE } from '../src/lib/pipeline.js';
import { SAMPLES } from '../src/samples.js';

const S = Object.fromEntries(SAMPLES.map((s) => [s.id, s.text]));

test('hospital bill: personal details are replaced, money and dates kept', () => {
  const r = redact(S.hospital);
  for (const secret of ['Lopez', 'Maria', '04/12/1951', 'RGH-55821934', '1428 Elm Street', 'Springfield, IL 62704', '(217) 555-0142', 'atrial fibrillation']) {
    assert.ok(!r.text.includes(secret), `still visible: ${secret}\n${r.text}`);
  }
  for (const keep of ['$437.60', 'December 5, 2026', 'Riverside General Hospital', 'Medicare Part B']) {
    assert.ok(r.text.includes(keep), `lost: ${keep}`);
  }
  // Same person -> same placeholder.
  const names = r.items.filter((i) => i.kind === 'NAME');
  assert.equal(names.length, 1);
  assert.equal(r.text.split(names[0].placeholder).length - 1, 2);
  assert.deepEqual(leakCheck(r.text, r.map), []);
});

test('restore puts originals back locally, in nested objects', () => {
  const r = redact(S.hospital);
  const ph = r.items.find((i) => i.kind === 'NAME').placeholder;
  const back = restore({ summary: `Bill for ${ph}`, steps: [`Call ${ph}'s insurer`] }, r.map);
  assert.equal(back.summary, 'Bill for Maria Lopez');
  assert.equal(back.steps[0], "Call Maria Lopez's insurer");
});

test('links keep their domain but lose path and query', () => {
  const r = redact(S.toll);
  assert.ok(r.text.includes('ezpass-tollpay.support'));
  assert.ok(!r.text.includes('id=88213'));
});

test('medicare number and the "Notice for" name', () => {
  const r = redact(S.medicare + '\nMember ID: 1EG4TE5MK73');
  assert.ok(!r.text.includes('1EG4TE5MK73'));
  assert.ok(!redact(S.medicare).text.includes('Helen Park'));
  // A name with no label at all is what the on-device model is for.
  const withModel = redact(S.medicare, [{ start: S.medicare.indexOf('Helen Park'), end: S.medicare.indexOf('Helen Park') + 10, kind: 'NAME', value: 'Helen Park' }]);
  assert.ok(!withModel.text.includes('Helen Park'));
});

test('card numbers only when they pass the Luhn check; SSN', () => {
  const spans = findSpans('Card 4111 1111 1111 1111, ref 1234 5678 9012 3456, SSN 123-45-6789');
  const kinds = spans.map((s) => s.kind);
  assert.ok(kinds.includes('CARD'));
  assert.ok(kinds.includes('SSN'));
  assert.equal(spans.filter((s) => s.kind === 'CARD').length, 1);
});

test('leak check blocks a payload that still has a secret', () => {
  const r = redact(S.hospital);
  const p = leakCheck(r.text + ' patient Maria Lopez', r.map);
  assert.ok(p.length > 0);
});

test('scam rules: IRS gift cards is high, hospital bill is low', () => {
  assert.equal(checkRedFlags(S.irs).level, 3);
  assert.equal(checkRedFlags(S.toll).level >= 2, true);
  assert.ok(checkRedFlags(S.hospital).level <= 1);
  assert.equal(checkRedFlags(S.medicare).level, 0);
});

test('facts: deadline and money', () => {
  const f = extractFacts(S.hospital);
  assert.ok(f.money.some((m) => m.value === 437.6));
  const d = deadline(f, new Date('2026-11-17T00:00:00Z'));
  assert.equal(d.iso, '2026-12-05');
  assert.equal(d.days, 18);
  assert.deepEqual(unsupported('You owe $437.60 by December 5, 2026', S.hospital), []);
  assert.deepEqual(unsupported('You owe $500.00', S.hospital), ['$500.00']);
});

test('model can raise but never lower the rule risk', () => {
  assert.equal(mergeRisk(3, 'none').label, 'high');
  assert.equal(mergeRisk(0, 'medium').label, 'medium');
});

// ---- Router: where each prompt runs ----

function fakeDeps({ device }) {
  const sent = [];
  return {
    sent,
    device: device
      ? {
          available: true,
          findPersonal: async (t) => (t.includes('Helen Park') ? [{ text: 'Helen Park', kind: 'NAME' }] : []),
          quick: async () => ({ risk: 'low', one_line: 'A Medicare summary, not a bill.' }),
        }
      : null,
    hybrid: {
      quick: async (t) => { sent.push(t); return { data: { risk: 'low', one_line: 'ok' }, source: SOURCE.CLOUD, payload: t }; },
      followUp: async (letter, q) => { sent.push(letter + q); return { data: { answer: 'Ask [NAME_1] to call by December 5, 2026.' }, source: SOURCE.CLOUD }; },
    },
    cloud: {
      explain: async (t) => { sent.push(t); return { data: { summary: 'Bill for [NAME_1]: $437.60, also $99.00 fee', scam_risk: 'none' }, source: SOURCE.CLOUD, payload: t }; },
    },
  };
}

test('with an on-device model: nothing leaves the device until the user asks the expert', async () => {
  const deps = fakeDeps({ device: true });
  const local = await analyzeLocal(S.medicare, deps);
  assert.equal(local.quick.source, SOURCE.DEVICE);
  assert.equal(deps.sent.length, 0);
  assert.equal(local.ledger.length, 0);
  assert.ok(!local.redaction.text.includes('Helen Park'), 'model-found name is redacted');
});

test('without an on-device model: quick verdict goes to the cloud, but only redacted', async () => {
  const deps = fakeDeps({ device: false });
  const local = await analyzeLocal(S.hospital, deps);
  assert.equal(deps.sent.length, 1);
  assert.ok(!deps.sent[0].includes('Maria Lopez'));
  assert.equal(local.ledger.length, 1);
});

test('expert answer is restored locally and fact-checked', async () => {
  const deps = fakeDeps({ device: false });
  const local = await analyzeLocal(S.hospital, deps);
  const ex = await askExpert(local, deps);
  assert.ok(ex.data.summary.includes('Maria Lopez'));
  assert.ok(!deps.sent.some((s) => s.includes('Maria Lopez')));
  assert.deepEqual(ex.notInLetter, ['$99.00']);
});

test('follow-up question is redacted too', async () => {
  const deps = fakeDeps({ device: false });
  const local = await analyzeLocal(S.hospital, deps);
  const r = await askFollowUp(local, 'Can my daughter Ana Lopez call (217) 555-0199 for Maria Lopez?', deps);
  const last = deps.sent[deps.sent.length - 1];
  assert.ok(!last.includes('Maria Lopez'));
  assert.ok(!last.includes('555-0199'));
  assert.ok(r.answer.includes('Maria Lopez'));
});
