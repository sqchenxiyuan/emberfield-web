import { assertAnimalTrainingDefaults, stripAnimalTrainingFields } from './legacy-animal-training-defaults';
/** v58 adds no root defaults. A synthetic historical fixture may be carried
 * backward only while neither delivery nor autonomous prisoner dining is live. */
export function assertPrisonFoodDefaults(raw: Record<string, any>): void {
  assertAnimalTrainingDefaults(raw);
  for (const p of raw.pawns ?? []) {
    if (Object.hasOwn(p, 'prisonFoodTask') || p.phase === 'prisonFood' ||
      (p.faction === 'prisoner' && (p.phase === 'dine' || p.eating != null || p.living?.mealTask != null)))
      throw new Error('Cannot downgrade active prisoner delivery or dining');
  }
}
export function stripPrisonFoodFields(raw: Record<string, any>): void {
  assertPrisonFoodDefaults(raw); // Nothing exists to delete in an inactive v58 save.
  stripAnimalTrainingFields(raw);
}
