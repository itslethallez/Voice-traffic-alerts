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

  // Full screen reference shot.
  await page.screenshot({ path: 'audit-0-full.png' });

  // Per-region crops (CSS px, deviceScaleFactor applied automatically).
  const crops = [
    ['audit-1-top.png', { x: 0, y: 0, width: 430, height: 240 }],           // mode switch + header
    ['audit-2-centre.png', { x: 40, y: 240, width: 350, height: 300 }],     // map centre
    ['audit-3-bottom.png', { x: 0, y: 480, width: 430, height: 380 }],      // sheet + control row
    ['audit-4-controls.png', { x: 0, y: 560, width: 430, height: 240 }],    // persistent buttons
    ['audit-6-material.png', { x: 10, y: 120, width: 410, height: 160 }],   // floating chrome material
    ['audit-7-speedo.png', { x: 300, y: 560, width: 130, height: 160 }],    // speedometer
  ];
  for (const [file, clip] of crops) {
    await page.screenshot({ path: file, clip });
    console.log(file, 'done');
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
