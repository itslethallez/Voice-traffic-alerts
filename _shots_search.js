const puppeteer = require('puppeteer-core');

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
  // Adelaide CBD - the same spot the other _shots scripts put the driver.
  await page.setGeolocation({ latitude: -34.9285, longitude: 138.6007, accuracy: 5 });

  // Capture the real /suggest responses so we can confirm POI/business
  // coverage, not just addresses.
  const suggestResponses = [];
  page.on('response', async (res) => {
    if (res.url().includes('/search/searchbox/v1/suggest')) {
      try {
        suggestResponses.push(await res.json());
      } catch {}
    }
    if (res.url().includes('/search/searchbox/v1/retrieve')) {
      try {
        const body = await res.json();
        console.log('[retrieve]', JSON.stringify(body.features?.[0]?.geometry?.coordinates));
      } catch {}
    }
  });
  page.on('console', (msg) => {
    if (msg.text().includes('[navigate]')) console.log('[page]', msg.text());
  });

  await page.goto('http://localhost:8741/', { waitUntil: 'networkidle2', timeout: 90000 });
  await page.waitForFunction(() => window.__shotgunMap && window.__shotgunMap.loaded(), { timeout: 90000 });
  await page.evaluate(() => new Promise((r) => window.__shotgunMap.once('idle', r)));
  await new Promise((r) => setTimeout(r, 3000));

  // Open Navigate mode.
  await page.click('[aria-label="Navigate - plan a trip"]');
  await page.waitForSelector('[aria-label="Destination search"]', { timeout: 10000 });

  // Type a real Adelaide place name - keystrokes debounce 350ms.
  await page.click('[aria-label="Destination search"]');
  await page.type('[aria-label="Destination search"]', 'Adelaide Railway Station', { delay: 30 });

  // Wait for result rows to render.
  await page.waitForSelector('[aria-label^="Set destination to"]', { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: 'nav-search-results.png' });

  // Dump what came back.
  const rows = await page.$$eval('[aria-label^="Set destination to"]', (els) => els.map((e) => e.textContent));
  console.log('RESULT ROWS:', JSON.stringify(rows, null, 2));
  for (const body of suggestResponses) {
    console.log('SUGGEST feature_types:', JSON.stringify((body.suggestions ?? []).map((s) => ({
      name: s.name,
      feature_type: s.feature_type,
      poi_category: s.poi_category,
      distance: s.distance,
    })), null, 2));
  }

  // Pick the first result - should retrieve coordinates and show the card.
  await page.click('[aria-label^="Set destination to"]');
  await page.waitForFunction(() => document.body.innerText.includes('DESTINATION'), { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: 'nav-search-selected.png' });

  console.log('done');
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
