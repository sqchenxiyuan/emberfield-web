import type { Cargo } from './types';
import { WEATHER_RULES, weatherEffects, type WeatherState } from './weather';
import type { DeteriorationEnvironment } from './deterioration';
import type { FilthKind } from './sanitation';

/** Cadence and expected cell visits are Web adaptations, not native sampling. */
export const ENVIRONMENT_RULES = {
  interval: 100, wetInterval: 24,
  filthVisitsPerDay: 36,
} as const;

export interface EnvironmentItemView {
  id: number; entity: 'stack' | 'carcass';
  environment: DeteriorationEnvironment;
  hitPoints: number | null; maxHitPoints: number | null; rate: number;
}
export interface EnvironmentView {
  items: EnvironmentItemView[];
  filth: { id: number; exposed: boolean; rainWashes: boolean; washing: boolean }[];
  wetPawnIds: number[];
  natureAvailable: boolean;
}

/** Native weather thoughts switch at the midpoint, not with the interpolated
 * rain intensity. Selected snow definitions have no SoakingWet thought. */
export function wettingWeather(weather: WeatherState, tick: number): boolean {
  const kind = tick - weather.startedTick < WEATHER_RULES.transitionTicks / 2
    ? weather.previousKind : weather.kind;
  return kind === 'rain' || kind === 'thunderstorm';
}

/** GoForWalk checks EnjoyableOutsideNow's interpolated rain threshold. The
 * separate native Skygaze Def gate is not applied to walking. Horseshoes use a physical source
 * and does not acquire an invented global rain prohibition. */
export function natureWeatherAllowed(weather: WeatherState, tick: number): boolean {
  return weatherEffects(weather, tick).rainRate < .25;
}

export function carcassBatch(animal: { id: number; species: 'hare' | 'deer'; rotProgress: number; carcassHitPoints?: number }): Cargo {
  return { resource: 'carcass', amount: 1, carcass: { animalId: animal.id, species: animal.species },
    rotProgress: animal.rotProgress, ...(animal.carcassHitPoints === undefined ? {} : { hitPoints: animal.carcassHitPoints }) };
}

// These four mappings use rain-washable native Defs. Butchering generates the
// animal BloodDef; this does not imply every original filth type washes away.
export const RAIN_WASHES: Readonly<Record<FilthKind, boolean>> = {
  dirt: true, blood: true, butcher: true, vomit: true,
};
