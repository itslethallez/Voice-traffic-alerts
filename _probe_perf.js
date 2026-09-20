const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=default'],
  });
  const page = await browser.newPage();
  const logs = [];
  page.on('console', (m) => { if (m.text().includes('[perf]')) logs.push(m.text()); });
  await page.goto('http://localhost:8741/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 22000));
  console.log(logs.join('\n') || 'NO PERF LOGS');
  await browser.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
