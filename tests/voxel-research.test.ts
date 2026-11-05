import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { VoxelSimulation } from '../src/voxel/world';
import {
  Block,
  index,
  researchBenchCells,
  researchBenchInteraction,
  type Pos,
  type VoxelCommand,
} from '../src/voxel/types';
import {
  initialResearch,
  validResearch,
  researchComplete,
  researchPointsPerTick,
  simpleBenchFactor,
  RESEARCH_DEFS,
  RESEARCH_KEYS,
  RESEARCH_SESSION_TICKS,
} from '../src/voxel/research';
import { initialSkills, researchSpeed } from '../src/voxel/skills';
import { makeWeaponBench } from '../src/voxel/weaponProduction';

const pos = (x: number, y: number, z = 8): Pos => ({ x, y, z });
// Controlled terrain/materials isolate work eligibility and transaction boundaries.
// No research progress is granted except the explicitly labelled near-completion case.
function fixture(benches = 1) {
  const s = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 }, false, 2) /* Controlled geometry: historical full visibility. */;
  // Isolated terrain fixture excludes the newly spawned wildlife.
  s.animals = [];
  s.blocks.fill(Block.Stone);
  s.ladders.fill(0);
  s.trees = [];
  s.items = [];
  s.stockpiles = [];
  for (let x = 10; x <= 30; x++)
    for (let y = 10; y <= 30; y++) {
      s.blocks[index(x, y, 7)] = Block.Soil;
      for (let z = 8; z < 16; z++) s.blocks[index(x, y, z)] = Block.Air;
    }
  s.spawn = pos(11, 11);
  s.pawns.forEach((p, i) => {
    Object.assign(p, pos(11, 11 + i));
    p.schedule.fill('work');
    for (const k of Object.keys(p.priorities)) p.priorities[k as keyof typeof p.priorities] = 0;
    p.priorities.research = 4;
  });
  for (let i = 0; i < benches; i++)
    s.researchBenches.push({ id: s.nextId++, ...pos(16 + i * 6, 16), axis: 'x' });
  return VoxelSimulation.load(s.save());
}
function command(s: VoxelSimulation, c: VoxelCommand) {
  const r = s.command(c);
  expect(r.ok, r.message).toBe(true);
  return r;
}
function until(s: VoxelSimulation, done: () => boolean, max = 4000) {
  for (let i = 0; i < max && !done(); i++) s.step();
  expect(
    done(),
    JSON.stringify({ tick: s.tick, jobs: s.jobs, pawns: s.pawns.map((p) => p.reason) }),
  ).toBe(true);
}

describe('research definitions and native time conversion', () => {
  it('starts with the seven industrial technologies and preserves previous releases as legacy unlocked', () => {
    const state = initialResearch();
    expect(RESEARCH_KEYS.filter((k) => researchComplete(state, k))).toHaveLength(7);
    expect(validResearch(state)).toBe(true);
    expect(
      RESEARCH_KEYS.filter((k) => !['PlateArmor', 'Machining', 'Gunsmithing', 'BlowbackOperation'].includes(k)).every((k) =>
        researchComplete(initialResearch(true), k),
      ),
    ).toBe(true);
    expect(initialResearch(true).progress.PlateArmor).toBe(0);
    expect(RESEARCH_DEFS.LongBlades.prerequisites).toEqual(['Smithing']);
  });
  it('uses research speed, manipulation, outdoor and temperature factors at 20 TPS', () => {
    const skills = initialSkills(1);
    expect(researchSpeed(skills, 1)).toBe(1);
    expect(researchPointsPerTick(skills, 1, 0.75)).toBeCloseTo(0.00825 * 3 * 0.75, 12);
    expect(researchPointsPerTick(skills, 0, 0.75)).toBeCloseTo(0.02475 * 0.5 * 0.75, 12);
    expect(simpleBenchFactor(true, 20)).toBe(0.421875);
    expect(simpleBenchFactor(false, 9)).toBe(0.75);
    expect(simpleBenchFactor(false, 35)).toBe(0.75);
    expect(simpleBenchFactor(false, 8)).toBeCloseTo(0.525, 12);
  });
  it('rotates all six footprint cells and the operating position consistently', () => {
    const b = { ...pos(16, 16), axis: 'y' as const };
    expect(new Set(researchBenchCells(b).map((p) => `${p.x}/${p.y}`)).size).toBe(6);
    expect(researchBenchInteraction(b)).toEqual(pos(15, 17));
    expect(researchBenchCells(b)).toContainEqual(pos(17, 18));
  });
});

describe('physical research work, scheduling and progression', () => {
  it('allows project selection without a bench, but neither progress nor XP appears', () => {
    const s = fixture(0),
      before = structuredClone(s.pawns.map((p) => p.skills.intellectual));
    command(s, { type: 'research', project: 'Batteries' });
    s.step(100);
    expect(s.research.progress.Batteries).toBe(0);
    expect(s.pawns.map((p) => p.skills.intellectual)).toEqual(before);
    expect(s.jobs).toHaveLength(0);
  });
  it('gains points then Intellectual XP only after arriving at the operating cell', () => {
    const s = fixture();
    command(s, { type: 'research', project: 'Batteries' });
    until(s, () => s.jobs.some((j) => j.workTicks > 0));
    const j = s.jobs.find((j) => j.kind === 'research')!,
      p = s.pawns.find((p) => p.id === j.owner)!;
    expect(j.workTicks).toBe(1);
    expect({ x: p.x, y: p.y, z: p.z }).toEqual(researchBenchInteraction(s.researchBenches[0]));
    expect(s.research.progress.Batteries).toBeCloseTo(
      researchPointsPerTick(p.skills, 1, s.researchBenchFactor(s.researchBenches[0])),
      12,
    );
    expect(p.skills.intellectual.xp).toBeCloseTo(
      p.skills.intellectual.passion === 1 ? 0.3 : 0.105,
      12,
    );
    expect(s.pawns.filter((q) => q !== p).every((q) => q.skills.intellectual.xp === 0)).toBe(true);
  });
  it('preserves partial research through switch, stop, save and load', () => {
    let s = fixture();
    command(s, { type: 'research', project: 'Batteries' });
    until(s, () => s.research.progress.Batteries > 1);
    const progress = s.research.progress.Batteries;
    command(s, { type: 'research', project: 'Smithing' });
    until(s, () => s.research.progress.Smithing > 0.2);
    expect(s.research.progress.Batteries).toBe(progress);
    command(s, { type: 'research', project: null });
    const state = structuredClone(s.research),
      xp = s.pawns.map((p) => p.skills.intellectual.xp);
    s.step(80);
    expect(s.research).toEqual(state);
    expect(s.pawns.map((p) => p.skills.intellectual.xp)).toEqual(xp);
    s = VoxelSimulation.load(s.save());
    expect(s.research).toEqual(state);
    command(s, { type: 'research', project: 'Batteries' });
    until(s, () => s.research.progress.Batteries > progress);
  });
  it('adds simultaneous work at separate benches into one global project', () => {
    const s = fixture(2);
    command(s, { type: 'research', project: 'Batteries' });
    until(s, () => s.jobs.filter((j) => j.kind === 'research' && j.workTicks > 0).length === 2);
    const before = s.research.progress.Batteries;
    const expected = s.jobs
      .filter((j) => j.kind === 'research')
      .reduce(
        (n, j) =>
          n +
          researchPointsPerTick(
            s.pawns.find((p) => p.id === j.owner)!.skills,
            1,
            s.researchBenchFactor(s.researchBenches.find((b) => b.x === j.x)!),
          ),
        0,
      );
    s.step();
    expect(s.research.progress.Batteries - before).toBeCloseTo(expected, 12);
  });
  it('releases finite research sessions without resetting project progress', () => {
    const s = fixture();
    command(s, { type: 'research', project: 'Batteries' });
    until(s, () => s.jobs.some((j) => j.workTicks > 0));
    const id = s.jobs[0].id;
    until(s, () => !s.jobs.some((j) => j.id === id), RESEARCH_SESSION_TICKS + 100);
    expect(s.research.progress.Batteries).toBeGreaterThan(1);
    const before = s.research.progress.Batteries;
    until(s, () => s.research.progress.Batteries > before);
  });
  it('interrupts research for a newly reachable higher-priority construction job', () => {
    const s = fixture();
    command(s, { type: 'research', project: 'Batteries' });
    until(s, () => s.jobs.some((j) => j.workTicks > 0));
    const p = s.pawns.find((p) => p.jobId !== null)!;
    command(s, { type: 'priority', pawnId: p.id, work: 'build', value: 1 });
    s.items.push({ ...pos(12, 18), id: s.nextId++, resource: 'wood', amount: 6 });
    command(s, { type: 'designate', tool: 'wall', from: pos(14, 20) });
    until(s, () => s.jobs.some((j) => j.kind === 'wall' && j.owner === p.id), 30);
    expect(p.workTarget).toEqual(pos(14, 20));
  });
  it('stops work immediately on drafting and while all research priorities are disabled', () => {
    const s = fixture();
    command(s, { type: 'research', project: 'Batteries' });
    until(s, () => s.research.progress.Batteries > 0.2);
    for (const p of s.pawns) command(s, { type: 'draft', pawnId: p.id, drafted: true });
    const state = structuredClone(s.research),
      xp = s.pawns.map((p) => p.skills.intellectual.xp);
    s.step(80);
    expect(s.research).toEqual(state);
    expect(s.pawns.map((p) => p.skills.intellectual.xp)).toEqual(xp);
    for (const p of s.pawns) {
      command(s, { type: 'priority', pawnId: p.id, work: 'research', value: 0 });
      command(s, { type: 'draft', pawnId: p.id, drafted: false });
    }
    s.step(80);
    expect(s.research).toEqual(state);
  });
  it('does not repeatedly interrupt research for a higher-priority smith without fuel', () => {
    const s = fixture();
    // Controlled researched workshop isolates readiness from technology progression.
    s.research.progress.Smithing = 700;
    s.weaponBenches.push(makeWeaponBench(s.nextId++, 'smithy', pos(24, 23), 'x'));
    s.items.push({ ...pos(12, 18), id: s.nextId++, resource: 'steel', amount: 30 });
    command(s, { type: 'research', project: 'Batteries' });
    until(s, () => s.jobs.some((j) => j.kind === 'research' && j.workTicks > 0));
    const j = s.jobs.find((j) => j.kind === 'research')!,
      p = s.pawns.find((p) => p.id === j.owner)!;
    command(s, { type: 'priority', pawnId: p.id, work: 'craft', value: 1 });
    command(s, {
      type: 'weaponBill',
      benchId: s.weaponBenches[0].id,
      kind: 'steelKnife',
      target: 1,
      paused: false,
    });
    until(
      s,
      () =>
        s.jobs.find((v) => v.id === j.id)!.owner === p.id && p.phase === 'work' && !p.path.length,
    );
    const ticks = j.workTicks;
    s.step(100);
    expect(j.workTicks - ticks).toBe(100);
    expect(s.jobs.find((v) => v.kind === 'smith')?.progress).toBe(0);
  });
  it('stops a research job when demolition is designated and dismantles the real bench', () => {
    const s = fixture();
    command(s, { type: 'research', project: 'Batteries' });
    until(s, () => s.research.progress.Batteries > 0.2);
    const before = s.research.progress.Batteries;
    for (const p of s.pawns)
      command(s, { type: 'priority', pawnId: p.id, work: 'build', value: 1 });
    command(s, { type: 'designate', tool: 'remove', from: pos(18, 17) });
    until(s, () => s.researchBenches.length === 0);
    expect(s.research.progress.Batteries).toBe(before);
    expect(s.research.current).toBe('Batteries');
    expect(s.items.filter((i) => i.resource === 'wood').reduce((n, i) => n + i.amount, 0)).toBe(37);
    expect(s.items.filter((i) => i.resource === 'steel').reduce((n, i) => n + i.amount, 0)).toBe(
      12,
    );
  });
  it('completes once across simultaneous workers, clears all jobs and enables the unlock', () => {
    const s = fixture(2);
    expect(s.command({ type: 'designate', tool: 'battery', from: pos(26, 23) }).ok).toBe(false);
    command(s, { type: 'research', project: 'Batteries' });
    until(s, () => s.jobs.filter((j) => j.workTicks > 0).length === 2);
    // Controlled completion boundary; ordinary campaign proves all preceding points.
    s.research.progress.Batteries = 399.99999;
    const before = s.pawns.map((p) => p.skills.intellectual.xp);
    s.step();
    expect(s.research.progress.Batteries).toBe(400);
    expect(s.research.current).toBe(null);
    expect(s.jobs.filter((j) => j.kind === 'research')).toHaveLength(0);
    expect(s.pawns.filter((p, i) => p.skills.intellectual.xp > before[i])).toHaveLength(1);
    command(s, { type: 'designate', tool: 'battery', from: pos(26, 23) });
    expect(s.command({ type: 'research', project: 'Batteries' }).ok).toBe(false);
    expect(VoxelSimulation.load(s.save()).research.progress.Batteries).toBe(400);
  });
  it('builds a six-cell research bench from finite carried inputs and cannot overlap it', () => {
    const s = fixture(0);
    s.items.push(
      { ...pos(12, 18), id: s.nextId++, resource: 'wood', amount: 75 },
      { ...pos(13, 18), id: s.nextId++, resource: 'steel', amount: 25 },
    );
    for (const p of s.pawns)
      command(s, { type: 'priority', pawnId: p.id, work: 'build', value: 1 });
    command(s, { type: 'designate', tool: 'researchBench', from: pos(16, 16), axis: 'y' });
    until(s, () => s.researchBenches.length === 1);
    expect(s.stats.consumed.wood).toBe(75);
    expect(s.stats.consumed.steel).toBe(25);
    for (const p of researchBenchCells(s.researchBenches[0])) {
      expect(s.standable(p)).toBe(false);
      expect(s.command({ type: 'designate', tool: 'wall', from: p }).ok).toBe(false);
    }
    expect(VoxelSimulation.load(s.save()).researchBenches).toEqual(s.researchBenches);
  });
  it('rejects prerequisite bypass and technology-gated designations at the simulation boundary', () => {
    const s = fixture();
    expect(s.command({ type: 'research', project: 'LongBlades' })).toMatchObject({ ok: false });
    for (const tool of ['smithy', 'grove', 'solar', 'battery'] as const)
      expect(s.command({ type: 'designate', tool, from: pos(26, 23) })).toMatchObject({
        ok: false,
      });
    expect(s.research.current).toBe(null);
  });
});

describe('research save integrity and real v14 migration', () => {
  it('migrates authentic v14 bytes without replacing existing skill XP or physical state', () => {
    const bytes = readFileSync(new URL('./fixtures/voxel-v14-start.json', import.meta.url));
    const provenance = JSON.parse(
      readFileSync(new URL('./fixtures/voxel-v14-start.provenance.json', import.meta.url), 'utf8'),
    );
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(provenance.sha256);
    const old = JSON.parse(bytes.toString()),
      before = structuredClone(old),
      s = VoxelSimulation.load(old),
      saved = s.save();
    expect(old).toEqual(before);
    expect(saved.version).toBe(59);
    expect(saved.research.origin).toBe('legacy-unlocked');
    expect(saved.blocks).toEqual(old.blocks);
    expect(saved.items).toEqual(old.items);
    expect(saved.researchBenches).toEqual([]);
    saved.pawns.forEach((p, i) => {
      for (const key of Object.keys(old.pawns[i].skills))
        expect(p.skills[key as keyof typeof p.skills]).toEqual(old.pawns[i].skills[key]);
      expect(p.skills.intellectual).toEqual(initialSkills(i).intellectual);
      expect(p.worn).toEqual(old.pawns[i].worn);
      expect(p.health).toEqual(old.pawns[i].health);
    });
  });
  it('rejects malformed progress, inconsistent prerequisite/current, duplicate benches and stale jobs', () => {
    const s = fixture();
    command(s, { type: 'research', project: 'Batteries' });
    const saved = s.save();
    const changes: Array<(d: any) => void> = [
      (d) => (d.research.progress.Batteries = NaN),
      (d) => (d.research.progress.Batteries = -1),
      (d) => (d.research.progress.Batteries = 401),
      (d) => delete d.research.progress.TreeSowing,
      (d) => (d.research.progress.extra = 0),
      (d) => (d.research.progress.LongBlades = 1),
      (d) => (d.research.current = 'LongBlades'),
      (d) => (d.research.current = 'unknown'),
      (d) => d.researchBenches.push({ ...d.researchBenches[0], id: d.nextId++ }),
      (d) => (d.researchBenches[0].axis = 'bad'),
      (d) => (d.researchBenches[0].x = 63),
      (d) => (d.jobs[0].researchProject = 'Smithing'),
      (d) => (d.jobs[0].progress = 1),
      (d) => d.jobs.push({ ...d.jobs[0], id: d.nextId++ }),
      (d) => delete d.pawns[0].skills.intellectual,
      (d) => delete d.pawns[0].priorities.research,
    ];
    for (const change of changes) {
      const bad = structuredClone(saved);
      change(bad);
      expect(() => VoxelSimulation.load(bad)).toThrow();
    }
  });
});
