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

  // Inject a navigating state - NavigationStatusBar reads the store
  // directly, no real route needed to verify the ARR clock rendering.
  await page.evaluate(() => {
    window.__shotgunNavStore.setState({
      status: 'navigating',
      etaMs: Date.now() + 7 * 60_000,
      remainingDistanceM: 4600,
      destinationLabel: 'GLENELG',
      distanceToNextManeuverM: 3700,
      currentStepIndex: 4,
      activeRoute: {
        distanceMeters: 10800,
        polyline: [
          { latitude: -34.9285, longitude: 138.6007 },
          { latitude: -34.94, longitude: 138.56 },
          { latitude: -34.98, longitude: 138.51 },
        ],
        steps: [
          { maneuver: { location: [0, 0], instruction: 'x', type: 'turn', modifier: 'right' } },
          { maneuver: { location: [0, 0], instruction: 'x', type: 'turn', modifier: 'right' } },
          { maneuver: { location: [0, 0], instruction: 'x', type: 'turn', modifier: 'right' } },
          { maneuver: { location: [0, 0], instruction: 'x', type: 'turn', modifier: 'right' } },
          { maneuver: { location: [0, 0], instruction: 'Turn left onto Brighton Road/A15.', type: 'turn', modifier: 'left' } },
          { maneuver: { location: [0, 0], instruction: 'Turn left onto Brighton Road/A15.', type: 'turn', modifier: 'left' } },
          { maneuver: { location: [0, 0], instruction: 'Turn right onto Jetty Road.', type: 'turn', modifier: 'right' } },
          { maneuver: { location: [0, 0], instruction: 'Your destination is on the left.', type: 'arrive' } },
        ],
      },
    });
  });
  await sleep(1500);
  await page.screenshot({ path: 'fix-nav-statusbar.png' });
  const text = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('*')].filter((n) => n.children.length === 0 && /ARR/.test(n.textContent || ''));
    return nodes.map((n) => n.textContent);
  });
  console.log('[probe] ARR text nodes:', JSON.stringify(text));
  await browser.close();
  console.log('done');
})().catch((e) => { console.error(e); process.exit(1); });
