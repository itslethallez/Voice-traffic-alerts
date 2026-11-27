#!/usr/bin/env bash
# Weekly road-map refresh for the Valhalla server (run over SSH by
# .github/workflows/refresh-valhalla.yml; also the first-time build).
#
#   1. download the latest Geofabrik extract into staging/
#   2. build tiles there in a one-off container (live keeps serving)
#   3. start the new tiles on a side port and check them: /status, a
#      Sir Donald Bradman Drive route that must carry its road name, a
#      Sydney route, and a tile file no smaller than 80% of last week's
#   4. only if all pass: live -> previous, staging -> live, restart
#
# Any failure exits non-zero with the live tiles untouched, so the
# workflow goes red and the feed watchdog opens an issue. Rollback:
# ./refresh.sh --rollback swaps previous back in.
#
# Env overrides (for a local test): BASE_DIR, PBF_URL, SKIP_SYDNEY_CHECK=1,
# COMPOSE_FILE. Needs bash, curl, jq and docker compose on the host.
# Log tag: [valhalla].
set -euo pipefail

export BASE_DIR="${BASE_DIR:-/opt/valhalla}"
PBF_URL="${PBF_URL:-https://download.geofabrik.de/australia-oceania/australia/australia-latest.osm.pbf}"
IMAGE="${VALHALLA_IMAGE:-ghcr.io/valhalla/valhalla-scripted:3.9.3}"
COMPOSE_FILE="${COMPOSE_FILE:-$BASE_DIR/docker-compose.yml}"
LIVE="$BASE_DIR/live"
STAGING="$BASE_DIR/staging"
PREVIOUS="$BASE_DIR/previous"

log() { echo "[valhalla] $(date -u +%FT%TZ) $*"; }
fail() {
  log "FAILED: $*"
  if docker ps -a --format '{{.Names}}' | grep -qx valhalla-check; then
    docker logs --tail 15 valhalla-check 2>&1 | grep -v admin_access | sed 's/^/[valhalla]   check container: /'
    docker rm -f valhalla-check >/dev/null 2>&1 || true
  fi
  exit 1
}

restart_live() {
  docker compose -f "$COMPOSE_FILE" up -d --force-recreate valhalla
  for _ in $(seq 1 60); do
    if docker compose -f "$COMPOSE_FILE" exec -T valhalla curl -fsS http://localhost:8002/status >/dev/null 2>&1; then
      log "live server answering"
      return 0
    fi
    sleep 2
  done
  fail "live server did not come back after restart"
}

if [[ "${1:-}" == "--rollback" ]]; then
  [[ -f "$PREVIOUS/valhalla_tiles.tar" ]] || fail "no previous tiles to roll back to"
  log "rolling back to previous tiles"
  rm -rf "$STAGING" && mv "$LIVE" "$STAGING" && mv "$PREVIOUS" "$LIVE" && mkdir -p "$PREVIOUS"
  restart_live
  exit 0
fi

mkdir -p "$LIVE" "$STAGING" "$PREVIOUS"
log "staging a fresh build in $STAGING"
find "$STAGING" -mindepth 1 -delete

log "downloading $PBF_URL"
curl -fsSL --retry 3 -o "$STAGING/extract.osm.pbf" "$PBF_URL" || fail "download failed"
pbf_bytes=$(stat -c %s "$STAGING/extract.osm.pbf")
log "extract is $((pbf_bytes / 1024 / 1024)) MB"

log "building tiles (this is the long part)"
started=$(date +%s)
# Valhalla's own tools, called directly - not the image's entrypoint,
# whose rebuild-if-changed logic restarted a build inside the check
# container in testing. Config -> admin boundaries (country driving rules)
# -> tiles -> one tar the server memory-maps. No elevation, no time zones
# (road matching needs neither).
docker run --rm --name valhalla-build -m 6g \
  -v "$STAGING:/custom_files" --entrypoint bash "$IMAGE" -c '
    set -euo pipefail
    valhalla_build_config \
      --mjolnir-tile-dir /custom_files/valhalla_tiles \
      --mjolnir-tile-extract /custom_files/valhalla_tiles.tar \
      --mjolnir-admin /custom_files/admins.sqlite \
      --mjolnir-traffic-extract "" --mjolnir-timezone "" \
      --httpd-service-listen tcp://*:8002 > /custom_files/valhalla.json
    valhalla_build_admins -c /custom_files/valhalla.json /custom_files/extract.osm.pbf 2>&1 | grep -v admin_access || true
    valhalla_build_tiles -c /custom_files/valhalla.json /custom_files/extract.osm.pbf
    valhalla_build_extract -c /custom_files/valhalla.json -v
    rm -rf /custom_files/valhalla_tiles
  ' || fail "tile build failed"
[[ -s "$STAGING/valhalla_tiles.tar" ]] || fail "build finished without valhalla_tiles.tar"
log "build took $(( $(date +%s) - started ))s, tiles $(( $(stat -c %s "$STAGING/valhalla_tiles.tar") / 1024 / 1024 )) MB"

if [[ -f "$LIVE/valhalla_tiles.tar" ]]; then
  new_size=$(stat -c %s "$STAGING/valhalla_tiles.tar")
  old_size=$(stat -c %s "$LIVE/valhalla_tiles.tar")
  if (( new_size * 10 < old_size * 8 )); then
    fail "new tiles ($new_size bytes) are under 80% of the live ones ($old_size) - truncated extract?"
  fi
fi

log "checking the new tiles in a side container"
docker rm -f valhalla-check >/dev/null 2>&1 || true
# No published port: the checks run inside the container (the image has
# curl and jq), so they can't collide with the live server.
docker run -d --name valhalla-check -m 2g \
  -v "$STAGING:/custom_files:ro" --entrypoint valhalla_service \
  "$IMAGE" /custom_files/valhalla.json 2 >/dev/null
in_check() { docker exec -i valhalla-check "$@"; }
for _ in $(seq 1 90); do
  in_check curl -fsS http://localhost:8002/status >/dev/null 2>&1 && break
  sleep 2
done
in_check curl -fsS http://localhost:8002/status >/dev/null || fail "new tiles: /status never answered"

route_names() {
  # $1 = JSON locations array -> the road names along the route, one per line
  local shape
  shape=$(in_check curl -fsS http://localhost:8002/route \
    -d "{\"locations\":$1,\"costing\":\"auto\",\"directions_type\":\"none\"}" | jq -r '.trip.legs[0].shape // empty')
  [[ -n "$shape" ]] || return 1
  in_check curl -fsS http://localhost:8002/trace_attributes \
    -d "{\"encoded_polyline\":\"$shape\",\"costing\":\"auto\",\"shape_match\":\"edge_walk\",\"filters\":{\"attributes\":[\"edge.names\"],\"action\":\"include\"}}" \
    | jq -r '.edges[].names[]?'
}

sdb=$(route_names '[{"lat":-34.93238,"lon":138.54441,"heading":86,"heading_tolerance":45},{"lat":-34.93238,"lon":138.55743}]') \
  || fail "new tiles: no route on Sir Donald Bradman Drive"
grep -qx 'Sir Donald Bradman Drive' <<<"$sdb" || fail "new tiles: Sir Donald Bradman Drive route lost its road name"
log "check ok: Adelaide (Sir Donald Bradman Drive)"

if [[ "${SKIP_SYDNEY_CHECK:-0}" != "1" ]]; then
  # Parramatta Road, Annandale -> Leichhardt: proves the build covers more than SA.
  syd=$(route_names '[{"lat":-33.8835,"lon":151.1725},{"lat":-33.8840,"lon":151.1585}]') \
    || fail "new tiles: no route in Sydney (extract incomplete?)"
  [[ -n "$syd" ]] || fail "new tiles: Sydney route has no named roads"
  log "check ok: Sydney"
fi

docker rm -f valhalla-check >/dev/null
log "checks passed - swapping in the new tiles"
rm -f "$STAGING/extract.osm.pbf"
rm -rf "$PREVIOUS"
mv "$LIVE" "$PREVIOUS"
mv "$STAGING" "$LIVE"
mkdir -p "$STAGING"
restart_live
log "done"
