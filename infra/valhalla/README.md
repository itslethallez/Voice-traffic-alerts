# Valhalla routing server (runbook)

Shotgun's one always-on service, approved on 21 Nov 2026 (see "Approved exceptions" in CLAUDE.md). It answers road matching's forward-route question first. `server/api/road/forward-route.ts` falls back to Mapbox Directions when Valhalla isn't configured, fails, or takes more than 1.5 s.

| | |
|---|---|
| Where | DigitalOcean SYD1, droplet `shotgun-valhalla-syd1` (tag `shotgun-valhalla`) |
| Size | `s-4vcpu-8gb`: 4 vCPU, 8 GB, about US$48/month, plus 4 GB swap |
| Map data | Geofabrik Australia extract (OpenStreetMap, ODbL). Credit "© OpenStreetMap contributors" in Settings → MAP DATA |
| Software | `ghcr.io/valhalla/valhalla-scripted:3.9.3` (using Valhalla's own binaries, not the image's entrypoint), `caddy:2.11.8-alpine` |
| Endpoint | `https://<ip-with-dashes>.sslip.io`, giving a free DNS name so Caddy gets a Let's Encrypt certificate |
| Access | Caddy only passes `/route`, `/trace_attributes` and `/status`, and only with header `X-Shotgun-Valhalla-Secret`. Everything else gets 403 |
| Firewall | DO cloud firewall and ufw: inbound 22, 80 and 443 only. SSH by key only |
| Updates | `.github/workflows/refresh-valhalla.yml`, Monday 03:00 Adelaide. Runs `refresh.sh` over SSH |
| Alerts | `feed-health.yml` opens "Feed down: Valhalla road map update" if the weekly run fails or stops, and "Service down: Valhalla routing server" if the live probe fails |
| Log tags | `[valhalla]` on the server and in the workflow; `[road]` in the Vercel function and in the app |

## Files

- `provision.js`: creates or finds the SSH key, droplet and firewall through the DO API. It's idempotent and never deletes anything.
- `cloud-init.yaml`: first boot. Installs Docker, ufw and swap, and creates `/opt/valhalla/{live,staging,previous}`.
- `deploy.sh`: copies the config, writes `caddy.env`, starts the stack and checks it gets 200 with the secret and 403 without. Pass `--build` the first time.
- `refresh.sh`: weekly rebuild. It downloads the extract, builds into `staging/`, and checks the new tiles in a side container:
  - Sir Donald Bradman Drive must keep its name;
  - a Sydney route must exist;
  - the new tiles must be at least 80% of last week's size.

  Only after all of those pass does it swap `live` → `previous` and `staging` → `live`. `--rollback` swaps `previous` back in.
- `docker-compose.yml`, `Caddyfile`: the running stack.

## First-time setup

```sh
# 1. Droplet, key, firewall (needs DIGITALOCEAN_TOKEN)
node infra/valhalla/provision.js          # prints ip + host

# 2. Build Australia (~1 h) and start serving
VALHALLA_IP=... VALHALLA_HOST=....sslip.io VALHALLA_SHARED_SECRET=... \
  infra/valhalla/deploy.sh --build
```

The shared secret and URL are kept outside the repo, in `~/.shotgun/valhalla.env`.

They need to go in three places:
- **Vercel:** `VALHALLA_URL` and `VALHALLA_SHARED_SECRET`.
- **GitHub secrets:**
  - `VALHALLA_SSH_KEY` (the private deploy key);
  - `VALHALLA_SSH_KNOWN_HOSTS`;
  - `VALHALLA_SHARED_SECRET`.
- **GitHub variables:** `VALHALLA_IP` and `VALHALLA_URL`.

## When something's wrong

- **"Service down: Valhalla routing server"**
  1. `ssh -i ~/.ssh/shotgun_valhalla root@<ip>`, then `cd /opt/valhalla && docker compose ps && docker compose logs --tail 50`.
  2. Restart with `docker compose up -d`.

  Road matching keeps working on Mapbox in the meantime; that costs money but isn't an outage.
- **"Feed down: Valhalla road map update"**
  1. Open the failed run: the `[valhalla] FAILED:` line says which step broke.
  2. The live map hasn't changed, so nothing is urgent. Re-run the workflow once the cause is fixed.
- **Bad map after an update:** run `/opt/valhalla/refresh.sh --rollback` on the server.
- **Out of memory during a build:** the build container is capped at 6 GB and has swap behind it, and the live server is capped at 3 GB. If Australia outgrows that, move up one droplet size; it's a new decision, so ask first.

## Local test

This is how `refresh.sh` was tested on 21 Nov 2026, using the South Australia extract and Docker Desktop. Run it inside a `docker:27-cli` container with the Docker socket and `/tmp/valhalla-test` mounted, and these settings:

```
BASE_DIR=/tmp/valhalla-test PBF_URL=file:///.../south-australia-latest.osm.pbf SKIP_SYDNEY_CHECK=1
```

Results:
- First build, weekly run and rollback: pass.
- Truncated extract: fails, and the live tiles keep serving.
- Caddy: 403 without the secret, 403 for an endpoint not on the list, 200 for `/status` and `/route` with the secret.
