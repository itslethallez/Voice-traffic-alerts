const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=default'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 860, deviceScaleFactor: 2 });
  // Put the driver on a real major road (Adelaide CBD grid = primary/
  // secondary, OSM maxspeed coverage ~93%) so the limit roundel resolves
  // genuinely through the Overpass path - no fixture.
  const context = browser.defaultBrowserContext();
  await context.overridePermissions('http://localhost:8741', ['geolocation']);
  await page.setGeolocation({ latitude: -34.9285, longitude: 138.6007, accuracy: 5 });
  await page.goto('http://localhost:8741/', { waitUntil: 'networkidle2', timeout: 90000 });
  await page.waitForFunction(() => window.__shotgunMap && window.__shotgunMap.loaded(), { timeout: 90000 });
  await page.evaluate(() => new Promise((r) => window.__shotgunMap.once('idle', r)));
  // Give the position watch + Overpass lookup time to resolve.
  await new Promise((r) => setTimeout(r, 8000));

  await page.screenshot({ path: 'v3-full.png' });
  // Left-edge speed capsule.
  await page.screenshot({ path: 'v3-speed.png', clip: { x: 0, y: 380, width: 150, height: 260 } });
  // Bottom row - Report FAB only.
  await page.screenshot({ path: 'v3-bottom.png', clip: { x: 0, y: 620, width: 430, height: 240 } });
  console.log('done');
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
