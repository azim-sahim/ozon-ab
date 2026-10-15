#!/bin/sh
set -eu
cd /workspace
node scripts/preview.mjs stop || true
if ! curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  npm run dev >>/tmp/app-startup.log 2>&1 &
  i=0
  while [ "$i" -lt 40 ]; do
    if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
      break
    fi
    i=$((i + 1))
    sleep 1
  done
fi
if [ -f /tmp/ozon-rotator.pid ] && kill -0 "$(cat /tmp/ozon-rotator.pid)" 2>/dev/null; then
  exit 0
fi
(
  while true; do
    sleep 20
    curl -sf --max-time 20 http://127.0.0.1:8080/api/cron/tick >/tmp/ozon-rotator.last 2>/dev/null || true
  done
) &
echo $! >/tmp/ozon-rotator.pid
