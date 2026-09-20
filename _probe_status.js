const puppeteer = require('puppeteer-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=default', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 860, deviceScaleFactor: 2 });
  await page.setGeolocation({ latitude: -34.9285, longitude: 138.6007, accuracy: 5 });

  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || t.includes('[routes]') || t.includes('[navigate]') || t.includes('[nav]')) console.log('[page]', t); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('requestfailed', (r) => console.log('[reqfail]', r.url().slice(0, 120)));

  await page.goto('http://localhost:8741/', { waitUntil: 'networkidle2', timeout: 90000 });
  await page.waitForFunction(() => window.__shotgunMap && window.__shotgunMap.loaded(), { timeout: 90000 });
  await page.evaluate(() => new Promise((r) => window.__shotgunMap.once('idle', r)));
  await sleep(2500);

  // Zoomed-out marker check: icons should sit centred on their roads.
  await page.evaluate(() =>
    window.__shotgunMap.jumpTo({ center: [138.6007, -34.9285], zoom: 13, pitch: 50, bearing: 0 })
  );
  await page.evaluate(() => new Promise((r) => window.__shotgunMap.once('idle', r)));
  await sleep(600);
  await page.screenshot({ path: 'fix-markers-zoomout.png' });

  // Start nav for the ARR clock in the status bar.
  await page.evaluate(() =>
    window.__shotgunMap.jumpTo({ center: [138.6007, -34.9285], zoom: 15.5, pitch: 50, bearing: 0 })
  );
  await page.click('[aria-label="Navigate - plan a trip"]');
  await page.waitForSelector('[aria-label="Destination search"]', { timeout: 10000 });
  await page.click('[aria-label="Destination search"]');
  await page.type('[aria-label="Destination search"]', 'Glenelg', { delay: 30 });
  await sleep(3000);
  const suggestions = await page.evaluate(() =>
    [...document.querySelectorAll('[aria-label^="Set destination to"]')].map((e) => e.getAttribute('aria-label'))
  );
  console.log('[probe] suggestions:', JSON.stringify(suggestions));
  await page.click('[aria-label^="Set destination to"]');
  await sleep(3000);
  console.log('[probe] after pick:', await page.evaluate(() => JSON.stringify(window.__shotgunRouteOptionsStore?.getState().status)));
  try {
    await page.waitForFunction(() => window.__shotgunRouteOptionsStore?.getState().status === 'ready', { timeout: 45000 });
  } catch {
    console.log('[probe] options state:', await page.evaluate(() => JSON.stringify(window.__shotgunRouteOptionsStore?.getState())));
    throw new Error('route options never reached ready');
  }
  await page.click('[aria-label^="Start navigation"]');
  await page.waitForFunction(() => window.__shotgunNavStore.getState().status === 'navigating', { timeout: 15000 });
  await sleep(2500);
  await page.screenshot({ path: 'fix-nav-statusbar.png' });
  const statusText = await page.evaluate(() => document.body.innerText.match(/\d+\s*MIN[^\n]*\n?[^\n]*/)?.[0] ?? null);
  console.log('[probe] status bar text region:', JSON.stringify(statusText));

  await browser.close();
  console.log('done');
})().catch((e) => { console.error(e); process.exit(1); });
