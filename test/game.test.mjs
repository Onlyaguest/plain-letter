import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, tapMailbox, openLetter, lockDetail, move, deliver, canDeliver, buyUpgrade, tick, nextLetter,
  refillOrders, rngFrom, levelOf, stampMax, takeTray, letterForCloud, MAILBOX, CELLS, validState,
} from '../src/game/engine.js';
import { DECK } from '../src/game/deck.js';

const T0 = 1_800_000_000_000;
const find = (s, c, n) => s.board.findIndex((t) => t && t.c === c && (n === undefined || t.n === n));
function mail(s, now = T0) { const r = tapMailbox(s, nextLetter(s), now); return r; }
function mailAndOpen(s) {
  const a = mail(s); assert.equal(a.event.type, 'letter');
  return openLetter(a.state, a.event.cell);
}

test('mailbox spends a stamp and drops a sealed letter next to it', () => {
  const s0 = newGame(T0);
  assert.ok(validState(s0));
  const { state, event } = mail(s0);
  assert.equal(event.type, 'letter');
  assert.equal(state.stamps, s0.stamps - 1);
  assert.equal(state.board[event.cell].c, 'letter');
  assert.ok([1, 6].includes(event.cell), 'lands next to the mailbox');
  assert.equal(state.letters[event.lid].title, DECK[0].title);
});

test('opening the toll text turns it into the clues the rules find', () => {
  const { state, event } = mailAndOpen(newGame(T0));
  assert.equal(event.type, 'opened');
  const chains = event.tiles.map((t) => t.c).sort();
  assert.deepEqual(chains, ['fake', 'link', 'money', 'pressure']);
  assert.equal(find(state, 'letter'), -1, 'the letter is used up');
  assert.ok(state.seen.includes('link'));
});

test('two identical clues merge one step up; different ones swap', () => {
  let s = mailAndOpen(newGame(T0)).state;            // toll: link 1
  s = mailAndOpen(s).state;                           // package: link 1 + link 1 (login)
  const ones = s.board.map((t, i) => (t && t.c === 'link' && t.n === 1 ? i : -1)).filter((i) => i >= 0);
  assert.ok(ones.length >= 2);
  const r = move(s, ones[0], ones[1]);
  assert.equal(r.event.type, 'merge');
  assert.deepEqual([r.state.board[ones[1]].c, r.state.board[ones[1]].n], ['link', 2]);
  assert.equal(r.state.board[ones[0]], null);
  const a = find(r.state, 'pressure'), b = find(r.state, 'money');
  const sw = move(r.state, a, b);
  assert.equal(sw.event.type, 'swap');
  assert.equal(sw.state.board[b].c, 'pressure');
});

test('the mailbox cannot be moved or merged into', () => {
  const s = mailAndOpen(newGame(T0)).state;
  const i = find(s, 'link');
  assert.equal(move(s, MAILBOX, i).event.type, 'blocked');
  assert.equal(move(s, i, MAILBOX).event.type, 'blocked');
});

test('exposed personal details cannot merge until they are locked on the device', () => {
  let s = newGame(T0);
  s.xp = 20; // level 3: letters with personal details arrive
  s.deckPos = 3; // the water bill
  const r = mailAndOpen(s);
  s = r.state;
  const exposed = s.board.map((t, i) => (t && t.c === 'exposed' ? i : -1)).filter((i) => i >= 0);
  assert.ok(exposed.length >= 2);
  assert.notEqual(move(s, exposed[0], exposed[1]).event.type, 'merge');
  s = lockDetail(s, exposed[0]).state;
  s = lockDetail(s, exposed[1]).state;
  const m = move(s, exposed[0], exposed[1]);
  assert.equal(m.event.type, 'merge');
  assert.deepEqual([m.state.board[exposed[1]].c, m.state.board[exposed[1]].n], ['privacy', 2]);
});

test('a request is delivered only when the board has every tile, and pays coins and xp', () => {
  let s = mailAndOpen(newGame(T0)).state;
  const rose = s.orders.find((o) => o.who === 'rose');
  assert.ok(canDeliver(s, rose).ok);
  const r = deliver(s, rose.id, rngFrom(3));
  assert.equal(r.event.type, 'delivered');
  assert.equal(r.state.coins, 5);
  assert.ok(r.state.xp > s.xp);
  assert.equal(r.state.orders.length, 3, 'a new request replaces it');
  assert.equal(find(r.state, 'link', 1), -1);
  const patel = r.state.orders.find((o) => o.who === 'patel');
  assert.equal(deliver(r.state, patel.id).event.type, 'not-ready');
});

test('cloud requests always need a locked (privacy) tile, never an exposed one', () => {
  const s = newGame(T0); s.xp = 40; s.seen = ['link', 'pressure', 'payment', 'fake']; s.orders = [];
  const rng = rngFrom(7);
  for (let k = 0; k < 40; k++) { s.orders = []; refillOrders(s, rng); for (const o of s.orders) {
    assert.ok(!o.need.some((n) => n.c === 'exposed'));
    if (o.cloud) assert.ok(o.need.some((n) => n.c === 'privacy'));
  } }
});

test('stamps refill over time, up to the maximum; an empty mailbox says so', () => {
  let s = newGame(T0);
  s.stamps = 0; s.stampAt = T0;
  assert.equal(tapMailbox(s, nextLetter(s), T0).event.type, 'no-stamps');
  s = tick(s, T0 + 45_000);
  assert.equal(s.stamps, 2);
  s = tick(s, T0 + 10_000_000);
  assert.equal(s.stamps, stampMax(s));
});

test('help desk upgrades are bought in order and change the rules', () => {
  let s = newGame(T0); s.coins = 100;
  assert.equal(buyUpgrade(s, 'magnifier').event.type, 'locked-upgrade');
  s = buyUpgrade(s, 'lamp').state;
  assert.equal(stampMax(s), 11);
  s = buyUpgrade(s, 'magnifier').state;
  assert.equal(s.coins, 40);
  const r = mailAndOpen(s);
  const link = r.event.tiles.find((t) => t.c === 'link');
  assert.equal(link.n, 2, 'magnifier: clues come out one step higher');
  assert.equal(buyUpgrade(r.state, 'kettle').event.type, 'no-coins');
});

test('a full board sends extra clues to the tray, which empties when room frees up', () => {
  let s = newGame(T0);
  for (let i = 1; i < CELLS; i++) s.board[i] = { c: 'money', n: 4 };
  s.board[1] = { c: 'letter', n: 1, lid: 99 };
  s.letters[99] = { text: DECK[0].text, title: 't', kind: 'scam', source: 'deck' };
  const r = openLetter(s, 1);
  assert.equal(r.event.placed.length, 1);
  assert.equal(r.state.tray.length, 3);
  const s2 = r.state; s2.board[2] = null; s2.board[3] = null;
  const t = takeTray(s2).state;
  assert.equal(t.tray.length, 1);
});

test('levels rise with xp; cloud requests pick the latest opened scam letter', () => {
  assert.equal(levelOf(0), 1); assert.equal(levelOf(8), 2); assert.equal(levelOf(300), 11);
  let s = mailAndOpen(newGame(T0)).state;
  const L = letterForCloud(s);
  assert.equal(L.title, DECK[0].title);
  assert.ok(L.read.flags.includes('link'));
});

test('a written letter from the on-device model is used before the deck', () => {
  const s = newGame(T0);
  const w = { text: 'Your package is held. Pay the $2 fee at https://pkg-fee.top within 24 hours.', title: 'Written on device', kind: 'scam', source: 'device' };
  const r = tapMailbox(s, nextLetter(s, [w]), T0);
  assert.equal(r.state.letters[r.event.lid].source, 'device');
  assert.equal(r.state.deckPos, 0);
});

test('a letter brought from the main tool is free to add and never goes to the cloud', () => {
  const s = newGame(T0);
  const r = tapMailbox(s, { text: DECK[2].text, title: 'Your letter', kind: 'scam', source: 'yours' }, T0, true);
  assert.equal(r.state.stamps, s.stamps);
  const o = openLetter(r.state, r.event.cell).state;
  assert.equal(letterForCloud(o), null);
});

test('filing a clue pays coins by tier; letters and exposed details cannot be filed', async () => {
  const { fileTile, fileValue } = await import('../src/game/engine.js');
  let s = newGame(T0);
  s.board[5] = { c: 'link', n: 4 }; s.board[6] = { c: 'exposed', n: 1, kind: 'NAME' };
  assert.equal(fileValue(s.board[6]), 0);
  const r = fileTile(s, 5);
  assert.equal(r.event.type, 'filed'); assert.equal(r.state.coins, 8); assert.equal(r.state.board[5], null);
  assert.equal(fileTile(s, 6).event.type, 'noop');
});

test('requests lean on what is on the board, so they stay reachable', () => {
  const s = newGame(T0); s.xp = 60; s.seen = ['link', 'pressure', 'payment', 'fake'];
  for (let i = 1; i < 10; i++) s.board[i] = { c: 'payment', n: 2 };
  let hits = 0, total = 0;
  const rng = rngFrom(11);
  for (let k = 0; k < 30; k++) { s.orders = []; refillOrders(s, rng); for (const o of s.orders) for (const n of o.need) { total++; if (n.c === 'payment' && n.n >= 2) hits++; } }
  assert.ok(hits / total > 0.35, `payment asked ${hits}/${total}`);
});

test('a cloud request cannot be handed in while any personal detail is exposed', () => {
  let s = mailAndOpen(newGame(T0)).state; // a practice letter has been opened
  s.board[30] = { c: 'privacy', n: 2 }; s.board[31] = { c: 'exposed', n: 1, kind: 'NAME' };
  s.orders = [{ id: 77, who: 'patel', need: [{ c: 'privacy', n: 2 }], cloud: true, ask: '' }];
  assert.equal(canDeliver(s, s.orders[0]).why, 'exposed');
  assert.equal(deliver(s, 77).event.type, 'not-ready');
  s = lockDetail(s, 31).state;
  assert.ok(canDeliver(s, s.orders[0]).ok);
  assert.equal(deliver(s, 77).event.type, 'delivered');
});

test('cloud requests only appear after the player has locked a detail, and need a practice letter', () => {
  const s = newGame(T0); s.xp = 40; s.orders = [];
  const rng = rngFrom(5);
  for (let k = 0; k < 20; k++) { s.orders = []; refillOrders(s, rng); assert.ok(!s.orders.some((o) => o.cloud)); }
  const o = { id: 1, who: 'leo', need: [{ c: 'privacy', n: 1 }], cloud: true };
  s.board[5] = { c: 'privacy', n: 1 };
  assert.equal(canDeliver(s, o).why, 'no-letter');
});
