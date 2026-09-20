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
  await sleep(2500);

  const shots = [
    // Coast, high pitch, low zoom: horizon in frame, water west.
    { name: 'fog-coast-pitched', center: [138.51, -34.94], zoom: 12.5, pitch: 60, bearing: -90 },
    // Regional zoom-out: beyond DEM coverage at edges.
    { name: 'fog-zoomout', center: [138.6, -34.93], zoom: 10, pitch: 50, bearing: 0 },
    // Straight down vs pitched compare at driving zoom.
    { name: 'fog-driving-pitch', center: [138.6, -34.93], zoom: 15, pitch: 50, bearing: 0 },
  ];
  for (const s of shots) {
    await page.evaluate(
      (cfg) => window.__shotgunMap.jumpTo({ center: cfg.center, zoom: cfg.zoom, pitch: cfg.pitch, bearing: cfg.bearing }),
      s
    );
    await page.evaluate(() => new Promise((r) => window.__shotgunMap.once('idle', r)));
    await sleep(800);
    await page.screenshot({ path: `${s.name}.png` });
    console.log('shot', s.name);
  }
  const fog = await page.evaluate(() => JSON.stringify(window.__shotgunMap.getFog()));
  console.log('fog spec:', fog);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
