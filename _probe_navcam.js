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
  await page.setGeolocation({ latitude: -34.9285, longitude: 138.6007, accuracy: 5 });

  await page.goto('http://localhost:8741/', { waitUntil: 'networkidle2', timeout: 90000 });
  await page.waitForFunction(() => window.__shotgunMap && window.__shotgunMap.loaded(), { timeout: 90000 });
  await page.evaluate(() => new Promise((r) => window.__shotgunMap.once('idle', r)));
  await sleep(2000);

  const before = await page.evaluate(() => ({
    pitch: window.__shotgunMap.getPitch(),
    padding: window.__shotgunMap.getPadding(),
    zoom: window.__shotgunMap.getZoom(),
  }));
  console.log('[cruising]', JSON.stringify(before));

  // Inject a minimal navigating state: route polyline + trip position.
  await page.evaluate(() => {
    window.__shotgunNavStore.setState({
      status: 'navigating',
      etaMs: Date.now() + 7 * 60_000,
      remainingDistanceM: 4600,
      destinationLabel: 'GLENELG',
      distanceToNextManeuverM: 3700,
      currentStepIndex: 0,
      activeRoute: {
        distanceMeters: 10800,
        polyline: [
          { latitude: -34.9285, longitude: 138.6007 },
          { latitude: -34.94, longitude: 138.575 },
          { latitude: -34.97, longitude: 138.53 },
          { latitude: -34.98, longitude: 138.51 },
        ],
        steps: [
          { maneuver: { location: [138.6007, -34.9285], instruction: 'Drive south.', type: 'depart' } },
          { maneuver: { location: [138.53, -34.97], instruction: 'Turn right onto Jetty Road.', type: 'turn', modifier: 'right' } },
          { maneuver: { location: [138.51, -34.98], instruction: 'Arrive.', type: 'arrive' } },
        ],
      },
    });
    window.__shotgunTripStore.setState({
      driverPosition: { latitude: -34.9285, longitude: 138.6007 },
      driverHeadingDeg: 200,
      driverSpeedKmh: 40,
    });
  });
  await sleep(2500);

  const nav = await page.evaluate(() => ({
    pitch: window.__shotgunMap.getPitch(),
    padding: window.__shotgunMap.getPadding(),
    zoom: window.__shotgunMap.getZoom(),
    bearing: window.__shotgunMap.getBearing(),
    center: window.__shotgunMap.getCenter(),
  }));
  console.log('[nav]', JSON.stringify(nav));
  // Where does the puck render? Project the driver coord and compare to height.
  const puckY = await page.evaluate(() => {
    const p = window.__shotgunMap.project([-34.9285 + 0, 138.6007 - 0]); // lngLat order
    return p.y / window.__shotgunMap.getContainer().clientHeight;
  }).catch(() => null);
  // Actually project takes [lng,lat]:
  const puckFrac = await page.evaluate(() => {
    const c = window.__shotgunMap.getCenter();
    const p = window.__shotgunMap.project(c);
    return (p.y / window.__shotgunMap.getContainer().clientHeight).toFixed(3);
  });
  console.log('[nav] puck screen-height fraction:', puckFrac);
  await page.screenshot({ path: 'nav-cam-check.png' });
  await browser.close();
  console.log('done');
})().catch((e) => { console.error(e); process.exit(1); });
