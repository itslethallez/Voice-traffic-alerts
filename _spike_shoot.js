const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const ROOT = __dirname;

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(p === ROOT + path.sep ? path.join(ROOT, '_spike/index.html') : p, (err, data) => {
    if (err) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  });
});

(async () => {
  await new Promise((r) => server.listen(8766, r));
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    protocolTimeout: 300000,
    args: ['--enable-unsafe-swiftshader', '--use-angle=default'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 860, deviceScaleFactor: 2 });
  page.on('console', (m) => { if (m.text().includes('MAPERR')) console.log(m.text()); });
  page.on('requestfailed', (r) => console.log('[reqfail]', r.url().slice(0, 110)));

  const only = process.argv[2];
  for (const v of only ? [only] : ['ours', 'night', 'day']) {
    try {
      await page.goto(`http://localhost:8766/_spike/index.html?v=${v}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForFunction(() => window.__map && window.__map.loaded(), { timeout: 120000 });
      await sleep(8000); // let tiles/labels settle without blocking on 'idle'
      await page.screenshot({ path: `spike-${v}.png` });
      console.log(`[${v}] shot taken`);
    } catch (e) {
      console.log(`[${v}] FAILED: ${e.message.slice(0, 140)}`);
    }
  }
  await browser.close();
  server.close();
  console.log('done');
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
