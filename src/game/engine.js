// Letter Desk: a merge game that trains you to spot scams and guard your details.
// Pure functions over a plain JSON state; every action returns { state, event }.
// The letters are read by the same on-device rules as the main tool (redflags, redact, facts).

import { checkRedFlags } from '../lib/redflags.js';
import { findSpans } from '../lib/redact.js';
import { extractFacts } from '../lib/facts.js';
import { DECK } from './deck.js';

export const COLS = 6;
export const ROWS = 7;
export const CELLS = COLS * ROWS;
export const MAILBOX = 0; // the generator sits in the top-left cell
export const MAX_TIER = 4;

export const CHAINS = {
  link: { label: 'Link trick', color: 'link', scam: true, icons: ['🔗', '🎣', '🕸️', '🏅'], names: ['Link', 'Look-alike link', 'Phishing kit', 'Phishing busted'] },
  pressure: { label: 'Pressure', color: 'pressure', scam: true, icons: ['⏰', '🚨', '📣', '🏅'], names: ['Hurry-up line', 'Threat', 'Pressure play', 'Pressure busted'] },
  payment: { label: 'Payment trick', color: 'payment', scam: true, icons: ['💳', '🎁', '🕳️', '🏅'], names: ['Odd payment', 'Gift-card ask', 'Untraceable payment', 'Payment trick busted'] },
  fake: { label: 'Impostor', color: 'fake', scam: true, icons: ['🏛️', '🎭', '📜', '🏅'], names: ['Big name', 'Fake official', 'Impostor script', 'Impostor busted'] },
  privacy: { label: 'Privacy', color: 'privacy', icons: ['🔒', '✉️', '🗄️', '🏦'], names: ['Locked detail', 'Sealed envelope', 'Safe box', 'Vault'] },
  date: { label: 'Deadline', color: 'date', icons: ['📅', '⏳', '🗓️', '🔔'], names: ['Date', 'Deadline', 'Calendar note', 'Reminder set'] },
  money: { label: 'Money', color: 'money', icons: ['💲', '🧾', '📒', '✅'], names: ['Amount', 'Checked amount', 'Budget line', 'Bill sorted'] },
  letter: { label: 'Letter', color: 'letter', icons: ['📩'], names: ['Sealed letter'] },
  exposed: { label: 'Exposed detail', color: 'exposed', icons: ['🪪'], names: ['Exposed detail'] },
};

// Which scam chain each warning sign feeds.
export const FLAG_CHAIN = {
  link: 'link', 'link-login': 'link', code: 'link', remote: 'link',
  urgent: 'pressure', secrecy: 'pressure',
  'gift-card': 'payment', 'refund-overpay': 'payment', prize: 'payment',
  authority: 'fake', 'toll-package': 'fake',
};

const DETAIL_NAMES = {
  NAME: 'name', DOB: 'date of birth', ACCOUNT: 'account number', ADDRESS: 'address', PHONE: 'phone number',
  EMAIL: 'email', HEALTH: 'diagnosis', SSN: 'Social Security number', CARD: 'card number',
};

export const UPGRADES = [
  { id: 'lamp', name: 'Reading lamp', icon: '💡', cost: 20, perk: '+3 stamps in the mailbox' },
  { id: 'magnifier', name: 'Magnifier', icon: '🔍', cost: 40, perk: 'Scam clues come out one step higher' },
  { id: 'kettle', name: 'Tea kettle', icon: '🫖', cost: 60, perk: 'Stamps refill twice as fast' },
  { id: 'shredder', name: 'Shredder', icon: '🗑️', cost: 90, perk: 'Personal details lock themselves' },
  { id: 'calendar', name: 'Wall calendar', icon: '🗓️', cost: 130, perk: 'Dates arrive as deadlines' },
  { id: 'phonelist', name: 'Family phone list', icon: '☎️', cost: 180, perk: 'A fourth family request' },
  { id: 'board', name: 'Bulletin board', icon: '📌', cost: 240, perk: 'Requests pay 25% more' },
  { id: 'chair', name: 'Comfy chair', icon: '🛋️', cost: 320, perk: 'The help desk is complete' },
];

export const PEOPLE = [
  { id: 'rose', name: 'Grandma Rose', face: '👵' },
  { id: 'ray', name: 'Uncle Ray', face: '🧔' },
  { id: 'patel', name: 'Mrs. Patel', face: '👩🏽' },
  { id: 'leo', name: 'Leo', face: '🧑' },
  { id: 'chen', name: 'Mr. Chen', face: '👴' },
];

const ASKS = {
  link: 'A text wants me to tap a link. Should I?',
  pressure: 'They say I must act today. Is that normal?',
  payment: 'They want gift cards. Is that how bills work?',
  fake: 'Someone "official" contacted me. Real?',
  privacy: 'Can you get an expert to look, without my details?',
  date: 'When is this actually due?',
  money: 'How much do I really owe?',
};

export const LEVEL_XP = [0, 8, 20, 36, 56, 80, 110, 145, 185, 230, 280];
const STAMP_MS = 20000;
const BASE_STAMPS = 8;

// ---------- helpers ----------
const clone = (s) => JSON.parse(JSON.stringify(s));
export const has = (s, id) => !!s.upgrades[id];
export const stampMax = (s) => BASE_STAMPS + (has(s, 'lamp') ? 3 : 0);
const stampMs = (s) => (has(s, 'kettle') ? STAMP_MS / 2 : STAMP_MS);
export const levelOf = (xp) => { let l = 1; for (let i = 1; i < LEVEL_XP.length; i++) if (xp >= LEVEL_XP[i]) l = i + 1; return l; };
export const tileName = (t) => (t.c === 'exposed' ? `Exposed ${DETAIL_NAMES[t.kind] || 'detail'}` : CHAINS[t.c].names[t.n - 1]);
export const tileIcon = (t) => CHAINS[t.c].icons[t.n - 1];

/** Mulberry32: small seeded random, so tests and the recorded demo are repeatable. */
export function rngFrom(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Read a letter with the on-device rules: which tiles it turns into. */
export function readLetter(text) {
  const flags = checkRedFlags(text).hits;
  const kinds = [...new Set(findSpans(text).map((s) => s.kind).filter((k) => DETAIL_NAMES[k]))];
  const facts = extractFacts(text);
  return {
    flags,
    details: kinds,
    due: facts.dates.find((d) => d.due) || null,
    money: facts.money.length,
  };
}

function emptyCells(s, near = MAILBOX) {
  const r0 = Math.floor(near / COLS), c0 = near % COLS;
  return s.board
    .map((t, i) => (t === null ? i : -1))
    .filter((i) => i >= 0)
    .sort((a, b) => (Math.abs(Math.floor(a / COLS) - r0) + Math.abs((a % COLS) - c0)) - (Math.abs(Math.floor(b / COLS) - r0) + Math.abs((b % COLS) - c0)) || a - b);
}

/** Put tiles on the board near a cell; what does not fit waits in the tray. */
function place(s, tiles, near) {
  const free = emptyCells(s, near);
  const placed = [];
  for (const t of tiles) {
    const i = free.shift();
    if (i === undefined) s.tray.push(t); else { s.board[i] = t; placed.push(i); }
  }
  return placed;
}

function gainXp(s, n) {
  const before = levelOf(s.xp);
  s.xp += n;
  const after = levelOf(s.xp);
  if (after > before) {
    s.stamps = Math.max(s.stamps, stampMax(s));
    s.coins += 10 * (after - before);
    return after;
  }
  return 0;
}

// ---------- state ----------
export function newGame(now = Date.now(), seed = 1) {
  const s = {
    v: 1, seed, board: Array(CELLS).fill(null), tray: [], stamps: BASE_STAMPS, stampAt: now,
    coins: 0, xp: 0, upgrades: {}, orders: [], letters: {}, deckPos: 0, seen: [], nextId: 1,
    stats: { opened: 0, merges: 0, delivered: 0, locked: 0, scams: 0 },
  };
  s.board[MAILBOX] = { c: 'mailbox' };
  // Tutorial requests: match the first toll text exactly.
  s.orders = [
    { id: s.nextId++, who: 'rose', need: [{ c: 'link', n: 1 }], cloud: false, ask: ASKS.link },
    { id: s.nextId++, who: 'ray', need: [{ c: 'pressure', n: 1 }], cloud: false, ask: ASKS.pressure },
    { id: s.nextId++, who: 'patel', need: [{ c: 'link', n: 2 }], cloud: false, ask: 'Two texts with links! Same trick?' },
  ];
  return s;
}

/** Refill stamps over time. */
export function tick(st, now = Date.now()) {
  const max = stampMax(st);
  if (st.stamps >= max) return st.stampAt === now ? st : { ...st, stampAt: now };
  const n = Math.floor((now - st.stampAt) / stampMs(st));
  if (n <= 0) return st;
  const s = clone(st);
  s.stamps = Math.min(max, s.stamps + n);
  s.stampAt = s.stamps >= max ? now : s.stampAt + n * stampMs(s);
  return s;
}
export const msToNextStamp = (s, now = Date.now()) => (s.stamps >= stampMax(s) ? 0 : Math.max(0, s.stampAt + stampMs(s) - now));

/** Next practice letter: written ones first (from the on-device model), then the deck by level. */
export function nextLetter(s, written = []) {
  if (written.length) return written[0];
  const lvl = levelOf(s.xp);
  const pool = DECK.filter((d) => d.minLevel <= lvl);
  const d = pool[s.deckPos % pool.length];
  return { text: d.text, title: d.title, kind: d.kind, source: 'deck' };
}

/** Tap the mailbox: one stamp -> one sealed letter. */
export function tapMailbox(st, letter, now = Date.now(), free = false) {
  let s = tick(st, now);
  if (s.stamps <= 0 && !free) return { state: s, event: { type: 'no-stamps' } };
  if (!emptyCells(s).length) return { state: s, event: { type: 'board-full' } };
  s = clone(s);
  if (!free) {
    if (s.stamps >= stampMax(s)) s.stampAt = now;
    s.stamps -= 1;
  }
  if (letter.source === 'deck') s.deckPos += 1;
  const lid = s.nextId++;
  s.letters[lid] = { text: letter.text, title: letter.title, kind: letter.kind, source: letter.source || 'deck' };
  const [cell] = place(s, [{ c: 'letter', n: 1, lid }], MAILBOX);
  return { state: s, event: { type: 'letter', cell, lid } };
}

/** Tap a sealed letter again: read it on the device, it turns into clue tiles. */
export function openLetter(st, cell) {
  const t = st.board[cell];
  if (!t || t.c !== 'letter') return { state: st, event: { type: 'noop' } };
  const s = clone(st);
  const L = s.letters[t.lid];
  const r = readLetter(L.text);
  const tiles = [];
  for (const f of r.flags) {
    const c = FLAG_CHAIN[f.id];
    if (!c) continue;
    let n = f.level >= 3 ? 2 : 1;
    if (has(s, 'magnifier')) n = Math.min(3, n + 1);
    tiles.push({ c, n, lid: t.lid });
  }
  for (const k of r.details.slice(0, 3)) {
    tiles.push(has(s, 'shredder') ? { c: 'privacy', n: 1, lid: t.lid } : { c: 'exposed', n: 1, kind: k, lid: t.lid });
  }
  if (r.due) tiles.push({ c: 'date', n: has(s, 'calendar') ? 2 : 1, lid: t.lid });
  if (r.money) tiles.push({ c: 'money', n: 1, lid: t.lid });
  s.board[cell] = null;
  const placed = place(s, tiles, cell);
  for (const x of tiles) if (!s.seen.includes(x.c) && CHAINS[x.c].scam) s.seen.push(x.c);
  s.stats.opened += 1;
  if (r.flags.length) s.stats.scams += 1;
  L.read = { flags: r.flags.map((f) => f.id), details: r.details, due: r.due?.text || null };
  const lvl = gainXp(s, 1);
  return { state: s, event: { type: 'opened', lid: t.lid, tiles, placed, tray: tiles.length - placed.length, levelUp: lvl, read: r } };
}

/** Tap an exposed personal detail: lock it on the device. */
export function lockDetail(st, cell) {
  const t = st.board[cell];
  if (!t || t.c !== 'exposed') return { state: st, event: { type: 'noop' } };
  const s = clone(st);
  s.board[cell] = { c: 'privacy', n: 1, lid: t.lid };
  s.stats.locked += 1;
  const lvl = gainXp(s, 1);
  return { state: s, event: { type: 'locked', cell, kind: t.kind, levelUp: lvl } };
}

const canMerge = (a, b) => a && b && a.c === b.c && a.n === b.n && a.n < MAX_TIER && CHAINS[a.c] && !['letter', 'exposed', 'mailbox'].includes(a.c);

/** Drag (or tap-tap) a tile onto another cell: merge twins, otherwise swap or move. */
export function move(st, from, to) {
  if (from === to) return { state: st, event: { type: 'noop' } };
  const a = st.board[from], b = st.board[to];
  if (!a || a.c === 'mailbox' || (b && b.c === 'mailbox')) return { state: st, event: { type: 'blocked' } };
  const s = clone(st);
  if (canMerge(a, b)) {
    s.board[from] = null;
    s.board[to] = { c: a.c, n: a.n + 1, lid: b.lid ?? a.lid };
    s.stats.merges += 1;
    const lvl = gainXp(s, a.n);
    return { state: s, event: { type: 'merge', cell: to, tile: s.board[to], levelUp: lvl } };
  }
  s.board[to] = a; s.board[from] = b;
  return { state: s, event: { type: b ? 'swap' : 'move', cell: to } };
}

/** File a clue away for coins: the sink for clues nobody asked for (top tiers pay most). */
export const fileValue = (t) => (t && CHAINS[t.c] && !['letter', 'exposed', 'mailbox'].includes(t.c) ? 2 ** (t.n - 1) : 0);
export function fileTile(st, cell) {
  const t = st.board[cell];
  const v = fileValue(t);
  if (!v) return { state: st, event: { type: 'noop' } };
  const s = clone(st);
  s.board[cell] = null;
  s.coins += v;
  const lvl = gainXp(s, t.n === MAX_TIER ? 2 : 0);
  placeTray(s);
  return { state: s, event: { type: 'filed', cell, coins: v, tile: t, levelUp: lvl } };
}

/** Which board cells would fill this request (or why not). */
export function canDeliver(s, order) {
  const used = new Set();
  const picks = [];
  for (const need of order.need) {
    const i = s.board.findIndex((t, k) => t && !used.has(k) && t.c === need.c && t.n === need.n);
    if (i < 0) return { ok: false, picks };
    used.add(i); picks.push(i);
  }
  return { ok: true, picks };
}

export function orderReward(s, order) {
  let coins = order.need.reduce((m, n) => m + 5 * 2 ** (n.n - 1), 0);
  if (order.cloud) coins = Math.round(coins * 1.5);
  if (has(s, 'board')) coins = Math.round(coins * 1.25);
  const xp = order.need.reduce((m, n) => m + 2 * n.n, 0);
  return { coins, xp };
}

/** Hand the tiles to the family member. Cloud requests also get an expert note (done by the UI). */
export function deliver(st, orderId, rng = Math.random) {
  const order = st.orders.find((o) => o.id === orderId);
  if (!order) return { state: st, event: { type: 'noop' } };
  const { ok, picks } = canDeliver(st, order);
  if (!ok) return { state: st, event: { type: 'not-ready' } };
  const s = clone(st);
  const lids = picks.map((i) => s.board[i].lid).filter(Boolean);
  for (const i of picks) s.board[i] = null;
  const rw = orderReward(s, order);
  s.coins += rw.coins;
  s.stats.delivered += 1;
  const lvl = gainXp(s, rw.xp);
  s.orders = s.orders.filter((o) => o.id !== orderId);
  s.lastWho = order.who;
  refillOrders(s, rng);
  placeTray(s);
  return { state: s, event: { type: 'delivered', order, reward: rw, levelUp: lvl, cloud: order.cloud, lids } };
}

const orderSlots = (s) => (has(s, 'phonelist') ? 4 : 3);

/** Top up the request bar from what the player has seen, harder as the level rises. */
export function refillOrders(s, rng = Math.random) {
  const lvl = levelOf(s.xp);
  const chains = s.seen.length ? s.seen : ['link', 'pressure'];
  const maxTier = lvl >= 7 ? 4 : lvl >= 4 ? 3 : 2;
  const maxNeeds = lvl >= 5 ? 3 : lvl >= 2 ? 2 : 1;
  while (s.orders.length < orderSlots(s)) {
    const pick = (arr) => arr[Math.floor(rng() * arr.length)];
    const busy = new Set(s.orders.map((o) => o.who));
    const free = PEOPLE.filter((p) => !busy.has(p.id) && p.id !== s.lastWho);
    const who = (free.length ? pick(free) : pick(PEOPLE)).id;
    const cloud = lvl >= 2 && rng() < 0.4 && !s.orders.some((o) => o.cloud);
    const need = [];
    if (cloud) need.push({ c: 'privacy', n: Math.min(maxTier, 2) });
    const count = Math.max(1, Math.ceil(rng() * maxNeeds) - (cloud ? 1 : 0)) ;
    const onBoard = s.board.filter((t) => t && CHAINS[t.c] && !['letter', 'exposed', 'privacy'].includes(t.c) && t.n <= maxTier);
    for (let i = 0; i < count; i++) {
      if (onBoard.length && rng() < 0.6) {
        // Ask for something the player has, one step up half the time: always reachable by a merge or two.
        const t = pick(onBoard);
        need.push({ c: t.c, n: Math.min(maxTier, t.n + (rng() < 0.5 ? 1 : 0)) });
      } else {
        const pool = [...chains, ...(lvl >= 2 ? ['date', 'money'] : [])];
        need.push({ c: pick(pool), n: 1 + Math.floor(rng() * maxTier) });
      }
    }
    const main = need.find((n) => n.c !== 'privacy') || need[0];
    s.orders.push({ id: s.nextId++, who, need, cloud, ask: cloud ? ASKS.privacy : ASKS[main.c] });
  }
  return s;
}

/** Move waiting tiles from the tray onto free cells. */
export function placeTray(s) {
  while (s.tray.length && emptyCells(s).length) place(s, [s.tray.shift()], MAILBOX);
  return s;
}
export function takeTray(st) {
  if (!st.tray.length) return { state: st, event: { type: 'noop' } };
  const s = clone(st);
  placeTray(s);
  return { state: s, event: { type: 'tray' } };
}

/** Spend coins on the help desk. */
export function buyUpgrade(st, id) {
  const u = UPGRADES.find((x) => x.id === id);
  const next = UPGRADES.find((x) => !st.upgrades[x.id]);
  if (!u || st.upgrades[id]) return { state: st, event: { type: 'noop' } };
  if (next.id !== id) return { state: st, event: { type: 'locked-upgrade' } };
  if (st.coins < u.cost) return { state: st, event: { type: 'no-coins' } };
  const s = clone(st);
  s.coins -= u.cost;
  s.upgrades[id] = true;
  if (id === 'lamp') s.stamps += 3;
  if (id === 'phonelist') refillOrders(s);
  const lvl = gainXp(s, 3);
  return { state: s, event: { type: 'upgrade', upgrade: u, levelUp: lvl } };
}

/** The letter a cloud request is about: the latest opened scam letter. */
export function letterForCloud(s, lids = []) {
  const ids = [...lids, ...Object.keys(s.letters).reverse()].map(Number);
  // Only practice letters go to the cloud; a letter the player brought from the main tool never does.
  const ok = (L) => L && L.read && L.source !== 'yours';
  for (const id of ids) { const L = s.letters[id]; if (ok(L) && L.read.flags.length) return { lid: id, ...L }; }
  for (const id of ids) { const L = s.letters[id]; if (ok(L)) return { lid: id, ...L }; }
  return null;
}

/** Sanity check for saved games from older versions. */
export function validState(s) {
  return s && s.v === 1 && Array.isArray(s.board) && s.board.length === CELLS && s.board[MAILBOX]?.c === 'mailbox';
}
