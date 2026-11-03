import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { initialTrade } from '../src/voxel/trade';
import { initialFireHazards } from '../src/voxel/fire';
import { initialWeather } from '../src/voxel/weather';
import { makeWeapon } from '../src/voxel/weapons';
import { makeApparel } from '../src/voxel/apparel';
import { makeWeaponBench } from '../src/voxel/weaponProduction';
import { applyInjury } from '../src/voxel/injuries';
import { BODY_PARTS } from '../src/voxel/anatomy';
import { healthSummary } from '../src/voxel/survival';
import { initialResearch, RESEARCH_DEFS } from '../src/voxel/research';
import { TREE_DATA } from '../src/voxel/plants';
import { Block, index, weaponBenchInteraction, researchBenchInteraction, type Pos, type Projectile, type TreeSpecies, type VoxelCommand } from '../src/voxel/types';

const pos = (x: number, y = 16, z = 8): Pos => ({ x, y, z });
function command(s: VoxelSimulation, c: VoxelCommand) {
  const r = s.command(c);
  expect(r.ok, r.message).toBe(true);
}
function until(s: VoxelSimulation, done: () => boolean, limit = 120) {
  for (let i = 0; i < limit && !done(); i++) s.step();
  expect(done(), JSON.stringify({ tick: s.tick, pawns: s.pawns.map(p => [p.id, p.reason, p.shooting]), events: s.combatEvents })).toBe(true);
}
// Controlled geometry, initial gear and deterministic seed selection isolate the
// integrated state machine. These are test scenarios, not ordinary campaign proof.
// Attack, aiming, burst, impact, movement and save/load use public command/step APIs.
function fixture(kind: 'shortBow' | 'revolver' | 'machinePistol' = 'revolver', seed = 1) {
  const s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 });
  s.seed = seed;
  s.trade = initialTrade(s.seed, s.tick);
  s.fireHazards = initialFireHazards(s.seed, s.tick);
  s.weather = initialWeather(s.seed, s.settings, s.tick, s.generator);
  // Isolated terrain fixture excludes the newly spawned wildlife.
  s.animals = [];
  s.blocks.fill(Block.Stone);
  s.ladders.fill(0);
  s.trees = [];
  s.items = [];
  s.stockpiles = [];
  for (let x = 8; x <= 36; x++)
    for (let y = 10; y <= 28; y++)
      for (let z = 8; z < 16; z++) s.blocks[index(x, y, z)] = Block.Air;
  s.spawn = pos(12);
  s.pawns.forEach((p, i) => {
    Object.assign(p, i === 0 ? pos(12) : i === 1 ? pos(30) : pos(12, 25));
    p.worn = [];
    p.weapon = null;
    p.schedule.fill('work');
    for (const key of Object.keys(p.priorities)) p.priorities[key as keyof typeof p.priorities] = 0;
  });
  s.pawns[0].weapon = makeWeapon(s.nextId++, kind);
  s.pawns[0].skills.shooting.level = 20;
  command(s, { type: 'threats', enabled: false });
  const loaded = VoxelSimulation.load(s.save());
  for (const p of loaded.pawns) command(loaded, { type: 'draft', pawnId: p.id, drafted: true });
  return loaded;
}
function attack(s: VoxelSimulation) {
  command(s, { type: 'attack', pawnId: s.pawns[0].id, targetId: s.pawns[1].id });
}
function fires(s: VoxelSimulation) {
  return s.combatEvents.filter(e => e.kind === 'fire' && e.shooterId === s.pawns[0].id);
}
function firstShot(s: VoxelSimulation): Projectile {
  attack(s);
  until(s, () => s.projectiles.length > 0);
  return structuredClone(s.projectiles[0]);
}
function stopShooter(s: VoxelSimulation) {
  command(s, { type: 'draft', pawnId: s.pawns[0].id, drafted: false });
}
function aimedScenario(configure: (s: VoxelSimulation) => void = () => {}, kind: 'shortBow' | 'revolver' | 'machinePistol' = 'revolver') {
  for (let seed = 1; seed <= 40; seed++) {
    const s = fixture(kind, seed);
    configure(s);
    const shot = firstShot(s);
    if (shot.canHitIntended) return { s, shot, seed };
  }
  throw new Error('No aimed shot found in bounded deterministic scenario search');
}
function addTree(s: VoxelSimulation, species: TreeSpecies, health = 1) {
  const tree = { ...pos(29), id: s.nextId++, species, wood: TREE_DATA[species].wood, growth: 1, age: 0, planted: false, health, unlitTicks: 0 };
  s.trees.push(tree);
  return tree;
}

describe('ranged command and phase integration in controlled scenes', () => {
  it.each(['x', 'y'] as const)('rejects new workbenches whose %s interaction cell is a sandbag', axis => {
    for (const tool of ['smithy', 'machining', 'stonecutter', 'tailor', 'researchBench'] as const) {
      const s = fixture(), anchor = pos(20, 20);
      s.research = initialResearch(true);
      s.research.progress.Machining = RESEARCH_DEFS.Machining.cost;
      const interaction = tool === 'researchBench'
        ? researchBenchInteraction({ ...anchor, axis })
        : weaponBenchInteraction({ ...anchor, axis, kind: 'smithy' });
      s.sandbags.push({ ...interaction, id: s.nextId++, hitPoints: 300 });
      const result = s.command({ type: 'designate', tool, from: anchor, axis });
      expect(result.ok, `${tool}: ${result.message}`).toBe(false);
      expect(s.jobs).toEqual([]);
    }
  });

  it.each(['smithy-x', 'smithy-y', 'machining-x', 'machining-y'] as const)('blocks %s production on a sandbag interaction cell and resumes after normal removal', variant => {
    let s = fixture();
    s.pawns[0].weapon = null;
    const kind = variant.startsWith('machining') ? 'machining' : 'smithy', axis = variant.endsWith('x') ? 'x' : 'y';
    const bench = makeWeaponBench(s.nextId++, kind, pos(20, 20), axis), interaction = weaponBenchInteraction(bench);
    if (kind === 'smithy') bench.fuel = 50;
    s.weaponBenches.push(bench);
    s.sandbags.push({ ...interaction, id: s.nextId++, hitPoints: 300 });
    s.research = initialResearch(true);
    for (const key of ['Machining', 'Gunsmithing', 'BlowbackOperation'] as const) s.research.progress[key] = RESEARCH_DEFS[key].cost;
    if (kind === 'machining') {
      s.devices.push({ ...pos(16, 20), id: s.nextId++, kind: 'generator', axis: 'x', on: true, fuel: 75, energy: 0, target: 21, powered: false, active: false, networkId: null, watts: 0, reason: 'controlled test' });
      s.items.push({ ...pos(13, 18), id: s.nextId++, resource: 'steel', amount: 30 }, { ...pos(14, 18), id: s.nextId++, resource: 'components', amount: 2 });
    } else s.items.push({ ...pos(13, 18), id: s.nextId++, resource: 'wood', amount: 30 });
    s = VoxelSimulation.load(s.save());
    for (const p of s.pawns) command(s, { type: 'draft', pawnId: p.id, drafted: false });
    s.pawns[0].priorities.craft = 1;
    s.pawns[0].skills.crafting.level = 12;
    command(s, { type: 'weaponBill', benchId: bench.id, kind: kind === 'machining' ? 'revolver' : 'shortBow', target: 1, paused: false });
    s.step(120);
    expect(s.jobs.find(j => j.kind === 'smith')?.progress).toBe(0);
    expect(s.pawns[0].x === interaction.x && s.pawns[0].y === interaction.y).toBe(false);
    expect(s.path(s.pawns[0], interaction)).toBeNull();
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
    s.pawns[1].priorities.build = 1;
    command(s, { type: 'designate', tool: 'remove', from: interaction });
    until(s, () => s.sandbags.length === 0, 1000);
    until(s, () => s.jobs.some(j => j.kind === 'smith' && j.progress > 0), 1000);
    expect(s.pawns[0]).toMatchObject(interaction);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it.each(['sandbag', 'machining-x-first', 'machining-x-middle', 'machining-x-last', 'machining-y-first', 'machining-y-middle', 'machining-y-last'] as const)('protects every occupied support cell under %s when a lower-floor demolition finishes', kind => {
    let s = fixture();
    const anchor = pos(20, 20, 9), axis = kind.startsWith('machining-y') ? 'y' : 'x';
    const cells = kind === 'sandbag' ? [anchor] : [anchor, { ...anchor, [axis]: anchor[axis] + 1 }, { ...anchor, [axis]: anchor[axis] + 2 }];
    for (const p of cells) s.blocks[index(p.x, p.y, p.z - 1)] = Block.Wood;
    if (kind === 'sandbag') s.sandbags.push({ ...anchor, id: s.nextId++, hitPoints: 300 });
    else s.weaponBenches.push(makeWeaponBench(s.nextId++, 'machining', anchor, axis));
    s = VoxelSimulation.load(s.save());
    command(s, { type: 'draft', pawnId: s.pawns[0].id, drafted: false });
    s.pawns[0].priorities.build = 1;
    const target = cells[kind.endsWith('middle') ? 1 : kind.endsWith('last') ? 2 : 0];
    command(s, { type: 'designate', tool: 'remove', from: { ...target, z: target.z - 1 } });
    until(s, () => s.blocks[index(target.x, target.y, target.z - 1)] === Block.Air || s.jobs.some(j => j.kind === 'remove' && j.reason.includes('支撑')), 800);
    expect(s.blocks[index(target.x, target.y, target.z - 1)]).toBe(Block.Wood);
    expect(s.stats.produced.wood).toBe(0);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it.each(['drop', 'replace'] as const)('%s weapon orders cancel an active burst with the original weapon cooldown intact', action => {
    const s = fixture('machinePistol');
    attack(s);
    until(s, () => s.pawns[0].shooting?.phase === 'burst');
    const tick = s.tick, shots = fires(s).length, flying = structuredClone(s.projectiles);
    if (action === 'replace') {
      const weapon = makeWeapon(s.nextId++, 'revolver');
      s.items.push({ ...pos(13), id: s.nextId++, resource: 'weapon', amount: 1, weapon });
      command(s, { type: 'equipWeapon', pawnId: s.pawns[0].id, weaponId: weapon.id });
    } else command(s, { type: 'dropWeapon', pawnId: s.pawns[0].id });
    expect(s.pawns[0].shooting).toBeNull();
    expect(s.pawns[0].nextAttackTick).toBe(tick + 18);
    expect(s.projectiles).toEqual(flying);
    s.step(8);
    expect(fires(s)).toHaveLength(shots);
    expect(s.pawns[0].nextAttackTick).toBe(tick + 18);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it.each(['aim', 'burst'] as const)('a standing shooter who loses manipulation cancels %s before physically dropping the weapon', phase => {
    const s = fixture('machinePistol');
    attack(s);
    s.step();
    if (phase === 'burst') until(s, () => s.pawns[0].shooting?.phase === 'burst');
    const pawn = s.pawns[0], weapon = structuredClone(pawn.weapon), before = fires(s).length;
    // Explicit injury fixtures exercise the normal health reconciliation and drop path.
    for (const part of ['leftHand', 'rightHand'] as const)
      applyInjury(pawn.trauma, s.nextId++, part, 'cut', BODY_PARTS[part].hitPoints + 1);
    s.step();
    expect(pawn.dead || pawn.downed).toBe(false);
    expect(healthSummary(pawn).manipulation).toBe(0);
    expect(pawn.weapon).toBeNull();
    expect(s.items.find(i => i.weapon?.id === weapon!.id)?.weapon).toEqual(weapon);
    expect(pawn.shooting).toBeNull();
    if (phase === 'burst') expect(pawn.nextAttackTick).toBe(s.tick + 18);
    expect(fires(s)).toHaveLength(before);
    expect(() => VoxelSimulation.load(s.save())).not.toThrow();
  });

  it('a normal attack order aims before launching and launches before injury', () => {
    const { s, shot } = aimedScenario();
    const launchTick = fires(s)[0].tick;
    expect(launchTick).toBeGreaterThanOrEqual(6);
    expect(s.pawns[1].trauma.wounds).toEqual([]);
    expect(shot.launchedTick).toBe(s.tick);
    expect(shot.impactTick).toBeGreaterThan(s.tick);
    expect(s.pawns[0].nextAttackTick).toBe(launchTick + 32);
    stopShooter(s);
    s.step(shot.impactTick - s.tick - 1);
    expect(s.pawns[1].trauma.wounds).toEqual([]);
    s.step();
    expect(s.pawns[1].trauma.wounds.length).toBeGreaterThan(0);
    expect(s.combatEvents.some(e => e.kind === 'hit' && e.tick === shot.impactTick)).toBe(true);
  });

  it('a three-round burst maps native pawn offsets 0, 6, 13 to project offsets 0, 2, 5 and trains once per burst', () => {
    const s = fixture('machinePistol');
    attack(s);
    until(s, () => fires(s).length === 1);
    const first = fires(s)[0].tick, learned = s.pawns[0].skills.shooting.dailyXp;
    expect(learned).toBeGreaterThan(0);
    expect(s.pawns[0].shooting?.shotsLeft).toBe(2);
    until(s, () => fires(s).length === 3);
    expect(fires(s).map(e => e.tick - first)).toEqual([0, 2, 5]);
    expect(s.pawns[0].skills.shooting.dailyXp).toBe(learned);
    expect(s.pawns[0].shooting).toBeNull();
    expect(s.pawns[0].nextAttackTick).toBe(first + 5 + 18);
  });

  it.each(['aim', 'burst'] as const)('moving cancels %s without deleting already launched projectiles', phase => {
    const s = fixture('machinePistol');
    attack(s);
    s.step();
    expect(s.pawns[0].shooting?.phase).toBe('aim');
    if (phase === 'burst') until(s, () => s.pawns[0].shooting?.phase === 'burst');
    const before = fires(s).length, projectiles = structuredClone(s.projectiles), tick = s.tick;
    command(s, { type: 'move', pawnId: s.pawns[0].id, target: pos(12, 22) });
    expect(s.pawns[0].shooting).toBeNull();
    expect(s.pawns[0].attackTargetId).toBeNull();
    expect(s.projectiles).toEqual(projectiles);
    if (phase === 'burst') expect(s.pawns[0].nextAttackTick).toBeGreaterThanOrEqual(tick + 18);
    s.step(8);
    expect(fires(s)).toHaveLength(before);
    expect(s.pawns[0].y).toBeGreaterThan(16);
  });

  it.each(['aim', 'burst'] as const)('save/load resumes %s and in-flight state without duplicated shots or damage', phase => {
    const s = fixture('machinePistol');
    attack(s);
    s.step();
    if (phase === 'burst') until(s, () => s.pawns[0].shooting?.phase === 'burst' && s.projectiles.length > 0);
    expect(s.pawns[0].shooting?.phase).toBe(phase);
    const snapshot = s.save(), before = structuredClone(snapshot), loaded = VoxelSimulation.load(snapshot);
    expect(snapshot).toEqual(before);
    expect(loaded.pawns[0].shooting).toEqual(s.pawns[0].shooting);
    expect(loaded.projectiles).toEqual(s.projectiles);
    for (let i = 0; i < 25; i++) {
      s.step();
      loaded.step();
      expect(loaded.projectiles).toEqual(s.projectiles);
      expect(loaded.combatEvents).toEqual(s.combatEvents);
      expect(loaded.pawns.map(p => [p.shooting, p.nextAttackTick, p.staggerUntil, p.trauma, p.skills.shooting])).toEqual(s.pawns.map(p => [p.shooting, p.nextAttackTick, p.staggerUntil, p.trauma, p.skills.shooting]));
    }
  });

  it('moving the target away from the recorded destination preserves intended-target identity impact', () => {
    const { s, shot } = aimedScenario();
    stopShooter(s);
    command(s, { type: 'move', pawnId: s.pawns[1].id, target: pos(30, 22) });
    s.step(shot.impactTick - s.tick);
    expect(s.pawns[1].y).toBeGreaterThan(16);
    expect(Math.floor(shot.destination.y)).toBe(16);
    expect(s.pawns[1].trauma.wounds.length).toBeGreaterThan(0);
    expect(s.combatEvents.some(e => e.kind === 'hit' && e.targetId === s.pawns[1].id && e.y === s.pawns[1].y)).toBe(true);
  });

  it('a wild projectile cannot hit its original target through the non-target-pawn flag', () => {
    let found: VoxelSimulation | null = null;
    for (let seed = 1; seed <= 40; seed++) {
      const s = fixture('shortBow', seed), shot = firstShot(s);
      if (shot.canHitIntended || !shot.canHitOthers || shot.coverId !== null) continue;
      const destination = pos(Math.floor(shot.destination.x), Math.floor(shot.destination.y), Math.floor(shot.destination.z));
      if (Math.abs(destination.x - 30) + Math.abs(destination.y - 16) > 2) continue;
      stopShooter(s);
      command(s, { type: 'move', pawnId: s.pawns[1].id, target: destination });
      s.step(shot.impactTick - s.tick);
      if (s.pawns[1].x !== destination.x || s.pawns[1].y !== destination.y) continue;
      found = s;
      break;
    }
    expect(found).not.toBeNull();
    expect(found!.pawns[1].trauma.wounds).toEqual([]);
    expect(found!.combatEvents.some(e => ['hit', 'deflect'].includes(e.kind))).toBe(false);
    expect(found!.projectiles).toEqual([]);
  });

  it.each(['wall', 'floor'] as const)('solid %s inserted ahead of an in-flight projectile blocks impact', kind => {
    const { s, shot } = aimedScenario(scene => {
      if (kind === 'floor') {
        Object.assign(scene.pawns[1], pos(30, 16, 11));
        scene.blocks[index(30, 16, 10)] = Block.Wood;
      }
    });
    stopShooter(s);
    // Deliberate test geometry change after launch isolates collision from initial LOS.
    const obstruction = kind === 'wall' ? pos(21) : pos(24, 16, 10);
    s.blocks[index(obstruction.x, obstruction.y, obstruction.z)] = Block.Wood;
    s.step(shot.impactTick - s.tick);
    expect(s.projectiles).toEqual([]);
    expect(s.pawns[1].trauma.wounds).toEqual([]);
    expect(s.combatEvents.some(e => e.kind === 'terrain' && e.x === obstruction.x && e.z === obstruction.z)).toBe(true);
  });

  it('a resting pawn retains adjacent cover in the world report', () => {
    const s = fixture();
    s.sandbags.push({ ...pos(29), id: s.nextId++, hitPoints: 300 });
    s.pawns[1].phase = 'rest';
    const report = s.shotReport(s.pawns[0], s.pawns[1]);
    expect(report?.postureFactor).toBe(.5);
    expect(report?.passCover).toBeCloseTo(.45, 12);
    expect(report?.canBenefitFromCover).toBe(true);
  });
});

describe('ranged physical effects and strict persistence in controlled scenes', () => {
  it('a friendly pawn in flight can intercept a shot before its intended target', () => {
    let result: VoxelSimulation | null = null;
    for (let seed = 1; seed <= 80; seed++) {
      const s = fixture('revolver', seed);
      Object.assign(s.pawns[2], pos(24));
      const shot = firstShot(s);
      stopShooter(s);
      s.step(shot.impactTick - s.tick);
      if (s.combatEvents.some(e => e.kind === 'hit' && e.targetId === s.pawns[2].id)) { result = s; break; }
    }
    expect(result).not.toBeNull();
    expect(result!.pawns[2].trauma.wounds.length).toBeGreaterThan(0);
    expect(result!.pawns[1].trauma.wounds).toEqual([]);
    expect(fires(result!)).toHaveLength(1);
  });

  it.each(['sandbag', 'poplar', 'saguaro'] as const)('a real cover-directed shot damages %s using its physical HP', type => {
    let found: { s: VoxelSimulation; id: number } | null = null;
    for (let seed = 1; seed <= 80; seed++) {
      const s = fixture('revolver', seed);
      const cover = type === 'sandbag'
        ? { ...pos(29), id: s.nextId++, hitPoints: 300 }
        : addTree(s, type);
      if (type === 'sandbag') s.sandbags.push(cover as typeof s.sandbags[number]);
      const shot = firstShot(s);
      if (shot.coverId !== cover.id) continue;
      stopShooter(s);
      s.step(shot.impactTick - s.tick);
      if (s.combatEvents.some(e => e.kind === 'cover' && e.targetId === cover.id)) { found = { s, id: cover.id }; break; }
    }
    expect(found).not.toBeNull();
    const { s, id } = found!;
    if (type === 'sandbag') expect(s.sandbags.find(b => b.id === id)?.hitPoints).toBe(288);
    else expect(s.trees.find(t => t.id === id)?.health).toBeCloseTo(1 - 12 / (type === 'saguaro' ? 130 : 200), 12);
    expect(s.pawns[1].trauma.wounds).toEqual([]);
    const saved = s.save(), loaded = VoxelSimulation.load(saved);
    expect(loaded.sandbags).toEqual(s.sandbags);
    expect(loaded.trees).toEqual(s.trees);
  });

  it('a left-HP sandbag hit is destroyed once without creating material loot', () => {
    let found: VoxelSimulation | null = null;
    for (let seed = 1; seed <= 40; seed++) {
      const s = fixture('revolver', seed), id = s.nextId++;
      s.sandbags.push({ ...pos(29), id, hitPoints: 1 });
      const shot = firstShot(s);
      if (shot.coverId !== id) continue;
      stopShooter(s);
      s.step(shot.impactTick - s.tick);
      if (!s.sandbags.some(b => b.id === id)) { found = s; break; }
    }
    expect(found).not.toBeNull();
    expect(found!.items).toEqual([]);
    expect(found!.combatEvents.filter(e => e.kind === 'cover')).toHaveLength(1);
    expect(found!.combatEvents.find(e => e.kind === 'cover')?.damage).toBe(1);
    const restored = VoxelSimulation.load(found!.save());
    restored.step(25);
    expect(restored.sandbags).toEqual([]);
    expect(restored.items).toEqual([]);
  });

  it('a fully armor-deflected revolver hit still reduces armor HP and applies stagger', () => {
    let found: { s: VoxelSimulation; hitTick: number } | null = null;
    for (let seed = 1; seed <= 80; seed++) {
      const s = fixture('revolver', seed);
      s.pawns[1].worn = [makeApparel(s.nextId++, 'plateArmor', 6), makeApparel(s.nextId++, 'simpleHelmet', 6)];
      const before = s.pawns[1].worn.reduce((n, p) => n + p.hitPoints, 0), shot = firstShot(s);
      stopShooter(s);
      s.step(shot.impactTick - s.tick);
      const deflect = s.combatEvents.find(e => e.kind === 'deflect');
      if (deflect) {
        expect(s.pawns[1].worn.reduce((n, p) => n + p.hitPoints, 0)).toBeLessThan(before);
        found = { s, hitTick: deflect.tick }; break;
      }
    }
    expect(found).not.toBeNull();
    const { s, hitTick } = found!;
    expect(s.pawns[1].trauma.wounds).toEqual([]);
    expect(s.pawns[1].staggerUntil).toBe(hitTick + 32);
    expect(s.pawns[1].staggerUntil).toBeGreaterThan(s.tick);
    const loaded = VoxelSimulation.load(s.save());
    expect(loaded.pawns[1].staggerUntil).toBe(s.pawns[1].staggerUntil);
  });

  it('rejects altered projectile payloads, timing, identities and shooting phases on load', () => {
    const s = fixture('machinePistol');
    firstShot(s);
    expect(s.pawns[0].shooting?.phase).toBe('burst');
    const baseline = s.save();
    expect(() => VoxelSimulation.load(baseline)).not.toThrow();
    const mutations: [string, (v: any) => void][] = [
      ['damage', v => v.projectiles[0].damage++],
      ['penetration', v => v.projectiles[0].armorPenetration += .001],
      ['flight time', v => v.projectiles[0].impactTick++],
      ['already expired', v => v.projectiles[0].impactTick = v.tick],
      ['future launch', v => v.projectiles[0].launchedTick = v.tick + 1],
      ['unknown weapon', v => v.projectiles[0].kind = 'autopistol'],
      ['quality', v => v.projectiles[0].quality = 7],
      ['noncenter destination', v => v.projectiles[0].destination.x += .1],
      ['nonfinite origin', v => v.projectiles[0].from.x = NaN],
      ['self target', v => v.projectiles[0].targetId = v.projectiles[0].shooterId],
      ['faction', v => v.projectiles[0].shooterFaction = 'raider'],
      ['duplicate identity', v => v.projectiles[0].id = v.pawns[0].id],
      ['duplicate projectile', v => v.projectiles.push(structuredClone(v.projectiles[0]))],
      ['flag', v => v.projectiles[0].canHitWorld = 1],
      ['inconsistent cover target', v => { v.projectiles[0].coverId = v.pawns[1].id; v.projectiles[0].canHitIntended = true; }],
      ['posture chance', v => v.projectiles[0].postureImpactChance = .7],
      ['phase', v => v.pawns[0].shooting.phase = 'cooldown'],
      ['burst clock', v => v.pawns[0].shooting.nextShotTick++],
      ['burst count', v => v.pawns[0].shooting.shotsLeft = 3],
      ['weapon reference', v => v.pawns[0].shooting.weaponId++],
      ['target reference', v => v.pawns[0].shooting.targetId = v.pawns[2].id],
      ['origin moved', v => v.pawns[0].shooting.origin.y++],
      ['cooldown while shooting', v => v.pawns[0].nextAttackTick = v.tick + 1],
      ['stagger overflow', v => v.pawns[1].staggerUntil = v.tick + 33],
      ['future event', v => v.combatEvents[0].tick = v.tick + 1],
    ];
    for (const [label, change] of mutations) {
      const corrupted = structuredClone(baseline);
      change(corrupted);
      expect(() => VoxelSimulation.load(corrupted), label).toThrow();
    }
  });
});
