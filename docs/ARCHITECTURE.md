# Architecture

```
client → Gateway :3000 (X-Client-Region routing)
           ├→ Edge-US :3002 ─┐
           ├→ Edge-EU :3003 ─┼→ (MISS) Origin :3001 (SQLite + store/)
           └→ Edge-Asia :3004 ┘
Origin PUT → Replication :3005 → fanout to edges
  strong: sync HTTP quorum before ACK (high PUT latency, no staleness)
  eventual: ACK fast, delayed push after lagMs via RabbitMQ or setTimeout (staleness window)
Coordinator :3006 → purge fanout + /consistency/state version matrix
Edge/GTW → Analytics :3007 (fire-and-forget POST /events) → dashboard polls /metrics/*
```

Decisions:
- Service discovery = Docker DNS + env vars (replaces Eureka); config = env (replaces Spring Config).
- Edge cache = in-memory LRU+TTL per container (independent failure domains, no shared Redis).
- Origin = `node:sqlite` (stdlib, no native build) + filesystem blobs, version++ per PUT.
- Replication transport = RabbitMQ fanout when `RABBITMQ_URL` set, else delayed-HTTP fallback (works without docker).
- CAP: strong = CP-leaning (wait for replicas, slower writes); eventual = AP-leaning (fast writes, stale reads for lagMs).
