import { Block, CELLS, WIDTH, DEPTH, HEIGHT, at, inside, type Pos, type JobKind, type ConstructionMaterial } from './types';

/** Provisional Web pace; water and bridge identity are independent of balance. */
export const WATER_RULES = Object.freeze({ bridgeWood: 6, bridgeWork: 90, shallowPathTicks: 10 });
const plane = WIDTH * DEPTH;
export function waterBelow(water: Uint8Array, blocks: Uint8Array, p: Pos): number {
  if (!inside(p) || p.z < 1) return 0;
  const cell = at(p) - plane;
  return blocks[cell] === Block.Air ? water[cell] : 0;
}
/** Wood bridges provide light support. This list covers the currently available
 * building catalogue, not arbitrary future buildings or a mass simulation. */
export function bridgeSupports(kind: JobKind, material: ConstructionMaterial = 'wood'): boolean {
  return ['eggBox', 'bed', 'table', 'chair', 'shelf', 'smallShelf', 'door', 'fence', 'fenceGate',
    'penMarker', 'horseshoePin', 'heater', 'sandbag', 'craftingSpot', 'butcherSpot', 'wire', 'ladder', 'install', 'uninstall', 'remove'].includes(kind) ||
    (kind === 'wall' && material === 'wood');
}
export function validateWater(water: Uint8Array, bridges: Uint8Array, blocks: Uint8Array, ladders: Uint8Array, structureKinds?: Uint8Array): void {
  if (water.length !== CELLS || bridges.length !== CELLS) throw new Error('水域尺寸无效');
  for (let i = 0; i < CELLS; i++) {
    const z = Math.floor(i / plane);
    if (water[i] > 2 || bridges[i] > 1 ||
      (bridges[i] && (water[i] !== 1 || blocks[i] !== Block.Wood || structureKinds?.[i] !== 1)) ||
      (water[i] === 2 && (water[i-plane] === 2 ? water[i+plane] !== 0 : water[i+plane] !== 2)) ||
      (water[i] && (z < 1 || z >= HEIGHT - 2 || ladders[i] ||
        (blocks[i] !== Block.Air && !bridges[i]) ||
        (!blocks[i - plane] && !(water[i] === 2 && water[i - plane] === 2)) ||
        (water[i] === 1 && water[i - plane]))))
      throw new Error('水域、桥面或河床状态无效');
  }
}
