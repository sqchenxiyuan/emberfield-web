import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorldPreview, VoxelSave } from '../src/voxel/types';
import { generateRegions, resolveWorldSite, type WorldSite } from '../src/voxel/regions';
import { previewWorld } from '../src/voxel/worldgen';

const site: WorldSite = { version: 1, worldSeed: 73129, tileId: 714 };
const messages: any[] = [];
const context = { onmessage: null as null | ((event: any) => void), postMessage: (message: any) => messages.push(structuredClone(message)) };
let sequence = 0;
function request(type: string, fields: Record<string, unknown> = {}) {
  const id = ++sequence; context.onmessage!({ data: { type, id, ...fields } });
  const reply = messages.findLast(m => m.type === 'reply' && m.id === id);
  expect(reply).toBeTruthy(); return reply;
}
const save = (): VoxelSave => request('save').result;
const persistent = (data: VoxelSave) => ({ ...data, pawns: data.pawns.map(({ reason, ...pawn }) => pawn) });
beforeAll(async () => {
  vi.stubGlobal('self', context); vi.stubGlobal('setInterval', vi.fn());
  await import('../src/voxel/sim.worker');
});
beforeEach(() => {
  expect(request('new', { seed: 73129 }).error).toBeUndefined(); messages.length = 0;
});
afterAll(() => vi.unstubAllGlobals());

describe('world selection worker transactions', () => {
  it('previews the selected local camp without changing the running colony, speed or publishing a replacement', () => {
    request('speed', { value: 3 }); const before = save(), count = messages.length;
    const result = request('previewSite', { site }); expect(result.error).toBeUndefined();
    const resolved = resolveWorldSite(site), preview = result.result as WorldPreview;
    expect(preview).toEqual(previewWorld(resolved.seed, resolved.settings, resolved.generator));
    expect(messages.slice(count).filter(m => m.type === 'state')).toHaveLength(0);
    expect(save()).toEqual(before); expect(messages.findLast(m => m.type === 'state').snapshot.speed).toBe(3);
  });

  it('enters exactly the selected preview and publishes its persistent site with the new camp paused', () => {
    request('speed', { value: 3 });
    const preview = request('previewSite', { site }).result as WorldPreview;
    expect(request('newSite', { site }).error).toBeUndefined();
    const saved = save(), state = messages.findLast(m => m.type === 'state').snapshot;
    expect(saved).toMatchObject({ version: 52, worldSite: site, seed: preview.seed, settings: preview.settings, spawn: preview.spawn });
    expect(state).toMatchObject({ worldSite: site, seed: preview.seed, settings: preview.settings, speed: 0, tick: 0 });
  });

  it('keeps the active colony and speed when creating or previewing an invalid site fails', () => {
    expect(request('newSite', { site }).error).toBeUndefined(); request('speed', { value: 2 });
    const before = save(), ocean = generateRegions(site.worldSeed).tiles.find(t => t.biome === 'ocean')!;
    for (const invalid of [undefined, { ...site, tileId: -1 }, { ...site, tileId: ocean.id }]) {
      for (const type of ['previewSite', 'newSite']) {
        const count = messages.length; expect(request(type, { site: invalid }).error).toBeTypeOf('string');
        expect(messages.slice(count).filter(m => m.type === 'state')).toHaveLength(0);
        expect(save()).toEqual(before);
      }
    }
    expect(messages.findLast(m => m.type === 'state').snapshot.speed).toBe(2);
  });

  it('rejects attempts to override site-derived parameters or smuggle a site through the custom-mode interface', () => {
    const before = save();
    for (const extra of [{ seed: 1 }, { settings: {} }, { generator: 1 }, { worldSite: site }])
      for (const type of ['previewSite', 'newSite']) expect(request(type, { site, ...extra }).error).toMatch(/只接受 site/);
    for (const type of ['preview', 'new', 'init'])
      expect(request(type, { seed: 73129, site }).error).toMatch(/专用地区接口/);
    expect(save()).toEqual(before);
  });

  it('retains the active camp on a contradictory site save and restores identity on a valid load', () => {
    expect(request('newSite', { site }).error).toBeUndefined(); const saved = save();
    const invalid = structuredClone(saved); invalid.settings.rainfall++;
    expect(request('load', { save: invalid }).error).toMatch(/地区身份.*不一致/); expect(save()).toEqual(saved);
    expect(request('new', { seed: 8123 }).error).toBeUndefined(); expect(save().worldSite).toBeNull();
    expect(request('load', { save: saved }).error).toBeUndefined(); expect(persistent(save())).toEqual(persistent(saved));
    const restored = save(); expect(request('load', { save: restored }).error).toBeUndefined(); expect(save()).toEqual(restored);
  });
});
