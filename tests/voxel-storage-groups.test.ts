import { stripUnfinishedFields, unfinishedExpectedField } from './legacy-unfinished-defaults';
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { VoxelSimulation } from '../src/voxel/world';
import { Block, at, index, type Counts, type Pos, type Resource, type VoxelCommand } from '../src/voxel/types';
import { defaultShelfSettings, shelfCells } from '../src/voxel/shelves';
import { freshBatch } from '../src/voxel/preservation';
import { fireDamageKey } from '../src/voxel/fire';
import { storageGroupCommand, type StorageGroup } from '../src/voxel/storageGroups';

const pos = (x: number, y = 16, z = 8): Pos => ({ x, y, z });
const same = (a: Pos, b: Pos) => at(a) === at(b);
function command(s: VoxelSimulation, c: VoxelCommand) {
  const result = s.command(c);
  expect(result.ok, JSON.stringify({ c, result })).toBe(true);
  return result;
}
function fixture(count = 2, upper = false) {
  const s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 }, false, 2);
  s.animals = []; s.grass = []; s.items = []; s.trees = []; s.stockpiles = []; s.homeArea.clear();
  s.blocks.fill(Block.Stone); s.ladders.fill(0); s.structureKinds.fill(0);
  for (let x = 10; x <= 30; x++) for (let y = 12; y <= 23; y++) {
    for (const z of upper ? [8, 9, 11, 12] : [8, 9]) s.blocks[index(x, y, z)] = Block.Air;
  }
  if (upper) for (let z = 8; z <= 12; z++) {
    s.blocks[index(14, 18, z)] = Block.Air;
    if (z < 12) s.ladders[index(14, 18, z)] = 1;
  }
  s.spawn = pos(12);
  for (const [i, pawn] of s.pawns.entries()) {
    Object.assign(pawn, pos(12, 16 + i)); pawn.schedule.fill('work'); pawn.food = 95; pawn.rest = 95;
    for (const work of Object.keys(pawn.priorities) as (keyof typeof pawn.priorities)[]) pawn.priorities[work] = 0;
  }
  for (let i = 0; i < count; i++) s.shelves.push({ ...pos(15 + i * 3, 16, upper && i === 1 ? 11 : 8),
    id: s.nextId++, kind: 'smallShelf', axis: 'x', settings: defaultShelfSettings() });
  command(s, { type: 'threats', enabled: false }); command(s, { type: 'fireHazards', enabled: false });
  return VoxelSimulation.load(s.save());
}
function item(s: VoxelSimulation, resource: Resource, amount: number, p = pos(28, 21)) {
  const value = { x: p.x, y: p.y, z: p.z, ...freshBatch(resource, amount), id: s.nextId++ };
  s.items.push(value); return value;
}
const baseline = (s: VoxelSimulation) => ({ counts: s.counts(), stats: structuredClone(s.stats) });
function audit(s: VoxelSimulation, before: ReturnType<typeof baseline>) {
  const counts = s.counts();
  for (const resource of Object.keys(counts) as (keyof Counts)[]) {
    expect(counts[resource] + s.stats.consumed[resource] - before.stats.consumed[resource]
      + s.stats.spoiled[resource] - before.stats.spoiled[resource]
      + s.stats.destroyed[resource] - before.stats.destroyed[resource], resource)
      .toBe(before.counts[resource] + s.stats.produced[resource] - before.stats.produced[resource]);
  }
}
function until(s: VoxelSimulation, done: () => boolean, before?: ReturnType<typeof baseline>, max = 4000) {
  for (let tick = 0; tick < max && !done(); tick++) { s.step(); if (before) audit(s, before); }
  expect(done(), JSON.stringify({ tick: s.tick, jobs: s.jobs, pawns: s.pawns.map(p => ({ phase: p.phase, reason: p.reason, cargo: p.cargo })) })).toBe(true);
}
const onShelf = (s: VoxelSimulation, id: number, resource: Resource) => {
  const shelf = s.shelves.find(value => value.id === id);
  return shelf ? s.items.filter(value => value.resource === resource && shelfCells(shelf).some(cell => same(cell, value)))
    .reduce((total, value) => total + value.amount, 0) : 0;
};
const groupFor = (s: VoxelSimulation, id: number) => s.snapshot().storageGroups.find(group => group.memberIds.includes(id));
const settings = (s: VoxelSimulation, shelfId: number, priority: number, accepts: Resource[]) => command(s, { type: 'shelfStorage', shelfId, priority, accepts });

describe('linked shelf storage gameplay', () => {
  it('rejects a command that would make an existing group exceed the save member limit without partial migration', () => {
    const shelves = Array.from({length:1025}, (_, i) => ({...pos(15), id:i+1,
      kind:'smallShelf' as const, axis:'x' as const, settings:defaultShelfSettings()}));
    const storageGroups:StorageGroup[]=[{id:1026,name:'容量边界',memberIds:shelves.slice(0,1024).map(s=>s.id),settings:defaultShelfSettings()}];
    const host={shelves,storageGroups,items:[],jobs:[],pawns:[],nextId:1027};
    const before=structuredClone(host);
    expect(storageGroupCommand(host,{type:'shelfLink',sourceId:1,memberIds:[1025]})?.ok).toBe(false);
    expect(host).toEqual(before);
  });
  it('hauls into the linked higher-priority stores, then moves excluded goods after editing another member', () => {
    const s = fixture(3), [a, b, fallback] = s.shelves;
    settings(s, a.id, 3, ['wood']); settings(s, b.id, 0, ['steel']); settings(s, fallback.id, 1, ['wood']);
    command(s, { type: 'shelfLink', sourceId: a.id, memberIds: [b.id] });
    item(s, 'wood', 30); const before = baseline(s); s.pawns[0].priorities.haul = 1;
    until(s, () => onShelf(s, a.id, 'wood') + onShelf(s, b.id, 'wood') === 30, before);
    expect(onShelf(s, fallback.id, 'wood')).toBe(0);
    const physical = structuredClone(s.items);
    settings(s, b.id, 3, ['steel']);
    expect(s.items).toEqual(physical);
    expect(s.storageSpace(a, { resource: 'wood' })).toBe(0);
    expect(s.storageSpace(b, { resource: 'wood' })).toBe(0);
    until(s, () => onShelf(s, fallback.id, 'wood') === 30, before);
    expect(s.counts().wood).toBe(30);
  });

  it('invalidates a linked destination reservation while retaining and rerouting the physical carried batch', () => {
    const s = fixture(3), [a, b, fallback] = s.shelves;
    settings(s, a.id, 3, ['wood']); settings(s, fallback.id, 1, ['wood']);
    command(s, { type: 'shelfLink', sourceId: a.id, memberIds: [b.id] });
    item(s, 'wood', 40); const before = baseline(s); s.pawns[0].priorities.haul = 1;
    until(s, () => s.pawns.some(p => p.cargo?.resource === 'wood') && s.snapshot().storageCapacity
      .some(cell => [a.id, b.id].includes(cell.shelfId!) && cell.reserved > 0), before);
    const cargo = structuredClone(s.pawns.find(p => p.cargo?.resource === 'wood')!.cargo);
    settings(s, b.id, 3, ['steel']);
    expect(s.pawns.find(p => p.cargo?.resource === 'wood')?.cargo).toEqual(cargo);
    expect(s.snapshot().storageCapacity.filter(cell => [a.id, b.id].includes(cell.shelfId!)).every(cell => cell.reserved === 0)).toBe(true);
    until(s, () => onShelf(s, fallback.id, 'wood') === 40, before);
    expect(s.counts().wood).toBe(40);
  });

  it('moves only the selected member between groups and leaves the rest of its original group effective', () => {
    const s = fixture(5), [a, b, c, d, e] = s.shelves;
    settings(s, a.id, 3, ['wood']); settings(s, d.id, 2, ['steel']);
    command(s, { type: 'shelfLink', sourceId: a.id, memberIds: [b.id, c.id] });
    command(s, { type: 'shelfLink', sourceId: d.id, memberIds: [e.id] });
    const oldGroupId = groupFor(s, a.id)!.id, destinationGroupId = groupFor(s, d.id)!.id;
    command(s, { type: 'shelfLink', sourceId: d.id, memberIds: [b.id] });
    expect(groupFor(s, a.id)).toMatchObject({ id: oldGroupId, settings: { priority: 3, accepts: ['wood'] } });
    expect(groupFor(s, a.id)!.memberIds.slice().sort()).toEqual([a.id, c.id].sort());
    expect(groupFor(s, b.id)!.id).toBe(destinationGroupId);
    expect(groupFor(s, b.id)!.memberIds.slice().sort()).toEqual([b.id, d.id, e.id].sort());
    for (const shelf of [a, c]) { expect(s.storageSpace(shelf, { resource: 'wood' })).toBeGreaterThan(0); expect(s.storageSpace(shelf, { resource: 'steel' })).toBe(0); }
    for (const shelf of [b, d, e]) { expect(s.storageSpace(shelf, { resource: 'wood' })).toBe(0); expect(s.storageSpace(shelf, { resource: 'steel' })).toBeGreaterThan(0); }
    expect(VoxelSimulation.load(s.save()).snapshot().storageGroups).toEqual(s.snapshot().storageGroups);
  });

  it('preserves the effective rules on both shelves when a two-member group is unlinked', () => {
    const s = fixture(), [a, b] = s.shelves;
    settings(s, a.id, 3, ['wood']); settings(s, b.id, 0, ['steel']);
    command(s, { type: 'shelfLink', sourceId: a.id, memberIds: [b.id] });
    command(s, { type: 'shelfUnlink', shelfId: a.id });
    expect(s.snapshot().storageGroups).toEqual([]);
    expect(s.shelves.map(shelf => shelf.settings)).toEqual([{ priority: 3, accepts: ['wood'] }, { priority: 3, accepts: ['wood'] }]);
    settings(s, a.id, 0, ['steel']);
    item(s, 'wood', 20); const before = baseline(s); s.pawns[0].priorities.haul = 1;
    until(s, () => onShelf(s, b.id, 'wood') === 20, before);
    expect(onShelf(s, a.id, 'wood')).toBe(0);
    expect(s.shelves.find(shelf => shelf.id === b.id)!.settings).toEqual({ priority: 3, accepts: ['wood'] });
  });

  it('inherits shared rules from a blueprint through real delivery, construction and subsequent hauling', () => {
    let s = fixture(1); const id = s.shelves[0].id;
    settings(s, id, 3, ['steel']); item(s, 'wood', 25); item(s, 'steel', 35, pos(28, 20));
    const before = baseline(s);
    command(s, { type: 'designate', tool: 'smallShelf', from: pos(23), axis: 'x' });
    const blueprintId = s.jobs.find(job => job.kind === 'smallShelf')!.id;
    settings(s, blueprintId, 0, ['grain']);
    command(s, { type: 'shelfLink', sourceId: id, memberIds: [blueprintId] });
    const linked = structuredClone(s.snapshot().storageGroups);
    s = VoxelSimulation.load(s.save()); expect(s.snapshot().storageGroups).toEqual(linked);
    s.pawns[0].priorities.build = 1; s.pawns[0].priorities.haul = 2;
    until(s, () => s.shelves.some(shelf => shelf.id === blueprintId), before);
    expect(s.shelves.find(shelf => shelf.id === blueprintId)).not.toHaveProperty('quality');
    expect(groupFor(s, blueprintId)!.memberIds).toContain(id);
    expect(s.storageSpace(pos(23), { resource: 'grain' })).toBe(0);
    expect(s.storageSpace(pos(23), { resource: 'steel' })).toBeGreaterThan(0);
    until(s, () => onShelf(s, id, 'steel') + onShelf(s, blueprintId, 'steel') === 35, before);
    expect(s.stats.consumed.wood - before.stats.consumed.wood).toBe(25);
  });

  it('links across floors and physically hauls to the upstairs member when the lower shelf is full', () => {
    let s = fixture(2, true); const [a, b] = s.shelves;
    settings(s, a.id, 3, ['steel']); command(s, { type: 'shelfLink', sourceId: a.id, memberIds: [b.id] });
    for (let i = 0; i < 3; i++) item(s, 'steel', 75, a);
    item(s, 'steel', 25); const before = baseline(s);
    s = VoxelSimulation.load(s.save()); s.pawns[0].priorities.haul = 1;
    until(s, () => onShelf(s, b.id, 'steel') === 25, before);
    expect(onShelf(s, a.id, 'steel')).toBe(225);
    expect(s.items.find(value => value.resource === 'steel' && same(value, b))!.z).toBe(11);
    expect(VoxelSimulation.load(s.save()).snapshot().storageGroups).toEqual(s.snapshot().storageGroups);
  });

  it('keeps group membership while a shelf is uninstalled, carried, saved and reinstalled', () => {
    let s = fixture(); const [a, b] = s.shelves;
    settings(s, a.id, 3, ['steel']); command(s, { type: 'shelfLink', sourceId: a.id, memberIds: [b.id] });
    item(s, 'steel', 30, a); const before = baseline(s); s.pawns[0].priorities.build = 1;
    command(s, { type: 'installFurniture', kind: 'smallShelf', furnitureId: a.id, target: pos(27, 20), axis: 'y' });
    until(s, () => s.pawns.some(pawn => pawn.cargo?.furniture?.id === a.id), before);
    expect(s.shelves.some(shelf => shelf.id === a.id)).toBe(false);
    expect(groupFor(s, a.id)?.memberIds).toContain(b.id);
    s = VoxelSimulation.load(s.save()); audit(s, before);
    settings(s, a.id, 1, ['wood']);
    expect(s.storageSpace(b, { resource: 'steel' })).toBe(0);
    expect(s.storageSpace(b, { resource: 'wood' })).toBeGreaterThan(0);
    until(s, () => s.shelves.some(shelf => shelf.id === a.id && same(shelf, pos(27, 20))), before);
    expect(groupFor(s, a.id)?.settings).toEqual({ priority: 1, accepts: ['wood'] });
    expect(s.storageSpace(pos(27, 20), { resource: 'steel' })).toBe(0);
    expect(s.counts().steel).toBe(30);
    expect(VoxelSimulation.load(s.save()).snapshot().storageGroups).toEqual(s.snapshot().storageGroups);
  });

  it('removes destroyed members immediately and preserves the last survivors current shared rules', () => {
    const s = fixture(3), [a, b, c] = s.shelves;
    settings(s, a.id, 3, ['wood']); command(s, { type: 'shelfLink', sourceId: a.id, memberIds: [b.id, c.id] });
    item(s, 'wood', 30, a); const before = baseline(s);
    const destroy = (shelf: typeof a) => expect(s.fireDestroy({ ...shelf, kind: shelf.kind, targetId: shelf.id,
      key: fireDamageKey(shelf.kind, shelf.id, shelf), hitPoints: 1, maxHitPoints: 100 }, 'storage group test fire')).toBe(true);
    destroy(a); audit(s, before);
    expect(groupFor(s, b.id)!.memberIds.slice().sort()).toEqual([b.id, c.id].sort());
    destroy(b); audit(s, before);
    expect(s.snapshot().storageGroups).toEqual([]);
    expect(s.shelves.find(shelf => shelf.id === c.id)!.settings).toEqual({ priority: 3, accepts: ['wood'] });
    s.pawns[0].priorities.haul = 1;
    until(s, () => onShelf(s, c.id, 'wood') === 30, before);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('cleans cancelled blueprints from their group without reverting the surviving shelf rules', () => {
    const s = fixture(1), a = s.shelves[0]; settings(s, a.id, 3, ['steel']);
    command(s, { type: 'designate', tool: 'smallShelf', from: pos(23) });
    const id = s.jobs.find(job => job.kind === 'smallShelf')!.id;
    command(s, { type: 'shelfLink', sourceId: a.id, memberIds: [id] });
    settings(s, id, 2, ['wood']); command(s, { type: 'designate', tool: 'cancel', from: pos(23) });
    expect(s.snapshot().storageGroups).toEqual([]);
    expect(s.shelves[0].settings).toEqual({ priority: 2, accepts: ['wood'] });
    expect(s.command({ type: 'shelfStorage', shelfId: id, priority: 3, accepts: ['wood'] }).ok).toBe(false);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('renames a group and rejects invalid editing commands without altering members or physical goods', () => {
    const s = fixture(), [a, b] = s.shelves;
    command(s, { type: 'shelfLink', sourceId: a.id, memberIds: [b.id] });
    const groupId = groupFor(s, a.id)!.id;
    command(s, { type: 'shelfGroupRename', groupId, name: '建筑材料库' });
    expect(groupFor(s, b.id)?.name).toBe('建筑材料库');
    for (const c of [
      { type: 'shelfLink', sourceId: a.id, memberIds: [] },
      { type: 'shelfLink', sourceId: a.id, memberIds: [a.id] },
      { type: 'shelfLink', sourceId: a.id, memberIds: [b.id, b.id] },
      { type: 'shelfLink', sourceId: a.id, memberIds: [9999999] },
      { type: 'shelfGroupRename', groupId, name: '' },
      { type: 'shelfGroupRename', groupId, name: ' '.repeat(3) },
      { type: 'shelfGroupRename', groupId, name: 'a'.repeat(41) },
      { type: 'shelfGroupRename', groupId: 9999999, name: '不存在' },
      { type: 'shelfStorage', shelfId: a.id, priority: 4, accepts: ['wood'] },
      { type: 'shelfStorage', shelfId: a.id, priority: 3, accepts: ['wood', 'wood'] },
      { type: 'shelfStorage', shelfId: a.id, priority: 3, accepts: ['chunk'] },
    ] as VoxelCommand[]) {
      const before = s.save(); expect(s.command(c).ok, JSON.stringify(c)).toBe(false); expect(s.save()).toEqual(before);
    }
  });

  it('migrates the actual v37 shelf checkpoint while retaining its original terrain, inventory and shelf identity', () => {
    const bytes = readFileSync(new URL('./fixtures/voxel-v37-before-storage-groups.json', import.meta.url));
    const proof = JSON.parse(readFileSync(new URL('./fixtures/voxel-v37-before-storage-groups.provenance.json', import.meta.url), 'utf8'));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(proof.sha256);
    const old = JSON.parse(bytes.toString()), original = structuredClone(old);
    expect(old.version).toBe(37); expect(old.storageGroups).toBeUndefined();
    const s = VoxelSimulation.load(old), saved = s.save();
    expect(saved.version).toBe(56); expect(saved.storageGroups).toEqual([]); expect(old).toEqual(original);
    for (const key of ['blocks', 'ladders', 'items', 'stats', 'explored', 'generator', 'worldSite', 'seed', 'shelves'])
      expect((saved as any)[key], key).toEqual(unfinishedExpectedField(key, old[key]));
    command(s, { type: 'designate', tool: 'smallShelf', from: pos(30, 29) });
    const blueprint = s.jobs.find(job => job.kind === 'smallShelf')!;
    expect(blueprint.storageSettings).toEqual(defaultShelfSettings());
    s.step(20); expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('rejects corrupted group records, conflicting identities and downgraded linked saves', () => {
    const s = fixture(3), [a, b, c] = s.shelves;
    command(s, { type: 'shelfLink', sourceId: a.id, memberIds: [b.id] });
    const base = s.save();
    const mutations: [string, (data: any) => void][] = [
      ['negative id', data => { data.storageGroups[0].id = -1; }],
      ['fractional id', data => { data.storageGroups[0].id = 1.5; }],
      ['entity id collision', data => { data.storageGroups[0].id = a.id; }],
      ['duplicate group id', data => { data.storageGroups.push(structuredClone(data.storageGroups[0])); }],
      ['missing member', data => { data.storageGroups[0].memberIds[1] = 9999999; }],
      ['duplicate member', data => { data.storageGroups[0].memberIds.push(a.id); }],
      ['single member', data => { data.storageGroups[0].memberIds = [a.id]; }],
      ['member in two groups', data => { data.storageGroups.push({ ...structuredClone(data.storageGroups[0]), id: data.nextId++, memberIds: [b.id, c.id] }); }],
      ['empty name', data => { data.storageGroups[0].name = ''; }],
      ['too long name', data => { data.storageGroups[0].name = 'a'.repeat(41); }],
      ['invalid priority', data => { data.storageGroups[0].settings.priority = 4; }],
      ['invalid resource', data => { data.storageGroups[0].settings.accepts = ['chunk']; }],
      ['duplicate filters', data => { data.storageGroups[0].settings.accepts = ['wood', 'wood']; }],
      ['downgrade to v37', data => { stripUnfinishedFields(data); data.version = 37; }],
    ];
    for (const [name, mutate] of mutations) {
      const data = structuredClone(base); mutate(data); expect(() => VoxelSimulation.load(data), name).toThrow();
    }
  });
});
