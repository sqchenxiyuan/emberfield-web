import { expect } from 'vitest';
import { stripWeatherFields } from './legacy-weather-defaults';

/** Downgrade only synthetic, fire-free schema fixtures. Historical fixture
 * bytes remain immutable; never erase a real incident, loss or active task. */
export function stripFireFields(raw: Record<string, any>) {
  stripWeatherFields(raw);
  expect(raw.fires).toEqual([]);
  expect(raw.fireDamage).toEqual([]);
  expect(raw.fireLog).toEqual([]);
  expect(raw.fireHazards.events).toEqual([]);
  for (const pawn of raw.pawns) {
    expect(pawn.firefightTask).toBeNull();
    expect(pawn.repairTask).toBeNull();
    expect(['firefight', 'repair']).not.toContain(pawn.phase);
    delete pawn.firefightTask;
    delete pawn.repairTask;
    delete pawn.priorities.firefight;
  }
  delete raw.fires;
  delete raw.fireDamage;
  delete raw.fireLog;
  delete raw.fireHazards;
}
