import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { VoxelSimulation } from '../src/voxel/world';
import { initialAnimalPenState } from '../src/voxel/pens';
import { relocationExpectedField } from './legacy-relocation-defaults';

const HASHES = {
  'carrying-feed': 'd9fc04f3ec710c41b9104044f246d0348b9026f1c1d3b2ca183113b4fe7993a0',
  pregnant: 'be5cced3f7cb4f8f10bb93b85eee2675d63d9c20494fb0d7ef2df879742fdc60',
  newborn: '7212b5c2531d6249d316bf9432ed80c67ade2f4894af4e96d1d59432b53a2aaf',
} as const;
function historical(name: keyof typeof HASHES) {
  const bytes = readFileSync(new URL(`./fixtures/voxel-v29-pens-${name}.json`, import.meta.url));
  const proof = JSON.parse(readFileSync(new URL(`./fixtures/voxel-v29-pens-${name}.provenance.json`, import.meta.url), 'utf8'));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(HASHES[name]);
  expect(proof).toMatchObject({ version: 29, sha256: HASHES[name], source: `test-results/voxel-husbandry/${name}.json`,
    campaignExecution: {
      bundleSha256: 'b89138ce74de518fd15061bad67b95a0f5084a5c47ada5b9e8d0a50c9854c1e4',
      scriptSha256: '2507f14233ce767d3d64e9974a907f21e89ea52c3ed2ae80ebb6df27e432b224',
    } });
  const old = JSON.parse(bytes.toString('utf8'));
  expect(old.version).toBe(29); expect(old.tick).toBe(proof.tick); return old;
}

describe('authentic v29 pen migration', () => {
  it.each(['carrying-feed', 'pregnant', 'newborn'] as const)('preserves real %s state and adds only v30 defaults', name => {
    const old = historical(name), before = structuredClone(old), s = VoxelSimulation.load(old), saved = s.save();
    expect(old).toEqual(before); expect(saved.version).toBe(34);
    expect(saved.tick).toBe(old.tick); expect(saved.nextId).toBe(old.nextId);
    for (const key of ['fences', 'fenceGates', 'penMarkers', 'animalAreas'] as const) expect(saved[key]).toEqual([]);
    expect(saved.animals).toEqual(old.animals.map((a: any) => ({ ...a, ...initialAnimalPenState(old.tick) })));
    for (const previous of old.pawns) {
      const p = saved.pawns.find(p => p.id === previous.id)!;
      expect(p.ropeTask).toBeNull();
      for (const key of ['x', 'y', 'z', 'faction', 'food', 'rest', 'health', 'trauma', 'medical', 'skills', 'priorities',
        'handleTask', 'cargo', 'weapon', 'worn', 'psyche', 'dirtCarry', 'foodPoisoning'] as const)
        expect(p[key], `${name}:pawn${p.id}.${key}`).toEqual(key === 'psyche' ? { ...previous.psyche, tolerance: { ...previous.psyche.tolerance, social: 0 } } : previous[key]);
    }
    for (const key of ['grass', 'husbandryLog', 'items', 'stats', 'trade', 'weather', 'snow', 'fires', 'fireDamage', 'fireHazards',
      'fireLog', 'filth', 'crops', 'trees', 'beds', 'research', 'blocks', 'ladders', 'structureKinds'] as const)
      expect(saved[key], `${name}.${key}`).toEqual(key === 'beds' ? old.beds.map((b:any)=>({...b,quality:2})) : relocationExpectedField(key, old[key]));
    if (name === 'carrying-feed') {
      const p = saved.pawns.find(p => p.handleTask)!;
      expect(p.handleTask!.stage).toBe('approach'); expect(p.cargo!.resource).toBe('grain'); expect(p.cargo!.amount).toBeGreaterThan(0);
    } else if (name === 'pregnant') expect(saved.animals.some(a => a.pregnancy !== null)).toBe(true);
    else expect(saved.animals.some(a => a.ageTicks === 0 && a.growth === 0)).toBe(true);
    const again = VoxelSimulation.load(saved).save();
    expect(again.animals).toEqual(saved.animals); expect(again.grass).toEqual(saved.grass);
    expect(again.pawns.map(p => ({ id: p.id, ropeTask: p.ropeTask, handleTask: p.handleTask, cargo: p.cargo })))
      .toEqual(saved.pawns.map(p => ({ id: p.id, ropeTask: p.ropeTask, handleTask: p.handleTask, cargo: p.cargo })));
    expect(again.items).toEqual(saved.items); expect(again.stats).toEqual(saved.stats); expect(again.nextId).toBe(old.nextId);
  });
  it('rejects new v30 fields embedded into original v29 input before mutating caller state', () => {
    const source = historical('pregnant');
    const changes: ((d: any) => void)[] = [
      ...['fences', 'fenceGates', 'penMarkers', 'animalAreas'].map(key => (d: any) => { d[key] = []; }),
      ...Object.entries(initialAnimalPenState(source.tick)).map(([key, value]) => (d: any) => { d.animals[0][key] = value; }),
      d => { d.pawns[0].ropeTask = null; }, d => { d.animals[0].goal = { kind: 'area', id: 1 }; },
      d => { d.animals[0].goal = { kind: 'exit', id: 0 }; }, d => { d.jobs.push({ kind: 'fence' }); },
    ];
    for (const change of changes) {
      const old = structuredClone(source); change(old); const before = structuredClone(old);
      expect(() => VoxelSimulation.load(old)).toThrow(/旧版本包含新版围栏/); expect(old).toEqual(before);
    }
  });
  it('resumes the genuine old carried-feeding state identically after a second current load', () => {
    const old = historical('carrying-feed'), first = VoxelSimulation.load(old), copy = VoxelSimulation.load(first.save());
    const originalFood = first.counts().grain + first.stats.consumed.grain + first.stats.spoiled.grain + first.stats.destroyed.grain;
    first.step(40); copy.step(40);
    expect(copy.animals).toEqual(first.animals); expect(copy.items).toEqual(first.items); expect(copy.stats).toEqual(first.stats);
    expect(copy.pawns.map(p => ({ id: p.id, task: p.handleTask, cargo: p.cargo, skills: p.skills })))
      .toEqual(first.pawns.map(p => ({ id: p.id, task: p.handleTask, cargo: p.cargo, skills: p.skills })));
    expect(copy.counts().grain + copy.stats.consumed.grain + copy.stats.spoiled.grain + copy.stats.destroyed.grain).toBe(originalFood);
    expect(copy.nextId).toBe(first.nextId);
  });
});
