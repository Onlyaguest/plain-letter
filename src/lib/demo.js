// Demo mode: used ONLY when Firebase is not configured (e.g. local development).
// AI answers are pre-written; rules, redaction, the leak check and the ledger are the real code.
import { SOURCE } from './pipeline.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function pick(text) {
  if (/Riverside General/.test(text)) return 'hospital';
  if (/E-ZPass|toll/i.test(text)) return 'toll';
  if (/IRS/.test(text)) return 'irs';
  if (/MEDICARE SUMMARY/i.test(text)) return 'medicare';
  return 'other';
}

const QUICK = {
  hospital: { one_line: 'This is a hospital bill. It looks normal; you owe $437.60 after insurance.', sender: 'Riverside General Hospital', asks_you_to: 'Pay $437.60 by December 5, 2026', risk: 'low' },
  toll: { one_line: 'This text is very likely a scam. Do not tap the link.', sender: 'Claims to be E-ZPass', asks_you_to: 'Pay a toll through a link', risk: 'high' },
  irs: { one_line: 'This is a scam. The IRS never asks for gift cards or threatens arrest by phone.', sender: 'Claims to be the IRS', asks_you_to: 'Buy gift cards and call back', risk: 'high' },
  medicare: { one_line: 'This is a Medicare summary, not a bill. Nothing to pay to Medicare.', sender: 'Medicare', asks_you_to: 'Check the services; appeal only if something is wrong', risk: 'none' },
  other: { one_line: 'Here is what this message is about.', sender: 'Not clear', asks_you_to: 'Not clear', risk: 'low' },
};

const EXPLAIN = {
  hospital: {
    summary: 'Riverside General Hospital is billing [NAME_1] for an emergency visit on 10/14/2026. Medicare paid most of it. The part left for you is $437.60.',
    what_it_is: 'A hospital bill after insurance', sender: 'Riverside General Hospital',
    steps: ['Check that the visit date and service are right.', 'If anything looks wrong, ask for an itemized statement.', 'Pay $437.60 by December 5, 2026, or call [PHONE_1] to ask for a payment plan.', 'If money is tight, ask about financial assistance before the deadline.'],
    deadline: 'December 5, 2026',
    money: [{ amount: '$4,860.00', what: 'Full price before insurance' }, { amount: '$3,512.40', what: 'Paid by Medicare Part B' }, { amount: '$910.00', what: 'Discount (adjustment)' }, { amount: '$437.60', what: 'What you owe' }],
    scam_risk: 'low', scam_reasons: [],
    questions_to_ask: ['Can I get an itemized statement?', 'Do I qualify for financial assistance?', 'Can I pay in monthly payments without interest?'],
    unclear: ['Whether a secondary insurance (like Medigap) was billed.'],
    can_ignore: ['Total charges: the hospital\'s list price is not what you pay.'],
  },
  toll: {
    summary: 'A text says you owe a $6.99 toll and threatens a $50.00 fee. This is a common scam: real toll agencies do not threaten your license over a few dollars by text.',
    what_it_is: 'A scam text pretending to be a toll agency', sender: 'Claims to be E-ZPass',
    steps: ['Do not tap the link or reply.', 'If you want to be sure, log in to your toll account by typing the official site yourself.', 'Forward the text to 7726 (SPAM), then delete it.'],
    deadline: '', money: [{ amount: '$6.99', what: 'Claimed unpaid toll' }, { amount: '$50.00', what: 'Threatened late fee' }],
    scam_risk: 'high', scam_reasons: ['The link is not the official E-ZPass website.', 'It threatens your license over a small amount.', 'It pushes you to pay within 24 hours.'],
    questions_to_ask: [], unclear: [], can_ignore: [],
  },
  irs: {
    summary: 'Someone claiming to be the IRS says there is a warrant for [NAME_1] and asks for gift cards. This is a scam. The IRS contacts you by mail first and never takes gift cards.',
    what_it_is: 'A scam phone message', sender: 'Claims to be the IRS',
    steps: ['Do not call back and do not buy gift cards.', 'If you are worried about taxes, check your IRS account at irs.gov yourself.', 'Tell a family member, and report it at reportfraud.ftc.gov.'],
    deadline: '', money: [{ amount: '$2,940', what: 'Claimed unpaid taxes' }],
    scam_risk: 'high', scam_reasons: ['Asks for gift cards.', 'Threatens arrest today.', 'Tells you to keep it secret.'],
    questions_to_ask: [], unclear: [], can_ignore: [],
  },
  medicare: {
    summary: 'This is a summary of physical therapy that Medicare covered for [NAME_1]. It is not a bill. The therapy office may bill you up to $46.32.',
    what_it_is: 'Medicare Summary Notice', sender: 'Medicare',
    steps: ['Check you really had therapy on 09/08/2026 and 09/22/2026.', 'Wait for a bill from Lakeview Physical Therapy; it should not be more than $46.32.', 'If something is wrong, call 1-800-MEDICARE. Appeals must be received by January 28, 2027.'],
    deadline: 'January 28, 2027',
    money: [{ amount: '$231.60', what: 'Medicare-approved amount' }, { amount: '$185.28', what: 'Medicare paid the provider' }, { amount: '$46.32', what: 'Most the provider may bill you' }],
    scam_risk: 'none', scam_reasons: [], questions_to_ask: ['Has my supplemental insurance been billed for the $46.32?'], unclear: [], can_ignore: ['The appeal section, unless something is wrong.'],
  },
};

export function createDemoAI({ deviceReady }) {
  const quickSrc = deviceReady ? SOURCE.DEVICE : SOURCE.CLOUD;
  return {
    demo: true,
    device: deviceReady
      ? { available: true, findPersonal: async () => [], quick: async (t) => { await wait(400); return QUICK[pick(t)]; } }
      : null,
    hybrid: {
      quick: async (t) => { await wait(500); return { data: QUICK[pick(t)], source: quickSrc }; },
      followUp: async (letter, q) => {
        await wait(500);
        const k = pick(letter);
        const answer = /scam/i.test(q)
          ? QUICK[k].one_line
          : /late/i.test(q) && k === 'hospital'
            ? 'The letter does not say what happens if you pay late. Call [PHONE_1] before December 5, 2026 and ask for a payment plan.'
            : /call/i.test(q) && k === 'hospital'
              ? 'Call Patient Financial Services at [PHONE_1], Monday to Friday 8am to 5pm.'
              : 'The letter does not say. Ask the sender using a phone number you find yourself.';
        return { data: { answer }, source: quickSrc };
      },
    },
    cloud: {
      explain: async (t) => { await wait(900); return { data: EXPLAIN[pick(t)] || { summary: 'Demo mode has answers only for the samples.', what_it_is: '', sender: '', steps: [], deadline: '', money: [], scam_risk: 'low', scam_reasons: [], questions_to_ask: [], unclear: [], can_ignore: [] }, source: SOURCE.CLOUD }; },
    },
  };
}
