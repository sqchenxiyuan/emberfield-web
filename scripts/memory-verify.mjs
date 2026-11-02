import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const BASE = process.env.COLONY_TEST_URL ?? 'http://127.0.0.1:4178';
const seconds = Number(process.env.COLONY_SOAK_SECONDS ?? 300);
await mkdir('test-results/memory', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
const cdp = await browser.newBrowserCDPSession(),
  samples = [],
  errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const capture = async (label) => {
  const processes = (await cdp.send('SystemInfo.getProcessInfo')).processInfo;
  const ids = processes.map((p) => p.id).filter(Number.isSafeInteger);
  let memory = [];
  if (process.platform === 'win32') {
    const script = `Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue | Select-Object Id,@{n='workingSetMiB';e={$_.WorkingSet64/1MB}},@{n='privateCommitMiB';e={$_.PrivateMemorySize64/1MB}} | ConvertTo-Json -Compress`;
    const raw = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', windowsHide: true },
    );
    memory = JSON.parse(raw);
    if (!Array.isArray(memory)) memory = [memory];
  }
  const info = processes.map((p) => ({ ...p, ...memory.find((m) => m.Id === p.id) }));
  const snapshot = await page.evaluate(() => ({
    metrics: window.ember.snapshot().metrics,
    tick: window.ember.snapshot().summary.tick,
    speed: window.ember.snapshot().speed,
    mainHeap: performance.memory?.usedJSHeapSize ?? null,
  }));
  const sample = {
    label,
    at: Date.now(),
    ...snapshot,
    processes: info,
    rendererPrivateMiB: info
      .filter((p) => p.type === 'renderer')
      .reduce((s, p) => s + (p.privateCommitMiB ?? 0), 0),
    browserTreePrivateMiB: info.reduce((s, p) => s + (p.privateCommitMiB ?? 0), 0),
  };
  samples.push(sample);
  console.log(
    JSON.stringify({
      label,
      rendererPrivateMiB: sample.rendererPrivateMiB,
      browserTreePrivateMiB: sample.browserTreePrivateMiB,
      fps: snapshot.metrics.fps,
      tps: snapshot.metrics.tps,
      tick: snapshot.tick,
    }),
  );
};
try {
  await page.goto(BASE);
  await page.waitForFunction(() => window.ember?.snapshot().ready);
  await page.getByRole('button', { name: '建立我们的营地' }).click();
  await page.getByRole('button', { name: '菜单与存档', exact: true }).click();
  const data = await readFile('test-results/campaign/day-8.json');
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'day-8.json', mimeType: 'application/json', buffer: data });
  await page.waitForFunction(() => window.ember.snapshot().summary.tick === 96000);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.waitForTimeout(2000);
  await capture('established-paused');
  await page.getByRole('button', { name: '6倍速', exact: true }).click();
  await page.waitForTimeout(12000);
  await capture('established-6x');
  assert.ok(
    samples.at(-1).metrics.tps > 100,
    '6x should sustain over 100 TPS in this reference scene',
  );
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.waitForFunction(() => window.ember.snapshot().speed === 0);
  const start = Date.now();
  let i = 0;
  while (Date.now() - start < seconds * 1000) {
    // Only the camera changes. Rendering and the bounded snapshot pipeline remain active.
    const canvas = page.locator('canvas');
    await canvas.click({ position: { x: 300, y: 200 } });
    await page.keyboard.down(i % 2 ? 'a' : 'd');
    await page.waitForTimeout(1000);
    await page.keyboard.up(i % 2 ? 'a' : 'd');
    await page.mouse.wheel(0, i % 2 ? -200 : 200);
    await page.waitForTimeout(9000);
    if (i % 3 === 0) await capture(`soak-${Math.round((Date.now() - start) / 1000)}s`);
    i++;
  }
  await capture('final');
  assert.deepEqual(errors, []);
  assert.ok(
    samples.every((s) => s.metrics.bufferCount === 3),
    'snapshot buffer pool must stay bounded',
  );
  if (process.platform === 'win32')
    assert.ok(
      Math.max(...samples.map((s) => s.rendererPrivateMiB)) < 512,
      'Renderer-process private committed memory exceeds initial CPU budget',
    );
} finally {
  await writeFile(
    'test-results/memory/report.json',
    JSON.stringify(
      {
        browser: browser.version(),
        requestedSoakSeconds: seconds,
        samples,
        errors,
        scope:
          'Chrome headless 1440x1000 DPR1; actual 8-day colony. Twelve seconds at 6x, followed by paused simulation with active rendering/snapshots and camera movement. Windows private committed memory collected only for processes identified by this isolated browser CDP instance. Renderer processes include native runtime overhead; GPU process private memory is CPU commit, not dedicated VRAM. Working sets may share pages and must not be summed as unique physical usage. This is not a universal capacity or 60-minute soak guarantee.',
      },
      null,
      2,
    ),
  );
  await browser.close();
}
