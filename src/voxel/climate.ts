import { DAY, type WorldSettings } from './types';
import { hourAt, temperatureAt as legacyTemperatureAt } from './farming';

export const YEAR_DAYS = 60;
export const SEASON_DAYS = 15;
/** Source latitude curve uses abs(sin(latitude)), not a linear latitude fraction. */
export function seasonalAmplitude(latitude: number): number {
  const x = Math.abs(Math.sin((latitude * Math.PI) / 180));
  return x <= 0.1 ? 3 + x * 10 : 4 + (x - 0.1) * (24 / 0.9);
}
export function seasonalOffset(day: number, latitude: number): number {
  const amplitude = seasonalAmplitude(latitude) * (latitude < 0 ? -1 : 1);
  return -amplitude * Math.cos(2 * Math.PI * (day / YEAR_DAYS - 10 / 12));
}
/** The 7 C daily sine and starting local hour 08:00 are explicit prototype adaptations. */
export function outdoorTemperature(
  tick: number,
  settings: WorldSettings,
  generator: 1 | 2 | 3 | 4 = 2,
): number {
  if (generator === 1) return legacyTemperatureAt(tick);
  return (
    settings.meanTemperature +
    seasonalOffset(tick / DAY, settings.latitude) +
    7 * Math.sin(((hourAt(tick) - 8) / 24) * Math.PI * 2)
  );
}
/** World-label estimate, not actual hourly crop growth or indoor farming. */
export function growingSeasonDays(settings: WorldSettings): number {
  let days = 0;
  for (let segment = 0; segment < 12; segment++) {
    let sum = 0;
    for (let sample = 0; sample < 120; sample++)
      sum +=
        settings.meanTemperature +
        seasonalOffset(segment * 5 + 0.5 + (sample * 5) / 120, settings.latitude);
    const mean = sum / 120;
    if (mean >= 6 && mean <= 42) days += 5;
  }
  return days;
}
