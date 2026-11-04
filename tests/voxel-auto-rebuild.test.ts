import { stripAutoSlaughterFields } from './legacy-auto-rebuild-defaults';
import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { Block, at, index, position, type Pawn, type Pos, type Projectile, type Resource, type VoxelCommand } from '../src/voxel/types';
import { FIRE_MAX_HP, fireDamageKey, fireDamageBurning, type BurnTargetKind } from '../src/voxel/fire';
import { freshBatch } from '../src/voxel/preservation';
import { LIVING_BUILDINGS } from '../src/voxel/living';
import { defaultShelfSettings, SHELF_DEFS } from '../src/voxel/shelves';
import { fireFuelAt, frameDamageTarget, igniteFire, updateFires } from '../src/voxel/fireWorld';
import { SANDBAG_COST, SANDBAG_HP } from '../src/voxel/weaponProduction';

const pos = (x: number, y = 16, z = 8): Pos => ({ x, y, z });
function command(s: VoxelSimulation, c: VoxelCommand) {
  const result = s.command(c); expect(result.ok, JSON.stringify({ c, result })).toBe(true); return result;
}
function until(s: VoxelSimulation, done: () => boolean, limit = 3500) {
  for (let n = 0; n < limit && !done(); n++) s.step();
  expect(done(), JSON.stringify({ tick: s.tick, jobs: s.jobs,
    pawns: s.pawns.map(p => ({ phase: p.phase, reason: p.reason, cargo: p.cargo, jobId: p.jobId })) })).toBe(true);
}
/** Controlled geometry and deliberate destruction isolate simulation boundaries.
 * They are not native gameplay, browser interaction or a natural incident run. */
function fixture(configure?: (s: VoxelSimulation) => void) {
  const s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 }, false, 2);
  s.animals = []; s.grass = []; s.trees = []; s.items = []; s.stockpiles = []; s.homeArea.clear();
  s.blocks.fill(Block.Stone); s.ladders.fill(0); s.structureKinds.fill(0);
  for (let x = 10; x <= 30; x++) for (let y = 10; y <= 24; y++)
    for (let z = 8; z <= 14; z++) s.blocks[index(x, y, z)] = Block.Air;
  s.spawn = pos(12);
  for (const [n, p] of s.pawns.entries()) {
    Object.assign(p, pos(12, 16 + n)); p.food = 95; p.rest = 95; p.schedule.fill('work');
    for (const work of Object.keys(p.priorities)) p.priorities[work as keyof Pawn['priorities']] = 0;
  }
  configure?.(s);
  command(s, { type: 'threats', enabled: false }); command(s, { type: 'fireHazards', enabled: false });
  return VoxelSimulation.load(s.save());
}
function item(s: VoxelSimulation, resource: Resource, amount: number, point = pos(25, 21)) {
  const result = { x: point.x, y: point.y, z: point.z, ...freshBatch(resource, amount), id: s.nextId++ }; s.items.push(result); return result;
}
function chair(s: VoxelSimulation, point = pos(18)) {
  const result = { ...point, id: s.nextId++, axis: 'y' as const, quality: 6 as const }; s.chairs.push(result); return result;
}
function destroy(s: VoxelSimulation, kind: BurnTargetKind, point: Pos, id: number | null = null) {
  const damage = { ...point, kind, targetId: id, key: fireDamageKey(kind, id, point), hitPoints: 1, maxHitPoints: FIRE_MAX_HP[kind] };
  expect(s.fireDestroy(damage, 'controlled auto-rebuild destruction')).toBe(true); return damage;
}
function enable(s: VoxelSimulation, point: Pos) {
  command(s, { type: 'autoRebuild', enabled: true }); command(s, { type: 'homeArea', from: point, enabled: true });
}
function build(s: VoxelSimulation) { command(s, { type: 'priority', pawnId: s.pawns[0].id, work: 'build', value: 1 }); }

describe('automatic rebuilding after destruction', () => {
  it('treats fire above a wall upper block as burning the same wall in both model and UI snapshots', () => {
    const base=pos(18), upper=pos(18,16,9), top=pos(18,16,10);
    const s=fixture(s => {
      s.blocks[at(base)]=s.blocks[at(upper)]=Block.Wood;
      s.structureKinds[at(base)]=2; s.structureKinds[at(upper)]=3;
    });
    enable(s,base);
    const damage={...base,kind:'block' as const,targetId:null,key:fireDamageKey('block',null,base),hitPoints:50,maxHitPoints:FIRE_MAX_HP.block};
    s.fireDamage.push(damage);
    expect(igniteFire(s,top,'lightning')).not.toBeNull();
    expect(fireFuelAt(s,top).some(t=>t.damage?.key===damage.key)).toBe(true);
    expect(fireDamageBurning(damage,s.fires,s)).toBe(true);
    const snapshot=s.snapshot(); expect(fireDamageBurning(damage,snapshot.fires,snapshot)).toBe(true);
    expect(s.command({type:'repair',pawnId:s.pawns[0].id,damageKey:damage.key}).ok).toBe(false);
    const loaded=VoxelSimulation.load(s.save()); expect(loaded.fireDamage).toEqual(s.fireDamage);
    expect(fireDamageBurning(loaded.fireDamage[0],loaded.fires,loaded)).toBe(true);
  });
  it('starts disabled, persists the switch and strictly validates commands and current saves', () => {
    const s = fixture(); expect(s.snapshot().autoRebuild).toBe(false); expect(s.save().autoRebuild).toBe(false);
    command(s, { type: 'autoRebuild', enabled: true });
    expect(VoxelSimulation.load(s.save()).snapshot().autoRebuild).toBe(true);
    expect(s.command({ type: 'autoRebuild', enabled: 'yes' as unknown as boolean }).ok).toBe(false);
    expect(s.snapshot().autoRebuild).toBe(true);
    const bad = s.save(); bad.autoRebuild = 'yes' as unknown as boolean;
    expect(() => VoxelSimulation.load(bad)).toThrow();
    command(s, { type: 'autoRebuild', enabled: false }); expect(VoxelSimulation.load(s.save()).autoRebuild).toBe(false);
  });

  it('migrates a synthetic v45-compatible save with auto-rebuild disabled without changing physical state', () => {
    const s = fixture(), old = s.save();
    const synthetic = structuredClone(old) as Omit<typeof old, 'version' | 'autoRebuild'> & { version: number; autoRebuild?: boolean };
    synthetic.version = 45; stripAutoSlaughterFields(synthetic); delete synthetic.autoRebuild;
    const before = structuredClone(synthetic), loaded = VoxelSimulation.load(synthetic);
    expect(loaded.save().version).toBe(57); expect(loaded.autoRebuild).toBe(false); expect(synthetic).toEqual(before);
    for (const key of ['blocks', 'items', 'stats', 'tick', 'chairs', 'homeArea'] as const) expect(loaded.save()[key]).toEqual(old[key]);
    // The separately frozen v45 implementation samples are checked by the release verifier.
  });

  it('rejects missing or non-boolean current settings and refuses v45 saves carrying the new flag', () => {
    const saved = fixture().save(); expect(saved.version).toBe(57);
    const missing: Partial<typeof saved> = structuredClone(saved); delete missing.autoRebuild;
    expect(() => VoxelSimulation.load(missing)).toThrow(/自动重建设置无效/);
    for (const value of [undefined, null, 0, 1, 'true', {}, []]) {
      const malformed = { ...saved, autoRebuild: value };
      expect(() => VoxelSimulation.load(malformed), `malformed autoRebuild ${JSON.stringify(value)}`).toThrow(/自动重建设置无效/);
    }
    for (const enabled of [true, false]) {
      const downgraded = { ...saved, version: 45, autoRebuild: enabled }; stripAutoSlaughterFields(downgraded); const before = structuredClone(downgraded);
      expect(() => VoxelSimulation.load(downgraded)).toThrow(/旧版本存档混入自动重建/); expect(downgraded).toEqual(before);
    }
  });

  it.each([{ on: false, home: true }, { on: true, home: false }, { on: true, home: true }])(
    'requires the switch and Home at destruction: $on / $home', ({ on, home }) => {
      const s = fixture(s => { chair(s); }), original = s.chairs[0];
      command(s, { type: 'autoRebuild', enabled: on });
      if (home) command(s, { type: 'homeArea', from: original, enabled: true });
      const before = s.counts(), damage = destroy(s, 'chair', original, original.id);
      expect(s.chairs).toHaveLength(0); expect(s.counts()).toEqual(before); expect(s.stats.produced.wood).toBe(0);
      expect(s.jobs.filter(j => j.kind === 'chair')).toHaveLength(on && home ? 1 : 0);
      expect(s.fireDestroy(damage, 'duplicate destruction receipt')).toBe(true);
      expect(s.jobs.filter(j => j.kind === 'chair')).toHaveLength(on && home ? 1 : 0);
      if (on && home) {
        const planned = structuredClone(s.jobs[0]); command(s, { type: 'autoRebuild', enabled: false });
        expect(s.jobs).toEqual([planned]); command(s, { type: 'designate', tool: 'cancel', from: original });
        command(s, { type: 'autoRebuild', enabled: true }); s.step(20); expect(s.jobs).toHaveLength(0);
      }
    });

  it('uses public commands and ordinary work on a generated world, waits for allowed materials and resumes across interruption', () => {
    // Generated terrain, starting inventory and actual work are unchanged. Only
    // the destructive event is injected through the existing damage host method.
    let s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 });
    command(s, { type: 'threats', enabled: false }); command(s, { type: 'fireHazards', enabled: false });
    const workerId = s.pawns[0].id, initialWood = s.counts().wood;
    for (const p of s.pawns) {
      for (let hour = 0; hour < 24; hour++) command(s, { type: 'schedule', pawnId: p.id, hour, assignment: 'work' });
      for (const work of Object.keys(p.priorities) as (keyof Pawn['priorities'])[])
        command(s, { type: 'priority', pawnId: p.id, work, value: p.id === workerId && work === 'build' ? 1 : 0 });
    }
    let target: Pos | null = null;
    for (let y = s.spawn.y - 3; y <= s.spawn.y + 3 && !target; y++)
      for (let x = s.spawn.x - 3; x <= s.spawn.x + 3 && !target; x++) {
        const point = { x, y, z: s.spawn.z };
        if (s.command({ type: 'designate', tool: 'chair', from: point, axis: 'y' }).ok) target = point;
      }
    expect(target).not.toBeNull(); until(s, () => s.chairs.length === 1);
    const old = structuredClone(s.chairs[0]), consumed = s.stats.consumed.wood;
    enable(s, old); destroy(s, 'chair', old, old.id);
    expect(s.jobs.filter(j => j.kind === 'chair')).toHaveLength(1);
    expect(s.stats.consumed.wood).toBe(consumed); expect(s.stats.produced.wood).toBe(0);
    for (const wood of s.items.filter(i => i.resource === 'wood')) command(s, { type: 'itemForbidden', itemId: wood.id, forbidden: true });
    s.step(30); expect(s.chairs).toHaveLength(0); expect(s.stats.consumed.wood).toBe(consumed);
    for (const wood of s.items.filter(i => i.resource === 'wood')) command(s, { type: 'itemForbidden', itemId: wood.id, forbidden: false });
    until(s, () => s.pawns.some(p => p.cargo?.resource === 'wood'));
    const carried = s.pawns.find(p => p.id === workerId)!.cargo;
    s = VoxelSimulation.load(s.save()); expect(s.pawns.find(p => p.id === workerId)!.cargo).toEqual(carried);
    until(s, () => s.jobs.some(j => j.kind === 'chair' && j.progress > 0));
    const progress = s.jobs.find(j => j.kind === 'chair')!.progress;
    command(s, { type: 'draft', pawnId: workerId, drafted: true }); s = VoxelSimulation.load(s.save());
    expect(s.jobs.find(j => j.kind === 'chair')!.progress).toBe(progress);
    command(s, { type: 'draft', pawnId: workerId, drafted: false }); until(s, () => s.chairs.length === 1);
    expect(s.chairs[0]).toMatchObject({ x: old.x, y: old.y, z: old.z, axis: old.axis }); expect(s.chairs[0].id).not.toBe(old.id);
    expect(s.stats.consumed.wood).toBe(2 * LIVING_BUILDINGS.chair.cost.wood);
    expect(s.counts().wood + s.stats.consumed.wood + s.stats.destroyed.wood).toBe(initialWood); expect(s.stats.produced.wood).toBe(0);
    expect(VoxelSimulation.load(s.save()).chairs).toEqual(s.chairs);
  });

  it('rerolls furniture quality using the new builder and discards destroyed identity and damage', () => {
    const s = fixture(s => { chair(s); s.pawns[0].skills.construction.level = 0; }), old = s.chairs[0];
    const damage = { ...old, kind: 'chair' as const, targetId: old.id, key: fireDamageKey('chair', old.id, old), hitPoints: 1, maxHitPoints: FIRE_MAX_HP.chair };
    s.fireDamage.push(damage); item(s, 'wood', LIVING_BUILDINGS.chair.cost.wood); enable(s, old); destroy(s, 'chair', old, old.id); build(s);
    until(s, () => s.chairs.length === 1);
    expect(s.chairs[0].id).not.toBe(old.id); expect(s.chairs[0].quality).not.toBe(old.quality);
    expect(s.fireDamage).toHaveLength(0); expect(s.counts().wood).toBe(0); expect(s.stats.produced.wood).toBe(0);
    expect(s.stats.consumed.wood).toBe(LIVING_BUILDINGS.chair.cost.wood);
  });

  it.each(['remove', 'uninstall'] as const)('does not rebuild an intentionally %s chair', action => {
    const s = fixture(s => { chair(s); }), old = s.chairs[0]; enable(s, old); build(s);
    if (action === 'remove') command(s, { type: 'designate', tool: 'remove', from: old });
    else command(s, { type: 'uninstallFurniture', kind: 'chair', furnitureId: old.id });
    until(s, () => s.chairs.length === 0); s.step(10);
    expect(s.jobs.some(j => j.kind === 'chair')).toBe(false);
    if (action === 'remove') expect(s.counts().wood).toBe(Math.floor(LIVING_BUILDINGS.chair.cost.wood / 2));
    else expect(s.items.filter(i => i.furniture?.id === old.id)).toHaveLength(1);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('rebuilds a sandbag destroyed by projectile cover damage only after fresh material delivery and work', () => {
    const s = fixture(s => s.sandbags.push({ ...pos(18), id: s.nextId++, hitPoints: 2 })), original = s.sandbags[0];
    enable(s, original);
    // Controlled damage-host boundary, not a native interaction, projectile
    // trajectory test or naturally selected combat encounter. Only the fields
    // read by this host method are supplied; no fake projectile is persisted.
    const host = s as unknown as { projectileHitCover(shot: Pick<Projectile, 'damage' | 'shooterId'>, id: number): boolean };
    const shot = { shooterId: s.pawns[0].id, damage: 1 };
    expect(host.projectileHitCover(shot, original.id)).toBe(true); expect(s.sandbags[0].hitPoints).toBe(1);
    expect(s.jobs.filter(j => j.kind === 'sandbag')).toHaveLength(0);
    expect(host.projectileHitCover(shot, original.id)).toBe(true); expect(s.sandbags).toHaveLength(0);
    const plans = s.jobs.filter(j => j.kind === 'sandbag'); expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ ...pos(18), cost: SANDBAG_COST, progress: 0, delivered: {} });
    expect(host.projectileHitCover(shot, original.id)).toBe(false); expect(s.jobs.filter(j => j.kind === 'sandbag')).toHaveLength(1);
    build(s); s.step(30); expect(s.sandbags).toHaveLength(0);
    expect(s.counts().cloth).toBe(0); expect(s.stats.consumed.cloth).toBe(0); expect(s.stats.produced.cloth).toBe(0);
    item(s, 'cloth', SANDBAG_COST.cloth); until(s, () => s.sandbags.length === 1);
    expect(s.sandbags[0]).toMatchObject({ ...pos(18), hitPoints: SANDBAG_HP }); expect(s.sandbags[0].id).not.toBe(original.id);
    expect(s.stats.consumed.cloth).toBe(SANDBAG_COST.cloth); expect(s.counts().cloth).toBe(0); expect(s.stats.produced.cloth).toBe(0);
    const restored = VoxelSimulation.load(s.save()); expect(restored.sandbags).toEqual(s.sandbags); expect(restored.stats).toEqual(s.stats);
  });

  it('cancels a partly supplied rebuild without replacing it again or duplicating the delivered input', () => {
    let s = fixture(s => { chair(s); }), old = s.chairs[0];
    item(s, 'wood', 20); enable(s, old); destroy(s, 'chair', old, old.id); build(s);
    until(s, () => s.jobs.some(j => (j.delivered.wood ?? 0) > 0));
    s = VoxelSimulation.load(s.save()); command(s, { type: 'designate', tool: 'cancel', from: old });
    s.step(40); expect(s.jobs).toHaveLength(0); expect(s.chairs).toHaveLength(0);
    expect(s.counts().wood).toBe(20); expect(s.stats.consumed.wood).toBe(0); expect(s.stats.produced.wood).toBe(0);
    expect(VoxelSimulation.load(s.save()).counts().wood).toBe(20);
  });

  it('keeps a large shelf orientation and linked storage settings while preserving loose goods independently', () => {
    let s = fixture(s => {
      s.shelves.push({ ...pos(18), id: s.nextId++, kind: 'shelf', axis: 'y', settings: defaultShelfSettings() },
        { ...pos(23, 13), id: s.nextId++, kind: 'smallShelf', axis: 'x', settings: defaultShelfSettings() });
    });
    const [old, member] = s.shelves; command(s, { type: 'shelfStorage', shelfId: old.id, priority: 3, accepts: ['steel'] });
    command(s, { type: 'shelfLink', sourceId: old.id, memberIds: [member.id] });
    item(s, 'steel', 6, old); item(s, 'wood', SHELF_DEFS.shelf.cost.wood); enable(s, old);
    destroy(s, 'shelf', old, old.id);
    const plan = s.jobs.find(j => j.kind === 'shelf')!; expect(plan).toBeDefined(); expect(plan.axis).toBe('y');
    expect(s.storageGroups[0].memberIds).toContain(plan.id); expect(s.storageGroups[0].memberIds).not.toContain(old.id);
    command(s, { type: 'shelfStorage', shelfId: member.id, priority: 0, accepts: ['grain'] });
    s = VoxelSimulation.load(s.save()); build(s); until(s, () => s.shelves.some(value => value.id !== member.id));
    const rebuilt = s.shelves.find(value => value.id !== member.id)!;
    expect(rebuilt).toMatchObject({ x: old.x, y: old.y, z: old.z, kind: 'shelf', axis: 'y' }); expect(rebuilt.id).not.toBe(old.id);
    const group = s.snapshot().storageGroups.find(g => g.memberIds.includes(rebuilt.id));
    expect(group?.settings).toEqual({ priority: 0, accepts: ['grain'] }); expect(s.counts().steel).toBe(6);
    expect(s.stats.consumed.wood).toBe(SHELF_DEFS.shelf.cost.wood); expect(s.stats.produced.wood).toBe(0);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('uses a multi-cell building anchor for Home, not a different occupied cell', () => {
    const s = fixture(s => s.shelves.push({ ...pos(18), id: s.nextId++, kind: 'shelf', axis: 'y', settings: defaultShelfSettings() }));
    const old = s.shelves[0]; enable(s, { ...old, y: old.y + 1 }); destroy(s, 'shelf', old, old.id);
    expect(s.jobs.filter(j => j.kind === 'shelf')).toHaveLength(0);
  });

  it('rejects rebuilding a researched building when its technology is unavailable', () => {
    const s = fixture(s => {
      s.devices.push({ ...pos(18), id: s.nextId++, kind: 'battery', axis: 'x', on: true, fuel: 0,
        energy: 0, target: 21, powered: false, active: false, networkId: null, watts: 0, reason: '' });
    });
    expect(s.research.progress.Batteries).toBe(0);
    const old = s.devices[0]; enable(s, old); destroy(s, 'device', old, old.id); expect(s.jobs.some(j => j.kind === 'battery')).toBe(false);
  });

  it.each(['owner', 'medical'] as const)('does not copy the destroyed bed %s setting or quality into the new bed', setting => {
    const s = fixture(s => {
      s.beds.push({ ...pos(18), id: s.nextId++, axis: 'y', quality: 6,
        owner: setting === 'owner' ? s.pawns[0].id : null, medical: setting === 'medical', prisoner: false });
      s.pawns[0].skills.construction.level = 0;
    });
    const old = s.beds[0]; item(s, 'wood', 45); enable(s, old); destroy(s, 'bed', old, old.id); build(s);
    until(s, () => s.beds.length === 1); expect(s.beds[0]).toMatchObject({ axis: 'y', owner: null, medical: false, prisoner: false });
    expect(s.beds[0].id).not.toBe(old.id); expect(s.beds[0].quality).not.toBe(old.quality);
  });

  it.each([8, 9])('removes both wall voxels when level %i burns and creates only the lower-anchor replacement', z => {
    let s = fixture(s => {
      s.blocks[at(pos(18))] = Block.Wood; s.blocks[at(pos(18, 16, 9))] = Block.Wood;
      s.structureKinds[at(pos(18))] = 2; s.structureKinds[at(pos(18, 16, 9))] = 3;
    });
    enable(s, pos(18)); destroy(s, 'block', pos(18, 16, z));
    expect(s.blocks[at(pos(18))]).toBe(Block.Air); expect(s.blocks[at(pos(18, 16, 9))]).toBe(Block.Air);
    const plans = s.jobs.filter(j => j.kind === 'wall'); expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ ...pos(18), material: 'wood' });
    s = VoxelSimulation.load(s.save()); expect(s.jobs.filter(j => j.kind === 'wall')).toHaveLength(1);
  });

  it('does not rebuild a wooden floor or unsupported furniture after losing its upper-storey support', () => {
    const s = fixture(s => {
      s.blocks[at(pos(18, 16, 10))] = Block.Wood; s.structureKinds[at(pos(18, 16, 10))] = 1;
      chair(s, pos(18, 16, 11));
    });
    enable(s, pos(18, 16, 11)); destroy(s, 'block', pos(18, 16, 10));
    expect(s.chairs).toHaveLength(0); expect(s.jobs.some(j => ['floor', 'chair'].includes(j.kind))).toBe(false);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('rolls back rejected destruction without removing the other wall half or leaving a replacement plan', () => {
    const s = fixture(s => {
      for (let z = 0; z <= 12; z++) {
        s.blocks[at(pos(18, 16, z))] = Block.Air;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) s.blocks[at(pos(18 + dx, 16 + dy, z))] = Block.Stone;
      }
      s.blocks[at(pos(18))] = Block.Wood; s.blocks[at(pos(18, 16, 9))] = Block.Wood;
      s.structureKinds[at(pos(18))] = 2; s.structureKinds[at(pos(18, 16, 9))] = 3;
      Object.assign(s.pawns[0], pos(18, 16, 10));
    });
    enable(s, pos(18)); const before = s.save(), target = pos(18, 16, 9);
    expect(s.fireDestroy({ ...target, kind: 'block', targetId: null, key: fireDamageKey('block', null, target),
      hitPoints: 1, maxHitPoints: FIRE_MAX_HP.block }, 'controlled impossible landing')).toBe(false);
    const after = s.save();
    for (const key of ['blocks', 'structureKinds', 'jobs', 'items', 'nextId', 'stats'] as const) expect(after[key]).toEqual(before[key]);
    expect(s.pawns[0]).toMatchObject(pos(18, 16, 10));
  });

  it('rebuilds a destroyed shallow-water bridge surface while keeping its water identity', () => {
    let s = new VoxelSimulation(73129, { river: 'river' });
    const cell = s.water.findIndex(value => value === 1), deck = position(cell), surface = { ...deck, z: deck.z + 1 };
    // Deliberate bridge geometry; ordinary-command resource flow is tested above.
    s.blocks[cell] = Block.Wood; s.bridges[cell] = 1; s.structureKinds[cell] = 1; s.explored.fill(1);
    s = VoxelSimulation.load(s.save()); enable(s, surface); destroy(s, 'block', deck);
    expect(s.blocks[cell]).toBe(Block.Air); expect(s.bridges[cell]).toBe(0); expect(s.water[cell]).toBe(1);
    expect(s.jobs.filter(j => j.kind === 'bridge')).toHaveLength(1);
    expect(s.jobs.find(j => j.kind === 'bridge')).toMatchObject(surface);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it.each([{ on: false, home: true }, { on: true, home: false }, { on: true, home: true }])(
    'burns a supplied construction frame through actual fire updates without consuming a separate carried input: $on / $home', ({ on, home }) => {
      const s = fixture(), site = pos(18), worker = s.pawns[0];
      item(s, 'wood', 75); item(s, 'steel', 25, pos(26, 21));
      command(s, { type: 'designate', tool: 'researchBench', from: site, axis: 'x' }); build(s);
      until(s, () => s.jobs.some(j => j.kind === 'researchBench' && j.delivered.wood === 75) && worker.cargo?.resource === 'steel');
      command(s, { type: 'priority', pawnId: worker.id, work: 'build', value: 0 });
      const old = s.jobs.find(j => j.kind === 'researchBench')!, cargo = structuredClone(worker.cargo);
      command(s, { type: 'autoRebuild', enabled: on });
      if (home) command(s, { type: 'homeArea', from: site, enabled: true });
      const damage = frameDamageTarget(old); damage.hitPoints = 1; s.fireDamage.push(damage);
      expect(fireFuelAt(s, site).map(f => f.damage?.kind)).toContain('frame');
      const fire = igniteFire(s, site, 'shortCircuit'); expect(fire).not.toBeNull();
      // Advance only this controlled fire opportunity; no pawn update can move
      // the separate carried steel before the destruction transaction is checked.
      s.tick = fire!.nextDamageTick; updateFires(s);
      expect(s.jobs.some(j => j.id === old.id)).toBe(false); expect(s.researchBenches).toHaveLength(0);
      expect(worker.cargo).toEqual(cargo); expect(s.counts().steel).toBe(25);
      expect(s.stats.destroyed.wood).toBe(75); expect(s.stats.destroyed.steel).toBe(0);
      expect(s.stats.consumed.wood).toBe(0); expect(s.stats.produced.wood).toBe(0); expect(s.counts().wood).toBe(0);
      const replacements = s.jobs.filter(j => j.kind === 'researchBench'); expect(replacements).toHaveLength(on && home ? 1 : 0);
      if (on && home) {
        expect(replacements[0].id).not.toBe(old.id); expect(replacements[0].progress).toBe(0);
        expect(replacements[0].delivered).toEqual({}); expect(replacements[0].deliveredBatches).toEqual([]);
      }
      expect(s.fires).toHaveLength(0); expect(s.fireDamage).toHaveLength(0);
      const restored = VoxelSimulation.load(s.save()); expect(restored.counts()).toEqual(s.counts());
      expect(restored.stats).toEqual(s.stats); expect(restored.pawns[0].cargo).toEqual(cargo);
    });

  it('keeps empty blueprints and supplied terrain plans outside the combustible building-frame lifecycle', () => {
    const s = fixture(); command(s, { type: 'designate', tool: 'chair', from: pos(18) });
    expect(fireFuelAt(s, pos(18))).toEqual([]); expect(igniteFire(s, pos(18), 'shortCircuit')).toBeNull();
    command(s, { type: 'designate', tool: 'floor', from: pos(20, 16, 11) });
    const terrain = s.jobs.find(j => j.kind === 'floor')!;
    // Isolated supplied-terrain fixture; this deliberately bypasses worker
    // delivery to test classification without introducing an upper-storey route.
    terrain.delivered = { wood: 1 }; terrain.deliveredBatches = [freshBatch('wood', 1)];
    expect(fireFuelAt(s, terrain)).toEqual([]); expect(igniteFire(s, terrain, 'shortCircuit')).toBeNull();
    const restored = VoxelSimulation.load(s.save());
    expect(restored.jobs.find(j => j.id === terrain.id)?.delivered).toEqual({ wood: 1 }); expect(restored.fires).toEqual([]);
  });

  it('roundtrips partial frame damage, rejects forged maximum HP and clears damage when supplied work is cancelled', () => {
    let s = fixture(); item(s, 'wood', LIVING_BUILDINGS.chair.cost.wood);
    command(s, { type: 'designate', tool: 'chair', from: pos(18) }); build(s);
    until(s, () => s.jobs.some(j => j.kind === 'chair' && j.progress > 0));
    command(s, { type: 'priority', pawnId: s.pawns[0].id, work: 'build', value: 0 });
    const job = s.jobs.find(j => j.kind === 'chair')!, damage = frameDamageTarget(job); damage.hitPoints = damage.maxHitPoints / 2;
    s.fireDamage.push(damage); const saved = s.save(); s = VoxelSimulation.load(saved);
    expect(s.fireDamage).toEqual([damage]); expect(s.jobs.find(j => j.id === job.id)?.progress).toBe(job.progress);
    const forged = structuredClone(saved); forged.fireDamage[0].maxHitPoints *= 2;
    expect(() => VoxelSimulation.load(forged)).toThrow(/火灾存档/);
    const downgraded = structuredClone(saved) as Omit<typeof saved, 'version' | 'autoRebuild'> & { version: number; autoRebuild?: boolean };
    downgraded.version = 45; stripAutoSlaughterFields(downgraded); delete downgraded.autoRebuild;
    const before = structuredClone(downgraded);
    expect(() => VoxelSimulation.load(downgraded)).toThrow(/旧版本存档混入自动重建或施工框架损伤/);
    expect(downgraded).toEqual(before);
    command(s, { type: 'designate', tool: 'cancel', from: job });
    expect(s.jobs).toHaveLength(0); expect(s.fireDamage).toHaveLength(0);
    expect(s.counts().wood).toBe(LIVING_BUILDINGS.chair.cost.wood); expect(s.stats.destroyed.wood).toBe(0);
    const restored = VoxelSimulation.load(s.save()); expect(restored.fireDamage).toEqual([]); expect(restored.jobs).toEqual([]);
    expect(restored.counts().wood).toBe(LIVING_BUILDINGS.chair.cost.wood);
  });

  it('transfers a destroyed shelf-frame storage group to its fresh blueprint and pays again to complete it', () => {
    let s = fixture(s => s.shelves.push({ ...pos(23, 13), id: s.nextId++, kind: 'smallShelf', axis: 'x', settings: defaultShelfSettings() }));
    const memberId = s.shelves[0].id, site = pos(18);
    item(s, 'wood', SHELF_DEFS.shelf.cost.wood); command(s, { type: 'designate', tool: 'shelf', from: site, axis: 'y' });
    const old = s.jobs.find(j => j.kind === 'shelf')!;
    command(s, { type: 'shelfStorage', shelfId: memberId, priority: 3, accepts: ['steel'] });
    command(s, { type: 'shelfLink', sourceId: memberId, memberIds: [old.id] }); build(s);
    until(s, () => (old.delivered.wood ?? 0) > 0);
    command(s, { type: 'priority', pawnId: s.pawns[0].id, work: 'build', value: 0 }); enable(s, site);
    expect(s.fireDestroy(frameDamageTarget(old), 'controlled shelf-frame destruction')).toBe(true);
    const replacement = s.jobs.find(j => j.kind === 'shelf')!;
    expect(replacement.id).not.toBe(old.id); expect(replacement.axis).toBe('y'); expect(replacement.delivered).toEqual({});
    expect(s.storageGroups[0].memberIds).toEqual([memberId, replacement.id]);
    command(s, { type: 'shelfStorage', shelfId: memberId, priority: 1, accepts: ['grain'] });
    s = VoxelSimulation.load(s.save()); item(s, 'wood', SHELF_DEFS.shelf.cost.wood); build(s);
    until(s, () => s.shelves.some(shelf => shelf.id === replacement.id));
    expect(s.storageGroups[0].settings).toEqual({ priority: 1, accepts: ['grain'] });
    expect(s.stats.destroyed.wood).toBe(SHELF_DEFS.shelf.cost.wood);
    expect(s.stats.consumed.wood).toBe(SHELF_DEFS.shelf.cost.wood); expect(s.counts().wood).toBe(0); expect(s.stats.produced.wood).toBe(0);
    const restored = VoxelSimulation.load(s.save()); expect(restored.shelves).toEqual(s.shelves); expect(restored.storageGroups).toEqual(s.storageGroups);
  });

  it.each(['chair', 'shelf'] as const)('finishes a damaged %s frame at the same HP fraction instead of healing it', kind => {
    let s = fixture(); const site = pos(18), cost = kind === 'chair' ? LIVING_BUILDINGS.chair.cost.wood : SHELF_DEFS.shelf.cost.wood;
    item(s, 'wood', cost); command(s, { type: 'designate', tool: kind, from: site, axis: 'y' }); build(s);
    until(s, () => s.jobs.some(j => j.kind === kind && j.progress > 0));
    command(s, { type: 'priority', pawnId: s.pawns[0].id, work: 'build', value: 0 });
    const job = s.jobs.find(j => j.kind === kind)!, damage = frameDamageTarget(job); damage.hitPoints = damage.maxHitPoints / 2;
    s.fireDamage.push(damage); s = VoxelSimulation.load(s.save()); build(s);
    until(s, () => kind === 'chair' ? s.chairs.length === 1 : s.shelves.length === 1);
    command(s, { type: 'priority', pawnId: s.pawns[0].id, work: 'build', value: 0 });
    const completed = kind === 'chair' ? s.chairs[0] : s.shelves[0];
    expect(s.fireDamage).toEqual([{ x: site.x, y: site.y, z: site.z, kind, targetId: completed.id,
      key: fireDamageKey(kind, completed.id, site), hitPoints: FIRE_MAX_HP[kind] / 2, maxHitPoints: FIRE_MAX_HP[kind] }]);
    expect(s.jobs.some(j => j.id === job.id)).toBe(false); expect(s.stats.consumed.wood).toBe(cost); expect(s.counts().wood).toBe(0);
    const restored = VoxelSimulation.load(s.save()); expect(restored.fireDamage).toEqual(s.fireDamage);
    expect(kind === 'chair' ? restored.chairs : restored.shelves).toEqual(kind === 'chair' ? s.chairs : s.shelves);
  });

  it('finishes a damaged wall with one shared damage anchor and repairs both visible halves through that identity', () => {
    let s = fixture(); const base = pos(18), upper = pos(18, 16, 9);
    // Isolate damage inheritance: this healthy qualified builder cannot botch
    // the frame and replace it with a different, undamaged construction.
    s.pawns[0].skills.construction.level = 8;
    command(s, { type: 'designate', tool: 'wall', from: base, material: 'wood' });
    const plan = s.jobs.find(j => j.kind === 'wall')!; item(s, 'wood', plan.cost.wood!); build(s);
    until(s, () => plan.progress > 0);
    command(s, { type: 'priority', pawnId: s.pawns[0].id, work: 'build', value: 0 });
    const frame = frameDamageTarget(plan); frame.hitPoints = frame.maxHitPoints / 2; s.fireDamage.push(frame);
    s = VoxelSimulation.load(s.save()); build(s); until(s, () => s.blocks[at(base)] === Block.Wood);
    command(s, { type: 'priority', pawnId: s.pawns[0].id, work: 'build', value: 0 });
    const key = fireDamageKey('block', null, base), upperTarget = fireFuelAt(s, upper).find(f => f.damage?.kind === 'block')!.damage!;
    expect(upperTarget.key).toBe(key); expect(fireFuelAt(s, base).find(f => f.damage?.kind === 'block')!.damage!.key).toBe(key);
    expect(s.fireDamage).toEqual([{ ...base, kind: 'block', targetId: null, key, hitPoints: FIRE_MAX_HP.block / 2, maxHitPoints: FIRE_MAX_HP.block }]);
    const consumed = structuredClone(s.stats.consumed), id = s.pawns[0].id;
    command(s, { type: 'homeArea', from: base, enabled: true }); command(s, { type: 'repair', pawnId: id, damageKey: upperTarget.key });
    expect(s.command({ type: 'repair', pawnId: s.pawns[1].id, damageKey: key }).ok).toBe(false);
    until(s, () => s.fireDamage[0].hitPoints > FIRE_MAX_HP.block / 2);
    const partial = structuredClone(s.fireDamage); s = VoxelSimulation.load(s.save()); expect(s.fireDamage).toEqual(partial);
    until(s, () => s.fireDamage.length === 0);
    expect(s.blocks[at(base)]).toBe(Block.Wood); expect(s.blocks[at(upper)]).toBe(Block.Wood);
    expect(s.structureKinds[at(base)]).toBe(2); expect(s.structureKinds[at(upper)]).toBe(3); expect(s.stats.consumed).toEqual(consumed);
    const restored = VoxelSimulation.load(s.save()); expect(restored.fireDamage).toEqual([]); expect(restored.blocks).toEqual(s.blocks);
  });

  it('restores a destroyed wire through a new paid construction job', () => {
    const s = fixture(s => s.wires.push(pos(18))), wire = pos(18); enable(s, wire);
    destroy(s, 'wire', wire); expect(s.wires).toHaveLength(0);
    const plan = s.jobs.find(j => j.kind === 'wire')!; expect(plan).toBeDefined(); expect(plan.delivered).toEqual({});
    expect(s.stats.produced.steel).toBe(0); expect(s.counts().steel).toBe(0);
    build(s); s.step(20); expect(s.wires).toHaveLength(0); item(s, 'steel', plan.cost.steel!);
    until(s, () => s.wires.length === 1); expect(s.wires).toEqual([wire]); expect(s.stats.consumed.steel).toBe(plan.cost.steel);
    expect(s.counts().steel).toBe(0); expect(VoxelSimulation.load(s.save()).wires).toEqual([wire]);
  });

  it('merges synthetic legacy wall-half damage conservatively and redirects the existing repair task', () => {
    const base = pos(18), upper = pos(18, 16, 9), s = fixture(s => {
      s.blocks[at(base)] = Block.Wood; s.blocks[at(upper)] = Block.Wood;
      s.structureKinds[at(base)] = 2; s.structureKinds[at(upper)] = 3;
      s.blocks[at(pos(17))] = Block.Stone;
    });
    command(s, { type: 'homeArea', from: upper, enabled: true });
    s.fireDamage = [base, upper].map((p, i) => ({ ...p, kind: 'block', targetId: null,
      key: fireDamageKey('block', null, p), hitPoints: i === 0 ? 75 : 50, maxHitPoints: FIRE_MAX_HP.block }));
    const worker = s.pawns[0]; Object.assign(worker, pos(17, 16, 9)); worker.phase = 'repair';
    worker.repairTask = { damageKey: fireDamageKey('block', null, upper), progress: 7 };
    // This is an intentional historical-shape fixture, not one of the separately
    // frozen unmodified v45 implementation samples.
    const old = s.save() as Omit<ReturnType<typeof s.save>, 'version' | 'autoRebuild'> & { version: number; autoRebuild?: boolean };
    old.version = 45; stripAutoSlaughterFields(old); delete old.autoRebuild;
    const before = structuredClone(old), restored = VoxelSimulation.load(old), key = fireDamageKey('block', null, base);
    expect(old).toEqual(before); expect(restored.autoRebuild).toBe(false);
    expect(restored.fireDamage).toEqual([{ ...base, kind: 'block', targetId: null, key, hitPoints: 50, maxHitPoints: FIRE_MAX_HP.block }]);
    expect(restored.pawns[0].repairTask).toEqual({ damageKey: key, progress: 7 });
    expect(restored.blocks).toEqual(s.blocks); expect(restored.stats).toEqual(s.stats);
    expect(VoxelSimulation.load(restored.save()).fireDamage).toEqual(restored.fireDamage);
  });
});
