import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { Block, at, index, type Device, type Pawn, type Pos, type VoxelSave } from '../src/voxel/types';
import { FIRE_MAX_HP, FIRE_RULES, fireDamageKey, fireRandom, initialFireHazards, makeFire, nextFireIncident } from '../src/voxel/fire';
import { fireFuelAt, igniteFire, startRepair, updateFires } from '../src/voxel/fireWorld';
import { colonyWealthDetails } from '../src/voxel/wealth';
import { makeWeapon } from '../src/voxel/weapons';

const pos = (x = 20, y = 17, z = 8): Pos => ({ x, y, z });
/** Controlled geometry only. Normal ignition and campaign evidence live in the
 * independent campaign script; these fixtures isolate source and save boundaries. */
function fixture(configure?: (s: VoxelSimulation) => void) {
  const s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 }, false, 2) /* Controlled geometry: historical full visibility. */;
  s.animals = []; s.trees = []; s.treePlots = []; s.items = []; s.stockpiles = [];
  s.blocks.fill(Block.Stone); s.ladders.fill(0); s.structureKinds.fill(0);
  for (let x = 10; x <= 30; x++) for (let y = 10; y <= 20; y++)
    for (let z = 8; z <= 9; z++) s.blocks[index(x, y, z)] = Block.Air;
  s.spawn = pos(11, 11); s.homeArea.clear();
  for (const [i, p] of s.pawns.entries()) {
    Object.assign(p, pos(11 + i, 14)); p.schedule.fill('work'); p.food = 95; p.rest = 95;
    for (const k of Object.keys(p.priorities)) p.priorities[k as keyof Pawn['priorities']] = 0;
  }
  s.command({ type: 'threats', enabled: false }); s.command({ type: 'fireHazards', enabled: false });
  configure?.(s); return VoxelSimulation.load(s.save());
}
function wood(s: VoxelSimulation, p = pos(), amount = 30) {
  const item = { ...p, id: s.nextId++, resource: 'wood' as const, amount }; s.items.push(item); return item;
}
function damage(s: VoxelSimulation, p = pos(), hp = 50) {
  const d = { ...p, key: fireDamageKey('block', null, p), kind: 'block' as const, targetId: null,
    hitPoints: hp, maxHitPoints: FIRE_MAX_HP.block };
  s.fireDamage.push(d); return d;
}
function battery(s: VoxelSimulation, x: number): Device {
  return { id: s.nextId++, ...pos(x, 16), kind: 'battery', axis: 'x', on: true, fuel: 0,
    energy: 400, target: 21, powered: false, active: false, networkId: null, watts: 0, reason: '' };
}

describe('fire rules, electrical boundaries and persistent damage', () => {
  it('preserves deterministic next opportunities and introduces no retrospective incident on migration epoch', () => {
    const initial = initialFireHazards(123, 120000);
    expect(initial.cycle).toBe(0); expect(initial.events).toEqual([]);
    expect(initial.nextIncidentTick).toBe(nextFireIncident(123, 120000, 0));
    expect(initial.nextIncidentTick).toBeGreaterThanOrEqual(120000 + FIRE_RULES.firstIncidentDelay);
    for (let cycle = 0; cycle < 40; cycle++)
      expect(nextFireIncident(123, 120000, cycle + 1)).toBeGreaterThan(nextFireIncident(123, 120000, cycle));
  });
  it('drains only the causing electrical network and persists its identity in the event', () => {
    const s = fixture(s => { s.devices.push(battery(s, 15), battery(s, 25)); });
    s.fireHazards.enabled = true;
    // Invoke the normal opportunity evaluator at its exact deadline, with real power topology.
    s.tick = s.fireHazards.nextIncidentTick;
    s.power.step(s.tick, s.devices, () => 0);
    const before = new Map(s.devices.map(d => [d.networkId, d.energy]));
    expect(before.size).toBe(2); updateFires(s);
    const event = s.fireHazards.events.at(-1)!;
    expect(event.source).toBe('shortCircuit'); expect(event.outcome).toBe('ignited');
    expect(event.networkId).not.toBeNull();
    for (const device of s.devices) expect(device.energy).toBe(device.networkId === event.networkId ? 0 : before.get(device.networkId));
    expect(s.fires).toHaveLength(1);
  });
  it('skips disabled opportunities while already burning fuel continues to be consumed', () => {
    const s = fixture(); const item = wood(s); const f = igniteFire(s, item, 'lightning')!;
    const initialAmount = item.amount;
    s.step(FIRE_RULES.damageInterval);
    expect(s.fireHazards.enabled).toBe(false); expect(s.stats.destroyed.wood).toBe(1);
    expect(s.counts().wood).toBe(initialAmount - 1); expect(s.fires[0].id).toBe(f.id);
    const fresh = fixture(); fresh.tick = fresh.fireHazards.nextIncidentTick; updateFires(fresh);
    expect(fresh.fireHazards.events[0].outcome).toBe('skipped'); expect(fresh.fires).toEqual([]);
  });
  it('maps a floor flame to the actual wooden support and consumes one target per damage pulse', () => {
    const p = pos(), below = pos(p.x, p.y, p.z - 1);
    const s = fixture(s => { s.blocks[at(below)] = Block.Wood; s.structureKinds[at(below)] = 1; });
    const item = wood(s, p); igniteFire(s, p, 'lightning');
    const targets = fireFuelAt(s, p);
    expect(targets).toHaveLength(2); expect(targets.find(f => f.damage)?.damage).toMatchObject(below);
    s.step(FIRE_RULES.damageInterval);
    expect(Number(s.stats.destroyed.wood > 0) + Number(s.fireDamage.length > 0)).toBe(1);
    expect(item.amount).toBeGreaterThanOrEqual(29);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('propagates vertically through adjacent wooden wall cells with a deterministic spread roll', () => {
    const p = pos(), top = pos(p.x, p.y, p.z + 1);
    const s = fixture(s => { s.blocks[at(p)] = Block.Wood; s.blocks[at(top)] = Block.Wood; });
    let id = s.nextId;
    while (fireRandom(s.seed, id, FIRE_RULES.spreadInterval, 4) >= FIRE_RULES.spreadChance) id++;
    s.nextId = id + 1; s.fires.push(makeFire(id, p, 0, 'lightning', 1.7));
    s.step(FIRE_RULES.spreadInterval);
    expect(s.fires.some(f => at(f) === at(top) && f.source === 'spread')).toBe(true);
    expect(s.fires.every(f => f.size <= FIRE_RULES.maxSize)).toBe(true);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('refuses repair for burning or deleted targets and ignores building HP until physical destruction', () => {
    const p = pos(), s = fixture(s => { s.blocks[at(p)] = Block.Wood; s.structureKinds[at(p)] = 2; });
    const full = colonyWealthDetails(s).buildings, d = damage(s, p);
    // Native WealthWatcher uses MarketValueIgnoreHp for player buildings.
    expect(colonyWealthDetails(s).buildings).toBe(full);
    s.homeArea.add(at(p)); const f = igniteFire(s, p, 'lightning')!;
    expect(startRepair(s, s.pawns[0], d)).toBe(false);
    s.fires = []; expect(startRepair(s, s.pawns[0], d)).toBe(true);
    s.command({ type: 'cancelRepair', pawnId: s.pawns[0].id });
    expect(s.fireDestroy(d, 'fixture burn')).toBe(true);
    expect(colonyWealthDetails(s).buildings).toBeLessThan(full);
    expect(startRepair(s, s.pawns[0], d)).toBe(false);
    expect(f.id).toBeGreaterThan(0);
  });
  it('burns the physical wooden bow once and leaves metal weapons nonflammable', () => {
    const s = fixture(), bow = makeWeapon(s.nextId++, 'shortBow'), knife = makeWeapon(s.nextId++, 'steelKnife');
    const bowStack = { ...pos(), id: s.nextId++, resource: 'weapon' as const, amount: 1, weapon: bow };
    const knifeStack = { ...pos(22), id: s.nextId++, resource: 'weapon' as const, amount: 1, weapon: knife };
    s.items.push(bowStack, knifeStack);
    expect(igniteFire(s, knifeStack, 'lightning')).toBeNull();
    expect(igniteFire(s, bowStack, 'lightning')).not.toBeNull();
    s.tick = FIRE_RULES.damageInterval; updateFires(s);
    expect(s.items.some(i => i.weapon?.id === bow.id)).toBe(false);
    expect(s.items.find(i => i.weapon?.id === knife.id)).toEqual(knifeStack);
    expect(s.stats.destroyed.weapon).toBe(1); expect(s.stats.produced.weapon).toBe(0);
    expect(s.fires).toEqual([]);
    s.tick++; updateFires(s); expect(s.stats.destroyed.weapon).toBe(1);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('does not refund destroyed buildings or count already consumed construction material as new loss', () => {
    const p = pos(), s = fixture(s => { s.blocks[at(p)] = Block.Wood; s.structureKinds[at(p)] = 2; });
    const d = damage(s, p, 1), before = structuredClone(s.stats);
    expect(s.fireDestroy(d, 'fixture burn')).toBe(true);
    expect(s.blocks[at(p)]).toBe(Block.Air); expect(s.structureKinds[at(p)]).toBe(0);
    expect(s.stats).toEqual(before); expect(s.counts().wood).toBe(0);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('rejects impossible actor collapse atomically instead of moving them to a distant safe tile', () => {
    const p = pos(20, 17, 11), floor = pos(20, 17, 10);
    const s = fixture(s => {
      for (let x = 19; x <= 21; x++) for (let y = 16; y <= 18; y++)
        for (let z = 0; z <= 13; z++) s.blocks[index(x, y, z)] = Block.Air;
      s.blocks[at(floor)] = Block.Wood; s.structureKinds[at(floor)] = 1;
      Object.assign(s.pawns[0], p);
    });
    const d = damage(s, floor, 1), before = s.save();
    expect(s.fireDestroy(d, 'fixture impossible collapse')).toBe(false);
    expect(s.save()).toEqual(before);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('falls down the original column and preserves loose batch identity data without a long horizontal spill', () => {
    const p = pos(20, 17, 11), floor = pos(20, 17, 10);
    const s = fixture(s => {
      for (let z = 8; z <= 13; z++) s.blocks[index(p.x, p.y, z)] = Block.Air;
      s.blocks[at(floor)] = Block.Wood; s.structureKinds[at(floor)] = 1;
      Object.assign(s.pawns[0], p);
      s.items.push({ ...p, id: s.nextId++, resource: 'grain', crop: 'rice', amount: 8, rotProgress: 321 });
    });
    expect(s.fireDestroy(damage(s, floor, 1), 'fixture collapse')).toBe(true);
    expect(s.pawns[0]).toMatchObject(pos(20, 17, 8));
    expect(s.items[0]).toMatchObject({ ...pos(20, 17, 8), resource: 'grain', crop: 'rice', amount: 8, rotProgress: 321 });
    expect(s.stats.destroyed.grain).toBe(0); expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
});

describe('strict fire save contracts', () => {
  it('records extinction once when burning the final structure reconciles fire inside its update', () => {
    const p = pos(), s = fixture(s => { s.blocks[at(p)] = Block.Wood; });
    damage(s, p, 1); igniteFire(s, p, 'lightning');
    s.step(FIRE_RULES.damageInterval);
    expect(s.blocks[at(p)]).toBe(Block.Air);
    expect(s.fires).toEqual([]);
    expect(s.fireLog.filter(e => e.type === 'extinguished')).toHaveLength(1);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });
  it('preserves active fire deadlines, fractional damage and disabled future events through roundtrip', () => {
    const p = pos(), s = fixture(s => { s.blocks[at(p)] = Block.Wood; });
    igniteFire(s, p, 'lightning'); s.step(31);
    const saved = s.save(), loaded = VoxelSimulation.load(saved);
    expect(loaded.fires).toEqual(saved.fires); expect(loaded.fireDamage).toEqual(saved.fireDamage);
    expect(loaded.fireHazards).toEqual(saved.fireHazards); expect(loaded.fireLog).toEqual(saved.fireLog);
    expect(loaded.fireDamage[0].hitPoints % 1).not.toBe(0);
  });
  const corruptions: [string, (s: VoxelSave) => void][] = [
    ['zero size', s => { s.fires[0].size = 0; }],
    ['excess size', s => { s.fires[0].size = 2; }],
    ['past pulse', s => { s.fires[0].nextDamageTick = s.tick; }],
    ['unaligned pulse', s => { s.fires[0].nextSpreadTick++; }],
    ['unknown source', s => { s.fires[0].source = 'debug' as never; }],
    ['full HP sparse record', s => { s.fireDamage[0].hitPoints = s.fireDamage[0].maxHitPoints; }],
    ['wrong HP maximum', s => { s.fireDamage[0].maxHitPoints++; }],
    ['duplicate damage', s => { s.fireDamage.push({ ...s.fireDamage[0] }); }],
    ['coordinate drift', s => { s.fireDamage[0].x++; }],
    ['future epoch', s => { s.fireHazards.epoch = s.tick + 1; }],
    ['forged event deadline', s => { s.fireHazards.nextIncidentTick++; }],
    ['missing task field', s => { delete (s.pawns[0] as any).repairTask; }],
    ['orphan task', s => { s.pawns[0].repairTask = { damageKey: s.fireDamage[0].key, progress: 1 }; }],
    ['invalid log', s => { s.fireLog.push({ tick: s.tick + 1, type: 'fell', position: pos(), message: 'future' }); }],
  ];
  it.each(corruptions)('rejects %s', (_name, mutate) => {
    const p = pos(), s = fixture(s => { s.blocks[at(p)] = Block.Wood; });
    igniteFire(s, p, 'lightning'); s.step(31);
    const saved = s.save(); mutate(saved); expect(() => VoxelSimulation.load(saved)).toThrow();
  });
  it('rejects fire fields smuggled into a pre-fire version before migrations insert defaults', () => {
    const s = fixture().save() as any; s.version = 25;
    expect(() => VoxelSimulation.load(s)).toThrow(/旧版本包含新版/);
  });
});
