#!/bin/bash
# Stop the local CDN stack (started by run-local.sh or manually via nohup).
#
# Usage: ./scripts/stop-local.sh [--clean] [--hard]
#   (default)  SIGTERM pid-file processes + pattern sweep, verify ports free
#   --clean    additionally wipe origin/analytics data + edge-warming blobs (fresh slate)
#   --hard     SIGKILL anything still holding ports 3000-3007 afterwards
#
# NOTE: the Vite dashboard dev server (if running) is NOT touched — stop it with Ctrl+C.

CLEAN=0; HARD=0
for a in "$@"; do
  case "$a" in
    --clean) CLEAN=1 ;;
    --hard) HARD=1 ;;
    *) echo "unknown flag: $a (use --clean, --hard)"; exit 1 ;;
  esac
done

ROOT=$(cd "$(dirname "$0")/.." && pwd)
PORTS="3000 3001 3002 3003 3004 3005 3006 3007"

port_open() { (exec 3<>/dev/tcp/127.0.0.1/"$1") 2>/dev/null && exec 3<&- && exec 3>&-; }

# 1) Graceful stop via pid files (stale PIDs are tolerated).
for f in /tmp/cdn-*.pid; do
  [ -f "$f" ] || continue
  pid=$(cat "$f" 2>/dev/null)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    echo "stopping pid $pid ($(basename "$f" .pid))"
    kill "$pid" 2>/dev/null || true
  fi
  rm -f "$f"
done

# 2) Pattern sweep — catches services started manually (nohup) without pid files.
#    Matches only our backend entrypoints, never this script (cmdline is 'bash scripts/stop-local.sh').
for svc in origin edge gateway replication coordinator analytics; do
  pkill -f "services/${svc}/server\.js" 2>/dev/null || true
done

# 3) Wait (up to 5s) for ports to drain.
for _ in $(seq 1 10); do
  busy=0
  for p in $PORTS; do port_open "$p" && busy=1; done
  [ "$busy" -eq 0 ] && break
  sleep 0.5
done

# 4) Report; escalate only on request.
still=""
for p in $PORTS; do port_open "$p" && still="$still $p"; done
if [ -n "$still" ]; then
  if [ "$HARD" -eq 1 ]; then
    echo "ports still busy:$still — SIGKILL by pattern…"
    for svc in origin edge gateway replication coordinator analytics; do
      pkill -9 -f "services/${svc}/server\.js" 2>/dev/null || true
    done
    if command -v fuser >/dev/null 2>&1; then
      # shellcheck disable=SC2086
      fuser -k $still/tcp 2>/dev/null || true
    fi
    sleep 1
    still2=""
    for p in $PORTS; do port_open "$p" && still2="$still2 $p"; done
    [ -n "$still2" ] && { echo "STILL busy:$still2 — something else owns these ports"; exit 1; }
    echo "all ports free"
  else
    echo "ports still busy:$still — run with --hard to SIGKILL, or check what owns them"
    exit 1
  fi
else
  echo "stopped — all ports free (3000-3007)"
fi

# 5) Optional data reset for a clean-slate demo.
if [ "$CLEAN" -eq 1 ]; then
  rm -rf "$ROOT/services/origin/data" "$ROOT/services/analytics/data"
  rm -f "$ROOT"/services/origin/store/*.blob
  echo "cleaned origin/analytics DBs + stored blobs (edge caches are in-memory, already gone)"
fi
