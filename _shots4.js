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
  await new Promise((r) => setTimeout(r, 1500));

  // Full screen - new style + collapsed chrome.
  await page.screenshot({ path: 'v2-0-full.png' });
  await page.screenshot({ path: 'v2-1-top.png', clip: { x: 0, y: 0, width: 430, height: 220 } });
  console.log('default view done');

  // Expand FILTERS row.
  const clicked = await page.evaluate(() => {
    const els = [...document.querySelectorAll('[aria-label]')];
    const chip = els.find((el) => el.getAttribute('aria-label') === 'Show alert filters');
    if (chip) { chip.click(); return true; }
    return false;
  });
  console.log('filters clicked:', clicked);
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: 'v2-2-filters.png', clip: { x: 0, y: 60, width: 430, height: 280 } });

  // Stirling regional view (where the clutter was reported).
  await page.evaluate(() => {
    window.__shotgunMap.jumpTo({ center: [138.7167, -35.0], zoom: 14.2, pitch: 50 });
  });
  await page.evaluate(() => new Promise((r) => window.__shotgunMap.once('idle', r)));
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: 'v2-3-stirling.png' });
  console.log('stirling done');
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
