import React, { useEffect, useState } from 'react';
import { api } from './api.js';

const SERVICES = {
  client: {
    name: 'Client', port: '—', color: '#6b7280',
    role: 'Demo user / load script. Sends reads and writes, sets X-Client-Region to simulate geography.',
    endpoints: ['GET /c/:key  + X-Client-Region: us|eu|asia', 'PUT /c/:key  {data}'],
  },
  gateway: {
    name: 'Gateway / Edge Router', port: ':3000', color: '#2563eb',
    role: 'Single entry point. Routes each read to the nearest simulated edge (X-Client-Region header → edge map, default us). Writes go straight to Origin. Adds X-Route-Reason / X-Edge-Target headers.',
    endpoints: ['GET /c/:key', 'PUT /c/:key', 'DELETE /c/:key', 'GET /route?region=eu'],
  },
  edgeUs: {
    name: 'Edge-US', port: ':3002', color: '#0891b2',
    role: 'Independent in-memory LRU + TTL cache (default 500 entries, 60 s). HIT → instant reply. MISS → origin-pull, then cache. Accepts pushed replication and purge commands.',
    endpoints: ['GET /cache/:key  (X-Cache: HIT|MISS)', 'POST /internal/replicate', 'DELETE /cache/:key', 'GET /cache/_stats'],
  },
  edgeEu: {
    name: 'Edge-EU', port: ':3003', color: '#0891b2',
    role: 'Same image as Edge-US, separate container and separate memory (REGION=eu). A purge or crash here never affects the other edges.',
    endpoints: ['GET /cache/:key  (X-Cache: HIT|MISS)', 'POST /internal/replicate', 'DELETE /cache/:key', 'GET /cache/_stats'],
  },
  edgeAsia: {
    name: 'Edge-Asia', port: ':3004', color: '#0891b2',
    role: 'Same image, REGION=asia. Demonstrates geographic replication lag and per-region hit ratios.',
    endpoints: ['GET /cache/:key  (X-Cache: HIT|MISS)', 'POST /internal/replicate', 'DELETE /cache/:key', 'GET /cache/_stats'],
  },
  origin: {
    name: 'Origin Content Service', port: ':3001', color: '#7c3aed',
    role: 'Authoritative source of truth. SQLite metadata (key, version++, content type) + blob files on disk. Every PUT bumps the version and notifies Replication.',
    endpoints: ['PUT /content/:key → version++', 'GET /content/:key', 'GET /content', 'DELETE /content/:key'],
  },
  repl: {
    name: 'Replication Service', port: ':3005', color: '#ea580c',
    role: 'Origin → edges fanout. STRONG: pushes to all edges synchronously and only then ACKs (slow write, zero staleness). EVENTUAL: ACKs fast, pushes after lagMs via RabbitMQ or delayed HTTP (staleness window).',
    endpoints: ['POST /replication/mode {mode, lagMs}', 'GET /replication/status', 'POST /internal/notify (from origin)'],
  },
  mq: {
    name: 'RabbitMQ', port: ':5672', color: '#f59e0b',
    role: 'Optional broker for eventual mode (cdn.replication fanout). If unreachable or unset, Replication falls back to delayed direct-HTTP pushes — same observable behavior, no infra needed.',
    endpoints: ['exchange cdn.replication (fanout)', 'exchange cdn.invalidate (fanout)'],
  },
  coord: {
    name: 'Consistency Coordinator', port: ':3006', color: '#dc2626',
    role: 'Cache invalidation and truth-teller. Fans purge out to selected edges and serves the version matrix (origin vs each edge) that powers the stale-row highlighting.',
    endpoints: ['POST /invalidate {key|*, regions?}', 'GET /consistency/state'],
  },
  analytics: {
    name: 'Analytics Service', port: ':3007', color: '#16a34a',
    role: 'Fire-and-forget collector. Every edge GET emits {hit/miss, edge + origin latency}; aggregates totals, hit ratio, p50/p95 and per-edge breakdowns.',
    endpoints: ['POST /events', 'GET /metrics/summary', 'GET /metrics/by-edge', 'GET /metrics/timeseries'],
  },
  dash: {
    name: 'This Dashboard', port: ':5173', color: '#111827',
    role: 'You are here. Polls Gateway (tester), Analytics (stats), Replication (mode) and Coordinator (matrix) every 2 s. Nothing is stored here — refresh anytime.',
    endpoints: ['polls :3000 / :3005 / :3006 / :3007'],
  },
};

function Node({ id, x, y, w = 132, h = 52, selected, onSelect }) {
  const s = SERVICES[id];
  return (
    <g onClick={() => onSelect(id)} className={`anode ${selected === id ? 'sel' : ''}`}>
      <rect x={x} y={y} width={w} height={h} rx="9" style={{ '--c': s.color }} />
      <text x={x + w / 2} y={y + 22} textAnchor="middle" className="an-name">{s.name}</text>
      <text x={x + w / 2} y={y + 39} textAnchor="middle" className="an-port">{s.port}</text>
    </g>
  );
}

function Arrow({ x1, y1, x2, y2, label, kind = 'sync', lx, ly, rotate }) {
  const mx = lx ?? (x1 + x2) / 2, my = ly ?? (y1 + y2) / 2 - 5;
  return (
    <g className={`aedge ${kind}`}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} markerEnd="url(#ah)" />
      {label && <text x={mx} y={my} textAnchor="middle" className="a-lbl" transform={rotate ? `rotate(-90 ${mx} ${my})` : undefined}>{label}</text>}
    </g>
  );
}

function PathEdge({ d, kind = 'async' }) {
  return (
    <g className={`aedge ${kind}`}>
      <path d={d} markerEnd="url(#ah)" />
    </g>
  );
}

function Badge({ n, x, y }) {
  return (
    <g className="abadge">
      <circle cx={x} cy={y} r="9" />
      <text x={x} y={y + 3.5} textAnchor="middle">{n}</text>
    </g>
  );
}

const FLOWS = [
  {
    title: 'Read · GET /c/:key',
    steps: ['Client sends key + X-Client-Region (e.g. eu).', 'Gateway picks the nearest edge, proxies the request.', 'Edge cache HIT → reply in ~ms. MISS → origin-pull from :3001, store with TTL, reply slower.', 'Edge fires an analytics event (hit/miss + latencies). Try it: cold an edge, GET twice, watch MISS → HIT.'],
  },
  {
    title: 'Write · PUT /c/:key',
    steps: ['Gateway forwards the write to Origin.', 'Origin saves blob + version++ and notifies Replication.', 'STRONG: replication pushes to all 3 edges and waits → slow PUT, every next GET fresh.', 'EVENTUAL: replication ACKs instantly, pushes after lagMs → fast PUT, edges serve the old version until the push lands (staleness window).'],
  },
  {
    title: 'Invalidate · POST /invalidate',
    steps: ['Coordinator fans a purge out to the selected edges (direct HTTP + MQ broadcast).', 'Edges drop the key from memory.', 'Next GET on each edge is a MISS → refetch from Origin. Verify in the consistency matrix: edge cells go blank, then refill.'],
  },
];

export default function Arch() {
  const [sel, setSel] = useState('gateway');
  const [live, setLive] = useState(null);
  useEffect(() => {
    let alive = true;
    const run = async () => {
      try {
        const [repl, summary] = await Promise.all([api.replStatus(), api.summary()]);
        if (alive) setLive({ mode: repl.mode, lagMs: repl.lagMs, pending: repl.pending, total: summary.total, hitRatio: summary.hitRatio });
      } catch { /* backend down — static page still renders */ }
    };
    run();
    const id = setInterval(run, 3000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  const s = SERVICES[sel];

  return (
    <div>
      {live && (
        <div className="livebar">
          live: replication <b>{live.mode}</b> · lag {live.lagMs} ms · pending {live.pending} · {live.total} requests · hit ratio {(live.hitRatio * 100).toFixed(1)}%
        </div>
      )}

      <section>
        <h2>How everything is connected <span className="chiplabel">click any box</span></h2>
        <svg viewBox="0 0 960 560" className="archsvg" role="img" aria-label="CDN architecture diagram">
          <defs>
            <marker id="ah" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8" fill="none" stroke="#9ca3af" strokeWidth="1.5" />
            </marker>
          </defs>

          {/* nodes */}
          <Node id="client" x={10} y={250} selected={sel} onSelect={setSel} />
          <Node id="gateway" x={180} y={250} selected={sel} onSelect={setSel} />
          <Node id="edgeUs" x={370} y={60} selected={sel} onSelect={setSel} />
          <Node id="edgeEu" x={370} y={250} selected={sel} onSelect={setSel} />
          <Node id="edgeAsia" x={370} y={440} selected={sel} onSelect={setSel} />
          <Node id="origin" x={580} y={250} selected={sel} onSelect={setSel} />
          <Node id="repl" x={580} y={60} selected={sel} onSelect={setSel} />
          <Node id="coord" x={580} y={440} selected={sel} onSelect={setSel} />
          <Node id="mq" x={790} y={60} selected={sel} onSelect={setSel} />
          <Node id="analytics" x={790} y={250} selected={sel} onSelect={setSel} />
          <Node id="dash" x={790} y={440} selected={sel} onSelect={setSel} />

          {/* 1 client → gateway → 2 nearest edge */}
          <Arrow x1={142} y1={296} x2={178} y2={296} />
          <Badge n="1" x={160} y={282} />
          <Arrow x1={322} y1={296} x2={368} y2={296} />
          <PathEdge d="M322,282 H350 V86 H368" />
          <Badge n="2" x={350} y={184} />
          <PathEdge d="M322,310 H350 V486 H368" />

          {/* 3 edge MISS → origin-pull (dashed) */}
          <Arrow x1={502} y1={296} x2={578} y2={296} kind="pull" />
          <PathEdge d="M502,100 H566 V270 H580" kind="pull" />
          <Badge n="3" x={582} y={185} />
          <PathEdge d="M502,472 H566 V322 H580" kind="pull" />

          {/* 4 origin → replication, 5 fanout push to all edges */}
          <Arrow x1={646} y1={250} x2={646} y2={114} />
          <Badge n="4" x={630} y={182} />
          <Arrow x1={578} y1={92} x2={504} y2={90} />
          <Badge n="5" x={541} y={78} />

          {/* 7 replication ↔ queue */}
          <Arrow x1={712} y1={86} x2={788} y2={86} kind="async" />
          <Arrow x1={788} y1={102} x2={712} y2={102} kind="async" />
          <Badge n="7" x={750} y={72} />

          {/* 6 coordinator → edges (purge) */}
          <Arrow x1={578} y1={466} x2={504} y2={466} kind="async" />
          <Badge n="6" x={541} y={480} />

          {/* 8 edges → analytics → dashboard */}
          <PathEdge d="M504,288 V348 H886 V322" />
          <Badge n="8" x={703} y={340} />
          <Arrow x1={886} y1={324} x2={886} y2={438} kind="async" />
        </svg>
        <div className="legend">
          <span><i className="ln sync" /> sync HTTP</span>
          <span><i className="ln pull" /> origin-pull on miss</span>
          <span><i className="ln async" /> async / events / queue</span>
        </div>
        <ol className="flowlegend">
          <li><b>1</b> Client → gateway: <code>GET / PUT /c/:key</code> (+ <code>X-Client-Region</code>)</li>
          <li><b>2</b> Gateway → nearest edge (region map, default us)</li>
          <li><b>3</b> Edge MISS → origin-pull from :3001, cached with TTL</li>
          <li><b>4</b> Origin → replication notify (key, version++)</li>
          <li><b>5</b> Replication → all edges fanout push (strong: sync · eventual: after lag)</li>
          <li><b>6</b> Coordinator → edges purge (invalidation)</li>
          <li><b>7</b> Eventual-mode queue via RabbitMQ (fallback: delayed HTTP)</li>
          <li><b>8</b> Edges → analytics events · dashboard polls everything</li>
        </ol>

        <div className="svcdetail">
          <b style={{ color: s.color }}>{s.name}</b> <span className="chiplabel">{s.port}</span>
          <p>{s.role}</p>
          <ul>{s.endpoints.map((e) => <li key={e}><code>{e}</code></li>)}</ul>
        </div>
      </section>

      <div className="grid" style={{ marginTop: 12 }}>
        {FLOWS.map((f) => (
          <section key={f.title}>
            <h2>{f.title}</h2>
            <ol className="flowsteps">
              {f.steps.map((st, i) => <li key={i}>{st}</li>)}
            </ol>
          </section>
        ))}
        <section>
          <h2>Consistency trade-off</h2>
          <table>
            <thead><tr><th></th><th>Strong (sync)</th><th>Eventual (async)</th></tr></thead>
            <tbody>
              <tr><td><b>PUT latency</b></td><td>high — waits for all edges</td><td>low — ACKs, pushes later</td></tr>
              <tr><td><b>Staleness</b></td><td>none — next GET is fresh</td><td>lagMs window of old data</td></tr>
              <tr><td><b>On edge crash</b></td><td>write degrades / fails</td><td>write succeeds, retry later</td></tr>
              <tr><td><b>Think</b></td><td>CP-leaning</td><td>AP-leaning</td></tr>
            </tbody>
          </table>
          <p className="sub" style={{ marginTop: 8 }}>Try it: set <code>eventual + 5000 ms</code>, PUT, GET immediately (stale), GET after 5 s (fresh). Then <code>strong</code>, PUT, GET (fresh at once).</p>
        </section>
      </div>
    </div>
  );
}
