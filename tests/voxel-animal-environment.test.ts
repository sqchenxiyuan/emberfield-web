import { describe, expect, it } from 'vitest';
import { DAY, type AnimalSpecies, type VoxelSave, type WildAnimal } from '../src/voxel/types';
import {
  ANIMAL_ENVIRONMENT_RULES, ANIMAL_TEMPERATURES, advanceAnimalEnvironment,
  animalEnvironmentEffects, animalTemperatureAllowsRecovery, animalTemperatureRange,
  animalThermalDanger, initialAnimalEnvironment,
} from '../src/voxel/animalEnvironment';
import {
  migrateAnimalEnvironment, rejectLegacyAnimalEnvironment,
  validateAnimalEnvironment, validateAnimalEnvironmentState,
} from '../src/voxel/animalEnvironmentPersistence';
import { animalEnvironmentExpectedField, stripAnimalEnvironmentFields } from './legacy-animal-environment-defaults';
import { stripAnimalMedicalFields } from './legacy-animal-medical-defaults';
import { stripAnimalTradeFields } from './legacy-animal-trade-defaults';

/** Deliberately a bounded pure-model fixture: no fabricated world generation,
 * routing, doctor state or claim that this proves world-level integration. */
const animal = (species: AnimalSpecies = 'chicken', cold = 0, hot = 0) => ({
  id: 42, species, dead: false, health: 20, hunger: 100,
  phase: 'roam', goal: null, path: [],
  environment: { hypothermia: cold, heatstroke: hot },
  medical: { policy: 'herbal', wounds: [], nextWoundId: 1, bloodLoss: 0,
    downed: false, bedId: null, carriedBy: null, rescue: false },
} as unknown as WildAnimal);
const everySample = (a: WildAnimal, temperature: number, count: number) => {
  let result: ReturnType<typeof advanceAnimalEnvironment> = null;
  for (let n = 1; n <= count; n++) {
    result = advanceAnimalEnvironment(a, temperature, n * ANIMAL_ENVIRONMENT_RULES.interval);
    if (result) break;
  }
  return result;
};
const legacy = () => ({ version: 54,
  animals: [{ id: 1, species: 'chicken', dead: false, health: 11, phase: 'roam' }],
  pawns: [{ environment: { heatstroke: .5 }, phase: 'shelter' }],
  environment: { temperature: 22 },
  trade: { receipts: [{ tick: 22, animalTransfers: [{ side: 'colony',
    animal: { id: 2, species: 'alpaca', dead: false, health: 40, phase: 'roam' } }] }] },
});

describe('animal thermal illness model', () => {
  it('uses distinct inherited species ranges and safe margins without mutating definitions', () => {
    expect(ANIMAL_TEMPERATURES).toEqual({
      hare: { comfortableMin: -30, comfortableMax: 40 },
      deer: { comfortableMin: -30, comfortableMax: 40 },
      alpaca: { comfortableMin: -20, comfortableMax: 45 },
      dromedary: { comfortableMin: -22, comfortableMax: 60 },
      chicken: { comfortableMin: -10, comfortableMax: 40 },
    });
    for (const species of Object.keys(ANIMAL_TEMPERATURES) as AnimalSpecies[]) {
      const a = animal(species), range = animalTemperatureRange(a);
      expect(range.safeMin).toBe(range.comfortableMin - 10);
      expect(range.safeMax).toBe(range.comfortableMax + 10);
      range.comfortableMin = -999;
      expect(animalTemperatureRange(a).comfortableMin).toBe(ANIMAL_TEMPERATURES[species].comfortableMin);
    }
    const first = initialAnimalEnvironment(), second = initialAnimalEnvironment();
    first.heatstroke = .4; expect(second).toEqual({ hypothermia: 0, heatstroke: 0 });
  });

  it('keeps healthy safe animals byte-for-byte unchanged without even assigning disease properties', () => {
    for (const species of Object.keys(ANIMAL_TEMPERATURES) as AnimalSpecies[]) {
      const a = animal(species), before = structuredClone(a), range = animalTemperatureRange(a);
      Object.freeze(a.environment);
      for (const temperature of [range.safeMin, 20, range.safeMax])
        for (let tick = 1; tick <= DAY; tick++) expect(advanceAnimalEnvironment(a, temperature, tick)).toBeNull();
      expect(a).toEqual(before);
    }
  });

  it('samples disease in game-day units and distinguishes cold-adapted and hot-adapted species', () => {
    const bird = animal('chicken'), hare = animal('hare'), camel = animal('dromedary');
    const before = structuredClone(bird);
    advanceAnimalEnvironment(bird, -30, 1); expect(bird).toEqual(before);
    advanceAnimalEnvironment(bird, -30, ANIMAL_ENVIRONMENT_RULES.interval);
    advanceAnimalEnvironment(hare, -30, ANIMAL_ENVIRONMENT_RULES.interval);
    expect(bird.environment.hypothermia).toBeGreaterThan(0); expect(hare.environment.hypothermia).toBe(0);
    advanceAnimalEnvironment(bird, 60, 2 * ANIMAL_ENVIRONMENT_RULES.interval);
    advanceAnimalEnvironment(camel, 60, 2 * ANIMAL_ENVIRONMENT_RULES.interval);
    expect(bird.environment.heatstroke).toBeGreaterThan(0); expect(camel.environment.heatstroke).toBe(0);
    expect(ANIMAL_ENVIRONMENT_RULES.interval * 1000).toBe(DAY);
    expect({ ...bird, environment: before.environment }).toEqual(before);
  });

  it('preserves illness in both hysteresis bands and recovers only beyond strict comfort boundaries', () => {
    const a = animal('chicken', .3, .4), { comfortableMin, comfortableMax, safeMin, safeMax } = animalTemperatureRange(a);
    for (const temperature of [safeMin, (safeMin + comfortableMin) / 2, comfortableMin]) {
      a.environment = { hypothermia: .3, heatstroke: 0 };
      advanceAnimalEnvironment(a, temperature, ANIMAL_ENVIRONMENT_RULES.interval);
      expect(a.environment.hypothermia).toBe(.3); expect(animalTemperatureAllowsRecovery(a, temperature)).toBe(false);
      expect(animalThermalDanger(a, temperature)).toBe(0);
    }
    for (const temperature of [comfortableMax, (safeMax + comfortableMax) / 2, safeMax]) {
      a.environment = { hypothermia: 0, heatstroke: .4 };
      advanceAnimalEnvironment(a, temperature, ANIMAL_ENVIRONMENT_RULES.interval);
      expect(a.environment.heatstroke).toBe(.4); expect(animalTemperatureAllowsRecovery(a, temperature)).toBe(false);
    }
    a.environment = { hypothermia: .3, heatstroke: .4 };
    expect(animalTemperatureAllowsRecovery(a, 20)).toBe(true);
    advanceAnimalEnvironment(a, 20, ANIMAL_ENVIRONMENT_RULES.interval);
    expect(a.environment.hypothermia).toBeLessThan(.3); expect(a.environment.heatstroke).toBeLessThan(.4);
    everySample(a, 20, 1000); expect(a.environment).toEqual(initialAnimalEnvironment());
  });

  it('accumulates exposure, slows then incapacitates animals, and distinguishes lethal cold from lethal heat', () => {
    const stages = [0, .04, .2, .35, .62].map(value => animalEnvironmentEffects(animal('chicken', value)));
    expect(stages.map(s => s.movingFactor)).toEqual([1, .95, .8, expect.any(Number), 0]);
    expect(stages[3].movingFactor).toBeGreaterThan(0); expect(stages[3].movingFactor).toBeLessThan(.5);
    expect(stages[3]).toMatchObject({ pain: .15, downed: false, ill: true, lethal: null });
    expect(stages[4]).toMatchObject({ pain: .3, downed: true, ill: true, lethal: null });
    const cold = animal(), hot = animal();
    expect(everySample(cold, -100, 1000)).toBe('hypothermia');
    expect(everySample(hot, 200, 1000)).toBe('heatstroke');
    expect(cold.environment.hypothermia).toBe(1); expect(hot.environment.heatstroke).toBe(1);
    expect(animalEnvironmentEffects(cold)).toMatchObject({ lethal: 'hypothermia', downed: false, movingFactor: 0 });
    expect(animalEnvironmentEffects(hot)).toMatchObject({ lethal: 'heatstroke', downed: false, movingFactor: 0 });
    expect(cold.dead).toBe(false); expect(cold.health).toBe(20); expect(cold.medical.wounds).toEqual([]);
  });

  it('handles both diseases together without choosing a recovery site that triggers the opposite illness', () => {
    const a = animal('chicken', .4, .4), range = animalTemperatureRange(a);
    expect(animalEnvironmentEffects(a)).toMatchObject({ pain: .3, ill: true, downed: true });
    expect(animalTemperatureAllowsRecovery(a, range.safeMin - 1)).toBe(false);
    expect(animalTemperatureAllowsRecovery(a, range.safeMax + 1)).toBe(false);
    expect(animalTemperatureAllowsRecovery(a, 20)).toBe(true);
    a.environment.heatstroke = 0;
    expect(animalTemperatureAllowsRecovery(a, range.safeMax)).toBe(true);
    expect(animalTemperatureAllowsRecovery(a, range.safeMax + 1)).toBe(false);
    expect(animalThermalDanger(a, range.safeMin - 7)).toBe(7);
    expect(animalThermalDanger(a, range.safeMax + 9)).toBe(9);
  });

  it('stops updating dead animals and rejects invalid input without mutation', () => {
    const a = animal('chicken', 1); a.dead = true; const before = structuredClone(a);
    advanceAnimalEnvironment(a, 20, 12); expect(a).toEqual(before);
    for (const temperature of [NaN, Infinity, -Infinity]) {
      expect(() => advanceAnimalEnvironment(a, temperature, 12)).toThrow();
      expect(animalTemperatureAllowsRecovery(a, temperature)).toBe(false);
      expect(animalThermalDanger(a, temperature)).toBe(Infinity);
    }
    for (const tick of [-1, .5, Infinity, NaN]) expect(() => advanceAnimalEnvironment(a, 20, tick)).toThrow();
    expect(a).toEqual(before);
  });
});

describe('animal environmental schema and historical migration', () => {
  it('adds independent default states to live and receipt animals without altering humans or prior history', () => {
    const old = legacy(), before = structuredClone(old);
    rejectLegacyAnimalEnvironment(old, 54); migrateAnimalEnvironment(old, 54);
    const expected = structuredClone(before) as any;
    expected.animals[0].environment = initialAnimalEnvironment();
    expected.trade.receipts[0].animalTransfers[0].animal.environment = initialAnimalEnvironment();
    expect(old).toEqual(expected);
    const migrated = old as any; migrated.animals[0].environment.heatstroke = .3;
    expect(migrated.trade.receipts[0].animalTransfers[0].animal.environment.heatstroke).toBe(0);
    validateAnimalEnvironment(old as unknown as VoxelSave);
  });

  it('rejects new fields, phases and goals in old live and deeply nested trade carriers without mutation', () => {
    const values = [{ environment: initialAnimalEnvironment() }, { environment: undefined },
      { phase: 'shelter' }, { goal: { kind: 'shelter', id: 3 } }, { goal: { kind: 'climateExit', id: 3 } }];
    for (const value of values) for (const location of ['live', 'receipt', 'nested']) {
      const old: any = legacy();
      if (location === 'live') Object.assign(old.animals[0], value);
      else if (location === 'receipt') Object.assign(old.trade.receipts[0].animalTransfers[0].animal, value);
      else old.trade.history = { previous: { snapshot: { species: 'hare', ...value } } };
      const before = structuredClone(old);
      expect(() => rejectLegacyAnimalEnvironment(old, 54)).toThrow(/旧版本/);
      expect(old).toEqual(before);
    }
    const malformed: any = legacy(); malformed.trade.receipts[0].animalTransfers[0].animal = { environment: {} };
    expect(() => rejectLegacyAnimalEnvironment(malformed, 54)).toThrow(/旧版本/);
    expect(() => rejectLegacyAnimalEnvironment(legacy(), 54)).not.toThrow();
  });

  it('preflights malformed histories before migration and never repairs missing current fields', () => {
    for (const mutate of [
      (d: any) => { d.animals.push(null); },
      (d: any) => { d.trade.receipts.push(null); },
      (d: any) => { d.trade.receipts[0].animalTransfers.push({ animal: null }); },
      (d: any) => { delete d.trade.receipts[0].animalTransfers; },
    ]) {
      const old = legacy(); mutate(old); const before = structuredClone(old);
      expect(() => migrateAnimalEnvironment(old, 54)).toThrow(); expect(old).toEqual(before);
    }
    const current = legacy(); current.version = 55; const before = structuredClone(current);
    migrateAnimalEnvironment(current, 55); expect(current).toEqual(before);
    expect(() => validateAnimalEnvironment(current as unknown as VoxelSave)).toThrow();
  });

  it('accepts defaults inserted by earlier husbandry migration after original-input validation', () => {
    const old: any = legacy(); rejectLegacyAnimalEnvironment(old, 28);
    old.animals[0].environment = initialAnimalEnvironment();
    migrateAnimalEnvironment(old, 28);
    expect(old.animals[0].environment).toEqual(initialAnimalEnvironment());
    expect(old.trade.receipts[0].animalTransfers[0].animal.environment).toEqual(initialAnimalEnvironment());
    expect(old.animals[0].environment).not.toBe(old.trade.receipts[0].animalTransfers[0].animal.environment);
  });

  it('strictly validates disease fields and fatal live state in both current and receipt animals without mutation', () => {
    const good = animal('alpaca', .5, .2), states: unknown[] = [null, [], {}, { hypothermia: 0 },
      { hypothermia: 0, heatstroke: 0, extra: 0 },
      ...[-1, 1.001, NaN, Infinity, '0', undefined].flatMap(value => [
        { hypothermia: value, heatstroke: 0 }, { hypothermia: 0, heatstroke: value },
      ]), { hypothermia: 1, heatstroke: 0 }, { hypothermia: 0, heatstroke: 1 }];
    validateAnimalEnvironmentState(good);
    for (const state of states) {
      const a = structuredClone(good); (a as any).environment = state; const before = structuredClone(a);
      expect(() => validateAnimalEnvironmentState(a)).toThrow(); expect(a).toEqual(before);
      const d = { animals: [], trade: { receipts: [{ animalTransfers: [{ animal: a }] }] } };
      expect(() => validateAnimalEnvironment(d as unknown as VoxelSave)).toThrow();
    }
    const corpse = animal('alpaca', 1); corpse.dead = true;
    expect(() => validateAnimalEnvironmentState(corpse)).not.toThrow();
    const d = { animals: [good], trade: { receipts: [{ animalTransfers: [{ animal: structuredClone(good) }] }] } };
    const before = structuredClone(d); validateAnimalEnvironment(d as unknown as VoxelSave); expect(d).toEqual(before);
  });
});

describe('synthetic animal environmental downgrade helpers', () => {
  it('strips only independent default states and restores expected fields without touching originals', () => {
    const d = { animals: [animal()], trade: { receipts: [{ animalTransfers: [{ animal: animal('alpaca') }] }] } };
    const before = structuredClone(d);
    stripAnimalEnvironmentFields(d);
    expect(Object.hasOwn(d.animals[0], 'environment')).toBe(false);
    expect(Object.hasOwn(d.trade.receipts[0].animalTransfers[0].animal, 'environment')).toBe(false);
    expect(animalEnvironmentExpectedField('animals', d.animals)).toEqual(before.animals);
    expect(animalEnvironmentExpectedField('trade', d.trade)).toEqual(before.trade);
    expect(Object.hasOwn(d.animals[0], 'environment')).toBe(false);
  });

  it('never discards disease or shelter state through environment, medical or trade downgrade chains', () => {
    const mutations: ((a: any) => void)[] = [
      a => { a.environment.hypothermia = .001; }, a => { a.environment.heatstroke = .001; },
      a => { a.environment.extra = 0; }, a => { a.environment = undefined; },
      a => { a.phase = 'shelter'; }, a => { a.goal = { kind: 'shelter', id: 1 }; },
      a => { a.goal = { kind: 'climateExit', id: 1 }; },
    ];
    for (const strip of [stripAnimalEnvironmentFields, stripAnimalMedicalFields, stripAnimalTradeFields])
      for (const mutate of mutations) for (const historical of [false, true]) {
        const d = { animals: [animal()], pawns: [], animalBeds: [],
          trade: { receipts: [{ animalTransfers: [{ animal: animal('alpaca') }] }] } };
        mutate(historical ? d.trade.receipts[0].animalTransfers[0].animal : d.animals[0]);
        const before = structuredClone(d);
        expect(() => strip(d)).toThrow(); expect(d).toEqual(before);
      }
  });
});
