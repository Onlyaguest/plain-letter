// The privacy-aware router. One rule decides where every prompt runs:
//
//   original text (with personal details)  -> ON-DEVICE ONLY, never the cloud
//   redacted text (placeholders only)      -> may go to the cloud
//
// Steps:
//   1. Rules on the device: dates, money, scam warning signs, rule-based redaction.
//   2. On-device model (if Chrome has one): finds personal details the rules missed,
//      and gives the quick verdict on the full original letter.
//      Without a local model the quick verdict runs on the REDACTED text in hybrid mode
//      (prefer on-device, fall back to cloud), so nothing personal leaves either way.
//   3. Cloud expert, only when the user asks: deep explanation of the redacted text.
//      A leak check runs right before sending; if anything personal is still visible the
//      request is blocked.
//   4. Back on the device: placeholders become real names again; amounts and dates the
//      cloud mentions that are not in the letter are flagged.
//
// Model calls are injected (see ai.js), so this file runs in Node tests without Firebase.

import { redact, restore, leakCheck, spansFromStrings } from './redact.js';
import { checkRedFlags, officialChecks, LEVELS } from './redflags.js';
import { extractFacts, deadline, unsupported } from './facts.js';

export const SOURCE = { RULES: 'rules', DEVICE: 'on_device', CLOUD: 'in_cloud' };

function levelOf(risk) {
  const i = LEVELS.indexOf(String(risk || '').toLowerCase());
  return i < 0 ? 0 : i;
}

/**
 * Step 1 + 2. Returns the local result: everything the user sees before any cloud call.
 * deps: { device: { available, findPersonal(text), quick(text) } | null,
 *         hybrid: { quick(redactedText) -> {data, source, payload} } | null,
 *         now?: Date }
 */
export async function analyzeLocal(original, deps = {}) {
  const text = String(original || '').trim();
  const facts = extractFacts(text);
  const flags = checkRedFlags(text);
  const result = {
    original: text,
    facts,
    deadline: deadline(facts, deps.now || new Date()),
    flags,
    checks: officialChecks(text),
    redaction: null,
    quick: null,
    ledger: [], // everything that left the device, exactly as sent
    steps: [],
  };

  // Redaction: rules always; on-device model adds what rules missed.
  let extra = [];
  if (deps.device?.available) {
    try {
      const found = await deps.device.findPersonal(text);
      extra = spansFromStrings(text, keepFactsVisible(found, facts));
      result.steps.push({ step: 'find-personal', source: SOURCE.DEVICE, found: extra.length });
    } catch (e) {
      result.steps.push({ step: 'find-personal', source: SOURCE.DEVICE, error: String(e.message || e) });
    }
  }
  result.redaction = redact(text, extra);
  result.steps.push({ step: 'redact', source: SOURCE.RULES, items: result.redaction.items.length });

  // Quick verdict.
  try {
    if (deps.device?.available) {
      const data = await deps.device.quick(text);
      result.quick = { data, source: SOURCE.DEVICE };
    } else if (deps.hybrid) {
      const payloadText = result.redaction.text;
      const problems = leakCheck(payloadText, result.redaction.map);
      if (problems.length) throw new Error('Blocked: ' + problems.join(', '));
      const r = await deps.hybrid.quick(payloadText);
      if (r.source === SOURCE.CLOUD) result.ledger.push({ step: 'quick verdict', sent: r.payload ?? payloadText });
      result.quick = { data: restore(r.data, result.redaction.map), source: r.source };
    }
  } catch (e) {
    result.steps.push({ step: 'quick', error: String(e.message || e) });
  }

  result.risk = mergeRisk(flags.level, result.quick?.data?.risk);
  return result;
}

/** Rules can raise risk; a model can raise it too, but never lower what the rules found. */
export function mergeRisk(ruleLevel, modelRisk) {
  const level = Math.max(ruleLevel, levelOf(modelRisk));
  return { level, label: LEVELS[level] };
}

/**
 * The on-device model sometimes tags a due date or an amount as personal (seen 11-19:
 * "Please pay by [DATEOFBIRTH_1]"). Deadlines and money are what the expert needs and are not
 * about the person, so model findings that are exactly a due date or an amount stay visible.
 * Dates of birth are still caught by the rules (DOB / born / date of birth labels).
 */
export function keepFactsVisible(found, facts) {
  const keep = new Set([
    ...facts.dates.filter((d) => d.due).map((d) => d.text.trim().toLowerCase()),
    ...facts.money.map((m) => m.text.trim().toLowerCase()),
  ]);
  return (found || []).filter((it) => !keep.has(String(it.text || '').trim().replace(/[.,;]$/, '').toLowerCase()));
}

/**
 * Step 3 + 4. Ask the cloud expert about the redacted letter.
 * deps.cloud.explain(redactedText) -> { data, source, payload }
 */
export async function askExpert(local, deps) {
  const payloadText = local.redaction.text;
  const problems = leakCheck(payloadText, local.redaction.map);
  if (problems.length) {
    return { blocked: problems };
  }
  const r = await deps.cloud.explain(payloadText);
  const ledger = [{ step: 'expert explanation', sent: r.payload ?? payloadText }];
  const restored = restore(r.data, local.redaction.map);
  const flat = JSON.stringify(restored);
  const notInLetter = unsupported(flat, local.original);
  const risk = mergeRisk(local.risk.level, restored.scam_risk);
  return { data: restored, source: r.source, ledger, notInLetter, risk };
}

/**
 * Follow-up question. The question is redacted with the same map (plus anything new in it),
 * then answered in hybrid mode: on-device if available, otherwise cloud.
 */
export async function askFollowUp(local, question, deps) {
  const map = { ...local.redaction.map };
  // Re-use existing placeholders for values the user repeats in the question.
  let q = String(question || '');
  for (const [ph, val] of Object.entries(map)) {
    if (val.length >= 3) q = q.split(val).join(ph);
  }
  const fresh = redact(q);
  // Renumber fresh placeholders so they cannot collide with the letter's.
  let qText = fresh.text;
  for (const [ph, val] of Object.entries(fresh.map)) {
    const np = ph.replace(/_(\d+)\]$/, (_, n) => `_${900 + Number(n)}]`);
    qText = qText.split(ph).join(np);
    map[np] = val;
  }
  const problems = leakCheck(local.redaction.text + '\n' + qText, map);
  if (problems.length) return { blocked: problems };
  const r = await deps.hybrid.followUp(local.redaction.text, qText);
  const ledger = r.source === SOURCE.CLOUD ? [{ step: 'follow-up', sent: r.payload ?? qText }] : [];
  const answer = restore(r.data?.answer ?? '', map);
  return { answer, source: r.source, ledger, notInLetter: unsupported(answer, local.original + '\n' + question) };
}
