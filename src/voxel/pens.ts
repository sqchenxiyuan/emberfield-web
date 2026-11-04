import { at, CELLS, DAY, DEPTH, HEIGHT, WIDTH, inside, position, type Pos, type WildAnimal } from './types';

export interface Fence extends Pos { id: number }
export interface FenceGate extends Pos {
  id: number; axis: 'x' | 'y'; mode: 'auto' | 'open' | 'locked'; openUntil: number;
}
export interface PenFilter { deer: boolean; male: boolean; female: boolean }
export interface PenMarker extends Pos { id: number; name: string; filter: PenFilter }
export interface AnimalArea { id: number; name: string; color: number; cells: number[] }
export type AnimalPenState = Pick<WildAnimal, 'allowedAreaId' | 'ropePaused' | 'requestedPenId' | 'nextRoamTick'>;
export interface RopeTask {
  animalId: number; penId: number; stage: 'approach' | 'attach' | 'lead' | 'detach';
  progress: number; path: number[];
}
export interface PenTopology {
  markerId: number; cells: number[]; closed: boolean; reason: string; sharedWith: number[];
}
export interface PenSummary extends PenTopology {
  animalIds: number[]; pendingAnimalIds: number[]; grassNutrition: number; nutritionPerDay: number;
}
/** Work and roaming chance are concentrated Web tuning, not native calibration.
 * The five-day initial roaming grace and physical fence/rope distinction follow
 * the inspected mechanism. No nutrition estimate promises sustainable grazing. */
export const PEN_RULES = Object.freeze({
  attachWork: 40, detachWork: 20, ropeRetryTicks: 200,
  roamGraceTicks: 5 * DAY, roamCheckTicks: DAY, roamChance: .25, roamReturnCooldownTicks: 2 * DAY,
  maxFences: 2048, maxGates: 256, maxMarkers: 64, maxAreas: 16,
  maxAreaCells: 8192, maxNameLength: 40, maxRopePath: CELLS * 12,
});
/** Selected Core base material counts (1 / 25 / 30) and unscaled base HP.
 * This Web tier uses wood only and ceil(base WorkToBuild / 3); it does not
 * reproduce the native material-stat multiplier chain. */
export const PEN_BUILDINGS = Object.freeze({
  fence: Object.freeze({ cost: Object.freeze({ wood: 1 }), work: 24, maxHitPoints: 40 }),
  fenceGate: Object.freeze({ cost: Object.freeze({ wood: 25 }), work: 167, maxHitPoints: 20 }),
  penMarker: Object.freeze({ cost: Object.freeze({ wood: 30 }), work: 200, maxHitPoints: 100 }),
});
export function initialPenFilter(): PenFilter { return { deer: true, male: true, female: true }; }
export function initialAnimalPenState(tick: number): AnimalPenState {
  if (!Number.isSafeInteger(tick) || tick < 0 || !Number.isSafeInteger(tick + PEN_RULES.roamCheckTicks))
    throw new RangeError('圈养时钟无效');
  return { allowedAreaId: null, ropePaused: false, requestedPenId: null, nextRoamTick: tick + PEN_RULES.roamCheckTicks };
}
export function penAcceptsAnimal(marker: PenMarker, animal: Pick<WildAnimal, 'species' | 'sex' | 'faction' | 'dead'>): boolean {
  return animal.species === 'deer' && animal.faction === 'colony' && !animal.dead && marker.filter.deer &&
    (animal.sex === 'male' ? marker.filter.male : marker.filter.female);
}
export function isAnimalGroundStep(from: Pos, to: Pos): boolean {
  return inside(from) && inside(to) && from.z > 0 && from.z < HEIGHT - 1 && to.z > 0 && to.z < HEIGHT - 1 &&
    Math.abs(from.x - to.x) + Math.abs(from.y - to.y) === 1 && Math.abs(from.z - to.z) <= 1;
}
export function isPenMapEdge(p: Pos): boolean {
  return inside(p) && (p.x === 0 || p.x === WIDTH - 1 || p.y === 0 || p.y === DEPTH - 1);
}
type Neighbors = (p: Pos) => readonly number[];
const cell = (v: number) => Number.isInteger(v) && v >= 0 && v < CELLS;
function edges(from: number, neighbors: Neighbors): number[] {
  const p = position(from);
  return [...new Set(neighbors(p))].filter(n => cell(n) && isAnimalGroundStep(p, position(n)));
}

/** Enclosure uses the caller's STATIC deer walking graph: actual slopes and
 * head clearance, no ladders, no fire/actor blockers; auto door/gate temporary
 * opening is ignored. Held-open barriers must be passable in that graph.
 * A roof and a two-dimensional outline are irrelevant to containment. */
export function buildPenTopology(markers: readonly PenMarker[], neighbors: Neighbors,
  canStand: (p: Pos) => boolean = p => inside(p) && p.z > 0 && p.z < HEIGHT - 1): PenTopology[] {
  const components = new Map<number, { cells: number[]; closed: boolean }>();
  const results = markers.map(marker => {
    if (!inside(marker) || !canStand(marker)) return { markerId: marker.id, cells: [], closed: false,
      reason: '圈地标记没有合法站立格', sharedWith: [] as number[] };
    const start = at(marker);
    let component = components.get(start);
    if (!component) {
      const queue = [start], visited = new Set(queue); let closed = !isPenMapEdge(marker);
      for (let head = 0; head < queue.length; head++) for (const next of edges(queue[head], neighbors)) {
        if (visited.has(next) || !canStand(position(next))) continue;
        visited.add(next); queue.push(next);
        if (isPenMapEdge(position(next))) closed = false;
      }
      component = { cells: queue.sort((a, b) => a - b), closed };
      for (const n of queue) components.set(n, component);
    }
    return { markerId: marker.id, cells: component.cells, closed: component.closed,
      reason: component.closed ? '围栏或地形已形成封闭圈地' : '通路连接地图边界，圈地未封闭', sharedWith: [] as number[] };
  });
  for (const result of results) if (result.cells.length) {
    const component = components.get(result.cells[0]);
    result.sharedWith = markers.filter(marker => marker.id !== result.markerId && inside(marker) &&
      components.get(at(marker)) === component).map(marker => marker.id).sort((a, b) => a - b);
  }
  return results;
}

/** A rope move has two physical endpoints: the handler moves to next and the
 * deer moves to the handler's old cell. Both positions stay adjacent; swapping
 * their cells is prohibited. The caller supplies the intersection of legal
 * human and rope-managed deer edges, including openable doors but no fences or
 * ladders. No endpoint moves until the world executes a returned step.
 * States are adjacent pairs (at most 12 * CELLS), not arbitrary cell pairs. */
export function planRopePath(animal: Pos, handler: Pos, targetCells: ReadonlySet<number> | readonly number[],
  neighbors: Neighbors, reached: (animal: Pos, handler: Pos) => boolean = () => true): number[] | null {
  const targets = targetCells instanceof Set ? targetCells : new Set(targetCells);
  if (inside(animal) && targets.has(at(animal)) && reached(animal, handler)) return [];
  if (!isAnimalGroundStep(animal, handler)) return null;
  const a = at(animal), p = at(handler);
  const cache = new Map<number, number[]>();
  const nextOf = (n: number) => { let v = cache.get(n); if (!v) { v = edges(n, neighbors); cache.set(n, v); } return v; };
  if (!nextOf(a).includes(p)) return null;
  const start = a * CELLS + p, parents = new Map<number, number>([[start, -1]]), queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const key = queue[head], oldAnimal = Math.floor(key / CELLS), oldHandler = key % CELLS;
    for (const nextHandler of nextOf(oldHandler)) {
      if (nextHandler === oldAnimal) continue;
      const nextKey = oldHandler * CELLS + nextHandler;
      if (parents.has(nextKey)) continue;
      parents.set(nextKey, key);
      if (targets.has(oldHandler) && reached(position(oldHandler), position(nextHandler))) {
        const path: number[] = []; let n = nextKey;
        while (n !== start) { path.push(n % CELLS); n = parents.get(n)!; }
        return path.reverse();
      }
      queue.push(nextKey);
    }
  }
  return null;
}

/** An allowed area directs behaviour; it cannot trap an animal outside its
 * boundary. Search unrestricted legal ground edges until a real area cell is
 * reached. The world subsequently filters routine food, mating and roam goals. */
export function planAreaReturnPath(from: Pos, area: AnimalArea, neighbors: Neighbors): number[] | null {
  if (!inside(from) || !area.cells.length) return null;
  const targets = new Set(area.cells), start = at(from);
  if (targets.has(start)) return [];
  const parents = new Map<number, number>([[start, -1]]), queue = [start];
  for (let head = 0; head < queue.length; head++) for (const next of edges(queue[head], neighbors)) {
    if (parents.has(next)) continue;
    parents.set(next, queue[head]);
    if (targets.has(next)) {
      const path: number[] = []; let n = next;
      while (n !== start) { path.push(n); n = parents.get(n)!; }
      return path.reverse();
    }
    queue.push(next);
  }
  return null;
}
