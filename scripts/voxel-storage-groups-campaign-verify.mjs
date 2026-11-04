import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const OUT = process.env.VOXEL_STORAGE_GROUPS_OUT ?? 'test-results/voxel-storage-groups-campaign';
const input = process.env.VOXEL_STORAGE_GROUPS_INPUT ?? 'tests/fixtures/voxel-v37-before-storage-groups.json';
await mkdir(OUT, { recursive: true });
const bundle = await build({ stdin: {
  contents: "export {VoxelSimulation} from './src/voxel/world';export {at} from './src/voxel/types';export {shelfCells} from './src/voxel/shelves';",
  resolveDir: process.cwd(), loader: 'ts',
}, bundle: true, platform: 'node', format: 'esm', write: false });
const { VoxelSimulation, at, shelfCells } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const bytes = await readFile(input), original = JSON.parse(bytes);
assert.equal(original.version, 37, 'The ordinary-play input must remain its original v37 bytes');
assert.equal(original.shelves.length, 1, 'Resume the real one-shelf construction checkpoint');
let s = VoxelSimulation.load(original);
const initial = s.counts(), ledger = structuredClone(s.stats);
const report = {
  input, inputSha256: createHash('sha256').update(bytes).digest('hex'), inputVersion: original.version,
  scope: 'Resume an unchanged v37 ordinary-command shelf construction/hauling checkpoint. Mutations only through public commands, ticks and save/load; no injected terrain, actors, resources, needs or timers. Every simulated tick audits all resource balances and physical cell stack limits.',
  commands: [], checks: [], checkpoints: [],
};
const same = (a, b) => at(a) === at(b);
const groupFor = id => s.snapshot().storageGroups.find(group => group.memberIds.includes(id));
const shelfFor = id => s.shelves.find(shelf => shelf.id === id);
const stored = (id, resource) => {
  const shelf = shelfFor(id);
  return shelf ? s.items.filter(item => item.resource === resource && shelfCells(shelf).some(cell => same(cell, item)))
    .reduce((total, item) => total + item.amount, 0) : 0;
};
function audit() {
  const counts = s.counts();
  for (const resource of Object.keys(initial)) assert.equal(
    counts[resource] + s.stats.consumed[resource] - ledger.consumed[resource]
      + s.stats.spoiled[resource] - ledger.spoiled[resource]
      + s.stats.destroyed[resource] - ledger.destroyed[resource],
    initial[resource] + s.stats.produced[resource] - ledger.produced[resource], resource,
  );
  const cells = new Map();
  for (const item of s.items) cells.set(at(item), (cells.get(at(item)) ?? 0) + 1);
  for (const [cell, count] of cells) {
    const capacity = s.shelves.some(shelf => shelfCells(shelf).some(pos => at(pos) === cell))
      || s.storageSpills.some(pos => at(pos) === cell) ? 3 : 1;
    assert(count <= capacity, `physical stack overflow at ${cell}: ${count}/${capacity}`);
  }
  const allMembers = s.snapshot().storageGroups.flatMap(group => group.memberIds);
  assert.equal(new Set(allMembers).size, allMembers.length, 'A shelf must belong to at most one group');
}
function attempt(c) {
  const result = s.command(c); report.commands.push({ tick: s.tick, command: c, result }); audit(); return result;
}
function command(c) { const result = attempt(c); assert(result.ok, JSON.stringify({ c, result })); return result; }
function check(name, evidence = {}) { report.checks.push({ name, tick: s.tick, ...evidence }); console.log('PASS', name, s.tick); }
function until(name, done, max = 12000) {
  for (let n = 0; n < max && !done(); n++) { s.step(); audit(); }
  assert(done(), JSON.stringify({ name, tick: s.tick, jobs: s.jobs, pawns: s.pawns.map(p => ({ id: p.id, phase: p.phase, reason: p.reason, cargo: p.cargo })) }));
  check(name);
}
async function save(name) {
  const path = `${OUT}/${name}.json`, content = JSON.stringify(s.save());
  await writeFile(path, content);
  report.checkpoints.push({ name, path, tick: s.tick, sha256: createHash('sha256').update(content).digest('hex') });
}
function reload() { s = VoxelSimulation.load(s.save()); audit(); }
function sites() {
  const spawn = s.snapshot().spawn, choices = [];
  for (let y = spawn.y - 5; y <= spawn.y + 5; y++) for (let x = spawn.x - 5; x <= spawn.x + 5; x++) {
    const pos = { x, y, z: spawn.z };
    if (s.standable(pos) && !s.items.some(item => same(item, pos))
      && !s.shelves.some(shelf => shelfCells(shelf).some(cell => same(cell, pos)))
      && !s.stockpiles.some(stock => same(stock, pos))) choices.push(pos);
  }
  return choices.sort((a, b) => Math.abs(a.x - spawn.x) + Math.abs(a.y - spawn.y)
    - Math.abs(b.x - spawn.x) - Math.abs(b.y - spawn.y) || a.y - b.y || a.x - b.x);
}

command({ type: 'threats', enabled: false }); command({ type: 'fireHazards', enabled: false });
const first = s.shelves[0], firstId = first.id;
settings(firstId, 3, ['wood', 'food']);
// Existing ground stockpiles become the ordinary destination for excluded wood.
for (const stock of s.stockpiles) command({ type: 'storage', from: { x: stock.x, y: stock.y, z: stock.z },
  connected: false, priority: 1, accepts: ['wood'] });

let blueprint;
for (const pos of sites()) {
  const result = attempt({ type: 'designate', tool: 'smallShelf', from: pos, axis: 'x' });
  if (result.ok) { blueprint = s.jobs.find(job => job.kind === 'smallShelf' && same(job, pos)); break; }
}
assert(blueprint, 'There must be an ordinarily buildable small shelf site');
const secondId = blueprint.id, secondSite = { x: blueprint.x, y: blueprint.y, z: blueprint.z };
report.firstShelfId = firstId; report.secondShelfId = secondId; report.blueprintSite = secondSite;
settings(secondId, 0, ['steel']);
command({ type: 'shelfLink', sourceId: firstId, memberIds: [secondId] });
const groupId = groupFor(firstId).id; report.groupId = groupId;
command({ type: 'shelfGroupRename', groupId, name: '营地公共仓储' });
assert.deepEqual(groupFor(secondId).settings, { priority: 3, accepts: ['wood', 'food'] });
assert(groupFor(firstId).memberIds.includes(secondId));
await save('linked-blueprint'); reload();
assert.equal(groupFor(secondId).id, groupId);
check('a construction blueprint shares the source shelf rules and group after reload');
until('the linked small shelf is built by normal material delivery and work', () => !!shelfFor(secondId));
assert.equal(groupFor(secondId).id, groupId);
assert(s.storageSpace(shelfFor(secondId), { resource: 'wood' }) > 0);
until('the linked stores contain real wood and food', () => stored(firstId, 'wood') + stored(secondId, 'wood') > 0
  && stored(firstId, 'food') + stored(secondId, 'food') > 0);
await save('grouped');

const beforeFilter = structuredClone(s.items), woodBefore = s.counts().wood;
settings(secondId, 3, ['food']);
assert.deepEqual(s.items, beforeFilter, 'Changing rules cannot delete or teleport existing goods');
assert.equal(s.counts().wood, woodBefore);
assert.equal(s.storageSpace(shelfFor(firstId), { resource: 'wood' }), 0);
assert.equal(s.storageSpace(shelfFor(secondId), { resource: 'wood' }), 0);
until('editing one member causes excluded wood to be hauled from both shelves to ground storage', () =>
  stored(firstId, 'wood') + stored(secondId, 'wood') === 0
  && s.items.some(item => item.resource === 'wood' && s.stockpiles.some(stock => same(stock, item)))
  && !s.pawns.some(pawn => pawn.cargo?.resource === 'wood'));
await save('filtered');

command({ type: 'uninstallFurniture', kind: 'smallShelf', furnitureId: secondId });
const isPacked = () => [...s.items, ...s.pawns.flatMap(pawn => pawn.cargo ? [pawn.cargo] : []),
  ...s.jobs.flatMap(job => job.deliveredBatches)].some(batch => batch.furniture?.id === secondId);
until('the small shelf is uninstalled as the same physical group member', () => !shelfFor(secondId) && isPacked());
assert.equal(groupFor(secondId).id, groupId);
await save('packed'); reload();
settings(secondId, 2, ['wood', 'food']);
assert.deepEqual(groupFor(firstId).settings, { priority: 2, accepts: ['wood', 'food'] });
assert(s.storageCells().filter(cell => cell.shelfId === firstId).every(cell =>
  cell.priority === 2 && cell.accepts.includes('wood')));
check('editing the packed shelf after reload updates the remaining built member');

let installSite;
for (const pos of sites().filter(pos => Math.abs(pos.x - secondSite.x) + Math.abs(pos.y - secondSite.y) >= 4)) {
  if (attempt({ type: 'installFurniture', kind: 'smallShelf', furnitureId: secondId, target: pos, axis: 'y' }).ok) { installSite = pos; break; }
}
assert(installSite, 'There must be a reachable reinstall site away from the package');
report.installSite = installSite;
until('a colonist physically carries the linked shelf toward its new site', () => s.pawns.some(pawn => pawn.cargo?.furniture?.id === secondId));
await save('carried'); reload();
assert.equal(groupFor(secondId).id, groupId);
until('the original shelf is reinstalled at its new site after the mid-carry reload', () =>
  !!shelfFor(secondId) && same(shelfFor(secondId), installSite));
assert.deepEqual(groupFor(secondId).settings, { priority: 2, accepts: ['wood', 'food'] });
await save('reinstalled');

command({ type: 'shelfUnlink', shelfId: secondId });
assert.equal(s.snapshot().storageGroups.length, 0);
for (const id of [firstId, secondId]) assert.deepEqual(shelfFor(id).settings, { priority: 2, accepts: ['wood', 'food'] });
settings(firstId, 3, ['food']); settings(secondId, 3, ['wood']);
assert.equal(s.storageSpace(shelfFor(firstId), { resource: 'wood' }), 0);
assert.equal(s.storageSpace(shelfFor(secondId), { resource: 'food' }), 0);
until('unlinked shelves independently receive food and wood according to their separate rules', () =>
  stored(secondId, 'wood') === s.counts().wood && s.counts().wood > 0 && stored(firstId, 'food') > 0
  && stored(firstId, 'wood') === 0 && stored(secondId, 'food') === 0);
await save('final'); reload();
assert.equal(s.snapshot().storageGroups.length, 0);
assert.deepEqual(shelfFor(firstId).settings, { priority: 3, accepts: ['food'] });
assert.deepEqual(shelfFor(secondId).settings, { priority: 3, accepts: ['wood'] });
audit(); check('final reload keeps independent rules, stable shelf identities and the full resource ledger');
report.finalTick = s.tick; report.finalCounts = s.counts();
await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));

function settings(shelfId, priority, accepts) { command({ type: 'shelfStorage', shelfId, priority, accepts }); }
