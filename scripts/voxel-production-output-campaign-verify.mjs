import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const OUT = process.env.VOXEL_PRODUCTION_OUTPUT_OUT ?? 'test-results/voxel-production-output-campaign';
const input = 'tests/fixtures/voxel-v41-working-before-output.json';
const sha = b => createHash('sha256').update(b).digest('hex');
const bytes = await readFile(input), provenance = JSON.parse(await readFile(input.replace('.json', '.provenance.json'), 'utf8'));
assert.equal(sha(bytes), provenance.sha256); assert.equal(JSON.parse(bytes).version, 41);
await mkdir(OUT, { recursive: true });
const bundle = await build({ entryPoints: ['src/voxel/world.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { VoxelSimulation } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
let s = VoxelSimulation.load(JSON.parse(bytes));
const initial = s.counts(), initialStats = structuredClone(s.stats);
const report = { status: 'running', input, inputSha256: sha(bytes), inputVersion: 41, inputTick: s.tick,
  scriptSha256: sha(await readFile(new URL(import.meta.url))), bundleSha256: sha(bundle.outputFiles[0].contents),
  scope: 'One continuous ordinary-command continuation of an unchanged SHA-verified v41 unfinished-production checkpoint. Read-only geometry/path/snapshots choose destinations; no terrain, inventory, skills, needs, RNG, position or timer injection. Audits every resource after every command, tick and reload.',
  commands: [], checks: [], checkpoints: [], targets: [] };
function audit() { const counts = s.counts(); for (const r of Object.keys(counts)) assert.equal(
  counts[r] + s.stats.consumed[r] - initialStats.consumed[r] + s.stats.destroyed[r] - initialStats.destroyed[r] + s.stats.spoiled[r] - initialStats.spoiled[r],
  initial[r] + s.stats.produced[r] - initialStats.produced[r], r); }
function command(c) { const result = s.command(c); report.commands.push({ tick: s.tick, command: c, result }); assert(result.ok, JSON.stringify({ c, result })); audit(); }
function check(name) { report.checks.push({ name, tick: s.tick }); console.log('PASS', name, s.tick); }
function until(name, done, max = 16000) { for (let i = 0; i < max && !done(); i++) { s.step(); audit(); }
  assert(done(), JSON.stringify({ name, jobs: s.jobs, pawns: s.pawns.map(p => ({ id: p.id, reason: p.reason, cargo: p.cargo })) })); check(name); }
async function save(name) { const data = JSON.stringify(s.save()), path = `${OUT}/${name}.json`; await writeFile(path, data); report.checkpoints.push({ name, path, sha256: sha(data), tick: s.tick }); }
const pawn = () => s.pawns.find(p => p.id === report.creatorId);
const bill = () => s.productionQueues.find(q => q.benchId === report.benchId).bills.find(b => b.id === report.billId);
const same = (a, b) => a.x === b.x && a.y === b.y && a.z === b.z;
const on = target => s.items.filter(i => same(i, target.pos) && i.resource === 'weapon').length;
function patch(patch) { command({ type: 'productionBillUpdate', benchId: report.benchId, billId: report.billId, patch }); }
function reload() { const cargo = structuredClone(pawn().cargo), task = structuredClone(pawn().productionDelivery);
  s = VoxelSimulation.load(s.save()); assert.deepEqual(pawn().cargo, cargo); assert.deepEqual(pawn().productionDelivery, task); audit(); }
function emptyCell(near, minDistance = 0, maxDistance = 24) {
  for (let dx = -12; dx <= 12; dx++) for (let dy = -12; dy <= 12; dy++) {
    const q = { x: near.x + dx, y: near.y + dy, z: near.z };
    const distance = Math.abs(dx) + Math.abs(dy);
    if (distance < minDistance || distance > maxDistance || !s.exploredAt(q) || !s.standable(q) || s.path(pawn(), q) === null) continue;
    if ([...s.items, ...s.stockpiles, ...s.shelves, ...s.trees, ...s.crops, ...s.beds, ...s.stoves, ...s.weaponBenches, ...s.jobs]
      .some(i => same(i, q))) continue;
    return q;
  }
  throw Error('No ordinary reachable empty ground cell');
}
function makeZone(name, priority) {
  const p = emptyCell(pawn(), 10); command({ type: 'designate', tool: 'stock', from: p });
  const zone = s.stockpileZones.find(z => z.cells.some(c => c === p.x + p.y * 64 + p.z * 64 * 64));
  assert(zone); command({ type: 'stockpileZoneRename', zoneId: zone.id, name });
  command({ type: 'storage', from: p, priority, accepts: ['weapon'] });
  const target = { target: { kind: 'stockpile', id: zone.id }, pos: p, name }; report.targets.push(target); return target;
}
try {
  const u = s.items.find(i => i.unfinished)?.unfinished; assert(u);
  report.creatorId = u.creatorId; report.billId = u.boundBillId;
  report.benchId = s.productionQueues.find(q => q.bills.some(b => b.id === report.billId)).benchId;
  assert.equal(bill().output.mode, 'drop'); check('v41 migration retains old output placement and unfinished item');
  for (const p of s.pawns.filter(p => p.faction === 'colony')) command({ type: 'priority', pawnId: p.id, work: 'haul', value: 0 });
  const specific = makeZone('成品仓库', 0), best = makeZone('高优先级仓库', 3);
  // Expanding by explicit identity preserves the destination even when the new
  // empty member is separate from the original cell.
  const extra = emptyCell(specific.pos, 1, 3); command({ type: 'designate', tool: 'stock', from: extra, zoneId: specific.target.id });
  command({ type: 'storage', from: extra, priority: 0, accepts: [] });
  report.expansion = extra;
  patch({ output: { mode: 'specific', target: specific.target }, policy: { ...bill().policy, ingredientRadius: null } });
  await save('specific-working');
  const made = s.stats.weaponsMade;
  until('producer carries completed output despite haul disabled', () => !!pawn().productionDelivery);
  assert.equal(s.stats.weaponsMade, made + 1); assert.equal(bill().remaining, 0);
  assert.deepEqual(pawn().productionDelivery.target, specific.target); assert.equal(on(specific), 0); assert.equal(on(best), 0);
  await save('specific-carrying'); reload(); check('carried product and completed bill survive reload');
  patch({ output: { mode: 'drop', target: null } });
  assert.deepEqual(pawn().productionDelivery.target, specific.target); check('editing next output does not retarget an existing delivery');
  until('specific low priority warehouse receives the product', () => on(specific) === 1 && !pawn().productionDelivery);
  await save('specific-delivered');
  patch({ remaining: 1 }); await save('drop-working');
  until('Drop completes exactly once without delivery', () => s.stats.weaponsMade === made + 2);
  assert(!pawn().productionDelivery); assert.equal(on(specific), 1); assert.equal(on(best), 0);
  await save('drop-completed');
  patch({ remaining: 1, output: { mode: 'best', target: null } });
  until('Best chooses the higher priority warehouse', () => !!pawn().productionDelivery);
  assert.equal(pawn().productionDelivery.cell, best.pos.x + best.pos.y * 64 + best.pos.z * 64 * 64);
  await save('best-carrying');
  until('Best physically delivers', () => on(best) === 1 && !pawn().productionDelivery);
  await save('best-delivered');
  // Clear the first product's storage designation while preserving the physical
  // weapon; the bill loses its target, not its completed count or goods.
  patch({ output: { mode: 'specific', target: specific.target } });
  command({ type: 'designate', tool: 'clearZone', from: specific.pos });
  assert.equal(bill().output.mode, 'specific');
  command({ type: 'designate', tool: 'clearZone', from: extra });
  assert.equal(bill().output.mode, 'drop'); assert.equal(bill().remaining, 0);
  check('zone survives partial erasure and resets output only after final member deletion');
  reload(); await save('final'); check('all resources remain balanced after all three output modes');
  report.status = 'passed'; report.finalTick = s.tick; report.successfulCommands = report.commands.filter(c => c.result.ok).length;
} catch (error) { report.status = 'failed'; report.error = String(error?.stack ?? error); throw error; }
finally { await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2)); }
