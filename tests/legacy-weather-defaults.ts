import { expect } from 'vitest';

/** Synthetic historical schema fixtures only. Never erase actual weather or
 * accumulated snow, and never modify the byte-preserved historical saves. */
export function stripWeatherFields(raw: Record<string, any>) {
  expect(raw.weather.cycle).toBe(0);
  expect(raw.weather.kind).toBe('clear');
  expect(raw.weather.previousKind).toBe('clear');
  expect(raw.weather.events).toEqual([]);
  expect(raw.snow).toEqual([]);
  delete raw.weather;
  delete raw.snow;
}
