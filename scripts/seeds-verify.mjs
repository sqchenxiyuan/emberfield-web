import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const seeds = [73129, 42, 2026, 7, 105, 999, 12345, 8675, 31415, 27182],
  results = [];
await mkdir('test-results/seeds', { recursive: true });
for (const seed of seeds) {
  const out = `test-results/seeds/${seed}`;
  const r = spawnSync(process.execPath, ['scripts/campaign-verify.mjs'], {
    env: { ...process.env, CAMPAIGN_SEED: String(seed), CAMPAIGN_OUT: out },
    encoding: 'utf8',
    timeout: 120000,
  });
  await writeFile(`${out}/stdout.txt`, r.stdout ?? '');
  await writeFile(`${out}/stderr.txt`, r.stderr ?? '');
  let report;
  try {
    report = JSON.parse(await readFile(`${out}/report.json`, 'utf8'));
  } catch {}
  const result = {
    seed,
    exitCode: r.status,
    outcome: report?.outcome ?? 'error',
    tick: report?.tick,
    people: report?.people,
    stats: report?.stats,
    error: r.error?.message,
  };
  results.push(result);
  console.log(JSON.stringify(result));
}
await writeFile(
  'test-results/seeds/report.json',
  JSON.stringify(
    {
      scope:
        'Ten fixed seeds with the same ordinary-command colony policy. Losses are recorded, not hidden by changing RNG or resources.',
      results,
    },
    null,
    2,
  ),
);
if (results.some((r) => r.outcome === 'error')) process.exitCode = 1;
