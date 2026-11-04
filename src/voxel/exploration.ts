import { Block, CELLS, DEPTH, HEIGHT, WIDTH, index } from './types';

const layer = WIDTH * DEPTH;
function adjacent(cell: number): number[] {
  const x = cell % WIDTH, y = Math.floor(cell / WIDTH) % DEPTH, z = Math.floor(cell / layer);
  return [x > 0 ? cell - 1 : -1, x < WIDTH - 1 ? cell + 1 : -1,
    y > 0 ? cell - WIDTH : -1, y < DEPTH - 1 ? cell + WIDTH : -1,
    z > 0 ? cell - layer : -1, z < HEIGHT - 1 ? cell + layer : -1].filter(i => i >= 0);
}

/** Permanently expose connected air and its touching rock faces. Only a newly
 * opened cell touching known air can seed a reveal; remote excavation orders
 * never reveal space. Known air need not be flooded again after every change. */
export function revealExploration(blocks: Uint8Array, explored: Uint8Array, opened: Iterable<number>): number[] {
  const queue: number[] = [], queued = new Set<number>(), changed: number[] = [];
  const reveal = (cell: number) => { if (!explored[cell]) { explored[cell] = 1; changed.push(cell); } };
  for (const cell of opened) if (Number.isInteger(cell) && cell >= 0 && cell < CELLS && blocks[cell] === Block.Air &&
      (explored[cell] || adjacent(cell).some(n => explored[n] === 1 && blocks[n] === Block.Air)) && !queued.has(cell)) {
    queued.add(cell); reveal(cell); queue.push(cell);
  }
  for (let cursor = 0; cursor < queue.length; cursor++) for (const next of adjacent(queue[cursor])) {
    const unknown = explored[next] === 0;
    reveal(next);
    if (unknown && blocks[next] === Block.Air && !queued.has(next)) { queued.add(next); queue.push(next); }
  }
  return changed;
}

/** Exterior air enters from the sky and map sides. Enclosed underground air is
 * hidden until connected. Legacy generators retain their original full view. */
export function initialExploration(blocks: Uint8Array, generator: 1 | 2 | 3 | 4): Uint8Array {
  if (blocks.length !== CELLS) throw new Error('探索地形长度无效');
  const explored = new Uint8Array(CELLS);
  if (generator < 3) return explored.fill(1);
  const seeds: number[] = [];
  for (let z = 0; z < HEIGHT; z++) for (let y = 0; y < DEPTH; y++) for (let x = 0; x < WIDTH; x++)
    if (z === HEIGHT - 1 || x === 0 || x === WIDTH - 1 || y === 0 || y === DEPTH - 1) {
      const cell = index(x, y, z);
      if (blocks[cell] === Block.Air) { explored[cell] = 1; seeds.push(cell); }
    }
  revealExploration(blocks, explored, seeds);
  return explored;
}

export function rejectLegacyExploration(raw: Record<string, any>, sourceVersion: number): void {
  if (sourceVersion < 36 && Object.hasOwn(raw, 'explored')) throw new Error('旧版本存档包含新版探索字段');
}

/** Current data is never repaired. Reject sparse arrays, coercible values and
 * arbitrary lengths before allocating the authoritative independent mask. */
export function loadExploration(value: unknown): Uint8Array {
  if (!Array.isArray(value) || value.length !== CELLS) throw new Error('探索记录必须包含完整世界格数');
  for (let i = 0; i < CELLS; i++) if (!Object.hasOwn(value, i) || (value[i] !== 0 && value[i] !== 1))
    throw new Error('探索记录只能包含0或1');
  return Uint8Array.from(value);
}
