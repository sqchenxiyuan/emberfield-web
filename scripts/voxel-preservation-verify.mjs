import { spawnSync } from 'node:child_process';
// Separate output preserves the standalone electrical campaign's provenance.
for (const [script, args, env] of [
  [
    'scripts/voxel-power-campaign-verify.mjs',
    ['--prepare-food'],
    { VOXEL_POWER_CAMPAIGN_OUT: 'test-results/voxel-preservation-power' },
  ],
  [
    'scripts/voxel-preservation-campaign-verify.mjs',
    [],
    { VOXEL_PRESERVATION_SOURCE: 'test-results/voxel-preservation-power/final.json' },
  ],
]) {
  const result = spawnSync(process.execPath, [script, ...args], {
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
