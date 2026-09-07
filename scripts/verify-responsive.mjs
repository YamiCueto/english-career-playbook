import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9222;

const viewports = [
  { name: 'Mobile 360', width: 360, height: 800 },
  { name: 'iPhone 390', width: 390, height: 844 },
  { name: 'Pixel 412', width: 412, height: 915 },
  { name: 'Tablet 768', width: 768, height: 1024 },
  { name: 'Desktop 1440', width: 1440, height: 900 },
];

const routes = [
  { name: 'dashboard', path: '/#/dashboard' },
  { name: 'practice', path: '/#/practice' },
  { name: 'playbook', path: '/#/playbook' },
];

mkdirSync('reports/screenshots', { recursive: true });

const chrome = spawn(CHROME_PATH, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--disable-gpu',
  '--no-sandbox',
  '--disable-extensions',
  '--hide-scrollbars',
  'http://localhost:4200/#/dashboard',
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getPageDebuggerUrl() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
      if (page) {
        return page.webSocketDebuggerUrl;
      }
    } catch {}
    await sleep(250);
  }
  throw new Error('Could not find Chrome page target');
}

async function runAudit() {
  const wsUrl = await getPageDebuggerUrl();
  const ws = new WebSocket(wsUrl);

  let msgId = 1;
  const pending = new Map();

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) reject(data.error);
      else resolve(data.result);
    }
  };

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = msgId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  await new Promise((resolve) => (ws.onopen = resolve));

  await send('Page.enable');
  await send('Runtime.enable');

  const results = [];

  for (const vp of viewports) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: 1,
      mobile: vp.width < 768,
    });

    for (const route of routes) {
      const targetUrl = `http://localhost:4200${route.path}`;
      await send('Page.navigate', { url: targetUrl });
      await sleep(600);

      const evalResult = await send('Runtime.evaluate', {
        expression: `JSON.stringify({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
        })`,
        returnByValue: true,
      });

      const metrics = JSON.parse(evalResult.result.value);

      const screenshotResult = await send('Page.captureScreenshot', {
        format: 'png',
      });
      const imgBuffer = Buffer.from(screenshotResult.data, 'base64');
      const filename = `reports/screenshots/${vp.width}x${vp.height}_${route.name}.png`;
      writeFileSync(filename, imgBuffer);

      results.push({
        viewport: `${vp.width}×${vp.height}`,
        name: vp.name,
        route: route.path,
        scrollWidth: metrics.scrollWidth,
        clientWidth: metrics.clientWidth,
        hasHorizontalOverflow: metrics.overflow,
        screenshot: filename,
      });
    }
  }

  ws.close();
  chrome.kill();

  writeFileSync('reports/responsive-audit.json', JSON.stringify(results, null, 2));

  console.table(results.map(r => ({
    Viewport: r.viewport,
    Device: r.name,
    Route: r.route,
    ScrollWidth: r.scrollWidth,
    ClientWidth: r.clientWidth,
    'Overflow?': r.hasHorizontalOverflow ? 'FAIL' : 'PASS'
  })));

  const hasAnyFailure = results.some((r) => r.hasHorizontalOverflow);
  if (hasAnyFailure) {
    console.error('Responsive audit FAILED: horizontal overflow detected');
    process.exit(1);
  } else {
    console.log('Responsive audit PASSED: scrollWidth <= clientWidth across all viewports');
    process.exit(0);
  }
}

runAudit().catch((err) => {
  console.error(err);
  try {
    chrome.kill();
  } catch {}
  process.exit(1);
});
