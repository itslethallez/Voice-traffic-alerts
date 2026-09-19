const puppeteer = require('puppeteer-core');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  // Adelaide CBD - same spot the other _shots scripts put the driver.
  await page.setGeolocation({ latitude: -34.9285, longitude: 138.6007, accuracy: 5 });

  // Capture the real Directions responses so we can verify three genuine
  // route geometries came back (and that the excluded request differed).
  page.on('response', async (res) => {
    if (res.url().includes('/directions/v5/')) {
      try {
        const body = await res.json();
        const excluded = /exclude=motorway/.test(res.url());
        console.log(
          `[directions] exclude=${excluded} code=${body.code} routes=${(body.routes ?? []).length} ` +
            (body.routes ?? []).map((r) => `${(r.distance / 1000).toFixed(1)}km/${Math.round(r.duration / 60)}min`).join(' | ')
        );
      } catch {}
    }
  });
  page.on('console', (msg) => {
    if (msg.text().includes('[navigate]')) console.log('[page]', msg.text());
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
    // Far-south suburb - the natural route runs the Southern Expressway,
    // so side-streets has real work to do and any expressway incident
    // gives SAFEST a genuine alternative to prefer.
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
        mid: o.route.polyline[Math.floor(o.route.polyline.length / 2)],
      }))
    );

  await pickDestination();
  let options = await readOptions();
  console.log('OPTIONS (first pass):', JSON.stringify(options));

  // If no live incident happened to intersect the fastest route, seed one
  // exactly on its own polyline midpoint so SAFEST's reroute behaviour is
  // exercised for the screenshot - the same machinery a real Waze incident
  // would drive, just guaranteed on-corridor.
  const fastest = options.find((o) => o.id === 'fastest');
  if (fastest && fastest.hazardsOnRoute === 0) {
    console.log('No live incident on fastest - seeding one at its midpoint for the demo.');
    await page.evaluate((mid) => {
      const store = window.__shotgunTripStore.getState();
      const base = store.visibleAlerts[0] ?? {};
      const hazard = {
        ...base,
        alert_id: 'demo-hazard-expressway',
        type: 'ACCIDENT',
        subtype: null,
        latitude: mid.latitude,
        longitude: mid.longitude,
        street: 'Southern Expressway',
        city: 'Adelaide',
        publish_datetime_utc: new Date().toISOString(),
        description: 'Reported accident (seeded for route-options verification)',
        country: 'AU',
      };
      store.setVisibleAlerts([...store.visibleAlerts.filter((a) => a.alert_id !== hazard.alert_id), hazard]);
    }, fastest.mid);
    await page.evaluate(() => window.__shotgunRouteOptionsStore.getState().clear());
    await sleep(400);
    await pickDestination();
    options = await readOptions();
    console.log('OPTIONS (with seeded incident):', JSON.stringify(options));
  }

  // Cards + all three preview lines in frame.
  await sleep(1200);
  await page.screenshot({ path: 'nav-routes-cards.png' });

  // Tap SIDE STREETS - the emphasised line should switch on the map.
  const sideStreetsCard = await page.$('[aria-label^="SIDE STREETS route"]');
  if (sideStreetsCard) {
    await sideStreetsCard.click();
    await sleep(700);
  }
  await page.screenshot({ path: 'nav-routes-map.png' });

  const cardText = await page.$$eval('[aria-label$="route"], [aria-label*=" route,"]', (els) =>
    els.map((e) => e.getAttribute('aria-label'))
  );
  console.log('CARD LABELS:', JSON.stringify(cardText, null, 2));

  console.log('done');
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
