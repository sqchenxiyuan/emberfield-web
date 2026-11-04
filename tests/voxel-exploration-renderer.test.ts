import { describe, expect, it } from 'vitest';
import { Group, MeshLambertMaterial, OrthographicCamera, Plane, Raycaster, Vector2, Vector3 } from 'three';
import { VoxelRenderer } from '../src/voxel/renderer';
import { Block, CHUNK, WIDTH, DEPTH, HEIGHT, index } from '../src/voxel/types';

// Exercise actual chunk ingestion and mesh generation without requiring a GPU.
// Two different secret terrains must yield byte-identical visible geometry.
function harness(block: number, known: boolean, level = 4, hiddenWater = 0, hiddenBridge = 0) {
  const renderer = Object.create(VoxelRenderer.prototype) as any;
  Object.assign(renderer, {
    disposed: false, blockData: new Uint8Array(WIDTH * DEPTH * HEIGHT),
    ladderData: new Uint8Array(WIDTH * DEPTH * HEIGHT), exploredData: new Uint8Array(WIDTH * DEPTH * HEIGHT),
    waterData: new Uint8Array(WIDTH * DEPTH * HEIGHT), bridgeData: new Uint8Array(WIDTH * DEPTH * HEIGHT),
    terrainMeshes: new Map(), geometrySizes: new Map(), dirty: new Set(), loaded: new Set(),
    terrainRoot: new Group(), terrainMaterial: new MeshLambertMaterial(),
    cursor: new Group(), hover: null, level,
  });
  const blocks = new Uint8Array(CHUNK ** 3).fill(block), explored = new Uint8Array(CHUNK ** 3).fill(known ? 1 : 0);
  renderer.chunks([{ id: 0, blocks, explored, ladders: new Uint8Array(CHUNK ** 3).fill(1),
    water: new Uint8Array(CHUNK ** 3).fill(hiddenWater), bridges: new Uint8Array(CHUNK ** 3).fill(hiddenBridge) }]);
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
  it('does not reveal undiscovered water or bridge identity through mesh shape, colors or caches', () => {
    const dry = harness(Block.Air, false), deep = harness(Block.Air, false, 4, 2), bridge = harness(Block.Wood, false, 4, 1, 1);
    expect(deep.data).toEqual(dry.data); expect(bridge.data).toEqual(dry.data);
    expect(deep.renderer.waterData.some(Boolean)).toBe(false);
    expect(bridge.renderer.waterData.some(Boolean)).toBe(false);
    expect(bridge.renderer.bridgeData.some(Boolean)).toBe(false);
    dry.dispose(); deep.dispose(); bridge.dispose();
  });
  it('picks the actual river height below the work plane, including a ray into a bridge board gap', () => {
    for (const built of [false, true]) {
      const sample = harness(Block.Air, true), renderer = sample.renderer;
      const blocks = new Uint8Array(CHUNK ** 3), water = new Uint8Array(CHUNK ** 3), bridges = new Uint8Array(CHUNK ** 3);
      const cell = (2 * CHUNK + 3) * CHUNK + 3;
      water[cell] = 1; bridges[cell] = built ? 1 : 0; blocks[cell] = built ? Block.Wood : Block.Air;
      renderer.chunks([{ id: 0, blocks, water, bridges, explored: new Uint8Array(CHUNK ** 3).fill(1), ladders: new Uint8Array(CHUNK ** 3) }]);
      renderer.makeChunk(0);
      const camera = new OrthographicCamera(-6, 6, 6, -6, .1, 100);
      camera.position.set(12, 18, 12); camera.lookAt(3.5, 3, 3.5); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
      Object.assign(renderer, { camera, width: 800, height: 800, ray: new Raycaster(), pointer: new Vector2(), plane: new Plane(new Vector3(0, 1, 0), -4), hit: new Vector3() });
      const point = renderer.project({ x: 3, y: 3, z: 3 });
      expect(renderer.pick(point.x, point.y)).toEqual({ x: 3, y: 3, z: 3 });
      sample.dispose();
    }
  });
});
