import { describe, expect, it } from 'vitest';
import { DAY, type WildAnimal } from '../src/voxel/types';
import { ANIMAL_HUSBANDRY, HUSBANDRY_RULES, advanceAnimalNeeds, animalFeedAmount,
  animalLifeStage, animalNutritionCapacity, animalReproductionEligible, initialAnimalState, tameChance } from '../src/voxel/husbandry';
import { initialSkills, learnSkill, validSkills } from '../src/voxel/skills';

function animal(extra: Partial<WildAnimal> = {}): WildAnimal {
  return { id: 20, species: 'hare', name: '野兔', x: 4, y: 4, z: 8, health: 28, hunger: 80,
    dead: false, hunt: false, phase: 'roam', moveTick: 0, decisionTick: 0, fleeUntil: 0,
    threatId: null, retryTick: 0, rotProgress: 0, ...initialAnimalState(20, 'hare', 0), ...extra };
}

describe('animal biological progress and actual nutrition', () => {
  it('advances chronological age while hunger slows or suspends growth and pregnancy', () => {
    for (const [hunger, multiplier] of [[80, 1], [30, .5], [10, .25], [0, 0]]) {
      const a = animal({ ageTicks: 400, growth: .1, sex: 'female', hunger, pregnancy: { fatherId: 21, progress: .2 } });
      advanceAnimalNeeds(a);
      expect(a.ageTicks).toBe(401);
      expect(a.growth - .1).toBeCloseTo(multiplier / HUSBANDRY_RULES.adultTicks, 12);
      expect(a.pregnancy!.progress - .2).toBeCloseTo(multiplier / HUSBANDRY_RULES.gestationTicks, 12);
    }
  });
  it('does not create internal nutrition when growth enlarges the food capacity', () => {
    for (const [growth, beforeFactor] of [[.4 - .5 / (4 * DAY), .4], [1 - .5 / (4 * DAY), .75]]) {
      const a = animal({ growth, hunger: 80 });
      const nutrition = a.hunger / 100 * animalNutritionCapacity(a);
      const previousCapacity = animalNutritionCapacity(a);
      advanceAnimalNeeds(a);
      expect(animalNutritionCapacity(a)).toBeGreaterThan(previousCapacity);
      expect(a.hunger / 100 * animalNutritionCapacity(a)).toBeCloseTo(
        nutrition - ANIMAL_HUSBANDRY.hare.nutritionPerDay * beforeFactor / DAY, 12);
    }
  });
  it('accumulates malnutrition over days and recovers after feeding without immediately killing', () => {
    const a = animal({ hunger: 0 });
    for (let n = 0; n < DAY; n++) expect(advanceAnimalNeeds(a).starved).toBe(false);
    expect(a.malnutrition).toBeCloseTo(.453, 10);
    a.hunger = 100;
    for (let n = 0; n < 100; n++) advanceAnimalNeeds(a);
    expect(a.malnutrition).toBeCloseTo(.453 - 100 * .453 / DAY, 10);
    expect(a.dead).toBe(false);
    a.hunger = 0; a.malnutrition = 1 - .453 / DAY / 2;
    expect(advanceAnimalNeeds(a).starved).toBe(true);
    expect(a.malnutrition).toBe(1);
    expect(a.dead).toBe(false); // World owns corpse creation and resource accounting.
  });
  it('reports one miscarriage and retains a ready pregnancy until the world can place the birth', () => {
    const a = animal({ sex: 'female', hunger: 0, malnutrition: .35 - .453 / DAY / 2,
      pregnancy: { fatherId: 21, progress: .5 } });
    expect(advanceAnimalNeeds(a).miscarried).toBe(true);
    expect(a.pregnancy).toBeNull();
    expect(advanceAnimalNeeds(a).miscarried).toBe(false);
    const b = animal({ sex: 'female', pregnancy: { fatherId: 21, progress: 1 - .5 / (2 * DAY) } });
    expect(advanceAnimalNeeds(b).birthReady).toBe(true);
    expect(advanceAnimalNeeds(b).birthReady).toBe(true);
    expect(b.pregnancy).toEqual({ fatherId: 21, progress: 1 });
  });
  it('uses fed growth to determine adulthood and breeding rather than chronological age', () => {
    const a = animal({ faction: 'colony', tameness: 5, ageTicks: 100 * DAY, growth: .39 });
    expect(animalLifeStage(a)).toBe('baby'); expect(animalReproductionEligible(a)).toBe(false);
    a.growth = .4; expect(animalLifeStage(a)).toBe('juvenile');
    a.growth = 1; expect(animalLifeStage(a)).toBe('adult'); expect(animalReproductionEligible(a)).toBe(true);
    for (const change of [{ faction: 'wild' }, { pregnancy: { fatherId: 21, progress: 0 } },
      { hunger: 30 }, { slaughter: true }, { releaseMarked: true }, { dead: true }])
      expect(animalReproductionEligible({ ...a, ...change } as WildAnimal)).toBe(false);
  });
  it('leaves a dead animal entirely unchanged', () => {
    const a = animal({ dead: true, phase: 'dead', health: 0, hunger: 0, malnutrition: 1 });
    const before = structuredClone(a);
    expect(advanceAnimalNeeds(a)).toEqual({ starved: false, miscarried: false, birthReady: false });
    expect(a).toEqual(before);
  });
});

describe('handling food, skill and initial identity', () => {
  it('requires two genuine feeding portions and excludes meat and nonfood', () => {
    expect(HUSBANDRY_RULES.feedings).toBe(2);
    expect(animalFeedAmount('hare', 'grain')).toBe(1);
    expect(animalFeedAmount('deer', 'grain')).toBe(4);
    expect(animalFeedAmount('deer', 'meal')).toBe(1);
    expect(animalFeedAmount('hare', 'food')).toBe(1);
    for (const resource of ['meat', 'carcass', 'wood'] as const) expect(animalFeedAmount('deer', resource)).toBe(0);
  });
  it('gates wild taming at skill eight, increases chance with skill and rejects invalid levels', () => {
    const a = animal();
    expect(tameChance(a, 7)).toBe(0); expect(tameChance(a, 8)).toBeGreaterThan(0);
    expect(tameChance(a, 20)).toBeGreaterThan(tameChance(a, 8));
    expect(tameChance({ ...a, dead: true }, 20)).toBe(0);
    expect(tameChance({ ...a, faction: 'colony' }, 20)).toBe(0);
    for (const level of [-1, 21, .5, NaN, Infinity]) expect(() => tameChance(a, level)).toThrow();
  });
  it('gives both sexes to each alternating species and independent mutable state', () => {
    const all = Array.from({ length: 8 }, (_, n) => ({ species: n % 2 ? 'deer' : 'hare',
      state: initialAnimalState(n + 1, n % 2 ? 'deer' : 'hare', 0) }));
    for (const species of ['deer', 'hare'])
      expect(new Set(all.filter(a => a.species === species).map(a => a.state.sex)).size).toBe(2);
    all[0].state.path.push(1); expect(all[1].state.path).toEqual([]);
    expect(all.every(a => a.state.faction === 'wild' && a.state.growth === 1 && a.state.ageTicks === 4 * DAY)).toBe(true);
    for (const id of [0, -1, .5, NaN]) expect(() => initialAnimalState(id, 'hare', 0)).toThrow();
    expect(() => initialAnimalState(1, 'hare', Number.MAX_SAFE_INTEGER)).toThrow();
  });
  it('adds independently learnable Animals records without changing existing skill progression', () => {
    expect([0, 1, 2].map(i => initialSkills(i).animals.level)).toEqual([4, 8, 5]);
    const set = initialSkills(1), before = structuredClone(set);
    expect(initialSkills(1, true).animals.level).toBe(0);
    learnSkill(set.animals, 50);
    expect(set.animals.xp).toBe(17.5);
    for (const key of Object.keys(set).filter(k => k !== 'animals')) expect(set[key as keyof typeof set]).toEqual(before[key as keyof typeof set]);
    expect(validSkills(set)).toBe(true);
  });
});
