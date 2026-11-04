import { inside, at, type Cargo, type Pos, type VoxelSave } from './types';
import { mergeBatch, portion, validBatch } from './preservation';
import { EGG_BOX_RULES } from './eggBoxRules';
import { healthSummary } from './survival';
export { EGG_BOX_RULES } from './eggBoxRules';

export interface EggBox extends Pos {
  id: number;
  eggs: Cargo | null;
  emptyRequested: boolean;
  forbidden: boolean;
}
export interface EggBoxTask { boxId: number; progress: number }
export const isEgg = (batch: Pick<Cargo, 'resource'>): boolean =>
  batch.resource === 'eggFertilized' || batch.resource === 'eggUnfertilized';
export function eggBoxAccepts(box: EggBox, resource: Cargo['resource'], amount = 1): boolean {
  return !box.forbidden && isEgg({ resource }) && Number.isInteger(amount) && amount > 0 &&
    (box.eggs === null || box.eggs.resource === resource) &&
    (box.eggs?.amount ?? 0) + amount <= EGG_BOX_RULES.capacity;
}
export function eggBoxInsert(box: EggBox, batch: Cargo, commit: boolean): boolean {
  if (!validBatch(batch) || !eggBoxAccepts(box, batch.resource, batch.amount)) return false;
  if (commit) {
    if (box.eggs) mergeBatch(box.eggs, batch);
    else box.eggs = portion(batch, batch.amount);
  }
  return true;
}
export function eggBoxCanEmpty(box: EggBox): boolean {
  return !box.forbidden && !!box.eggs && !box.eggs.forbidden &&
    (box.emptyRequested || box.eggs.amount >= EGG_BOX_RULES.emptyAt);
}
export function rejectLegacyEggBoxes(raw: Record<string, any>, version: number): void {
  if (version >= 52) return;
  if (Object.hasOwn(raw, 'eggBoxes') || raw.pawns?.some((p: any) => Object.hasOwn(p, 'eggBoxTask') || p.phase === 'eggBox') ||
      raw.jobs?.some((j: any) => j.kind === 'eggBox') || raw.fireDamage?.some((d: any) => d.kind === 'eggBox') ||
      raw.animals?.some((a: any) => a.goal?.kind === 'layEggBox')) throw new Error('旧版本混入蛋箱机制');
}
export function validateEggBoxes(d: VoxelSave): void {
  const fail = (): never => { throw new Error('蛋箱或取蛋任务存档无效'); };
  if (!Array.isArray(d.eggBoxes) || d.eggBoxes.length > EGG_BOX_RULES.maxBoxes) fail();
  const ids = new Set<number>(), cells = new Set<number>(), reserved = new Set<number>();
  for (const box of d.eggBoxes) {
    if (!box || Object.keys(box).length !== 7 || !['id','x','y','z','eggs','emptyRequested','forbidden'].every(k => Object.hasOwn(box,k)) ||
        !Number.isSafeInteger(box.id) || box.id <= 0 || box.id >= d.nextId || ids.has(box.id) || !inside(box) || cells.has(at(box)) ||
        typeof box.emptyRequested !== 'boolean' || typeof box.forbidden !== 'boolean') fail();
    ids.add(box.id); cells.add(at(box));
    if (box.eggs !== null && (!validBatch(box.eggs) || !isEgg(box.eggs) || box.eggs.amount > EGG_BOX_RULES.capacity ||
        Object.keys(box.eggs).some(k => !['resource','amount','hatcher','rotProgress','hitPoints','forbidden','poisonChance'].includes(k)))) fail();
    if (!box.eggs && box.emptyRequested) fail();
  }
  for (const pawn of d.pawns) {
    const task = pawn.eggBoxTask;
    if (task === undefined) { if (pawn.phase === 'eggBox') fail(); continue; }
    const box = d.eggBoxes.find(b => b.id === task?.boxId);
    if (!task || Object.keys(task).length !== 2 || !Object.hasOwn(task,'boxId') || !Object.hasOwn(task,'progress') ||
        !box || !eggBoxCanEmpty(box) || reserved.has(box.id) || !Number.isInteger(task.progress) || task.progress < 0 || task.progress > EGG_BOX_RULES.emptyWork ||
        pawn.phase !== 'eggBox' || pawn.dead || pawn.downed || pawn.drafted || pawn.faction !== 'colony' || pawn.cargo || pawn.jobId !== null ||
        pawn.priorities.haul <= 0 || healthSummary(pawn).manipulation <= 0 || pawn.carriedBy !== null || pawn.carryingPawnId !== null ||
        pawn.eating !== null || pawn.carePhase !== null || pawn.apparelTask !== null || pawn.weaponTask !== null ||
        pawn.handleTask !== null || pawn.ropeTask !== null || pawn.cleanTask !== null || pawn.firefightTask !== null || pawn.repairTask !== null ||
        pawn.wardenTask !== null || pawn.productionDelivery !== undefined || pawn.psyche.recreation !== null || pawn.living.mealTask !== null ||
        (task.progress > 0 && (pawn.path.length > 0 || Math.abs(pawn.x-box.x)+Math.abs(pawn.y-box.y)+Math.abs(pawn.z-box.z)>1))) fail();
    reserved.add(box!.id);
  }
  for (const animal of d.animals) if (animal.goal?.kind === 'layEggBox') {
    const box = d.eggBoxes.find(b => b.id === animal.goal!.id);
    if (!box || animal.faction !== 'colony' || animal.species !== 'chicken' || animal.sex !== 'female' || animal.growth < 1 ||
        animal.dead || animal.eggProgress !== 1 || animal.phase !== 'layEgg' || animal.mateId !== null || animal.eatProgress !== 0 ||
        !eggBoxAccepts(box, animal.fertilizationCount ? 'eggFertilized' : 'eggUnfertilized') || reserved.has(box.id) ||
        (animal.layProgress > 0 && (animal.path.length > 0 || at(animal) !== at(box)))) fail();
    reserved.add(box!.id);
  }
}
