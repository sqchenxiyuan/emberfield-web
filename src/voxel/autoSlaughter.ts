import type { AnimalSpecies, WildAnimal } from './types';
import { HUSBANDRY_RULES, isAnimalAdult } from './husbandry';

export const AUTO_SLAUGHTER_SPECIES = ['hare', 'deer', 'dromedary', 'alpaca', 'chicken', 'labrador'] as const;
export const AUTO_SLAUGHTER_LIMITS = ['total', 'male', 'female', 'youngMale', 'youngFemale'] as const;
export type AutoSlaughterLimit = typeof AUTO_SLAUGHTER_LIMITS[number];
/** null is unlimited; zero deliberately retains none of the eligible group. */
export type AutoSlaughterPolicy = Record<AutoSlaughterLimit, number | null> & { allowPregnant: boolean };
export type AutoSlaughterSettings = Record<AnimalSpecies, AutoSlaughterPolicy>;
export interface AutoSlaughterHerd {
  species: AnimalSpecies;
  population: number;
  protectedPregnant: number;
  releasing: number;
  counts: Record<AutoSlaughterLimit, number>;
  selected: number[];
}
export interface AutoSlaughterStatus { targets: number[]; herds: AutoSlaughterHerd[] }
export function defaultAutoSlaughterPolicy(): AutoSlaughterPolicy {
  return { total: null, male: null, female: null, youngMale: null, youngFemale: null, allowPregnant: false };
}
export function defaultAutoSlaughter(): AutoSlaughterSettings {
  return { hare: defaultAutoSlaughterPolicy(), deer: defaultAutoSlaughterPolicy(), dromedary: defaultAutoSlaughterPolicy(), alpaca: defaultAutoSlaughterPolicy(), chicken: defaultAutoSlaughterPolicy(), labrador: defaultAutoSlaughterPolicy() };
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function validAutoSlaughterPolicy(value: unknown): value is AutoSlaughterPolicy {
  return record(value) && Object.keys(value).length === 6 && typeof value.allowPregnant === 'boolean' &&
    AUTO_SLAUGHTER_LIMITS.every(key => Object.hasOwn(value, key) && (value[key] === null ||
      (Number.isSafeInteger(value[key]) && Number(value[key]) >= 0 && Number(value[key]) <= HUSBANDRY_RULES.maxAnimals)));
}
export function validAutoSlaughter(value: unknown): value is AutoSlaughterSettings {
  return record(value) && Object.keys(value).length === AUTO_SLAUGHTER_SPECIES.length &&
    AUTO_SLAUGHTER_SPECIES.every(species => Object.hasOwn(value, species) && validAutoSlaughterPolicy(value[species]));
}

/** Derived selection, never a manual designation. Native category order and
 * protected-pregnancy counting are retained. Web recalculates on demand, uses
 * stable ID ties, and gives an explicit release order precedence. */
export function autoSlaughterSelection(settings: AutoSlaughterSettings, animals: readonly WildAnimal[]): AutoSlaughterStatus {
  const herds = AUTO_SLAUGHTER_SPECIES.map(species => {
    const policy = settings[species];
    const population = animals.filter(a => a.species === species && !a.dead && a.health > 0 && a.faction === 'colony');
    const available = population.filter(a => !a.releaseMarked);
    const protectedPregnant = available.filter(a => a.pregnancy !== null && !policy.allowPregnant).length;
    const eligible = available.filter(a => a.pregnancy === null || policy.allowPregnant);
    const older = (a: WildAnimal, b: WildAnimal) => b.ageTicks - a.ageTicks || a.id - b.id;
    const ordinary = eligible.filter(a => a.pregnancy === null).sort(older);
    const pregnant = eligible.filter(a => a.pregnancy !== null)
      .sort((a, b) => b.pregnancy!.progress - a.pregnancy!.progress || older(a, b));
    // Pregnant animals follow all non-pregnant candidates, even older ones.
    const total = [...ordinary, ...pregnant];
    const groups = {
      total,
      male: total.filter(a => a.sex === 'male' && isAnimalAdult(a)),
      female: total.filter(a => a.sex === 'female' && isAnimalAdult(a)),
      youngMale: total.filter(a => a.sex === 'male' && !isAnimalAdult(a)),
      youngFemale: total.filter(a => a.sex === 'female' && !isAnimalAdult(a)),
    };
    const selected = new Set<number>();
    for (const group of ['female', 'youngFemale', 'male', 'youngMale', 'total'] as const) {
      const limit = policy[group];
      if (limit === null) continue;
      const remaining = groups[group].filter(a => !selected.has(a.id));
      for (let i = 0; i < remaining.length - limit; i++) selected.add(remaining[i].id);
    }
    return { species, population: population.length, protectedPregnant, releasing: population.length - available.length,
      counts: Object.fromEntries(AUTO_SLAUGHTER_LIMITS.map(key => [key, groups[key].length])) as AutoSlaughterHerd['counts'],
      selected: [...selected] };
  });
  return { herds, targets: herds.flatMap(herd => herd.selected) };
}
