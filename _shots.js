const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=default'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 860, deviceScaleFactor: 2 });
  page.on('console', (m) => console.log('[page]', m.text().slice(0, 200)));
  await page.goto('http://localhost:8741/', { waitUntil: 'networkidle2', timeout: 90000 });
  await page.waitForFunction(() => window.__shotgunMap && window.__shotgunMap.loaded(), { timeout: 90000 });
  await page.evaluate(() => new Promise((r) => window.__shotgunMap.once('idle', r)));
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: 'shot-1-adelaide-cbd.png' });
  console.log('shot 1 done');

  // Adelaide Hills / Mount Lofty area - regional terrain + hillshade.
  await page.evaluate(() => {
    window.__shotgunMap.jumpTo({ center: [138.71, -34.975], zoom: 13.2 });
  });
  await page.evaluate(() => new Promise((r) => window.__shotgunMap.once('idle', r)));
  await new Promise((r) => setTimeout(r, 1000));
  await page.screenshot({ path: 'shot-2-adelaide-hills.png' });
  console.log('shot 2 done');

  // Zoomed-out regional view - terrain exaggeration reads at low zoom.
  await page.evaluate(() => {
    window.__shotgunMap.jumpTo({ center: [138.72, -35.05], zoom: 11.5 });
  });
  await page.evaluate(() => new Promise((r) => window.__shotgunMap.once('idle', r)));
  await new Promise((r) => setTimeout(r, 1000));
  await page.screenshot({ path: 'shot-3-regional.png' });
  console.log('shot 3 done');

  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
