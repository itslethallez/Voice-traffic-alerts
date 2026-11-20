#!/usr/bin/env node
/**
 * Creates (or finds) the Valhalla droplet on DigitalOcean - approved
 * 21 Nov 2026: SYD1, 8 GB / 4 vCPU (s-4vcpu-8gb, ~US$48/month). Idempotent:
 * re-running finds the existing droplet / key / firewall by name instead of
 * creating another (a second droplet would be a second bill).
 *
 *   DIGITALOCEAN_TOKEN=... node infra/valhalla/provision.js
 *
 * Does: SSH key (generated locally at ~/.ssh/shotgun_valhalla if missing,
 * uploaded once), the droplet (cloud-init.yaml as user_data), a cloud
 * firewall allowing only 22/80/443 in. Prints the IP and the HTTPS host
 * name (<ip>.sslip.io - a free wildcard DNS name, so Caddy can get a
 * Let's Encrypt certificate without us buying a domain).
 *
 * Doesn't: build tiles or start anything - that's deploy.sh. Never deletes.
 * Dependency-free (Node 18+ fetch). Log tag: [valhalla].
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NAME = 'shotgun-valhalla-syd1';
const TAG = 'shotgun-valhalla';
const REGION = 'syd1';
const SIZE = 's-4vcpu-8gb';
const IMAGE = 'ubuntu-24-04-x64';
const KEY_PATH = path.join(os.homedir(), '.ssh', 'shotgun_valhalla');

const token = process.env.DIGITALOCEAN_TOKEN;
if (!token) {
  console.error('[valhalla] DIGITALOCEAN_TOKEN is not set');
  process.exit(1);
}

async function api(method, route, body) {
  const response = await fetch(`https://api.digitalocean.com/v2${route}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`DigitalOcean ${method} ${route} failed (${response.status}): ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

function ensureLocalKey() {
  if (!fs.existsSync(KEY_PATH)) {
    fs.mkdirSync(path.dirname(KEY_PATH), { recursive: true });
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', 'shotgun-valhalla-deploy', '-f', KEY_PATH], { stdio: 'ignore' });
    console.log(`[valhalla] generated SSH key ${KEY_PATH}`);
  }
  return fs.readFileSync(`${KEY_PATH}.pub`, 'utf8').trim();
}

async function ensureKey(publicKey) {
  const { ssh_keys: keys } = await api('GET', '/account/keys?per_page=200');
  const existing = keys.find((k) => k.public_key.trim() === publicKey);
  if (existing) return existing;
  const { ssh_key: created } = await api('POST', '/account/keys', { name: 'shotgun-valhalla-deploy', public_key: publicKey });
  console.log(`[valhalla] uploaded SSH key ${created.fingerprint}`);
  return created;
}

async function ensureDroplet(keyId) {
  const { droplets } = await api('GET', `/droplets?tag_name=${TAG}&per_page=50`);
  if (droplets.length > 1) throw new Error(`more than one ${TAG} droplet exists - refusing to guess: ${droplets.map((d) => d.name).join(', ')}`);
  if (droplets.length === 1) {
    console.log(`[valhalla] droplet ${droplets[0].name} (#${droplets[0].id}) already exists`);
    return droplets[0];
  }
  const userData = fs.readFileSync(path.join(__dirname, 'cloud-init.yaml'), 'utf8');
  const { droplet } = await api('POST', '/droplets', {
    name: NAME,
    region: REGION,
    size: SIZE,
    image: IMAGE,
    ssh_keys: [keyId],
    user_data: userData,
    tags: [TAG],
    monitoring: true,
    ipv6: false,
    backups: false,
  });
  console.log(`[valhalla] created droplet ${droplet.name} (#${droplet.id}) - ${SIZE} in ${REGION}`);
  return droplet;
}

async function waitActive(id) {
  for (let i = 0; i < 90; i++) {
    const { droplet } = await api('GET', `/droplets/${id}`);
    const ip = droplet.networks.v4.find((n) => n.type === 'public');
    if (droplet.status === 'active' && ip) return { droplet, ip: ip.ip_address };
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error('droplet did not become active within 7.5 minutes');
}

async function ensureFirewall() {
  const { firewalls } = await api('GET', '/firewalls?per_page=200');
  if (firewalls.some((f) => f.name === TAG)) {
    console.log(`[valhalla] firewall ${TAG} already exists`);
    return;
  }
  const anywhere = { addresses: ['0.0.0.0/0', '::/0'] };
  await api('POST', '/firewalls', {
    name: TAG,
    tags: [TAG],
    inbound_rules: ['22', '80', '443'].map((ports) => ({ protocol: 'tcp', ports, sources: anywhere })),
    outbound_rules: [
      { protocol: 'tcp', ports: 'all', destinations: anywhere },
      { protocol: 'udp', ports: 'all', destinations: anywhere },
      { protocol: 'icmp', destinations: anywhere },
    ],
  });
  console.log(`[valhalla] created firewall ${TAG} (in: 22, 80, 443 only)`);
}

(async () => {
  const { account } = await api('GET', '/account');
  console.log(`[valhalla] DigitalOcean account ok (status ${account.status}, droplet limit ${account.droplet_limit})`);
  const sizes = (await api('GET', '/sizes?per_page=200')).sizes;
  const size = sizes.find((s) => s.slug === SIZE);
  if (!size || !size.regions.includes(REGION)) throw new Error(`${SIZE} is not available in ${REGION}`);
  console.log(`[valhalla] ${SIZE}: ${size.vcpus} vCPU, ${size.memory / 1024} GB, ${size.disk} GB disk, US$${size.price_monthly}/month`);

  const key = await ensureKey(ensureLocalKey());
  const created = await ensureDroplet(key.id);
  await ensureFirewall();
  const { ip } = await waitActive(created.id);
  const host = `${ip.replace(/\./g, '-')}.sslip.io`;
  console.log(`[valhalla] ready: ip=${ip} host=${host}`);
  console.log(JSON.stringify({ ip, host, dropletId: created.id }));
})().catch((error) => {
  console.error(`[valhalla] provision failed: ${error.message}`);
  process.exit(1);
});
