import React, { useEffect, useRef, useState } from 'react';
import {
  newGame, tick, tapMailbox, fileTile, fileValue, openLetter, lockDetail, move, deliver, canDeliver, buyUpgrade, takeTray, nextLetter,
  readLetter, letterForCloud, validState, levelOf, stampMax, msToNextStamp, orderReward, tileName, tileIcon,
  CHAINS, FLAG_CHAIN, UPGRADES, PEOPLE, LEVEL_XP, MAILBOX, COLS, MAX_TIER,
} from './engine.js';
import { WRITE_TOPICS } from './deck.js';
import { redact } from '../lib/redact.js';
import { checkRedFlags, RULES } from '../lib/redflags.js';
import { askExpert, SOURCE } from '../lib/pipeline.js';
import './desk.css';

const KEY = 'plain-letter-desk-v1';
function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (validState(s)) return s; } catch {}
  return newGame();
}
function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} }
const person = (id) => PEOPLE.find((p) => p.id === id) || PEOPLE[0];
const flagText = (id) => RULES.find((r) => r.id === id)?.text || id;

function Tile({ t, small }) {
  if (!t) return null;
  if (t.c === 'mailbox') return <div className="tile mailbox"><span className="ic">📮</span></div>;
  const ch = CHAINS[t.c];
  return (
    <div className={'tile c-' + ch.color + (small ? ' small' : '')} title={tileName(t)}>
      <span className="ic">{tileIcon(t)}</span>
      {ch.icons.length > 1 && <span className="tier">{Array.from({ length: MAX_TIER }, (_, i) => <i key={i} className={i < t.n ? 'on' : ''} />)}</span>}
    </div>
  );
}

export default function Desk({ deps, dev, incoming, onIncomingUsed }) {
  const [s, setS] = useState(load);
  const [sel, setSel] = useState(null);
  const [drag, setDrag] = useState(null); // {from, x, y}
  const [flash, setFlash] = useState(null); // cell index that just merged
  const [toast, setToast] = useState('');
  const [letter, setLetter] = useState(null); // last opened letter panel
  const [expert, setExpert] = useState(null); // {status, data, sent, source, who}
  const [ledger, setLedger] = useState([]);
  const [panel, setPanel] = useState(''); // 'desk' | 'help' | 'ledger'
  const [now, setNow] = useState(Date.now());
  const [written, setWritten] = useState([]); // letters written by the on-device model
  const writing = useRef(false);
  const down = useRef(null);
  const topicAt = useRef(0);

  useEffect(() => { save(s); }, [s]);
  useEffect(() => { const t = setInterval(() => { setNow(Date.now()); setS((x) => tick(x)); }, 1000); return () => clearInterval(t); }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 2600); return () => clearTimeout(t); }, [toast]);
  useEffect(() => { if (flash === null) return; const t = setTimeout(() => setFlash(null), 450); return () => clearTimeout(t); }, [flash]);

  // A letter brought over from the main tool arrives as a free sealed letter.
  useEffect(() => {
    if (!incoming) return;
    const r = tapMailbox(s, { text: incoming, title: 'Your letter', kind: checkRedFlags(incoming).level ? 'scam' : 'real', source: 'yours' }, Date.now(), true);
    if (r.event.type === 'letter') { setS(r.state); setSel(r.event.cell); say('Your letter is on the desk. It stays on this computer. Tap it twice to open.'); }
    onIncomingUsed?.();
  }, [incoming]);

  // The on-device model writes fresh practice letters in the background.
  useEffect(() => {
    const w = deps?.device?.writeLetter;
    if (!w || writing.current || written.length >= 1) return;
    writing.current = true;
    const t = WRITE_TOPICS[topicAt.current++ % WRITE_TOPICS.length];
    w(t.kind, t.topic)
      .then((d) => {
        const text = String(d?.text || '').trim();
        const r = readLetter(text);
        if (text.length > 40 && (r.flags.length || r.details.length || r.due)) setWritten((x) => [...x, { text, title: String(d.title || 'New letter').slice(0, 40), kind: t.kind, source: 'device' }]);
      })
      .catch(() => {})
      .finally(() => { writing.current = false; setNow(Date.now()); });
  }, [deps, written.length, now]);

  function say(m) { setToast(m); }
  function levelMsg(l) { if (l) say(`Level ${l}! New kinds of letters can arrive now.`); }

  function apply(r) {
    setS(r.state);
    const e = r.event;
    if (e.type === 'merge') { setFlash(e.cell); say(`Merged: ${tileName(e.tile)}`); levelMsg(e.levelUp); }
    if (e.type === 'no-stamps') say('Out of stamps. A new one arrives every few seconds.');
    if (e.type === 'board-full') say('The desk is full. Merge or hand in some clues first.');
    if (e.type === 'locked') { setFlash(e.cell); say('Locked on your device. Locked details can go to the cloud; exposed ones never do.'); levelMsg(e.levelUp); }
    return e;
  }

  function onMailbox() {
    const L = nextLetter(s, written);
    const e = apply(tapMailbox(s, L));
    if (e.type === 'letter') {
      if (L.source === 'device') setWritten((x) => x.slice(1));
      setSel(e.cell);
      say(L.source === 'device' ? 'A fresh letter, written by Gemini Nano on your device. Tap it again to open.' : 'New letter. Tap it again to open.');
    }
  }

  function activate(i) {
    const t = s.board[i];
    if (t.c === 'letter') {
      const r = openLetter(s, i);
      const e = apply(r);
      const L = r.state.letters[e.lid];
      setLetter({ ...L, lid: e.lid, read: e.read });
      setSel(null);
      say(e.read.flags.length ? `${e.read.flags.length} warning sign${e.read.flags.length > 1 ? 's' : ''} found by the rules on your device.` : 'No warning signs. Looks like a real letter: check the facts.');
      if (e.tray) setTimeout(() => say(`${e.tray} clue${e.tray > 1 ? 's' : ''} waiting in the tray: make room on the desk.`), 2700);
      levelMsg(e.levelUp);
    } else if (t.c === 'exposed') {
      apply(lockDetail(s, i)); setSel(null);
    } else {
      say(t.n < MAX_TIER ? 'Drag it onto a twin to merge it one step up, or file it for coins.' : 'Top level! Hand it in, or file it for coins.');
    }
  }

  function tap(i) {
    if (i === MAILBOX) { onMailbox(); return; }
    const t = s.board[i];
    if (sel === null) { if (t) setSel(i); return; }
    if (sel === i) { activate(i); return; }
    const a = s.board[sel];
    if (a && a.c !== 'mailbox' && (!t || (t.c === a.c && t.n === a.n))) { apply(move(s, sel, i)); setSel(null); return; }
    setSel(t ? i : null);
  }

  // Pointer: a short press is a tap, a drag moves / merges / swaps.
  function pDown(e, i) {
    if (e.button !== undefined && e.button !== 0) return;
    down.current = { i, x: e.clientX, y: e.clientY, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function pMove(e) {
    const d = down.current; if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8 && d.i !== MAILBOX && s.board[d.i]) d.moved = true;
    if (d.moved) setDrag({ from: d.i, x: e.clientX, y: e.clientY });
  }
  function pUp(e) {
    const d = down.current; down.current = null;
    if (!d) return;
    if (!d.moved) { tap(d.i); return; }
    setDrag(null);
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-cell]');
    if (el) { const to = Number(el.dataset.cell); apply(move(s, d.i, to)); setSel(null); }
  }

  async function onDeliver(o) {
    const r = deliver(s, o.id);
    const e = r.event;
    if (e.type !== 'delivered') { say('Not ready yet: you need every tile shown on the card.'); return; }
    setS(r.state);
    say(`${person(o.who).name} says thank you! +${e.reward.coins} coins`);
    levelMsg(e.levelUp);
    if (o.cloud) await expertNote(r.state, e.lids, o.who);
  }

  async function expertNote(state, lids, who) {
    const L = letterForCloud(state, lids);
    if (!L || !deps) return;
    const red = redact(L.text);
    setExpert({ status: 'asking', who, sent: red.text, title: L.title });
    try {
      const r = await askExpert({ original: L.text, redaction: red, risk: checkRedFlags(L.text) }, deps);
      if (r.blocked) { setExpert({ status: 'blocked', who, sent: red.text, problems: r.blocked, title: L.title }); return; }
      setExpert({ status: 'done', who, data: r.data, source: r.source, sent: r.ledger[0].sent, title: L.title });
      setLedger((x) => [...x, { step: `expert note for ${person(who).name} (${L.title})`, sent: r.ledger[0].sent }]);
    } catch (err) {
      setExpert({ status: 'error', who, sent: red.text, title: L.title, msg: String(err.message || err) });
    }
  }

  const lvl = levelOf(s.xp);
  const lo = LEVEL_XP[lvl - 1] ?? 0, hi = LEVEL_XP[lvl] ?? lo + 60;
  const nextUp = UPGRADES.find((u) => !s.upgrades[u.id]);
  const secs = Math.ceil(msToNextStamp(s, now) / 1000);
  const selT = sel !== null ? s.board[sel] : null;
  const hint = selT
    ? selT.c === 'letter' ? 'Sealed letter: tap again to open it on your device.'
      : selT.c === 'exposed' ? `${tileName(selT)}: tap again to lock it before anything goes to the cloud.`
        : `${tileName(selT)} · ${CHAINS[selT.c].label}${selT.n < MAX_TIER ? ' · drag onto a twin to merge, or' : ' · top level:'}`
    : 'Tap the mailbox 📮 for a letter. Tap a letter twice to open it. Drag twins together to merge.';

  return (
    <div className="desk">
      <div className="dmain">
      <div className="hud">
        <div className="lvl" title={`${s.xp} xp`}>
          <b>Level {lvl}</b>
          <span className="bar"><i style={{ width: `${Math.min(100, ((s.xp - lo) / (hi - lo)) * 100)}%` }} /></span>
        </div>
        <span className="stat" title="Coins">🪙 {s.coins}</span>
        <span className="stat" title="Stamps: one per letter">📮 {s.stamps}/{stampMax(s)}{secs ? <small> +1 in {secs}s</small> : null}</span>
        <button className="ghost sm" onClick={() => setPanel(panel === 'desk' ? '' : 'desk')}>🛋️ Help desk</button>
        <button className="ghost sm" onClick={() => setPanel(panel === 'help' ? '' : 'help')} aria-label="How to play">❓ How to play</button>
      </div>

      <div className="ai-line">
        <span className={'chip dev-' + dev}><i />{dev === 'available' ? (written.length ? 'Gemini Nano wrote a fresh letter for you' : writing.current ? 'Gemini Nano is writing a practice letter…' : 'Gemini Nano ready') : 'Practice letters from the built-in deck'}</span>
        <button className="link" onClick={() => setPanel(panel === 'ledger' ? '' : 'ledger')}>What left my computer ({ledger.length})</button>
      </div>

      <div className="board" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }} onPointerMove={pMove}>
        {s.board.map((t, i) => (
          <div key={i} data-cell={i} className={'cell' + (sel === i ? ' sel' : '') + (flash === i ? ' pop' : '') + (drag?.from === i ? ' lifted' : '') + (t?.c === 'exposed' ? ' warn' : '')}
            onPointerDown={(e) => pDown(e, i)} onPointerUp={pUp} role="button" aria-label={t ? (t.c === 'mailbox' ? 'Mailbox' : tileName(t)) : 'Empty'}>
            <Tile t={t} />
            {i === MAILBOX && <span className="stamps">{s.stamps}</span>}
          </div>
        ))}
        {drag && s.board[drag.from] && <div className="ghosttile" style={{ left: drag.x, top: drag.y }}><Tile t={s.board[drag.from]} /></div>}
      </div>

      {s.tray.length > 0 && (
        <button className="tray" onClick={() => apply(takeTray(s))}>
          <span>Waiting: </span>{s.tray.slice(0, 6).map((t, k) => <Tile key={k} t={t} small />)}{s.tray.length > 6 ? ` +${s.tray.length - 6}` : ''}<span className="mute"> · tap to place</span>
        </button>
      )}

      <div className="hint" role="status">{hint}
        {selT && fileValue(selT) > 0 && <button className="ghost sm file" onClick={() => { const r = fileTile(s, sel); setS(r.state); setSel(null); say(`Filed away: +${r.event.coins} coin${r.event.coins > 1 ? 's' : ''}`); levelMsg(r.event.levelUp); }}>🗂️ File it · +{fileValue(selT)}🪙</button>}
      </div>
      </div>

      <div className="dside">
      <div className="orders">
        {s.orders.map((o) => {
          const p = person(o.who);
          const ready = canDeliver(s, o);
          const rw = orderReward(s, o);
          return (
            <div key={o.id} className={'order' + (ready.ok ? ' ready' : '') + (o.cloud ? ' cloud' : '')}>
              <div className="who"><span className="face">{p.face}</span><span><b>{p.name}</b>{o.cloud && <em className="cl">☁ Expert</em>}</span></div>
              <p className="ask">{o.ask}</p>
              <div className="needs">
                {o.need.map((n, k) => <span key={k} className={'need' + (s.board.some((t) => t && t.c === n.c && t.n === n.n) ? ' have' : '')}><Tile t={n} small /></span>)}
              </div>
              <button className="primary sm" disabled={!ready.ok} onClick={() => onDeliver(o)}>{ready.ok ? `Hand in · 🪙${rw.coins}` : `🪙 ${rw.coins}`}</button>
            </div>
          );
        })}
      </div>

      {panel === 'help' && (
        <div className="card note">
          <b>Letter Desk</b> trains the two habits that stop most scams: spotting warning signs, and keeping your details to yourself.
          <ol>
            <li>Tap the 📮 mailbox (one stamp) for a letter. Tap the letter again: the rules on your device read it and turn it into clues.</li>
            <li>Drag two identical clues together to merge them one step up: 🔗 → 🎣 → 🕸️ → 🏅.</li>
            <li>🪪 Exposed personal details must be tapped to <b>lock</b> on your device first. Only locked 🔒 tiles can go to a ☁ cloud request.</li>
            <li>Hand in clues to the family requests for coins. Spend coins on the help desk to unlock helpers.</li>
          </ol>
          {dev === 'available' ? 'Gemini Nano on your device writes fresh practice letters, free and offline.' : 'With Chrome\'s on-device model, Gemini Nano writes fresh practice letters for you.'} Cloud requests send the expert only the redacted letter.
        </div>
      )}

      {panel === 'ledger' && (
        <div className="card note">
          <b>Everything this desk sent to the cloud</b>
          {ledger.length ? ledger.map((l, i) => <details key={i}><summary>{l.step}</summary><pre>{l.sent}</pre></details>) : <p className="mute">Nothing yet. Only ☁ cloud requests send anything, and only redacted text.</p>}
        </div>
      )}

      {panel === 'desk' && (
        <div className="card upgrades">
          <b>Neighborhood help desk</b> <span className="mute">· fix it up one piece at a time</span>
          <div className="ugrid">
            {UPGRADES.map((u) => {
              const owned = !!s.upgrades[u.id];
              const isNext = nextUp?.id === u.id;
              return (
                <button key={u.id} className={'ug' + (owned ? ' owned' : '') + (isNext ? ' next' : '')} disabled={owned || !isNext}
                  onClick={() => { const r = buyUpgrade(s, u.id); const e = r.event; if (e.type === 'upgrade') { setS(r.state); say(`${u.name}: ${u.perk}`); levelMsg(e.levelUp); } else if (e.type === 'no-coins') say(`${u.name} needs ${u.cost} coins.`); }}>
                  <span className="ic">{u.icon}</span>
                  <span className="nm">{u.name}</span>
                  <span className="pk">{u.perk}</span>
                  <span className="cs">{owned ? 'Done' : `🪙 ${u.cost}`}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}


      {expert && (
        <div className="card lane cloud expert">
          <div className="lanehead"><span className="h">☁ Expert note for {person(expert.who).name}</span>
            {expert.status === 'done' && <span className={'badge ' + (expert.source === SOURCE.DEVICE ? 'dev' : 'cloud')}>{expert.source === SOURCE.DEVICE ? 'On your device' : 'Cloud · saw redacted text only'}</span>}</div>
          {expert.status === 'asking' && <p className="mute">Asking the cloud expert about “{expert.title}”. Only the redacted letter is sent…</p>}
          {expert.status === 'done' && (<>
            <p className="say">{expert.data.summary}</p>
            {expert.data.scam_reasons?.length > 0 && <ul>{expert.data.scam_reasons.slice(0, 3).map((x, k) => <li key={k}>{x}</li>)}</ul>}
          </>)}
          {expert.status === 'blocked' && <p className="err">Blocked before sending: {expert.problems.join(', ')}. Nothing was sent.</p>}
          {expert.status === 'error' && <p className="mute">The cloud expert is not reachable right now; your coins are safe. ({expert.msg})</p>}
          <details><summary>What was sent</summary><pre>{expert.sent}</pre></details>
        </div>
      )}

      {letter && (
        <div className={'card letterpanel ' + (letter.read.flags.length ? 'scam' : 'real')}>
          <div className="lanehead">
            <span className="h">{letter.title}</span>
            <span className={'badge ' + (letter.source === 'device' ? 'dev' : 'rules')}>{letter.source === 'device' ? 'Written by Gemini Nano on your device' : letter.source === 'yours' ? 'Your letter · stays here' : 'Practice letter'}</span>
          </div>
          <pre className="letter">{letter.text}</pre>
          {letter.read.flags.length ? (
            <ul className="signs">{letter.read.flags.map((f) => <li key={f.id}><b>{CHAINS[FLAG_CHAIN[f.id]]?.icons[f.level >= 3 ? 1 : 0]}</b> {flagText(f.id)}</li>)}</ul>
          ) : <p className="mute">No warning signs. Real letters still deserve a look: the deadline and the amount became clues too.</p>}
          {letter.read.details.length > 0 && <p className="mute">🪪 {letter.read.details.length} kind{letter.read.details.length > 1 ? 's' : ''} of personal detail found ({letter.read.details.map((d) => d.toLowerCase()).join(', ')}). Lock them before any cloud request.</p>}
        </div>
      )}

      </div>
      {toast && <div className="desk-toast" role="status">{toast}</div>}

      <p className="foot">Progress is saved in this browser only. <button className="link" onClick={() => { if (confirm('Start the desk over?')) { const n = newGame(); setS(n); setLetter(null); setExpert(null); setSel(null); } }}>Start over</button></p>
    </div>
  );
}
