import { describe, expect, it } from 'vitest';
import { Group, MeshLambertMaterial } from 'three';
import { VoxelRenderer } from '../src/voxel/renderer';
import { Block, CHUNK, WIDTH, DEPTH, HEIGHT, index } from '../src/voxel/types';

// Exercise actual chunk ingestion and mesh generation without requiring a GPU.
// Two different secret terrains must yield byte-identical visible geometry.
function harness(block: number, known: boolean, level = 4) {
  const renderer = Object.create(VoxelRenderer.prototype) as any;
  Object.assign(renderer, {
    disposed: false, blockData: new Uint8Array(WIDTH * DEPTH * HEIGHT),
    ladderData: new Uint8Array(WIDTH * DEPTH * HEIGHT), exploredData: new Uint8Array(WIDTH * DEPTH * HEIGHT),
    terrainMeshes: new Map(), geometrySizes: new Map(), dirty: new Set(), loaded: new Set(),
    terrainRoot: new Group(), terrainMaterial: new MeshLambertMaterial(),
    cursor: new Group(), hover: null, level,
  });
  const blocks = new Uint8Array(CHUNK ** 3).fill(block), explored = new Uint8Array(CHUNK ** 3).fill(known ? 1 : 0);
  renderer.chunks([{ id: 0, blocks, explored, ladders: new Uint8Array(CHUNK ** 3).fill(1) }]);
  renderer.makeChunk(0);
  const mesh = renderer.terrainMeshes.get(0);
  const geometry = Object.fromEntries(Object.entries(mesh.geometry.attributes).map(([name, attr]: [string, any]) => [name, [...attr.array]]));
  const data: Record<string, number[]> = { ...geometry, indices: [...mesh.geometry.index.array] };
  const dispose = () => { mesh.geometry.dispose(); renderer.terrainMaterial.dispose(); };
  return { renderer, data, dispose };
}

describe('exploration view boundary', () => {
  it('renders unknown air, stone and ore as exactly the same opaque cut mesh on every tested floor', () => {
    for (const level of [1, 4, 7]) {
      const air = harness(Block.Air, false, level), rock = harness(Block.Stone, false, level), ore = harness(Block.Steel, false, level);
      expect(air.data).toEqual(rock.data); expect(air.data).toEqual(ore.data);
      const heights = (air.data.position as number[]).filter((_, i) => i % 3 === 1);
      expect(heights.some(z => Math.abs(z - (level + .55)) < .00001)).toBe(true);
      expect(air.renderer.blockData[index(2, 2, level)]).toBe(Block.Stone);
      expect(air.renderer.ladderData[index(2, 2, level)]).toBe(0);
      air.dispose(); rock.dispose(); ore.dispose();
    }
  });
  it('reveals real geometry and mineral colors only after the same cells become explored', () => {
    const unknown = harness(Block.Steel, false), ore = harness(Block.Steel, true), air = harness(Block.Air, true);
    expect(unknown.data).not.toEqual(ore.data); expect(ore.data).not.toEqual(air.data);
    expect(air.data.position).toEqual([]);
    expect(ore.renderer.ladderData[index(2, 2, 4)]).toBe(1);
    unknown.dispose(); ore.dispose(); air.dispose();
  });
});
