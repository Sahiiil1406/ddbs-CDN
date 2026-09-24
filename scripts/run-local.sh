#!/bin/bash
# Run all backend services locally WITHOUT docker (RabbitMQ optional).
# Usage: ./scripts/run-local.sh
#   Uses $RABBITMQ_URL if set, else auto-detects amqp://guest:guest@127.0.0.1:5672,
#   else falls back to delayed-HTTP for eventual replication (no broker needed).
# Stop with: ./scripts/stop-local.sh [--clean] [--hard]
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

export ORIGIN_URL=http://localhost:3001 ANALYTICS_URL=http://localhost:3007

port_open() { (exec 3<>/dev/tcp/127.0.0.1/"$1") 2>/dev/null && exec 3<&- && exec 3>&-; }

# Refuse to start over a running stack (prevents duplicate processes / confusion).
busy=""
for p in 3000 3001 3002 3003 3004 3005 3006 3007; do port_open "$p" && busy="$busy $p"; done
if [ -n "$busy" ]; then
  echo "ports already busy:$busy — run ./scripts/stop-local.sh first (or --hard)"
  exit 1
fi

if [ -z "${RABBITMQ_URL:-}" ]; then
  if port_open 5672; then
    export RABBITMQ_URL="amqp://guest:guest@127.0.0.1:5672"
    echo "detected local RabbitMQ — replication/coordinator will use it"
  else
    echo "no local RabbitMQ — eventual replication uses delayed-HTTP fallback"
  fi
else
  echo "using RABBITMQ_URL=$RABBITMQ_URL"
fi

echo "installing deps..."
for s in services/origin services/edge services/gateway services/replication services/coordinator services/analytics packages/common; do
  (cd "$ROOT/$s" && npm install --no-audit --no-fund >/dev/null 2>&1 || true)
done

echo "starting services (logs: /tmp/cdn-*.log, pids: /tmp/cdn-*.pid)..."
PORT=3001 REPLICATION_URL=http://localhost:3005 nohup node services/origin/server.js >/tmp/cdn-origin.log 2>&1 & echo $! > /tmp/cdn-origin.pid
PORT=3007 nohup node services/analytics/server.js >/tmp/cdn-analytics.log 2>&1 & echo $! > /tmp/cdn-analytics.pid
sleep 1
PORT=3002 REGION=us    nohup node services/edge/server.js >/tmp/cdn-edge-us.log 2>&1 & echo $! > /tmp/cdn-edge-us.pid
PORT=3003 REGION=eu    nohup node services/edge/server.js >/tmp/cdn-edge-eu.log 2>&1 & echo $! > /tmp/cdn-edge-eu.pid
PORT=3004 REGION=asia  nohup node services/edge/server.js >/tmp/cdn-edge-asia.log 2>&1 & echo $! > /tmp/cdn-edge-asia.pid
PORT=3005 EDGES=http://localhost:3002,http://localhost:3003,http://localhost:3004 \
  nohup node services/replication/server.js >/tmp/cdn-repl.log 2>&1 & echo $! > /tmp/cdn-repl.pid
PORT=3006 EDGES=http://localhost:3002,http://localhost:3003,http://localhost:3004 \
  nohup node services/coordinator/server.js >/tmp/cdn-coord.log 2>&1 & echo $! > /tmp/cdn-coord.pid
PORT=3000 EDGE_US_URL=http://localhost:3002 EDGE_EU_URL=http://localhost:3003 EDGE_ASIA_URL=http://localhost:3004 \
  ORIGIN_URL=http://localhost:3001 COORDINATOR_URL=http://localhost:3006 \
  nohup node services/gateway/server.js >/tmp/cdn-gw.log 2>&1 & echo $! > /tmp/cdn-gw.pid

echo "health:"
sleep 3 # let node processes bind ports
ok=1
for p in 3000 3001 3002 3003 3004 3005 3006 3007; do
  reached=0
  for _ in 1 2 3; do
    if out=$(curl -s -m 3 "http://localhost:$p/health"); then reached=1; break; fi
    sleep 1
  done
  if [ "$reached" -eq 1 ]; then
    echo "  :$p ${out:0:70}"
  else
    echo "  :$p UNREACHABLE (see /tmp/cdn-*.log)"; ok=0
  fi
done
[ "$ok" -eq 1 ] || { echo "some services failed to start"; exit 1; }
echo "up — dashboard: cd web/dashboard && npm run dev (http://localhost:5173)"
