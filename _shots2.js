const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=default'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 860, deviceScaleFactor: 2 });
  await page.goto('http://localhost:8741/', { waitUntil: 'networkidle2', timeout: 90000 });
  await page.waitForFunction(() => window.__shotgunMap && window.__shotgunMap.loaded(), { timeout: 90000 });
  await page.evaluate(() => new Promise((r) => window.__shotgunMap.once('idle', r)));

  // Steep relief: Blue Mountains escarpment (Katoomba), terrain ON.
  await page.evaluate(() => {
    window.__shotgunMap.jumpTo({ center: [150.315, -33.72], zoom: 13, pitch: 60 });
  });
  await page.evaluate(() => new Promise((r) => window.__shotgunMap.once('idle', r)));
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: 'shot-4-terrain-on.png' });
  console.log('terrain on done');

  await page.evaluate(() => window.__shotgunMap.setTerrain(null));
  await page.evaluate(() => new Promise((r) => window.__shotgunMap.once('idle', r)));
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: 'shot-5-terrain-off.png' });
  console.log('terrain off done');

  await page.evaluate(() => {
    window.__shotgunMap.setTerrain({
      source: 'shotgun-terrain-dem',
      exaggeration: ['interpolate', ['linear'], ['zoom'], 10, 1.6, 14, 1.0],
    });
  });
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
