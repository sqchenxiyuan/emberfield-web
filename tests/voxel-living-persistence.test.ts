import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DAY, WIDTH } from '../src/voxel/types';
import { initialLiving, LIVING_RULES } from '../src/voxel/living';
import { migrateLiving, rejectLegacyLivingFields, validateLiving } from '../src/voxel/livingPersistence';

const HASHES: Record<string, string> = { leading: '110fa3b3d2e8f0a4458671d7760f07814462ef28ba2e46b0c56889d5e4d7a2bf',
  final: 'a9f91d6a5fc4a07e52db0c8119855232598c6785f85635c6854bde4d75014760' };
function legacy(name = 'leading') {
  const bytes = readFileSync(new URL(`./fixtures/voxel-v30-living-${name}.json`, import.meta.url));
  const proof = JSON.parse(readFileSync(new URL(`./fixtures/voxel-v30-living-${name}.provenance.json`, import.meta.url), 'utf8'));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(HASHES[name]); expect(proof.sha256).toBe(HASHES[name]);
  expect(proof.campaignExecution).toEqual({ bundleSha256: '6833990a9954416c205eb4a6432dd22be972be1f965d6816711ed09ba53786d2',
    scriptSha256: '20843d01b7fd0b79184b15373ffaeaa0198c1cfc99e71489e1ae2518c8229a42' });
  const d = JSON.parse(bytes.toString('utf8')); expect(d.version).toBe(30); return d;
}
function current() {
  const d = legacy(); migrateLiving(d, 30); d.version = 31;
  d.tables.push({ id: d.nextId++, x: 5, y: 5, z: 8, axis: 'x' });
  d.chairs.push({ id: d.nextId++, x: 5, y: 4, z: 8, axis: 'y' }); return d;
}
function dining() {
  const d = current(), p = d.pawns[0];
  Object.assign(p, { phase: 'dine', x: 5, y: 4, z: 8, eating: 'meal', cargo: { resource: 'meal', amount: 1 },
    dead: false, downed: false, drafted: false, carriedBy: null, carryingPawnId: null, jobId: null,
    carePhase: null, patientId: null, sleepingSince: null, sleepBedId: null, ropeTask: null, handleTask: null,
    wardenTask: null, cleanTask: null, firefightTask: null, repairTask: null, weaponTask: null, apparelTask: null,
    attackTargetId: null, shooting: null, path: [], destination: null });
  p.psyche.recreation = null; p.psyche.breakUntil = 0;
  p.living.mealTask = { stage: 'chew', chairId: d.chairs[0].id, tableId: d.tables[0].id,
    target: { x: 5, y: 4, z: 8 }, progress: 20, sourceId: null, amount: 1 };
  return { d, p, task: p.living.mealTask };
}

describe('authentic v30 source migration', () => {
  it.each(['leading', 'final'])('preserves every historical %s field while adding isolated empty living state', name => {
    const d = legacy(name), original = structuredClone(d); rejectLegacyLivingFields(d); migrateLiving(d, 30);
    expect(() => validateLiving(d)).not.toThrow(); const restored = structuredClone(d);
    expect(restored.tables).toEqual([]); expect(restored.chairs).toEqual([]);
    delete restored.tables; delete restored.chairs;
    for (const p of restored.pawns) { expect(p.living).toEqual(initialLiving()); delete p.living; }
    expect(restored).toEqual(original);
    if (name === 'leading') expect(d.pawns.some((p: any) => p.ropeTask?.stage === 'lead')).toBe(true);
  });
  it('rejects new furniture, thoughts and activities in old-version inputs before mutation', () => {
    const baseline = legacy();
    for (const change of [(d: any) => { d.tables = []; }, (d: any) => { d.chairs = []; },
      (d: any) => { d.pawns[0].living = initialLiving(); }, (d: any) => { d.pawns[0].phase = 'dine'; },
      (d: any) => { d.jobs.push({ kind: 'table' }); }, (d: any) => { d.fireDamage.push({ kind: 'chair' }); }]) {
      const d = structuredClone(baseline); change(d); const before = structuredClone(d);
      expect(() => rejectLegacyLivingFields(d)).toThrow(/旧版本包含新版/); expect(d).toEqual(before);
    }
    const broken = legacy(); broken.pawns.push(null); const before = structuredClone(broken);
    expect(() => migrateLiving(broken, 30)).toThrow(); expect(broken).toEqual(before);
  });
});

describe('living persistence contracts', () => {
  it('accepts seated and standing meals plus finite expired memories and paused sleep clocks', () => {
    const { d, p, task } = dining(); task.progress = 20.125; expect(() => validateLiving(d)).not.toThrow();
    task.chairId = null; expect(() => validateLiving(d)).not.toThrow();
    p.living.memories = [{ kind: 'ateWithoutTable', stage: 0, expires: 1 }];
    p.living.sleepThoughtAt = d.tick + DAY; expect(() => validateLiving(d)).not.toThrow();
  });
  it('rejects duplicate structures, footprint overlap, invalid dates and forged room caches', () => {
    for (const change of [(d: any) => { d.tables[0].id = d.pawns[0].id; },
      (d: any) => { d.tables[0].x = WIDTH - 1; },
      (d: any) => { Object.assign(d.chairs[0], { x: 6, y: 5 }); },
      (d: any) => { d.tables[0].impressiveness = 100; },
      (d: any) => { d.pawns[0].living.comfort = NaN; },
      (d: any) => { d.pawns[0].living.sleepThoughtAt = d.tick + DAY + 1; },
      (d: any) => { d.pawns[0].living.memories = [{ kind: 'diningRoom', stage: 1, expires: d.tick + DAY }]; },
      (d: any) => { d.pawns[0].living.memories = ['bedroom', 'barracks'].map(kind => ({ kind, stage: 6, expires: d.tick + DAY })); }]) {
      const d = current(); change(d); expect(() => validateLiving(d)).toThrow(/居住存档/);
    }
  });
  it('binds dining to actual food, exclusive work and a uniquely reserved adjacent seat', () => {
    for (const change of [({ p }: any) => { p.phase = 'idle'; }, ({ p }: any) => { p.ropeTask = {}; },
      ({ p }: any) => { p.cargo.resource = 'wood'; }, ({ task }: any) => { task.progress = LIVING_RULES.chewTicks; },
      ({ task }: any) => { task.amount = 2; }, ({ task }: any) => { task.tableId = null; },
      ({ task }: any) => { task.target.x++; }, ({ p }: any) => { p.path = [1]; },
      ({ d, p }: any) => { const second = structuredClone(p); second.id = d.nextId++; d.pawns.push(second); }]) {
      const value = dining(); change(value); expect(() => validateLiving(value.d)).toThrow(/居住存档/);
    }
  });
  it('supports blocked cargo ground meals without duplicating the reserved food', () => {
    const { d, p, task } = dining(); p.cargo = { resource: 'wood', amount: 2 };
    task.chairId = null; task.sourceId = d.nextId++;
    d.items.push({ id: task.sourceId, x: p.x, y: p.y, z: p.z, resource: 'meal', amount: 1 });
    expect(() => validateLiving(d)).not.toThrow();
    const second = structuredClone(p); second.id = d.nextId++; d.pawns.push(second);
    expect(() => validateLiving(d)).toThrow(/重复预约/);
    d.pawns.pop(); task.stage = 'travel'; task.progress = 0;
    expect(() => validateLiving(d)).toThrow(/原地用餐/);
  });
  it('combines dining, patient feeding and animal-handler fetches against one physical stack', () => {
    const { d, p, task } = dining(); p.cargo = { resource: 'wood', amount: 2 };
    task.chairId = null; task.sourceId = d.nextId++;
    const source = { id: task.sourceId, x: p.x, y: p.y, z: p.z, resource: 'meal', amount: 2 };
    d.items.push(source);
    // Other modules validate their task-specific data; this isolates the shared
    // physical stock budget that previously granted each subsystem a full copy.
    d.pawns[1].careFoodId = source.id; d.pawns[1].careAmount = 1;
    d.pawns[2].handleTask = { stage: 'fetch', foodId: source.id, amount: 1 };
    expect(() => validateLiving(d)).toThrow(/重复预约/);
    source.amount = 3; expect(() => validateLiving(d)).not.toThrow();
  });
});
