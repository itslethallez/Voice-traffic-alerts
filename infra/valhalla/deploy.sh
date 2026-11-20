#!/usr/bin/env bash
# Puts the Valhalla server together on a droplet provision.js created, and
# (re)deploys config changes. Run from the repo root, from any machine with
# ssh/scp and the deploy key:
#
#   VALHALLA_IP=1.2.3.4 VALHALLA_HOST=1-2-3-4.sslip.io \
#   VALHALLA_SHARED_SECRET=... infra/valhalla/deploy.sh [--build]
#
#   --build   also run refresh.sh (the first time: downloads Australia and
#             builds the tiles, ~1h; afterwards the weekly workflow does it)
#
# Copies docker-compose.yml, Caddyfile, refresh.sh to /opt/valhalla, writes
# caddy.env (host + secret; never committed), starts Caddy + Valhalla.
# Log tag: [valhalla].
set -euo pipefail

: "${VALHALLA_IP:?set VALHALLA_IP}"
: "${VALHALLA_HOST:?set VALHALLA_HOST}"
: "${VALHALLA_SHARED_SECRET:?set VALHALLA_SHARED_SECRET}"
KEY="${VALHALLA_SSH_KEY_FILE:-$HOME/.ssh/shotgun_valhalla}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SSH_OPTS=(-i "$KEY" -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 -o ConnectTimeout=15)
remote() { ssh "${SSH_OPTS[@]}" "root@$VALHALLA_IP" "$@"; }
log() { echo "[valhalla] $(date -u +%FT%TZ) $*"; }

log "waiting for first-boot setup (cloud-init)"
for _ in $(seq 1 60); do
  remote test -f /var/lib/cloud/instance/shotgun-ready 2>/dev/null && break
  sleep 10
done
remote test -f /var/lib/cloud/instance/shotgun-ready || { log "cloud-init never finished"; exit 1; }

log "copying config"
scp "${SSH_OPTS[@]}" "$HERE/docker-compose.yml" "$HERE/Caddyfile" "$HERE/refresh.sh" "root@$VALHALLA_IP:/opt/valhalla/"
remote "chmod +x /opt/valhalla/refresh.sh && umask 077 && printf 'VALHALLA_HOST=%s\nVALHALLA_SHARED_SECRET=%s\n' '$VALHALLA_HOST' '$VALHALLA_SHARED_SECRET' > /opt/valhalla/caddy.env"

if [[ "${1:-}" == "--build" ]]; then
  log "building tiles on the server (refresh.sh) - long"
  remote /opt/valhalla/refresh.sh
fi

remote test -f /opt/valhalla/live/valhalla_tiles.tar || { log "no tiles yet - run with --build first"; exit 1; }
log "starting caddy + valhalla"
remote "cd /opt/valhalla && docker compose up -d --remove-orphans"
for _ in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -H "X-Shotgun-Valhalla-Secret: $VALHALLA_SHARED_SECRET" "https://$VALHALLA_HOST/status" || true)
  [[ "$code" == "200" ]] && break
  sleep 5
done
[[ "$code" == "200" ]] || { log "https://$VALHALLA_HOST/status never returned 200 (last: $code)"; exit 1; }
nosecret=$(curl -s -o /dev/null -w '%{http_code}' "https://$VALHALLA_HOST/status")
[[ "$nosecret" == "403" ]] || { log "WARNING: /status without the secret returned $nosecret, expected 403"; exit 1; }
log "live: https://$VALHALLA_HOST (403 without the secret, 200 with it)"
