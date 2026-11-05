import { DAY, type AnimalSpecies, type WildAnimal } from './types';
import { heatOverage } from './survival';

export interface AnimalEnvironmentState { hypothermia: number; heatstroke: number }
export type AnimalThermalDeath = 'hypothermia' | 'heatstroke';

/** Core race stats, including ComfyTemperatureMax's inherited default of 40.
 * These are unmodified adult species ranges: no genes, apparel or mutations. */
export const ANIMAL_TEMPERATURES: Readonly<Record<AnimalSpecies, {
  comfortableMin: number; comfortableMax: number;
}>> = Object.freeze({
  hare: Object.freeze({ comfortableMin: -30, comfortableMax: 40 }),
  deer: Object.freeze({ comfortableMin: -30, comfortableMax: 40 }),
  alpaca: Object.freeze({ comfortableMin: -20, comfortableMax: 45 }),
  dromedary: Object.freeze({ comfortableMin: -22, comfortableMax: 60 }),
  chicken: Object.freeze({ comfortableMin: -10, comfortableMax: 40 }),
  labrador: Object.freeze({ comfortableMin: -30, comfortableMax: 40 }),
});

/** Native 60-tick temperature samples map to DAY/1000. Web samples are aligned
 * with the simulation clock, without consuming the world's random sequence. */
export const ANIMAL_ENVIRONMENT_RULES = Object.freeze({
  interval: DAY / 1000, safetyMargin: 10, severityPerDegree: .0000645,
  minimumColdGain: .00075, minimumHeatGain: .000375,
  recoveryFactor: .027, minimumRecovery: .0015, maximumRecovery: .015,
  stages: Object.freeze([0, .04, .2, .35, .62] as const),
  lethalSeverity: 1,
});

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const stage = (value: number) => ANIMAL_ENVIRONMENT_RULES.stages.reduce<number>(
  (result, threshold, i) => value >= threshold ? i : result, 0,
);
const recover = (severity: number) => clamp(severity - clamp(
  severity * ANIMAL_ENVIRONMENT_RULES.recoveryFactor,
  ANIMAL_ENVIRONMENT_RULES.minimumRecovery,
  ANIMAL_ENVIRONMENT_RULES.maximumRecovery,
));
function lethal(state: AnimalEnvironmentState): AnimalThermalDeath | null {
  return state.hypothermia >= ANIMAL_ENVIRONMENT_RULES.lethalSeverity ? 'hypothermia'
    : state.heatstroke >= ANIMAL_ENVIRONMENT_RULES.lethalSeverity ? 'heatstroke' : null;
}

export function initialAnimalEnvironment(): AnimalEnvironmentState {
  return { hypothermia: 0, heatstroke: 0 };
}

export function animalTemperatureRange(a: Pick<WildAnimal, 'species'>) {
  const { comfortableMin, comfortableMax } = ANIMAL_TEMPERATURES[a.species];
  return { comfortableMin, comfortableMax,
    safeMin: comfortableMin - ANIMAL_ENVIRONMENT_RULES.safetyMargin,
    safeMax: comfortableMax + ANIMAL_ENVIRONMENT_RULES.safetyMargin };
}

/** Mutates only the existing animal's two environmental disease severities.
 * Care, ordinary wounds, identity, food and death/carcass creation belong to
 * the caller. Safe zero-severity animals keep all state exactly unchanged. */
export function advanceAnimalEnvironment(a: WildAnimal, temperature: number, tick: number): AnimalThermalDeath | null {
  if (!Number.isFinite(temperature) || !Number.isSafeInteger(tick) || tick < 0)
    throw new RangeError('动物环境温度或时钟无效');
  if (a.dead) return null;
  const state = a.environment;
  if (lethal(state)) return lethal(state);
  if (tick % ANIMAL_ENVIRONMENT_RULES.interval !== 0) return null;
  const { comfortableMin, comfortableMax, safeMin, safeMax } = animalTemperatureRange(a);
  if (temperature < safeMin) state.hypothermia = clamp(state.hypothermia + Math.max(
    (safeMin - temperature) * ANIMAL_ENVIRONMENT_RULES.severityPerDegree,
    ANIMAL_ENVIRONMENT_RULES.minimumColdGain,
  ));
  else if (state.hypothermia > 0 && temperature > comfortableMin)
    state.hypothermia = recover(state.hypothermia);
  if (temperature > safeMax) state.heatstroke = clamp(state.heatstroke + Math.max(
    heatOverage(temperature - safeMax) * ANIMAL_ENVIRONMENT_RULES.severityPerDegree,
    ANIMAL_ENVIRONMENT_RULES.minimumHeatGain,
  ));
  else if (state.heatstroke > 0 && temperature < comfortableMax)
    state.heatstroke = recover(state.heatstroke);
  return lethal(state);
}

/** Healthy-body thermal effects. The world combines these with the separate
 * compact animal wound model; this does not claim complete native anatomy. */
export function animalEnvironmentEffects(a: Pick<WildAnimal, 'environment'>): {
  pain: number; movingFactor: number; downed: boolean; ill: boolean; lethal: AnimalThermalDeath | null;
} {
  const state = a.environment, cold = stage(state.hypothermia), hot = stage(state.heatstroke);
  const death = lethal(state), pain = [0, 0, 0, .15, .3][cold] + [0, 0, 0, .15, .3][hot];
  const painPenalty = clamp((pain - .1) / .9 * .4, 0, .4);
  const consciousness = death ? 0 : Math.max(0, Math.min(
    1 - (painPenalty >= .01 ? painPenalty : 0) + [0, -.05, -.1, -.2, 0][cold] + [0, -.05, -.1, -.2, 0][hot],
    cold === 4 || hot === 4 ? .1 : 1,
  ));
  const movingFactor = consciousness < .3 ? 0 : clamp(
    consciousness + [0, 0, -.1, -.3, 0][cold] + [0, 0, -.1, -.3, 0][hot],
  );
  return { pain, movingFactor, downed: !death && (consciousness < .3 || movingFactor <= .15),
    ill: state.hypothermia > 0 || state.heatstroke > 0, lethal: death };
}

/** Degrees outside this species' safe range; disease in the hysteresis band
 * may still need relocation even when this value is zero. */
export function animalThermalDanger(a: Pick<WildAnimal, 'species'>, temperature: number): number {
  if (!Number.isFinite(temperature)) return Infinity;
  const { safeMin, safeMax } = animalTemperatureRange(a);
  return Math.max(0, safeMin - temperature, temperature - safeMax);
}

/** Safe air alone does not reverse established illness: hypothermia recovers
 * strictly above comfortableMin and heatstroke strictly below comfortableMax.
 * A recovering site must also avoid starting the opposite thermal illness. */
export function animalTemperatureAllowsRecovery(
  a: Pick<WildAnimal, 'species' | 'environment'>, temperature: number,
): boolean {
  if (!Number.isFinite(temperature)) return false;
  const { comfortableMin, comfortableMax, safeMin, safeMax } = animalTemperatureRange(a);
  return temperature >= safeMin && temperature <= safeMax &&
    (a.environment.hypothermia === 0 || temperature > comfortableMin) &&
    (a.environment.heatstroke === 0 || temperature < comfortableMax);
}
