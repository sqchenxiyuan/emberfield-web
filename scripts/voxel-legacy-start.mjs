import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const LEGACY_START = {
  file: 'tests/fixtures/voxel-v7-start.json',
  sha256: '203b82e8cf07279f2090a9576131dc47182a2c8fdce838542ed05b6480969076',
  publishedCommit: '1e65ab00cf6b5b6f753bffa0154f7049f313bc1d',
  generator: 1,
  scope: 'Legacy-world continued-play regression. Generation-2 creation is verified separately.',
};

export async function loadLegacyStart(VoxelSimulation, seed = 73129) {
  assert.equal(
    seed,
    73129,
    'This historical coordinate campaign requires its original fixture seed',
  );
  const bytes = await readFile(new URL('../tests/fixtures/voxel-v7-start.json', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), LEGACY_START.sha256);
  const save = JSON.parse(bytes);
  assert.equal(save.version, 7);
  assert.equal(save.generator, 1);
  assert.equal(save.tick, 0);
  return VoxelSimulation.load(save);
}

export async function importLegacyStart(page) {
  const file = new URL('../tests/fixtures/voxel-v7-start.json', import.meta.url);
  const bytes = await readFile(file);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), LEGACY_START.sha256);
  const click = (name) => page.getByRole('button', { name, exact: true }).click();
  await click('菜单与存档');
  const chooser = page.waitForEvent('filechooser');
  await click('导入体素存档');
  await (
    await chooser
  ).setFiles({ name: 'voxel-v7-start.json', mimeType: 'application/json', buffer: bytes });
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.waitForFunction(
    () =>
      window.voxel.snapshot().snapshot.generator === 1 &&
      window.voxel.snapshot().snapshot.tick === 0,
  );
  await page.waitForTimeout(1000);
}
