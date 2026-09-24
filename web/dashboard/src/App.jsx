import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import Arch from './Arch.jsx';

function usePoll(fn, ms) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    const run = async () => { try { const d = await fn(); if (alive) setData(d); } catch { /* keep last */ } };
    run();
    const id = setInterval(run, ms);
    return () => { alive = false; clearInterval(id); };
  }, [ms]);
  return data;
}

const pct = (n) => `${(n * 100).toFixed(1)}%`;
const ms = (n) => `${Number(n || 0).toFixed(1)} ms`;

function Pill({ up, label }) {
  return <span className={`pill ${up ? 'on' : 'off'}`} title={`${label}: ${up ? 'up' : 'down'}`}>{label}</span>;
}

export default function App() {
  const [key, setKey] = useState('hello');
  const [region, setRegion] = useState('eu');
  const [content, setContent] = useState('Hello CDN');
  const [log, setLog] = useState([]);
  const [mode, setMode] = useState('eventual');
  const [lagMs, setLagMs] = useState(2000);
  const [lastGet, setLastGet] = useState(null);
  const [view, setView] = useState('dash');

  const health = usePoll(api.healthAll, 5000);
  const summary = usePoll(api.summary, 2000);
  const byEdge = usePoll(api.byEdge, 2000);
  const series = usePoll(api.timeseries, 2000);
  const edges = usePoll(api.edgeStatsAll, 2000);
  const repl = usePoll(api.replStatus, 2000);
  const consist = usePoll(api.consistency, 2000);

  const push = (m) => setLog((l) => [`${new Date().toLocaleTimeString()}  ${m}`, ...l].slice(0, 10));
  const keys = consist?.matrix || [];
  const edgeRows = ['us', 'eu', 'asia'].map((r) => {
    const a = byEdge?.byEdge?.find((x) => x.edge === r);
    const e = edges?.[r];
    const total = a?.c || 0, hits = a?.h || 0;
    return { region: r, total, hits, ratio: total ? hits / total : 0, avg: a?.avgMs || 0, size: e?.size ?? '–', evict: e?.evictions ?? '–' };
  });
  const buckets = (series?.series || []).slice(-24);
  const maxB = Math.max(1, ...buckets.map((b) => b.hits + b.misses));

  const doGet = async () => {
    const k = key.trim();
    if (!k) return push('GET: key is empty.');
    const t0 = performance.now();
    try {
      const r = await api.gatewayGet(k, region);
      const m = r._meta || {};
      setLastGet({ ok: true, key: k, cache: m.cache, version: r.version, ms: performance.now() - t0 });
      push(`GET ${k} → ${m.cache || '?'} v${r.version} (${(performance.now() - t0).toFixed(0)} ms)`);
    } catch (e) {
      setLastGet({ ok: false, key: k, error: e.status === 404 ? 'not found — PUT it first' : String(e.message || e) });
      push(`GET ${k} → ${e.status === 404 ? '404 not found (PUT first)' : 'failed: ' + (e.message || e)}`);
    }
  };
  const doPut = async () => {
    const k = key.trim();
    if (!k) return push('PUT: key is empty.');
    const t0 = performance.now();
    try {
      const r = await api.gatewayPut(k, content);
      push(`PUT ${k} → v${r.version} (${(performance.now() - t0).toFixed(0)} ms, repl ${r.replication?.detail?.mode || '?'})`);
    } catch (e) { push(`PUT failed: ${e.message || e}`); }
  };
  const doInvalidate = async () => {
    const k = key.trim();
    if (!k) return push('Invalidate: key is empty.');
    try { await api.invalidate(k); push(`Invalidated "${k}" on all edges`); }
    catch (e) { push(`Invalidate failed: ${e.message || e}`); }
  };
  const doMode = async () => {
    try { await api.replMode(mode, Number(lagMs)); push(`Replication: ${mode}, lag ${lagMs} ms`); }
    catch (e) { push(`Mode change failed: ${e.message || e}`); }
  };
  const doReset = async () => {
    try { await api.resetMetrics(); push('Analytics reset'); }
    catch (e) { push(`Reset failed: ${e.message || e}`); }
  };

  return (
    <div className="wrap">
      <header>
        <div>
          <h1>CDN Dashboard</h1>
          <p className="sub">Simulated edge network · origin + 3 edges + replication</p>
        </div>
        <div className="pills">
          {health ? (<>
            <Pill up={health.gateway === 'up'} label="gateway" />
            <Pill up={health.origin === 'up'} label="origin" />
            <Pill up={health.us === 'up'} label="us" />
            <Pill up={health.eu === 'up'} label="eu" />
            <Pill up={health.asia === 'up'} label="asia" />
            <Pill up={health.repl === 'up'} label="repl" />
            <Pill up={health.coord === 'up'} label="coord" />
          </>) : <span className="sub">checking…</span>}
        </div>
      </header>

      <nav className="tabs">
        <button className={view === 'dash' ? 'active' : ''} onClick={() => setView('dash')}>Dashboard</button>
        <button className={view === 'arch' ? 'active' : ''} onClick={() => setView('arch')}>Architecture &amp; flow</button>
      </nav>

      {view === 'arch' ? <Arch /> : (<>
      {summary && (
        <div className="cards">
          <div className="card"><div className="num">{summary.total}</div><div className="lbl">requests</div></div>
          <div className="card"><div className="num">{pct(summary.hitRatio)}</div><div className="bar"><i style={{ width: `${summary.hitRatio * 100}%` }} /></div><div className="lbl">hit ratio ({summary.hits} hit / {summary.misses} miss)</div></div>
          <div className="card"><div className="num">{ms(summary.hit.avgMs)}</div><div className="lbl">hit avg · p95 {ms(summary.hit.p95Ms)}</div></div>
          <div className="card"><div className="num">{ms(summary.miss.avgMs)}</div><div className="lbl">miss avg · p95 {ms(summary.miss.p95Ms)}</div></div>
        </div>
      )}

      <div className="grid">
        <section>
          <h2>Request tester</h2>
          <div className="row">
            <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="key, e.g. hello" aria-label="key" />
            <select value={region} onChange={(e) => setRegion(e.target.value)} aria-label="region">
              <option value="us">US</option><option value="eu">EU</option><option value="asia">Asia</option>
            </select>
            <button className="primary" onClick={doGet}>GET</button>
          </div>
          <div className="row">
            <input value={content} onChange={(e) => setContent(e.target.value)} placeholder="content value" style={{ flex: 1 }} aria-label="content" />
            <button onClick={doPut}>PUT</button>
            <button onClick={doInvalidate}>Invalidate</button>
          </div>
          {lastGet && (
            <div className={lastGet.ok ? 'result ok' : 'result err'}>
              {lastGet.ok
                ? <span><b className={lastGet.cache === 'HIT' ? 'hit' : 'miss'}>{lastGet.cache || '?'}</b> · v{lastGet.version} · {lastGet.ms.toFixed(0)} ms</span>
                : <span>“{lastGet.key}” {lastGet.error}</span>}
            </div>
          )}
          <div className="chips">
            <span className="chiplabel">Keys:</span>
            {keys.length === 0 && <span className="chiplabel">none yet — PUT one</span>}
            {keys.map((r) => (
              <button key={r.key} className={r.key === key.trim() ? 'chip active' : 'chip'} onClick={() => setKey(r.key)}> {r.key} · v{r.origin} </button>
            ))}
          </div>
          <pre className="log">{log.join('\n') || 'Activity will appear here…'}</pre>
        </section>

        <section>
          <h2>Edges</h2>
          <table>
            <thead><tr><th></th><th>req</th><th>hit %</th><th>avg</th><th>cached</th><th>evict</th></tr></thead>
            <tbody>
              {edgeRows.map((r) => (
                <tr key={r.region}><td><b>{r.region}</b></td><td>{r.total}</td><td>{pct(r.ratio)}</td><td>{ms(r.avg)}</td><td>{r.size}</td><td>{r.evict}</td></tr>
              ))}
            </tbody>
          </table>
          <h2 style={{ marginTop: 16 }}>Traffic <span className="chiplabel">(last 2 min)</span></h2>
          <div className="spark">
            {buckets.length === 0 && <span className="chiplabel">no traffic yet</span>}
            {buckets.map((b, i) => (
              <div key={i} className="bcol" title={`${b.t}: ${b.hits} hit / ${b.misses} miss`}>
                <div className="bmiss" style={{ height: `${((b.hits + b.misses) / maxB) * 64}px` }}>
                  <div className="bhit" style={{ height: `${(b.hits / Math.max(1, b.hits + b.misses)) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="legend"><span><i className="sw hit" /> hit</span><span><i className="sw miss" /> miss</span></div>
        </section>
      </div>

      <div className="grid">
        <section>
          <h2>Replication <span className="chiplabel">{repl ? `${repl.mode} · lag ${repl.lagMs} ms · pending ${repl.pending}` : '…'}</span></h2>
          <div className="row">
            <select value={mode} onChange={(e) => setMode(e.target.value)} aria-label="mode">
              <option value="eventual">eventual (async)</option><option value="strong">strong (sync)</option>
            </select>
            <input type="number" value={lagMs} onChange={(e) => setLagMs(e.target.value)} style={{ width: 90 }} aria-label="lag ms" />
            <button onClick={doMode}>Apply</button>
            <button className="danger" onClick={doReset}>Reset stats</button>
          </div>
          <ul className="recent">
            {(repl?.recent || []).slice(0, 4).map((h, i) => (
              <li key={i}><code>{h.key} v{h.version}</code> → {h.results?.filter((r) => r.ok).length ?? '?'}/{h.results?.length ?? '?'} edges <span className="chiplabel">{h.time?.slice(11, 19)}</span></li>
            ))}
            {(!repl?.recent || repl.recent.length === 0) && <li className="chiplabel">no replications yet — PUT a key</li>}
          </ul>
        </section>
        <section>
          <h2>Consistency <span className="chiplabel">origin vs edges</span></h2>
          <table>
            <thead><tr><th>key</th><th>origin</th><th>us</th><th>eu</th><th>asia</th></tr></thead>
            <tbody>
              {keys.map((r) => {
                const stale = r.origin !== r.us || r.origin !== r.eu || r.origin !== r.asia;
                return <tr key={r.key} className={stale ? 'stale' : ''}><td><b>{r.key}</b></td><td>{r.origin}</td><td>{r.us ?? '–'}</td><td>{r.eu ?? '–'}</td><td>{r.asia ?? '–'}</td></tr>;
              })}
              {keys.length === 0 && <tr><td colSpan="5" className="chiplabel">no content yet</td></tr>}
            </tbody>
          </table>
        </section>
      </div>
      </>)}
    </div>
  );
}
