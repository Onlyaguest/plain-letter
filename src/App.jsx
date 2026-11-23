import React, { useEffect, useMemo, useRef, useState } from 'react';
import { analyzeLocal, askExpert, askFollowUp, SOURCE } from './lib/pipeline.js';
import { createAI, deviceStatus, downloadDeviceModel, CLOUD_MODEL } from './lib/ai.js';
import { createDemoAI } from './lib/demo.js';
import { recognize } from './lib/ocr.js';
import { SAMPLES } from './samples.js';
import Desk from './game/Desk.jsx';

const RISK_TEXT = {
  none: { title: 'No warning signs found', cls: 'ok' },
  low: { title: 'Low risk, still check the details', cls: 'low' },
  medium: { title: 'Be careful', cls: 'mid' },
  high: { title: 'Stop. This looks like a scam', cls: 'high' },
};

const DEVICE_TEXT = {
  available: 'On-device AI ready',
  downloadable: 'On-device AI can be downloaded',
  downloading: 'Downloading on-device AI…',
  unavailable: 'No on-device AI on this computer',
  unsupported: 'No on-device AI in this browser',
};

function Badge({ source }) {
  if (source === SOURCE.DEVICE) return <span className="badge dev" title="Ran on this computer. Nothing was sent.">On your device</span>;
  if (source === SOURCE.CLOUD) return <span className="badge cloud" title="Ran in the cloud on the redacted text only.">Cloud · saw redacted text only</span>;
  return <span className="badge rules" title="Fixed rules on this computer. No AI.">Rules on your device</span>;
}

/** Original letter with the hidden parts highlighted. */
function Marked({ text, items }) {
  const parts = useMemo(() => {
    if (!items.length) return [text];
    const vals = items.map((i) => i.value).sort((a, b) => b.length - a.length);
    const re = new RegExp('(' + vals.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'g');
    return text.split(re);
  }, [text, items]);
  const set = new Set(items.map((i) => i.value));
  return <pre className="letter">{parts.map((p, i) => (set.has(p) ? <mark key={i}>{p}</mark> : p))}</pre>;
}

function Redacted({ text }) {
  const parts = text.split(/(\[[A-Z]+_\d+\])/g);
  return <pre className="letter redacted">{parts.map((p, i) => (/^\[[A-Z]+_\d+\]$/.test(p) ? <span key={i} className="ph">{p}</span> : p))}</pre>;
}

export default function App() {
  const [big, setBig] = useState(false);
  const [text, setText] = useState('');
  const [dev, setDev] = useState('checking');
  const [dlPct, setDlPct] = useState(null);
  const [busy, setBusy] = useState('');
  const [local, setLocal] = useState(null);
  const [expert, setExpert] = useState(null);
  const [follow, setFollow] = useState([]);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const fileRef = useRef(null);
  const [tab, setTab] = useState(() => (location.hash === '#desk' ? 'desk' : 'check'));
  const [toDesk, setToDesk] = useState(null);
  useEffect(() => { history.replaceState(null, '', tab === 'desk' ? '#desk' : location.pathname + location.search); }, [tab]);

  useEffect(() => { document.documentElement.classList.toggle('big', big); }, [big]);
  useEffect(() => { deviceStatus().then(setDev); }, []);

  const deps = useMemo(() => {
    if (dev === 'checking') return null;
    const ready = dev === 'available';
    return createAI({ deviceReady: ready }) || createDemoAI({ deviceReady: ready });
  }, [dev]);

  const ledger = [...(local?.ledger || []), ...(expert?.ledger || []), ...follow.flatMap((f) => f.ledger || [])];

  async function run(input) {
    const t = (input ?? text).trim();
    if (!t || !deps) return;
    setErr(''); setExpert(null); setFollow([]); setLocal(null);
    setBusy('local');
    try {
      setLocal(await analyzeLocal(t, deps));
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy('');
    }
  }

  async function onExpert() {
    setBusy('expert'); setErr('');
    try {
      const r = await askExpert(local, deps);
      if (r.blocked) setErr('Blocked before sending: ' + r.blocked.join(', ') + '. Nothing was sent.');
      else setExpert(r);
    } catch (e) {
      setErr('The cloud expert is not reachable right now. Your on-device results above still stand. (' + (e.message || e) + ')');
    } finally {
      setBusy('');
    }
  }

  async function onAsk(question) {
    const qq = (question ?? q).trim();
    if (!qq) return;
    setBusy('follow'); setErr('');
    try {
      const r = await askFollowUp(local, qq, deps);
      if (r.blocked) setErr('Blocked before sending: ' + r.blocked.join(', '));
      else setFollow((f) => [...f, { q: qq, ...r }]);
      setQ('');
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy('');
    }
  }

  async function onFile(f) {
    if (!f) return;
    setBusy('ocr'); setErr('');
    try {
      const t = await recognize(f);
      setText(t);
      await run(t);
    } catch (e) {
      setErr('Could not read that image. ' + (e.message || e));
      setBusy('');
    }
  }

  async function onDownload() {
    setDev('downloading'); setDlPct(0);
    try {
      await downloadDeviceModel((p) => setDlPct(p));
      setDev(await deviceStatus());
    } catch (e) {
      setErr(String(e.message || e));
      setDev(await deviceStatus());
    }
  }

  function shareText() {
    const d = expert?.data || {};
    const lines = [
      'Can you check this with me? (from Plain Letter)',
      local?.quick?.data?.one_line || '',
      d.summary || '',
      ...(d.steps || []).map((s, i) => `${i + 1}. ${s}`),
      local?.deadline ? `Deadline: ${local.deadline.text}` : '',
    ].filter(Boolean);
    navigator.clipboard?.writeText(lines.join('\n'));
  }

  const risk = expert?.risk || local?.risk;
  const rk = risk ? RISK_TEXT[risk.label] : null;
  const isDemo = deps?.demo;

  return (
    <div className="page">
      <header className="top">
        <div className="brand">
          <img src="./icon.svg" width="40" height="40" alt="" />
          <div>
            <h1>Plain Letter</h1>
            <p>Understand any letter. Your personal details stay on your computer.</p>
          </div>
        </div>
        <div className="topright">
          <span className={'chip dev-' + dev}>
            <i />{DEVICE_TEXT[dev] || 'Checking on-device AI…'}
            {dev === 'downloading' && dlPct != null ? ` ${Math.round(dlPct * 100)}%` : ''}
          </span>
          {dev === 'downloadable' && <button className="link" onClick={onDownload}>Download</button>}
          <button className="toggle" aria-pressed={big} onClick={() => setBig(!big)}>Large text</button>
        </div>
      </header>

      {isDemo && (
        <div className="demo">Demo mode: Firebase is not configured here, so AI answers are pre-written samples. Rules, redaction and the privacy gate are real.</div>
      )}

      <nav className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'check'} onClick={() => setTab('check')}>Check a letter</button>
        <button role="tab" aria-selected={tab === 'desk'} onClick={() => setTab('desk')}>🎮 Letter Desk</button>
      </nav>

      {tab === 'desk' ? (
        <Desk deps={deps} dev={dev} incoming={toDesk} onIncomingUsed={() => setToDesk(null)} />
      ) : (<>
      <section className="input card">
        <label htmlFor="t" className="h">Paste a letter, bill or text message</label>
        <textarea id="t" value={text} onChange={(e) => setText(e.target.value)} rows={big ? 7 : 8}
          placeholder="Paste it here, or upload a photo or screenshot. It is read on this computer." />
        <div className="row">
          <button className="primary" disabled={!text.trim() || !!busy || !deps} onClick={() => run()}>
            {busy === 'local' ? 'Reading on your device…' : 'Check it'}
          </button>
          <button className="ghost" disabled={!!busy} onClick={() => fileRef.current?.click()}>
            {busy === 'ocr' ? 'Reading the image…' : 'Upload a photo'}
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        </div>
        <div className="samples">
          <span>Try a sample:</span>
          {SAMPLES.map((s) => (
            <button key={s.id} className="pill" disabled={!!busy || !deps} onClick={() => { setText(s.text); run(s.text); }}>{s.label}</button>
          ))}
        </div>
      </section>

      {err && <div className="err" role="alert">{err}</div>}

      {local && (
        <div className="results">
          {rk && (
            <div className={'risk ' + rk.cls} role="status">
              <b>{rk.title}</b>
              {local.flags.hits.length > 0 && <span> · {local.flags.hits.length} warning sign{local.flags.hits.length > 1 ? 's' : ''}</span>}
            </div>
          )}

          <section className="card lane dev">
            <div className="lanehead"><h2>1 · Quick check</h2><Badge source={local.quick?.source} /></div>
            {local.quick ? (
              <>
                <p className="say">{local.quick.data.one_line}</p>
                <dl className="kv">
                  <dt>From</dt><dd>{local.quick.data.sender}</dd>
                  <dt>Wants you to</dt><dd>{local.quick.data.asks_you_to}</dd>
                </dl>
              </>
            ) : <p className="mute">Quick AI check not available. The rule checks below still ran on your device.</p>}
            <div className="facts">
              {local.deadline && (
                <div className={'fact ' + (local.deadline.days <= 7 ? 'soon' : '')}>
                  <small>Deadline</small><b>{local.deadline.text}</b>
                  <span>{local.deadline.days >= 0 ? `${local.deadline.days} days left` : `${-local.deadline.days} days ago`}</span>
                </div>
              )}
              {local.facts.money.slice(0, 4).map((m, i) => (
                <div className="fact" key={i}><small>Amount</small><b>{m.text}</b></div>
              ))}
            </div>
            {local.flags.hits.length > 0 && (
              <div className="signs">
                <h3>Warning signs <Badge source={SOURCE.RULES} /></h3>
                <ul>{local.flags.hits.map((h) => <li key={h.id} className={'lv' + h.level}>{h.text}</li>)}</ul>
              </div>
            )}
            {risk?.level >= 2 && (
              <div className="checks"><h3>Check it yourself</h3><ul>{local.checks.map((c, i) => <li key={i}>{c}</li>)}</ul></div>
            )}
          </section>

          <section className="card lane gate">
            <div className="lanehead"><h2>2 · Privacy gate</h2><span className="mute small">{local.redaction.items.length} personal detail{local.redaction.items.length === 1 ? '' : 's'} hidden</span></div>
            <div className="twocol">
              <div><h3>Your letter <small>(stays here)</small></h3><Marked text={local.original} items={local.redaction.items} /></div>
              <div><h3>What the cloud would see</h3><Redacted text={local.redaction.text} /></div>
            </div>
            {!expert && (
              <button className="primary wide" disabled={!!busy} onClick={onExpert}>
                {busy === 'expert' ? 'Asking the cloud expert…' : 'Ask the cloud expert — sends only the right side'}
              </button>
            )}
          </section>

          {expert && (
            <section className="card lane cloud">
              <div className="lanehead"><h2>3 · Expert explanation</h2><Badge source={expert.source} /></div>
              <p className="say">{expert.data.summary}</p>
              {expert.data.steps?.length > 0 && (<><h3>What to do</h3><ol className="steps">{expert.data.steps.map((s, i) => <li key={i}>{s}</li>)}</ol></>)}
              {expert.data.money?.length > 0 && (<><h3>Money</h3><ul>{expert.data.money.map((m, i) => <li key={i}><b>{m.amount}</b> — {m.what}</li>)}</ul></>)}
              {expert.data.questions_to_ask?.length > 0 && (<><h3>Questions you can ask</h3><ul>{expert.data.questions_to_ask.map((s, i) => <li key={i}>{s}</li>)}</ul></>)}
              {expert.data.unclear?.length > 0 && (<><h3>Not clear in the letter</h3><ul>{expert.data.unclear.map((s, i) => <li key={i}>{s}</li>)}</ul></>)}
              {expert.data.can_ignore?.length > 0 && (<><h3>You can ignore</h3><ul className="mute">{expert.data.can_ignore.map((s, i) => <li key={i}>{s}</li>)}</ul></>)}
              {expert.notInLetter?.length > 0 && (
                <p className="warn">Not in your letter, double-check: {expert.notInLetter.join(', ')}</p>
              )}
              <p className="mute small">Names and numbers were filled back in on your device.</p>
            </section>
          )}

          <section className="card lane ask">
            <div className="lanehead"><h2>Ask a question</h2></div>
            {follow.map((f, i) => (
              <div className="qa" key={i}><p className="q">{f.q}</p><p className="a">{f.answer} <Badge source={f.source} /></p></div>
            ))}
            <div className="row">
              <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onAsk()} placeholder="e.g. Can I ask for a payment plan?" />
              <button className="primary" disabled={!q.trim() || !!busy} onClick={() => onAsk()}>{busy === 'follow' ? '…' : 'Ask'}</button>
            </div>
            <div className="samples">
              {['Is this a scam?', 'What happens if I pay late?', 'Who should I call?'].map((s) => (
                <button key={s} className="pill" disabled={!!busy} onClick={() => onAsk(s)}>{s}</button>
              ))}
            </div>
          </section>

          <div className="row end">
            <button className="ghost" onClick={shareText}>Copy for family</button>
            <button className="ghost" onClick={() => { setToDesk(local.original); setTab('desk'); }}>🎮 Practice with this letter</button>
            <button className="ghost" onClick={() => setLedgerOpen(!ledgerOpen)}>What left my computer ({ledger.length})</button>
          </div>
          {ledgerOpen && (
            <section className="card ledger">
              <h3>Everything sent to the cloud, exactly as sent</h3>
              {ledger.length === 0 ? <p className="mute">Nothing. Everything so far ran on your device.</p> : ledger.map((l, i) => (
                <details key={i}><summary>{l.step}</summary><pre>{l.sent}</pre></details>
              ))}
              <p className="mute small">Cloud model: {CLOUD_MODEL} via Firebase AI Logic. On-device model: Gemini Nano in Chrome.</p>
            </section>
          )}
        </div>
      )}

      </>)}

      <footer className="foot">
        Plain Letter explains; it does not give legal, medical or financial advice. When in doubt, call the official number you find yourself.
      </footer>
    </div>
  );
}
