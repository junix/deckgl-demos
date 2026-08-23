import {spawn} from 'node:child_process';
import {mkdir, readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {PNG} from 'pngjs';
import {chromium} from 'playwright-core';

const root = resolve(import.meta.dirname, '..');
const port = 41731;
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const vite = resolve(root, 'node_modules/vite/bin/vite.js');
const server = spawn(process.execPath, [vite, 'preview', '--host', '127.0.0.1', '--port', String(port)], {cwd: root, stdio: 'pipe'});
const failures = [];

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { if ((await fetch(`http://127.0.0.1:${port}`)).ok) return; } catch {}
    await new Promise(resolveWait => setTimeout(resolveWait, 125));
  }
  throw new Error('Vite preview did not become ready');
}

function assertPreview(buffer, scene) {
  const image = PNG.sync.read(buffer);
  let colorful = 0;
  let opaque = 0;
  for (let index = 0; index < image.data.length; index += 4) {
    const [r, g, b, a] = image.data.subarray(index, index + 4);
    if (a > 240) opaque += 1;
    if (a > 240 && Math.max(r, g, b) - Math.min(r, g, b) > 22 && r + g + b > 100) colorful += 1;
  }
  if (opaque < image.width * image.height * 0.95) throw new Error(`${scene}: screenshot is unexpectedly transparent`);
  if (colorful < 3500) throw new Error(`${scene}: too few colorful pixels (${colorful})`);
}

function assertTransparentImage(buffer, scene) {
  const image = PNG.sync.read(buffer);
  let transparent = 0;
  let content = 0;
  for (let index = 0; index < image.data.length; index += 4) {
    const alpha = image.data[index + 3];
    if (alpha < 8) transparent += 1;
    if (alpha > 24) content += 1;
  }
  const pixels = image.width * image.height;
  if (transparent < pixels * 0.10) throw new Error(`${scene}: exported PNG lacks transparent background (${transparent}/${pixels})`);
  if (content < 2500) throw new Error(`${scene}: exported PNG has too little visible content (${content} pixels)`);
}

try {
  await mkdir(resolve(root, 'out'), {recursive: true});
  await waitForServer();
  const browser = await chromium.launch({headless: true, executablePath: chrome, args: ['--use-angle=metal']});
  for (const scene of ['hexagons', 'trips', 'flows']) {
    const page = await browser.newPage({viewport: {width: 1280, height: 820}, deviceScaleFactor: 1});
    const consoleErrors = [];
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('pageerror', error => consoleErrors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname === '127.0.0.1' || ['data:', 'blob:'].includes(url.protocol)) route.continue();
      else { failures.push(`${scene}: external request ${url.href}`); route.abort(); }
    });
    await page.goto(`http://127.0.0.1:${port}/?scene=${scene}`, {waitUntil: 'networkidle'});
    await page.waitForFunction(() => window.__plotDemo?.ready === true, undefined, {timeout: 20_000});
    const before = await page.evaluate(() => ({...window.__plotDemo}));
    if (!before.itemCount || before.scene !== scene) failures.push(`${scene}: invalid runtime metadata`);
    if (scene === 'trips') {
      await page.waitForTimeout(350);
      const after = await page.evaluate(() => window.__plotDemo?.frame ?? 0);
      if (after <= before.frame) failures.push('trips: animation frame did not advance');
      await page.getByRole('button', {name: 'Pause animation'}).click();
    }
    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error(`${scene}: canvas missing`);
    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.55);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.58, box.y + box.height * 0.45, {steps: 8});
    await page.mouse.up();
    await page.waitForTimeout(180);
    const changed = await page.evaluate(() => window.__plotDemo?.viewChanges ?? 0);
    if (changed < 1) failures.push(`${scene}: drag did not update the camera`);
    const path = resolve(root, 'out', `${scene}.png`);
    await page.screenshot({path});
    assertPreview(await readFile(path), scene);
    if (consoleErrors.length) failures.push(`${scene}: console errors: ${consoleErrors.join(' | ')}`);
    await page.close();
    const exportPage = await browser.newPage({viewport: {width: 1400, height: 900}, deviceScaleFactor: 1});
    await exportPage.goto(`http://127.0.0.1:${port}/?scene=${scene}&export=1`, {waitUntil: 'networkidle'});
    await exportPage.waitForFunction(() => window.__plotDemo?.ready === true, undefined, {timeout: 20_000});
    await exportPage.waitForTimeout(250);
    const exportPath = resolve(root, 'out', `${scene}-transparent.png`);
    await exportPage.screenshot({path: exportPath, omitBackground: true});
    assertTransparentImage(await readFile(exportPath), scene);
    await exportPage.close();
    console.log(`validated ${scene}: ${before.itemCount} records, ${changed} camera updates`);
  }
  await browser.close();
} finally {
  server.kill('SIGTERM');
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('deck.gl validation passed: 3 offline scenes + transparent PNG exports');
