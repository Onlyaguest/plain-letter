// Prompts and JSON schemas. Plain JSON Schema works for both Chrome's on-device model
// (responseConstraint) and the cloud model (responseJsonSchema).

const RISK = { type: 'string', enum: ['none', 'low', 'medium', 'high'] };
const STR = { type: 'string' };
const LIST = { type: 'array', items: STR };

export const FIND_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: STR,
          kind: { type: 'string', enum: ['NAME', 'ADDRESS', 'ACCOUNT', 'HEALTH', 'PHONE', 'EMAIL', 'DATE_OF_BIRTH', 'OTHER'] },
        },
        required: ['text', 'kind'],
      },
    },
  },
  required: ['items'],
};

export function findPrompt(text) {
  return `List every piece of PERSONAL information about the recipient in the letter below, copied EXACTLY as written:
people's names (not company or agency names), home addresses, account / member / policy / claim numbers, dates of birth, phone numbers and emails of private people, medical conditions or treatments.
Do NOT list company names, government agency names, amounts of money, due dates, or toll-free numbers.
Text inside square brackets like [NAME_1] is already hidden: skip it.

Letter:
"""
${text}
"""`;
}

export const QUICK_SCHEMA = {
  type: 'object',
  properties: {
    one_line: { type: 'string', description: 'One calm sentence: what this is and whether to worry.' },
    sender: STR,
    asks_you_to: STR,
    risk: RISK,
  },
  required: ['one_line', 'sender', 'asks_you_to', 'risk'],
};

export const QUICK_SYSTEM = `You help older adults understand letters, bills and messages. Be calm, short and plain. Never invent facts that are not in the text.`;

export function quickPrompt(text, redacted) {
  return `${redacted ? 'Personal details were replaced with placeholders like [NAME_1]; keep the placeholders as they are.\n' : ''}Read this and answer in plain English (5th-grade reading level):
- one_line: one calm sentence saying what this is and whether to worry
- sender: who it claims to be from
- asks_you_to: what it wants the reader to do, in a few words
- risk: scam risk (none / low / medium / high)

Text:
"""
${text}
"""`;
}

export const EXPLAIN_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: '2-3 plain sentences.' },
    what_it_is: STR,
    sender: STR,
    steps: { ...LIST, description: 'What to do, in order, at most 4 short steps.' },
    deadline: { type: 'string', description: 'Copy the date exactly from the letter, or empty.' },
    money: { type: 'array', items: { type: 'object', properties: { amount: STR, what: STR }, required: ['amount', 'what'] } },
    scam_risk: RISK,
    scam_reasons: LIST,
    questions_to_ask: { ...LIST, description: 'Questions to ask the sender or insurer, at most 3.' },
    unclear: { ...LIST, description: 'Things the letter does not say clearly.' },
    can_ignore: { ...LIST, description: 'Parts that need no action.' },
  },
  required: ['summary', 'what_it_is', 'sender', 'steps', 'deadline', 'money', 'scam_risk', 'scam_reasons', 'questions_to_ask', 'unclear', 'can_ignore'],
};

export const EXPLAIN_SYSTEM = `You explain confusing letters, bills, insurance notices and messages to older adults and people new to the US.
Rules:
- Plain English, short sentences, no jargon (explain any term you must use, e.g. "deductible").
- Use ONLY facts in the text. Copy amounts and dates exactly. If something is not stated, put it in "unclear"; never guess.
- Personal details were replaced with placeholders like [NAME_1] or [ACCOUNT_1]. Use the placeholders as they are; never try to guess what they hide.
- If it might be a scam, say so plainly and tell them to check through an official channel they find themselves, not the one in the message.
- Mention free help when it fits (payment plan, financial assistance, appeal rights, itemized bill).`;

export function explainPrompt(text) {
  return `Explain this so the reader knows exactly what it is and what to do.

Text:
"""
${text}
"""`;
}

export const FOLLOW_SCHEMA = {
  type: 'object',
  properties: { answer: { type: 'string', description: 'At most 4 short sentences.' } },
  required: ['answer'],
};

export const FOLLOW_SYSTEM = `Answer questions about a letter for an older adult. Plain English, at most 4 short sentences. Use only facts in the letter; if it does not say, say so. Keep placeholders like [NAME_1] as they are.`;

export function followPrompt(letter, question) {
  return `Letter (personal details replaced with placeholders):
"""
${letter}
"""

Question: ${question}`;
}
