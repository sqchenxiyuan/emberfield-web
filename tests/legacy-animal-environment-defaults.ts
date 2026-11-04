import { expect } from 'vitest';
import { initialAnimalEnvironment } from '../src/voxel/animalEnvironment';

const animals = (raw: Record<string, any>) => [...(raw.animals ?? []),
  ...(raw.trade?.receipts ?? []).flatMap((r: any) =>
    (r.animalTransfers ?? []).map((row: any) => row.animal))];

/** Synthetic downgrades may discard only inactive, exactly default disease
 * state. Preflight is separate so earlier-schema helpers remain atomic. */
export function assertAnimalEnvironmentDefaults(raw: Record<string, any>): void {
  for (const a of animals(raw)) {
    expect(a.phase).not.toBe('shelter');
    expect(['shelter', 'climateExit']).not.toContain(a.goal?.kind);
    if (Object.hasOwn(a, 'environment')) expect(a.environment).toEqual(initialAnimalEnvironment());
  }
}

export function stripAnimalEnvironmentFields(raw: Record<string, any>): void {
  assertAnimalEnvironmentDefaults(raw);
  for (const a of animals(raw)) delete a.environment;
}

export function animalEnvironmentExpectedField(key: string, value: any): any {
  const copy = structuredClone(value);
  if (key === 'animals') for (const a of copy) a.environment = initialAnimalEnvironment();
  if (key === 'trade') for (const r of copy.receipts ?? []) for (const row of r.animalTransfers ?? [])
    row.animal.environment = initialAnimalEnvironment();
  return copy;
}
