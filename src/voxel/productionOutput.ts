import { at, HEIGHT, WIDTH, DEPTH, type Resource, type VoxelSave } from './types';
import type { ProductionRecipe } from './productionBills';
import { shelfCells } from './shelves';
import { effectiveShelfSettings } from './storageGroups';
import { carryLimit } from './logistics';
import { validStockpileZoneId } from './stockpileZones';

export type ProductionOutputTarget =
  | { kind: 'stockpile'; id: string }
  | { kind: 'shelf' | 'group'; id: number };
export interface ProductionOutput {
  mode: 'drop' | 'best' | 'specific';
  target: ProductionOutputTarget | null;
}
/** This owns no product and no recipe work. The physical product is pawn.cargo,
 * and the completed bill may subsequently be edited or deleted independently. */
export interface ProductionDelivery {
  billId: string;
  recipe: ProductionRecipe;
  mode: 'best' | 'specific';
  target: ProductionOutputTarget | null;
  cell: number;
  state: 'carrying' | 'dropping';
}
export type ProductionOutputHost = Pick<VoxelSave, 'stockpiles' | 'stockpileZones' | 'shelves' | 'storageGroups'>;
export interface ProductionOutputDestination {
  target: ProductionOutputTarget;
  label: string;
  cells: number[];
  accepts: Resource[];
}
export const defaultProductionOutput = (mode: 'drop' | 'best' = 'best'): ProductionOutput => ({ mode, target: null });
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown, min = 1, max = 9999999): v is number => Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
export function validProductionOutputTarget(v: unknown): v is ProductionOutputTarget {
  if (!record(v) || Object.keys(v).length !== 2 || !Object.hasOwn(v, 'id')) return false;
  return v.kind === 'stockpile' ? validStockpileZoneId(v.id, 10000000)
    : ['shelf', 'group'].includes(v.kind) && integer(v.id);
}
export function validProductionOutput(v: unknown): v is ProductionOutput {
  return record(v) && Object.keys(v).length === 2 &&
    (v.mode === 'specific' ? validProductionOutputTarget(v.target) : ['drop', 'best'].includes(v.mode) && v.target === null);
}
export function sameProductionOutputTarget(a: ProductionOutputTarget | null, b: ProductionOutputTarget | null): boolean {
  return a === null || b === null ? a === b : a.kind === b.kind && a.id === b.id;
}
export function productionOutputResources(recipe: ProductionRecipe): Resource[] {
  if (recipe === 'cook') return ['meal'];
  if (recipe === 'stonecut') return ['stone'];
  if (recipe === 'butcher') return ['meat'];
  if (typeof recipe !== 'string') return [];
  if (/^smith:(woodClub|steelKnife|steelLongsword|shortBow|revolver|machinePistol)$/.test(recipe)) return ['weapon'];
  if (/^(tailoring:(tuque|parka|duster|shirt|pants)|armorsmith:(simpleHelmet|plateArmor))$/.test(recipe)) return ['apparel'];
  return [];
}
/** A linked group is one selectable destination with several physical shelves;
 * settings and free slots still belong to the actual member cells. */
export function productionOutputDestinations(host: ProductionOutputHost): ProductionOutputDestination[] {
  const stock = new Map(host.stockpiles.map(s => [at(s), s]));
  const entries: ProductionOutputDestination[] = host.stockpileZones.map(zone => ({
    target: { kind: 'stockpile', id: zone.id }, label: zone.name,
    cells: zone.cells.filter(cell => stock.has(cell)),
    accepts: [...new Set(zone.cells.flatMap(cell => stock.get(cell)?.accepts ?? []))],
  })).filter(e => e.cells.length > 0) as ProductionOutputDestination[];
  for (const group of host.storageGroups) {
    const members = host.shelves.filter(s => group.memberIds.includes(s.id));
    entries.push({ target: { kind: 'group', id: group.id }, label: group.name,
      cells: members.flatMap(s => shelfCells(s).map(at)), accepts: [...group.settings.accepts] });
  }
  for (const shelf of host.shelves) if (!host.storageGroups.some(g => g.memberIds.includes(shelf.id)))
    entries.push({ target: { kind: 'shelf', id: shelf.id },
      label: `${shelf.kind === 'smallShelf' ? '小货架' : '货架'} #${shelf.id}（${shelf.x}, ${shelf.y}, 层${shelf.z}）`,
      cells: shelfCells(shelf).map(at), accepts: [...effectiveShelfSettings(host.storageGroups, shelf.id, shelf.settings).accepts] });
  return entries;
}
/** A formerly independent shelf can still be addressed after joining a group;
 * only the picker de-duplicates it. Existing output references do not retarget. */
export function productionOutputTargetCells(host: ProductionOutputHost, target: ProductionOutputTarget): number[] {
  if (target.kind === 'shelf') {
    const shelf = host.shelves.find(s => s.id === target.id);
    return shelf ? shelfCells(shelf).map(at) : [];
  }
  return productionOutputDestinations(host).find(d => sameProductionOutputTarget(d.target, target))?.cells ?? [];
}
/** A registered linked group can survive while every shelf is packed. It has
 * no destination cells then, but its bill reference remains valid. */
export function productionOutputTargetExists(host: ProductionOutputHost, target: ProductionOutputTarget): boolean {
  return target.kind === 'stockpile' ? host.stockpileZones.some(zone => zone.id === target.id)
    : target.kind === 'shelf' ? host.shelves.some(shelf => shelf.id === target.id)
      : host.storageGroups.some(group => group.id === target.id);
}
export function productionOutputTargetName(host: ProductionOutputHost, target: ProductionOutputTarget | null): string {
  if (!target) return '最佳仓库';
  return productionOutputDestinations(host).find(d => sameProductionOutputTarget(d.target, target))?.label ??
    (target.kind === 'shelf' && host.shelves.some(s => s.id === target.id) ? `货架 #${target.id}` : '原指定仓库（已失效）');
}
export function reconcileProductionOutputs(host: ProductionOutputHost & Pick<VoxelSave, 'productionQueues'>): void {
  for (const queue of host.productionQueues) for (const bill of queue.bills)
    if (bill.output.mode === 'specific' && !productionOutputTargetExists(host, bill.output.target!))
      bill.output = defaultProductionOutput('drop');
}
export function validateProductionOutputState(d: VoxelSave): void {
  const fail = (): never => { throw new Error('生产成品去向或送货存档无效'); };
  for (const queue of d.productionQueues) for (const bill of queue.bills)
    if (!validProductionOutput(bill.output) || (bill.output.target && !productionOutputTargetExists(d, bill.output.target))) fail();
  for (const pawn of d.pawns) {
    if (!Object.hasOwn(pawn, 'productionDelivery')) continue;
    const task = pawn.productionDelivery;
    if (!record(task) || Object.keys(task).length !== 6 ||
        !['billId', 'recipe', 'mode', 'target', 'cell', 'state'].every(k => Object.hasOwn(task, k)) ||
        typeof task.billId !== 'string' || !/^(bill:[1-9]\d*|legacy:[1-9]\d*:.+)$/.test(task.billId) ||
        !integer(Number(task.billId.split(':')[1]), 1, d.nextId - 1) ||
        (task.billId.startsWith('legacy:') && task.billId.split(':').slice(2).join(':') !== task.recipe) ||
        !productionOutputResources(task.recipe).length ||
        !validProductionOutput({mode:task.mode, target:task.target}) || !['best', 'specific'].includes(task.mode) ||
        (task.target && (task.target.kind === 'stockpile'
          ? !validStockpileZoneId(task.target.id, d.nextId) : !integer(task.target.id, 1, d.nextId - 1))) ||
        !integer(task.cell, 0, WIDTH * DEPTH * HEIGHT - 1) || !['carrying', 'dropping'].includes(task.state) ||
        !pawn.cargo || pawn.cargo.resource !== productionOutputResources(task.recipe)[0] ||
        (pawn.cargo.resource === 'weapon' && pawn.cargo.weapon?.kind !== task.recipe.split(':')[1]) ||
        (pawn.cargo.resource === 'apparel' && pawn.cargo.apparel?.kind !== task.recipe.split(':')[1]) ||
        pawn.cargo.amount > carryLimit(pawn.cargo.resource) || pawn.jobId !== null ||
        pawn.faction !== 'colony' || pawn.dead || pawn.downed || pawn.drafted ||
        (task.state === 'carrying' ? pawn.phase !== 'haul'
          : pawn.phase !== 'idle' || pawn.path.length > 0 || pawn.destination !== null)) fail();
  }
}
