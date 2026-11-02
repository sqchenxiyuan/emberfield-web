import { describe, it, expect } from 'vitest';
import { Simulation } from '../src/sim/world';
import { BUILDINGS, TECHS, WORKS } from '../src/sim/defs';
import { DAY, HOUR, SIZE, type BuildingKind, type Work } from '../src/sim/types';
function only(sim: Simulation, work: Work[]) {
  for (const p of sim.world.pawns.filter((p) => !p.animal))
    for (const k of WORKS) p.priorities[k] = work.includes(k) ? 1 : 0;
  sim.world.autoPause = false;
  sim.world.nextRaid = DAY * 100;
}
function fixtureBuilding(sim: Simulation, kind: BuildingKind, x: number, y: number) {
  const tech = BUILDINGS[kind].tech;
  if (tech) sim.world.research[tech] = TECHS[tech].cost;
  expect(sim.command({ type: 'build', kind, x, y }).ok).toBe(true);
  const b = sim.world.buildings.at(-1)!;
  b.progress = BUILDINGS[kind].work * HOUR;
  b.delivered = { ...BUILDINGS[kind].cost };
  b.paid = true;
  sim.rebuildNav();
  return b;
}
describe('authoritative colony simulation', () => {
  it('same seed and commands produce identical state across step batching', () => {
    const a = new Simulation(42),
      b = new Simulation(42);
    for (const s of [a, b]) {
      s.command({ type: 'zone', zone: 2, x: 49, y: 43, x2: 54, y2: 50 });
      s.command({ type: 'build', kind: 'bed', x: 42, y: 43 });
    }
    a.step(5000);
    for (let i = 0; i < 500; i++) b.step(10);
    expect(a.save()).toEqual(b.save());
  });
  it('construction physically delivers and consumes materials once', () => {
    const s = new Simulation();
    only(s, ['build']);
    s.command({ type: 'build', kind: 'bed', x: 45, y: 43 });
    s.step(1600);
    expect(s.world.stats.built).toBe(1);
    expect(s.world.buildings[0].delivered.wood).toBe(30);
    expect(s.inventory().wood).toBe(150);
    expect(s.world.pawns.every((p) => !p.carry)).toBe(true);
    expect(s.world.items.every((i) => i.reserved === 0)).toBe(true);
  });
  it('two cooks cannot consume the last ten ingredients twice', () => {
    const s = new Simulation();
    only(s, ['cook']);
    s.world.items = s.world.items.filter((i) => i.kind !== 'raw');
    s.addItem('raw', 10, 43, 48);
    fixtureBuilding(s, 'stove', 44, 44);
    fixtureBuilding(s, 'stove', 48, 44);
    s.step(1500);
    expect(s.world.stats.cooked).toBe(1);
    expect(s.inventory().raw).toBe(0);
    expect(s.inventory().meal).toBe(1);
    expect(s.inventory().wood).toBeCloseTo(179.6);
    expect(s.world.items.every((i) => i.count >= 0 && i.reserved >= 0)).toBe(true);
  });
  it('drafting releases reservations and preserves carried supplies', () => {
    const s = new Simulation();
    only(s, ['build']);
    const p = s.world.pawns.find((p) => !p.animal)!;
    p.x = 38;
    p.y = 45;
    s.command({ type: 'build', kind: 'bed', x: 45, y: 43 });
    s.step(1);
    const assigned = s.world.pawns.find((p) => p.job?.kind === 'build')!;
    expect(assigned.job).not.toBeNull();
    s.command({ type: 'draft', ids: [assigned.id], value: true });
    expect(s.world.items.reduce((a, i) => a + i.reserved, 0)).toBe(0);
    expect(s.inventory().wood).toBe(180);
    s.command({ type: 'draft', ids: [assigned.id], value: false });
    s.step(45);
    s.command({
      type: 'draft',
      ids: s.world.pawns.filter((p) => !p.animal).map((p) => p.id),
      value: true,
    });
    expect(
      s.inventory().wood + s.world.buildings.reduce((n, b) => n + (b.delivered.wood ?? 0), 0),
    ).toBe(180);
  });
  it('canceling a partially supplied blueprint refunds only delivered materials', () => {
    const s = new Simulation();
    only(s, ['build']);
    s.command({ type: 'build', kind: 'stove', x: 46, y: 44 });
    s.step(90);
    s.command({ type: 'mark', mode: 'cancel', x: 46, y: 44, x2: 46, y2: 44 });
    expect(s.world.buildings).toHaveLength(0);
    expect(s.inventory().wood).toBe(180);
    expect(s.inventory().steel).toBe(100);
    expect(s.world.items.every((i) => i.reserved === 0)).toBe(true);
  });
  it('blocked routes return a reason instead of moving through terrain', () => {
    const s = new Simulation();
    for (let y = 0; y < SIZE; y++) s.world.terrain[y * SIZE + 44] = 2;
    s.rebuildNav();
    const p = s.world.pawns[0];
    p.x = 43;
    p.y = 47;
    const r = s.command({ type: 'move', ids: [p.id], x: 47, y: 47 });
    expect(r.ok).toBe(false);
    s.step(100);
    expect(p.x).toBe(43);
  });
  it('mid-job save/load preserves RNG, reservations and future state', () => {
    const s = new Simulation(44);
    only(s, ['build', 'grow', 'cook']);
    s.command({ type: 'build', kind: 'stove', x: 46, y: 44 });
    s.command({ type: 'zone', zone: 2, x: 49, y: 44, x2: 54, y2: 51 });
    s.step(70);
    const restored = new Simulation();
    restored.load(JSON.parse(JSON.stringify(s.save())));
    s.step(25000);
    restored.step(25000);
    expect(restored.save()).toEqual(s.save());
  });
  it('rejects malformed saves atomically', () => {
    const s = new Simulation();
    const before = s.save();
    expect(() => s.load({ version: 99 })).toThrow();
    expect(s.save()).toEqual(before);
  });
  it('rejects missing nested records, invalid coordinates and broken reservations atomically', () => {
    const s = new Simulation();
    const before = s.save();
    for (const mutate of [
      (v: any) => (v.pawns[0].priorities = null),
      (v: any) => (v.pawns[0].x = Infinity),
      (v: any) => (v.items[0].reserved = 5),
      (v: any) => (v.stats = null),
    ]) {
      const invalid = structuredClone(before);
      mutate(invalid);
      expect(() => s.load(invalid)).toThrow();
      expect(s.save()).toEqual(before);
    }
  });
  it('drafted melee guards hold their position until explicitly ordered to advance', () => {
    const s = new Simulation();
    only(s, []);
    const p = s.world.pawns.find((p) => !p.animal && p.weapon === 'knife')!;
    p.x = 45;
    p.y = 47;
    s.spawnRaid();
    s.command({ type: 'draft', ids: [p.id], value: true });
    s.step(50);
    expect(p.x).toBe(45);
    expect(p.y).toBe(47);
  });
  it('doctors collect medicine and stop bleeding in a working patient', () => {
    const s = new Simulation();
    only(s, ['doctor', 'grow']);
    s.command({ type: 'zone', zone: 2, x: 48, y: 48, x2: 50, y2: 50 });
    const p = s.world.pawns[0];
    s.damage(p, 15, 2);
    const med = s.inventory().medicine;
    s.step(1600);
    expect(s.world.stats.tended).toBeGreaterThan(0);
    expect(p.wounds.every((w) => w.tended)).toBe(true);
    expect(s.inventory().medicine).toBe(med - 1);
    expect(p.dead).toBe(false);
  });
  it('downed patients are rescued to beds and bandaged', () => {
    const s = new Simulation();
    only(s, ['doctor']);
    fixtureBuilding(s, 'medical', 44, 43);
    const p = s.world.pawns[0];
    p.x = 40;
    p.y = 48;
    p.blood = 35;
    p.downed = true;
    s.damage(p, 12, 2);
    s.step(1800);
    expect(p.dead).toBe(false);
    expect(p.wounds.every((w) => w.tended)).toBe(true);
    expect(Math.round(p.x)).toBe(44);
    expect(Math.round(p.y)).toBe(43);
    expect(s.world.logs.some((l) => l.text.includes('救回床位'))).toBe(true);
  });
  it('unreachable patients do not consume medicine', () => {
    const s = new Simulation();
    only(s, ['doctor']);
    const p = s.world.pawns[0];
    p.x = 10;
    p.y = 10;
    p.priorities.doctor = 0;
    s.damage(p, 10, 2);
    for (const [x, y] of [
      [9, 10],
      [11, 10],
      [10, 9],
      [10, 11],
    ])
      s.world.terrain[y * SIZE + x] = 2;
    s.rebuildNav();
    s.step(300);
    expect(s.inventory().medicine).toBe(12);
  });
  it('grow, harvest and replant create a repeating food supply in normal weather', () => {
    const s = new Simulation();
    only(s, ['grow']);
    s.world.nextWeather = DAY * 100;
    s.command({ type: 'zone', zone: 2, x: 48, y: 45, x2: 53, y2: 52 });
    s.step(DAY * 4);
    expect(s.world.stats.harvested).toBeGreaterThan(25);
    expect(s.inventory().raw).toBeGreaterThan(150);
    expect(s.world.crops.length).toBeGreaterThan(20);
    expect(s.world.pawns.filter((p) => !p.animal).every((p) => !p.dead)).toBe(true);
  });
  it('recipes collect ingredients from several small stacks without losing reservations', () => {
    const s = new Simulation();
    only(s, ['cook']);
    s.world.items = s.world.items.filter((i) => i.kind !== 'raw');
    s.addItem('raw', 8, 42, 48);
    s.addItem('raw', 8, 44, 48);
    fixtureBuilding(s, 'stove', 46, 44);
    s.step(1600);
    expect(s.world.stats.cooked).toBe(1);
    expect(s.inventory().raw).toBe(6);
    expect(s.world.items.every((i) => i.reserved === 0)).toBe(true);
  });
  it('independent power networks stop a disconnected beacon and resume without duplicate waves', () => {
    const s = new Simulation();
    only(s, []);
    fixtureBuilding(s, 'generator', 40, 43);
    const wire = fixtureBuilding(s, 'wire', 42, 43);
    const beacon = fixtureBuilding(s, 'beacon', 43, 43);
    s.step(100);
    expect(beacon.powered).toBe(true);
    expect(s.command({ type: 'beacon' }).ok).toBe(true);
    s.step(100);
    const before = s.world.beaconTicks;
    s.world.buildings = s.world.buildings.filter((b) => b !== wire);
    s.step(200);
    const paused = s.world.beaconTicks;
    s.step(200);
    expect(s.world.beaconTicks).toBe(paused);
    expect(paused).toBeGreaterThanOrEqual(before);
    fixtureBuilding(s, 'wire', 42, 43);
    s.step(200);
    expect(s.world.beaconTicks).toBeGreaterThan(paused);
  });
  it('beacon final waves replace ordinary raids and are serialized', () => {
    const s = new Simulation();
    only(s, []);
    fixtureBuilding(s, 'generator', 40, 43);
    fixtureBuilding(s, 'beacon', 42, 43);
    s.step(100);
    s.command({ type: 'beacon' });
    s.world.beaconTicks = DAY * 0.5 - 1;
    s.world.nextRaid = s.world.tick + 1;
    s.step();
    expect(s.world.stats.raids).toBe(1);
    expect(s.world.finalWaves).toBe(1);
    const copy = new Simulation();
    copy.load(s.save());
    copy.step(100);
    expect(copy.world.stats.raids).toBe(1);
  });
  it('continuing after victory restores normal raids without restarting the finale', () => {
    const s = new Simulation();
    only(s, []);
    expect(s.command({ type: 'continue' }).ok).toBe(false);
    fixtureBuilding(s, 'generator', 40, 43);
    fixtureBuilding(s, 'beacon', 42, 43);
    s.step(100);
    s.command({ type: 'beacon' });
    s.world.beaconTicks = DAY * 2 - 1;
    s.world.finalWaves = 2;
    s.step();
    expect(s.world.outcome).toBe('won');
    const victoryTick = s.world.tick;
    s.step(50);
    expect(s.world.tick).toBe(victoryTick);
    expect(s.command({ type: 'continue' }).ok).toBe(true);
    expect(s.world.beaconActive).toBe(false);
    expect(s.world.nextRaid).toBe(victoryTick + DAY * 4);
    const copy = new Simulation();
    copy.load(s.save());
    s.step(100);
    copy.step(100);
    expect(s.save()).toEqual(copy.save());
    expect(s.world.tick).toBe(victoryTick + 100);
    expect(s.command({ type: 'continue' }).ok).toBe(false);
    expect(s.world.nextRaid).toBe(victoryTick + DAY * 4);
    expect(s.command({ type: 'beacon' }).ok).toBe(false);
    s.world.nextRaid = s.world.tick + 1;
    const raids = s.world.stats.raids;
    s.step();
    expect(s.world.stats.raids).toBe(raids + 1);
    expect(s.world.beaconTicks).toBe(DAY * 2);
    expect(s.world.finalWaves).toBe(2);
  });
  it('research requires an unlocked prerequisite and actual labor', () => {
    const s = new Simulation();
    only(s, ['research']);
    expect(s.command({ type: 'research', target: 'beacon' }).ok).toBe(false);
    s.step(2000);
    expect(s.world.research.electricity ?? 0).toBe(0);
    fixtureBuilding(s, 'research', 46, 44);
    s.step(6000);
    expect(s.world.research.electricity).toBeGreaterThan(0);
    expect(s.command({ type: 'build', kind: 'beacon', x: 49, y: 42 }).ok).toBe(false);
  });
  it('crafting consumes metal and worker time, not a passive timer', () => {
    const s = new Simulation();
    only(s, []);
    s.world.research.machining = TECHS.machining.cost;
    fixtureBuilding(s, 'workbench', 46, 43);
    s.step(1000);
    expect(s.inventory().components).toBe(10);
    only(s, ['craft']);
    s.step(1200);
    expect(s.inventory().components).toBeGreaterThan(10);
    expect(s.inventory().steel).toBeLessThan(100);
  });
  it('power readouts survive loading while paused', () => {
    const s = new Simulation();
    only(s, []);
    fixtureBuilding(s, 'generator', 40, 43);
    fixtureBuilding(s, 'beacon', 42, 43);
    s.step(100);
    const copy = new Simulation();
    copy.load(s.save());
    expect(copy.summary().power).toEqual(s.summary().power);
    expect(copy.summary().power.generated).toBe(800);
  });
  it('completed beds clear crops and cannot be zoned as farmland', () => {
    const s = new Simulation();
    only(s, ['build']);
    s.command({ type: 'zone', zone: 2, x: 45, y: 43, x2: 45, y2: 44 });
    s.world.crops.push({ x: 45, y: 43, growth: 0.5, crop: 'grain', reserved: 0 });
    s.command({ type: 'build', kind: 'bed', x: 45, y: 43 });
    s.step(1400);
    expect(s.world.crops).toHaveLength(0);
    expect(s.world.zones[43 * SIZE + 45]).toBe(0);
    s.command({ type: 'zone', zone: 2, x: 45, y: 43, x2: 45, y2: 44 });
    expect(s.world.zones[43 * SIZE + 45]).toBe(0);
  });
});
