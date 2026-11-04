import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateWorld, previewWorld, WORLD_PRESETS } from '../src/voxel/worldgen';
import { initialExploration } from '../src/voxel/exploration';
import { Block, CELLS, DEPTH, WIDTH, index, type Hilliness } from '../src/voxel/types';

const sha = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
// Captured from root b125bd3 before changing generator code; site v1 must keep these bytes.
const legacy = [
  [73129, 'a70a50fb3df284c3d23e0fd4f2ec845ceabfee50b73c1deaa4a8fa87c37640a3', '708aecc5a6552964b39b030c8af8a3f5554ea4f8e79bab994b2f15d72c740e0b'],
  [17, '2e45ca0d9fb689d81be1e8dd0f4fb37bd7000021550e11c5eecf38f3f20513da', '58bbc5704fbf7cd3dd7bf5616ffa3b78c90224c407394140f47d59ab4c620f6d'],
  [-1, 'b079120a3f27e0578942c1136b84de44e007afc2f1d8b2377a6a7791ba22fd35', 'd7766ed23fac9d044aceb262930ec0db6f53950ff97f4471dbfb00454f958941'],
  [4295040425, '95a97ef924e86b5bdde32697b8687226cec8415174693c458adb9c8aea849b3b', '895b490eea9b3296090f6ec53c4286719361d293d771c03bca878a247dc96a05'],
] as const;

describe('generator 3 enclosed caves and frozen historical terrain', () => {
  it.each(legacy)('keeps generator 2 terrain and trees byte-identical at seed %i', (seed, blocks, trees) => {
    const w = generateWorld(seed, undefined, 2);
    expect(w.generator).toBe(2);
    expect(sha(w.blocks)).toBe(blocks);
    expect(sha(JSON.stringify(w.trees))).toBe(trees);
  });

  it.each(['flat', 'small', 'large', 'mountainous'] as Hilliness[])(
    'makes sealed chambers with floors, ceilings and clearance across %s terrain and all biomes', (hilliness) => {
      for (const seed of [73129, 17, -1, 4295040425]) for (const preset of Object.values(WORLD_PRESETS)) {
        const settings = { ...preset, hilliness };
        const w = generateWorld(seed, settings, 3), old = generateWorld(seed, settings, 2);
        const explored = initialExploration(w.blocks, 3);
        expect(w.generator).toBe(3);
        expect(w.heightMap).toEqual(old.heightMap);
        expect(w.surfaceMap).toEqual(old.surfaceMap);
        expect(w.spawn).toEqual(old.spawn);
        expect(w.trees).toEqual(old.trees);
        let hiddenAir = 0;
        const floors = new Set<number>();
        for (let y = 0; y < DEPTH; y++) for (let x = 0; x < WIDTH; x++) {
          expect(w.blocks[index(x, y, 0)]).toBe(Block.Bedrock);
          const height = w.heightMap[y * WIDTH + x];
          for (let z = 1; z < height; z++) {
            const i = index(x, y, z);
            if (w.blocks[i] !== Block.Air) continue;
            expect(explored[i]).toBe(0);
            expect(Math.hypot(x - w.spawn.x, y - w.spawn.y)).toBeGreaterThan(6);
            hiddenAir++;
            if (w.blocks[index(x, y, z - 1)] !== Block.Air) {
              floors.add(z);
              expect(z).toBeGreaterThanOrEqual(2);
              expect(w.blocks[index(x, y, z + 1)]).toBe(Block.Air);
              expect(w.blocks[index(x, y, z + 2)]).toBe(Block.Air);
            }
          }
        }
        expect(hiddenAir, JSON.stringify({ seed, settings })).toBeGreaterThan(30);
        expect(hiddenAir).toBeLessThan(CELLS / 5);
        expect(floors.size).toBeGreaterThan(0);
        expect(w.summary.resources.steel).toBeLessThanOrEqual(old.summary.resources.steel);
        expect(w.summary.resources.components).toBeLessThanOrEqual(old.summary.resources.components);
        expect(sha(generateWorld(seed, settings, 3).blocks)).toBe(sha(w.blocks));
      }
    }, 15000,
  );

  it('preview counts only discovered resource faces and shares no mutable terrain buffers', () => {
    const w = generateWorld(73129, undefined, 3), visible = initialExploration(w.blocks, 3);
    const preview = previewWorld(73129, undefined, 3);
    const count = (kind: number) => w.blocks.reduce((n, b, i) => n + Number(b === kind && visible[i] === 1), 0);
    expect(preview.summary.resources).toEqual({ stone: count(Block.Stone), steel: count(Block.Steel), components: count(Block.Components) });
    expect(preview.summary.resources.stone).toBeLessThan(w.blocks.filter(b => b === Block.Stone).length);
    expect(preview.generator).toBe(3);
    expect(Object.hasOwn(preview, 'blocks')).toBe(false);
    expect(Object.hasOwn(preview, 'explored')).toBe(false);
    expect(sha(generateWorld(73129 + 4294967296, undefined, 3).blocks)).not.toBe(sha(w.blocks));
    w.blocks.fill(Block.Air);
    expect(previewWorld(73129, undefined, 3)).toEqual(preview);
  });
});
