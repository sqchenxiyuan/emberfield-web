import { ANIMAL_TEMPERATURES, animalEnvironmentEffects, initialAnimalEnvironment } from './animalEnvironment';
import type { VoxelSave, WildAnimal } from './types';

const record = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const severity = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
function fail(reason: string): never { throw new Error('动物环境存档无效：' + reason); }
const hasEnvironment = (a: Record<string, any>) => Object.hasOwn(a, 'environment') ||
  a.phase === 'shelter' || (record(a.goal) && ['shelter', 'climateExit'].includes(a.goal.kind));

/** Check animal carriers only. Human/world environmental state must never be
 * interpreted as an animal field merely because it has the same key name. */
export function rejectLegacyAnimalEnvironment(old: Record<string, any>, sourceVersion: number): void {
  if (sourceVersion >= 55) return;
  if (Array.isArray(old.animals) && old.animals.some(a => record(a) && hasEnvironment(a)))
    fail('旧版本混入动物环境疾病或避温任务');
  const visitTrade = (node: unknown, animal = false): void => {
    if (Array.isArray(node)) { node.forEach(value => visitTrade(value, animal)); return; }
    if (!record(node)) return;
    if ((animal || Object.hasOwn(ANIMAL_TEMPERATURES, node.species)) && hasEnvironment(node))
      fail('旧版本混入交易动物环境历史');
    for (const [key, value] of Object.entries(node)) visitTrade(value, key === 'animal' || key === 'animals');
  };
  visitTrade(old.trade);
}

/** Preflight every historical carrier before changing any live animal. */
function snapshots(d: Record<string, any>): Record<string, any>[] {
  if (!Array.isArray(d.animals) || d.animals.some(a => !record(a)) ||
      !record(d.trade) || !Array.isArray(d.trade.receipts)) fail('动物或交易历史缺失');
  const result: Record<string, any>[] = [...d.animals];
  for (const receipt of d.trade.receipts) {
    if (!record(receipt) || !Array.isArray(receipt.animalTransfers)) fail('交易动物历史缺失');
    for (const row of receipt.animalTransfers) {
      if (!record(row) || !record(row.animal)) fail('交易动物快照无效');
      result.push(row.animal);
    }
  }
  return result;
}

export function migrateAnimalEnvironment(old: Record<string, any>, sourceVersion: number): void {
  if (sourceVersion >= 55) return;
  // The world rejects injected new fields on the original input before any
  // migration. Earlier husbandry migration can already have added today's
  // independent default state, so repeating that guard here is incorrect.
  const animals = snapshots(old);
  for (const a of animals) a.environment = initialAnimalEnvironment();
}

/** Historical animals retain disease severity even after leaving the map. */
export function validateAnimalEnvironmentState(a: WildAnimal): void {
  if (!record(a) || !Object.hasOwn(ANIMAL_TEMPERATURES, a.species) || typeof a.dead !== 'boolean')
    fail('动物身份或生死状态无效');
  const state = a.environment;
  if (!record(state) || Object.keys(state).length !== 2 ||
      !Object.hasOwn(state, 'hypothermia') || !Object.hasOwn(state, 'heatstroke') ||
      !severity(state.hypothermia) || !severity(state.heatstroke)) fail('环境疾病字段或严重度无效');
  if (!a.dead && animalEnvironmentEffects(a).lethal) fail('活体环境疾病已致命');
}

export function validateAnimalEnvironment(d: VoxelSave): void {
  for (const a of snapshots(d)) validateAnimalEnvironmentState(a as WildAnimal);
}
