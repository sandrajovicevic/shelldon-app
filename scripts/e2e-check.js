// Quick golden-path smoke test using the pre-installed Chromium.
// Not a permanent test suite -- just a manual verification driver.
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 8934;

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
};

const server = http.createServer((req, res) => {
  let filePath = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (filePath.endsWith('/')) filePath = path.join(filePath, 'index.html');
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

(async () => {
  await new Promise((resolve) => server.listen(PORT, resolve));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 420, height: 860 } });
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));

  await page.goto(`http://localhost:${PORT}/index.html`);
  await page.screenshot({ path: path.join(ROOT, 'scripts', 'shot-1-idle.png') });

  // add three options
  for (const opt of ['Laundry', 'Emails', 'Walk the dog']) {
    await page.fill('#optionInput', opt);
    await page.click('#addBtn');
  }
  await page.screenshot({ path: path.join(ROOT, 'scripts', 'shot-2-options.png') });

  const askDisabled = await page.getAttribute('#askBtn', 'disabled');
  console.log('askBtn disabled after 3 options (expect null):', askDisabled);

  await page.click('#askBtn');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(ROOT, 'scripts', 'shot-3-shaking.png') });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(ROOT, 'scripts', 'shot-4-reveal.png') });

  const bubble = await page.textContent('#bubbleText');
  console.log('verdict bubble text:', bubble);

  const postActionsHidden = await page.getAttribute('#postActions', 'class');
  console.log('postActions class (should not contain hidden):', postActionsHidden);

  // reroll once
  await page.click('#rerollBtn');
  await page.waitForTimeout(200);
  const bubbleAfterReroll = await page.textContent('#bubbleText');
  console.log('verdict after reroll:', bubbleAfterReroll);
  const rerollDisabled = await page.getAttribute('#rerollBtn', 'disabled');
  console.log('rerollBtn disabled after use (expect "" or "disabled"):', rerollDisabled);

  // mark done -> check streak increments
  const streakBefore = await page.textContent('#streakCount');
  await page.click('#didItBtn');
  await page.waitForTimeout(1600); // resets after 1.4s
  const streakAfter = await page.textContent('#streakCount');
  console.log('streak before/after Did it:', streakBefore, '->', streakAfter);

  await page.screenshot({ path: path.join(ROOT, 'scripts', 'shot-5-after-reset.png') });

  // entry should be reset
  const chipCount = await page.$$eval('#chips .chip', (els) => els.length);
  console.log('chips after reset (expect 0):', chipCount);

  // switch mode
  await page.click('[data-mode="life"]');
  const idleText = await page.textContent('#bubbleText');
  console.log('life mode idle prompt:', idleText);
  await page.screenshot({ path: path.join(ROOT, 'scripts', 'shot-6-life-mode.png') });

  // localStorage persistence check via reload
  await page.reload();
  const streakPersisted = await page.textContent('#streakCount');
  console.log('streak persisted after reload:', streakPersisted);

  console.log('console errors:', consoleErrors);

  await browser.close();
  server.close();
})();
