import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { verifyVoxelTrade } from './verify-voxel-trade-validation.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const campaignFile = `${process.env.VOXEL_TRADE_OUT ?? 'test-results/voxel-trade-final'}/report.json`;
const browserFile = `${process.env.VOXEL_TRADE_BROWSER_OUT ?? 'test-results/voxel-trade-browser'}/report.json`;
const unitFile = 'test-results/v21-unit-accepted.json';
const campaign = json(campaignFile), browser = json(browserFile), unit = json(unitFile);
assert.equal(unit.success, true);
const evidence = {
  kind: 'web-runtime-validated', version: 21, frozenAt: new Date().toISOString(),
  source: { bundleSha256: campaign.execution.sha256, files: campaign.execution.sources },
  unit: { total: unit.numTotalTests, passed: unit.numPassedTests, failed: unit.numFailedTests,
    files: unit.testResults.length, exitCode: 0, report: unitFile,
    tests: unit.testResults.flatMap(f => f.assertionResults.map(t => ({ name: t.fullName, status: t.status }))) },
  campaign, browser,
  legacy: ['initial', 'working', 'carrying', 'combat', 'injured', 'recovered', 'scheduled'].map(name => {
    const file = `tests/fixtures/voxel-v20-trade-${name}.json`, provenance = file.replace('.json', '.provenance.json');
    const data = json(file), p = json(provenance);
    assert.equal(p.sha256, sha(readFileSync(file))); assert.equal(data.version, 20);
    return { name, file, provenance, sha256: p.sha256, tick: data.tick, version: data.version };
  }),
  reports: [campaignFile, browserFile, unitFile, 'test-results/v21-build-after-layout.log', 'test-results/v21-research-check.log']
    .map(file => ({ file, sha256: sha(readFileSync(file)) })),
  limitations: [
    'Native runtime is separate chapter 67; project tests do not prove original RimWorld behavior.',
    'One fixed seed, two natural arrivals and transactions with only the first caravan are not a statistical arrival, stock or combat distribution.',
    'Bulk/combat catalogs and fixed materials are supported subsets; goods are carried by a trader, without pack animals.',
    'No full faction diplomacy, Lord defensive state machine, NPC rations/rest AI, world-map trade or industrial medicine.',
    'Boundary tests inject controlled conditions; the ordinary campaign and DOM browser runs use no summons, clock edits or resource grants.',
    'Historical campaign script version assertions were updated; earlier published acceptance records are not v21 reruns.',
  ],
};
verifyVoxelTrade(evidence, true);
writeFileSync('docs/research/rimworld/evidence/voxel-trade-validation.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(`Frozen v21: ${evidence.unit.passed} local tests, ${campaign.checks.length} campaign checks, ${browser.modes.map(m => `${m.mode}:${m.checks.length}`).join(', ')}`);
