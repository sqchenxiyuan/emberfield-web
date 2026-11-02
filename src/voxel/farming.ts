import { Block, DAY, type CropKind, type Resource } from './types';

export function fertilityOf(block: number): number {
  return block === Block.Soil
    ? 1
    : block === Block.RichSoil
      ? 1.4
      : block === Block.Gravel
        ? 0.7
        : block === Block.Sand
          ? 0.1
          : 0;
}
// Rice/potato inherit 0.7; corn explicitly sets 0.70 in the inspected Core defs.
export const MIN_CROP_FERTILITY = 0.7;

// Reference fields are documented separately from the 3D and time-scale design in chapter 12.
export const CROPS: Record<
  CropKind,
  { name: string; days: number; yield: number; fertilitySensitivity: number; sowWork: number }
> = {
  rice: { name: '稻米', days: 3, yield: 6, fertilitySensitivity: 1, sowWork: 57 },
  potato: { name: '土豆', days: 5.8, yield: 11, fertilitySensitivity: 0.4, sowWork: 57 },
  corn: { name: '玉米', days: 11.3, yield: 22, fertilitySensitivity: 1, sowWork: 57 },
  cotton: { name: '棉花', days: 8, yield: 10, fertilitySensitivity: 1, sowWork: 57 },
};
export const SIMPLE_MEAL = { ingredients: 10, wood: 1, output: 1, work: 100 };
export const NUTRITION: Partial<Record<Resource, number>> = { meal: 0.9, food: 0.9, grain: 0.05 };
export const FOOD_FALL_PER_TICK = (1.6 * 100) / DAY;
export const hourAt = (tick: number) => (8 + (tick / DAY) * 24) % 24;
export const temperatureAt = (tick: number) =>
  21 + 7 * Math.sin(((hourAt(tick) - 8) / 24) * Math.PI * 2);
export function temperatureGrowth(t: number) {
  if (t <= 0 || t >= 58) return 0;
  if (t < 6) return t / 6;
  if (t <= 42) return 1;
  return (58 - t) / 16;
}
// Saturated daylight is a local sky model; the original also saturates sunlight, with latitude/season/weather.
export function daylight(hour: number) {
  return hour >= 6 && hour <= 18 ? Math.min(1, 2 * Math.sin(((hour - 6) / 12) * Math.PI)) : 0;
}
export function fertilityGrowth(kind: CropKind, fertility: number) {
  return Math.max(0, 1 + (fertility - 1) * CROPS[kind].fertilitySensitivity);
}
export function lightGrowth(light: number) {
  return Math.max(0, Math.min(1, (light - 0.51) / 0.49));
}
export function cropGrowth(
  kind: CropKind,
  fertility: number,
  light: number,
  temperature: number,
  hour: number,
) {
  if (hour < 6 || hour >= 19.2) return 0;
  return (
    (fertilityGrowth(kind, fertility) * lightGrowth(light) * temperatureGrowth(temperature)) /
    (CROPS[kind].days * DAY)
  );
}
