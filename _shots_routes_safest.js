const puppeteer = require('puppeteer-core');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Haversine-ish, good enough for corridor checks at Adelaide latitude.
const distM = (a, b) => {
  const dy = (a[1] - b[1]) * 111_320;
  const dx = (a[0] - b[0]) * 111_320 * Math.cos((a[1] * Math.PI) / 180);
  return Math.hypot(dx, dy);
};

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=default'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 860, deviceScaleFactor: 2 });
  const context = browser.defaultBrowserContext();
  await context.overridePermissions('http://localhost:8741', ['geolocation']);
  await page.setGeolocation({ latitude: -34.9285, longitude: 138.6007, accuracy: 5 });

  const standardResponses = [];
  page.on('response', async (res) => {
    if (res.url().includes('/directions/v5/') && !/exclude=/.test(res.url())) {
      try {
        standardResponses.push(await res.json());
      } catch {}
    }
  });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));

  await page.goto('http://localhost:8741/', { waitUntil: 'networkidle2', timeout: 90000 });
  await page.waitForFunction(() => window.__shotgunMap && window.__shotgunMap.loaded(), { timeout: 90000 });
  await page.evaluate(() => new Promise((r) => window.__shotgunMap.once('idle', r)));
  await sleep(3000);

  const pickDestination = async () => {
    await page.click('[aria-label="Navigate - plan a trip"]');
    await page.waitForSelector('[aria-label="Destination search"]', { timeout: 10000 });
    await page.click('[aria-label="Destination search"]');
    await page.type('[aria-label="Destination search"]', 'Seaford', { delay: 30 });
    await page.waitForSelector('[aria-label^="Set destination to"]', { timeout: 15000 });
    await page.click('[aria-label^="Set destination to"]');
    await page.waitForFunction(
      () => window.__shotgunRouteOptionsStore && window.__shotgunRouteOptionsStore.getState().status === 'ready',
      { timeout: 45000 }
    );
  };

  const readOptions = () =>
    page.evaluate(() =>
      window.__shotgunRouteOptionsStore.getState().options.map((o) => ({
        id: o.id,
        km: +(o.route.distanceMeters / 1000).toFixed(1),
        min: Math.round(o.route.durationSeconds / 60),
        hazardsOnRoute: o.hazardsOnRoute.length,
      }))
    );

  await pickDestination();
  console.log('OPTIONS (natural):', JSON.stringify(await readOptions()));

  // Find a vertex on the returned fastest route that sits well outside the
  // alternative's 300m corridor - an incident there is one the alternative
  // genuinely routes around, not one both routes share.
  const body = standardResponses[standardResponses.length - 1];
  if (!body || body.routes.length < 2) {
    console.log('No alternative route returned - cannot prove divergence.');
    await browser.close();
    return;
  }
  const [r0, r1] = body.routes;
  const altCoords = r1.geometry.coordinates;
  let best = null;
  for (const vertex of r0.geometry.coordinates) {
    const nearest = Math.min(...altCoords.map((c) => distM(vertex, c)));
    if (!best || nearest > best.nearest) best = { vertex, nearest };
  }
  console.log(`Seeding incident on fastest-unique point: ${JSON.stringify(best.vertex)} (${Math.round(best.nearest)}m from alternative)`);
  if (best.nearest < 400) {
    console.log('Routes overlap too tightly - divergence proof not meaningful.');
    await browser.close();
    return;
  }

  await page.evaluate((vertex) => {
    const store = window.__shotgunTripStore.getState();
    const base = store.visibleAlerts[0] ?? {};
    const hazard = {
      ...base,
      alert_id: 'demo-hazard-divergence',
      type: 'ACCIDENT',
      subtype: null,
      latitude: vertex[1],
      longitude: vertex[0],
      street: 'Southern Expressway',
      city: 'Adelaide',
      publish_datetime_utc: new Date().toISOString(),
      description: 'Reported accident (seeded for route-options verification)',
      country: 'AU',
    };
    store.setVisibleAlerts([...store.visibleAlerts.filter((a) => a.alert_id !== hazard.alert_id), hazard]);
  }, best.vertex);
  await page.evaluate(() => window.__shotgunRouteOptionsStore.getState().clear());
  await sleep(400);

  await pickDestination();
  const options = await readOptions();
  console.log('OPTIONS (seeded):', JSON.stringify(options));

  await sleep(1200);
  await page.screenshot({ path: 'nav-routes-safest.png' });

  const cardText = await page.$$eval('[aria-label*=" route,"]', (els) => els.map((e) => e.getAttribute('aria-label')));
  console.log('CARD LABELS:', JSON.stringify(cardText, null, 2));

  console.log('done');
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
