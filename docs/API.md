# API Reference

Base ports (local): gateway :3000 · origin :3001 · edge-us :3002 · edge-eu :3003 · edge-asia :3004 · replication :3005 · coordinator :3006 · analytics :3007

## Gateway :3000
- `GET /c/:key` headers `X-Client-Region: us|eu|asia` → proxied edge response + `X-Cache/X-Edge/X-Version/X-Route-Reason/X-Edge-Target`
- `PUT /c/:key` body `{data, contentType?}` → origin write + replication info
- `DELETE /c/:key` → origin delete + fanout invalidate
- `GET /route?region=eu`, `GET /edges`, `GET /health`

## Origin :3001
- `PUT /content/:key` → `{key, version, replication:{replicated, ...}}`
- `GET /content/:key` → `{key, version, data, contentType}` (+`X-Version`)
- `GET /content` → `{items:[{key, version, contentType, updatedAt}]}`
- `DELETE /content/:key`

## Edge :3002/3/4
- `GET /cache/:key` → `X-Cache: HIT|MISS`; unknown key → `404 {error:not_found, hint}` (PUT first)
- `POST /internal/replicate {key,version,data,contentType,op}` · `DELETE /cache/:key` · `DELETE /cache` (purge all)
- `GET /cache/_stats` `{hits,misses,hitRatio,size,evictions}` · `GET /cache/_dump` · `POST /cache/_config {ttlMs,max}`

## Replication :3005
- `GET /replication/status` · `POST /replication/mode {mode: strong|eventual, lagMs}` · `POST /internal/notify {key,version,op}`

## Coordinator :3006
- `POST /invalidate {key|*, regions?: [us,eu,asia]}` · `GET /consistency/state` → `{matrix:[{key,origin,us,eu,asia}]}`

## Analytics :3007
- `POST /events {requestId,key,edge,hitMiss,edgeLatencyMs,originLatencyMs}` · `GET /metrics/summary` · `GET /metrics/by-edge` · `GET /metrics/timeseries?windowSec=&bucketSec=` · `DELETE /metrics/reset`
