const puppeteer = require('puppeteer-core');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Sample a small grid of terrain elevations around `center` (meters of
// offset), returning min/max/spread and the raw samples.
async function sampleGrid(page, center, radiusM) {
  return page.evaluate(
    ({ center, radiusM }) => {
      const map = window.__shotgunMap;
      const latM = 111320;
      const lonM = 111320 * Math.cos((center.latitude * Math.PI) / 180);
      const pts = [center];
      for (const [dx, dy] of [
        [radiusM, 0], [-radiusM, 0], [0, radiusM], [0, -radiusM],
        [radiusM * 0.7, radiusM * 0.7], [-radiusM * 0.7, radiusM * 0.7],
        [radiusM * 0.7, -radiusM * 0.7], [-radiusM * 0.7, -radiusM * 0.7],
      ]) {
        pts.push({ latitude: center.latitude + dy / latM, longitude: center.longitude + dx / lonM });
      }
      const samples = pts.map((p) => map.queryTerrainElevation([p.longitude, p.latitude]));
      const valid = samples.filter((v) => typeof v === 'number' && Number.isFinite(v));
      return {
        n: valid.length,
        min: Math.min(...valid),
        max: Math.max(...valid),
        spread: Math.max(...valid) - Math.min(...valid),
        samples: samples.map((v) => (v === null || v === undefined ? null : Math.round(v * 10) / 10)),
      };
    },
    { center, radiusM }
  );
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=default', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 860, deviceScaleFactor: 2 });
  const context = browser.defaultBrowserContext();
  await context.overridePermissions('http://localhost:8741', ['geolocation']);
  await page.setGeolocation({ latitude: -34.9285, longitude: 138.6007, accuracy: 5 });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  // show the relief-adaptive scale decisions from the app
  page.on('console', (m) => {
    if (m.text().includes('terrain relief')) console.log('  app:', m.text());
  });

  await page.goto('http://localhost:8741/', { waitUntil: 'networkidle2', timeout: 90000 });
  await page.waitForFunction(() => window.__shotgunMap && window.__shotgunMap.loaded(), { timeout: 90000 });
  await page.evaluate(() => new Promise((r) => window.__shotgunMap.once('idle', r)));
  await sleep(2000);

  const spots = [
    { name: 'Adelaide CBD', lat: -34.9285, lon: 138.6007, shot: 'terrain-cbd.png' },
    { name: 'Adelaide Hills (Stirling)', lat: -35.005, lon: 138.716, shot: 'terrain-hills.png' },
    { name: 'Katoomba NSW', lat: -33.712, lon: 150.312, shot: 'terrain-katoomba.png' },
  ];

  for (const spot of spots) {
    // driverPosition drives the relief resample - move the fix AND the camera
    await page.setGeolocation({ latitude: spot.lat, longitude: spot.lon, accuracy: 5 });
    await page.evaluate(
      ({ lat, lon }) =>
        window.__shotgunMap.jumpTo({ center: [lon, lat], zoom: 15.5, pitch: 50, bearing: 0 }),
      { lat: spot.lat, lon: spot.lon }
    );
    // let DEM + vector tiles land, then nudge the fix so the sampler retries
    // until the terrain tiles are queryable
    await page.evaluate(() => new Promise((r) => window.__shotgunMap.once('idle', r)));
    for (let i = 0; i < 6; i++) {
      await page.setGeolocation({ latitude: spot.lat + i * 0.0002, longitude: spot.lon + i * 0.0002, accuracy: 5 });
      await sleep(700);
    }
    await page.evaluate(() => new Promise((r) => window.__shotgunMap.once('idle', r)));
    await sleep(1000);

    for (const radius of [400, 900, 1800]) {
      const res = await sampleGrid(page, { latitude: spot.lat, longitude: spot.lon }, radius);
      console.log(
        `${spot.name} r=${radius}m: n=${res.n} min=${res.min.toFixed(1)} max=${res.max.toFixed(1)} spread=${res.spread.toFixed(1)}m`,
        JSON.stringify(res.samples)
      );
    }
    await page.screenshot({ path: spot.shot });
    console.log(`saved ${spot.shot}`);
  }

  await browser.close();
})();
