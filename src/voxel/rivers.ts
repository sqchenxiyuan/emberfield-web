import { Block, CELLS, DEPTH, HEIGHT, WIDTH, index, type Pos } from './types';

export type RiverKind = 'none' | 'creek' | 'river';
export type RiverEdge = 'north' | 'east' | 'south' | 'west';
/** Ports are centered on the shared edge. All incoming branches join the same
 * local water body before leaving at outflow. This is terrain, not a fluid solver. */
export interface RiverRoute {
  inflow: RiverEdge[];
  outflow: RiverEdge | null;
}
export const RIVER_RULES = Object.freeze({
  version: 1,
  landingProtection: 10,
  creekRadius: 1,
  riverRadius: 3,
  fordHalfWidth: 1,
  shallow: 1,
  deep: 2,
});

function random(seed: number, x: number, y: number, salt: number): number {
  let value = Math.imul((seed | 0) ^ Math.floor(seed / 4294967296), 374761393) ^
    Math.imul(x + 213, 668265263) ^ Math.imul(y + 577, 1274126177) ^ Math.imul(salt, 1597334677);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}
const directions = [[1, 0], [0, 1], [-1, 0], [0, -1]];
type Node = { cell: number; cost: number; priority: number };
/** A bounded local priority queue avoids scanning the whole map per path step. */
function push(heap: Node[], node: Node) {
  let i = heap.length;
  heap.push(node);
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (heap[parent].priority <= node.priority) break;
    heap[i] = heap[parent]; i = parent;
  }
  heap[i] = node;
}
function pop(heap: Node[]): Node {
  const head = heap[0], tail = heap.pop()!;
  if (!heap.length) return head;
  let i = 0;
  while (i * 2 + 1 < heap.length) {
    let child = i * 2 + 1;
    if (child + 1 < heap.length && heap[child + 1].priority < heap[child].priority) child++;
    if (heap[child].priority >= tail.priority) break;
    heap[i] = heap[child]; i = child;
  }
  heap[i] = tail;
  return head;
}
function routePath(seed: number, start: number, target: number, spawn: Pos): number[] {
  const costs = new Float64Array(WIDTH * DEPTH).fill(Infinity),
    previous = new Int32Array(WIDTH * DEPTH).fill(-1), heap: Node[] = [];
  const tx = target % WIDTH, ty = Math.floor(target / WIDTH);
  const heuristic = (cell: number) => Math.abs(cell % WIDTH - tx) + Math.abs(Math.floor(cell / WIDTH) - ty);
  costs[start] = 0;
  push(heap, { cell: start, cost: 0, priority: heuristic(start) });
  while (heap.length) {
    const current = pop(heap);
    if (current.cost !== costs[current.cell]) continue;
    if (current.cell === target) {
      const result = [target];
      while (result[result.length - 1] !== start) result.push(previous[result[result.length - 1]]);
      return result.reverse();
    }
    const x = current.cell % WIDTH, y = Math.floor(current.cell / WIDTH);
    for (const [dx, dy] of directions) {
      const nx = x + dx, ny = y + dy, next = ny * WIDTH + nx;
      if (nx < 0 || ny < 0 || nx >= WIDTH || ny >= DEPTH ||
          Math.hypot(nx - spawn.x, ny - spawn.y) < RIVER_RULES.landingProtection + RIVER_RULES.riverRadius) continue;
      const cost = current.cost + 1 + random(seed, Math.floor(nx / 4), Math.floor(ny / 4), 615) * 1.7;
      if (cost >= costs[next]) continue;
      costs[next] = cost; previous[next] = current.cell;
      push(heap, { cell: next, cost, priority: cost + heuristic(next) });
    }
  }
  throw new Error('无法在出生保护区外连接河流出入口');
}

/** The water byte occupies an AIR voxel immediately above a solid riverbed.
 * A pawn stands at water-cell z + 1; 1 means wadeable/bridgeable, 2 deep water.
 * Shallow water is one voxel deep; a deep channel is two contiguous water
 * voxels down to its real bed. No automatic flow or pressure is simulated.
 * Banks are graded at one voxel per tile; the starting patch remains unchanged.
 * Called before caves/ore so cave roof checks preserve the physical riverbed. */
export function carveRivers(
  seed: number, blocks: Uint8Array, heightMap: Uint8Array, spawn: Pos,
  kind: RiverKind, route?: RiverRoute,
): { water: Uint8Array; waterMap: Uint8Array; clearTrees: Uint8Array } {
  const water = new Uint8Array(CELLS), waterMap = new Uint8Array(WIDTH * DEPTH),
    clearTrees = new Uint8Array(WIDTH * DEPTH);
  if (kind === 'none') return { water, waterMap, clearTrees };
  const hubX = spawn.x + (random(seed, 0, 0, 600) < 0.5 ? -17 : 17),
    hubY = spawn.y + (random(seed, 0, 0, 601) < 0.5 ? -13 : 13), hub = hubY * WIDTH + hubX;
  const port: Record<RiverEdge, number> = {
    north: Math.floor(WIDTH / 2), south: (DEPTH - 1) * WIDTH + Math.floor(WIDTH / 2),
    west: Math.floor(DEPTH / 2) * WIDTH, east: Math.floor(DEPTH / 2) * WIDTH + WIDTH - 1,
  };
  const edges: RiverEdge[] = route ? [...new Set([...route.inflow, ...(route.outflow ? [route.outflow] : [])])] :
    random(seed, 0, 0, 602) < 0.5 ? ['north', 'south'] : ['west', 'east'];
  if (!edges.length) return { water, waterMap, clearTrees };
  const center = new Uint8Array(WIDTH * DEPTH);
  for (const edge of edges) for (const cell of routePath(seed, port[edge], hub, spawn)) center[cell] = 1;
  const radius = kind === 'creek' ? RIVER_RULES.creekRadius : RIVER_RULES.riverRadius,
    distance = new Uint8Array(WIDTH * DEPTH).fill(255), queue: number[] = [];
  for (let cell = 0; cell < center.length; cell++) if (center[cell]) {
    distance[cell] = 0; queue.push(cell);
  }
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const cell = queue[cursor], x = cell % WIDTH, y = Math.floor(cell / WIDTH);
    for (const [dx, dy] of directions) {
      const nx = x + dx, ny = y + dy, next = ny * WIDTH + nx;
      if (nx < 0 || ny < 0 || nx >= WIDTH || ny >= DEPTH || distance[next] <= distance[cell] + 1) continue;
      distance[next] = distance[cell] + 1; queue.push(next);
    }
  }
  const waterHeight = Math.max(4, Math.min(10, spawn.z - 1));
  // A full strip through the confluence supplies a continuous natural ford,
  // while the remainder of a broad river retains its impassable deep center.
  const fordHorizontal = edges.includes('north') || edges.includes('south');
  for (let y = 0; y < DEPTH; y++) for (let x = 0; x < WIDTH; x++) {
    const cell = y * WIDTH + x, wet = distance[cell] <= radius,
      ford = Math.abs((fordHorizontal ? y : x) - (fordHorizontal ? hubY : hubX)) <= RIVER_RULES.fordHalfWidth;
    if (wet) waterMap[cell] = kind === 'river' && distance[cell] <= 1 && !ford ? 2 : 1;
    const bankDistance = Math.max(0, distance[cell] - radius), originalHeight = heightMap[cell];
    const terrainHeight = wet ? waterHeight - (waterMap[cell] === 2 ? 2 : 1) : Math.max(waterHeight - (bankDistance - 1),
      Math.min(waterHeight + bankDistance - 1, originalHeight));
    const top = blocks[index(x, y, originalHeight - 1)];
    if (terrainHeight !== originalHeight || wet) {
      for (let z = 1; z < HEIGHT; z++) blocks[index(x, y, z)] = z >= terrainHeight ? Block.Air :
        z === terrainHeight - 1 ? wet ? Block.Gravel : top : Block.Stone;
    }
    if (wet) for (let z = terrainHeight; z < waterHeight; z++) water[index(x, y, z)] = waterMap[cell];
    heightMap[cell] = wet ? waterHeight : terrainHeight;
    if (wet || (ford && bankDistance <= 3)) clearTrees[cell] = 1;
  }
  return { water, waterMap, clearTrees };
}
