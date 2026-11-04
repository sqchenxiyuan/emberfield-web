import { Block, DEPTH, WIDTH, index, type Pos, type WorldSettings } from './types';

/** Provisional 3D cave rules. These are Emberfield choices, not RimWorld values.
 * Changing them requires another local generator/site version. */
export const CAVE_RULES = Object.freeze({
  networks: { flat: 2, small: 3, large: 5, mountainous: 7 },
  attemptsPerNetwork: 48,
  walkSteps: 36,
  clearance: 3,
  landingProtection: 6,
});

function random(seed: number, network: number, step: number, salt: number): number {
  let v = Math.imul((seed | 0) ^ Math.floor(seed / 4294967296), 374761393) ^
    Math.imul(network + 213, 668265263) ^ Math.imul(step + 577, 1274126177) ^
    Math.imul(salt + 3571, 1597334677);
  v = Math.imul(v ^ (v >>> 13), 1274126177);
  return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
}

/** Carve before minerals, keeping the original surface, solid floors, ceilings
 * and bedrock. Each walk is level and connected; separate walks can occupy
 * different elevations. There are no unwalkable one-cell diagonal tunnels.
 * Current terrain design makes enclosed chambers; entrances are excavated by
 * colonists. An exposed cave-mouth terrain pass is deliberately not implied. */
export function carveCaves(
  seed: number,
  blocks: Uint8Array,
  heightMap: Uint8Array,
  spawn: Pos,
  settings: WorldSettings,
): { networks: number; carvedCells: number } {
  let networks = 0, carvedCells = 0;
  const valid = (x: number, y: number, z: number) =>
    x >= 2 && y >= 2 && x < WIDTH - 2 && y < DEPTH - 2 &&
    Math.hypot(x - spawn.x, y - spawn.y) > CAVE_RULES.landingProtection &&
    z >= 2 && z + CAVE_RULES.clearance < heightMap[y * WIDTH + x] &&
    blocks[index(x, y, z - 1)] !== Block.Air &&
    blocks[index(x, y, z + CAVE_RULES.clearance)] !== Block.Air;
  const carve = (x: number, y: number, z: number, radius: number) => {
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius || !valid(x + dx, y + dy, z)) continue;
      for (let dz = 0; dz < CAVE_RULES.clearance; dz++) {
        const i = index(x + dx, y + dy, z + dz);
        if (blocks[i] !== Block.Air) { blocks[i] = Block.Air; carvedCells++; }
      }
    }
  };
  const directions = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  for (let network = 0; network < CAVE_RULES.networks[settings.hilliness]; network++) {
    let start: Pos | null = null;
    for (let attempt = 0; attempt < CAVE_RULES.attemptsPerNetwork; attempt++) {
      const x = 7 + Math.floor(random(seed, network, attempt, 0) * (WIDTH - 14)),
        y = 7 + Math.floor(random(seed, network, attempt, 1) * (DEPTH - 14)),
        maxZ = Math.min(6, heightMap[y * WIDTH + x] - CAVE_RULES.clearance - 1),
        z = 2 + Math.floor(random(seed, network, attempt, 2) * Math.max(1, maxZ - 1));
      // A full starter chamber needs a solid floor/roof throughout its footprint.
      if (!valid(x, y, z) || directions.some(([dx, dy]) => !valid(x + dx * 2, y + dy * 2, z))) continue;
      start = { x, y, z }; break;
    }
    if (!start) continue;
    networks++;
    let { x, y } = start;
    const { z } = start;
    let heading = Math.floor(random(seed, network, 0, 3) * 4);
    carve(x, y, z, 2);
    for (let step = 0; step < CAVE_RULES.walkSteps; step++) {
      const turn = random(seed, network, step, 4);
      if (turn < 0.22) heading = (heading + 1) % 4;
      else if (turn > 0.78) heading = (heading + 3) % 4;
      const choices = [heading, (heading + 1) % 4, (heading + 3) % 4, (heading + 2) % 4];
      const next = choices.find(d => valid(x + directions[d][0], y + directions[d][1], z));
      if (next === undefined) break;
      heading = next; x += directions[next][0]; y += directions[next][1];
      carve(x, y, z, step % 9 === 8 ? 2 + Math.floor(random(seed, network, step, 5) * 2) : 1);
    }
  }
  return { networks, carvedCells };
}
