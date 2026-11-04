/// <reference lib="webworker" />
import { VoxelSimulation } from './world';
import type { VoxelCommand } from './types';
import { previewWorld } from './worldgen';
import { resolveWorldSite } from './regions';
const ctx = self as unknown as DedicatedWorkerGlobalScope;
let sim = new VoxelSimulation(),
  speed = 0,
  elapsed = 0,
  previous = performance.now(),
  lastPublish = 0,
  tickMs = 0;
let publishedRooms = -1;
function publish() {
  const chunks = sim.chunks();
  const snapshot = sim.snapshot(speed, tickMs);
  const roomIds = publishedRooms !== snapshot.roomRevision ? sim.visibleRoomIds() : undefined;
  publishedRooms = snapshot.roomRevision;
  ctx.postMessage({ type: 'state', snapshot, chunks, roomIds }, [
    ...chunks.flatMap((c) => [c.blocks.buffer, c.ladders.buffer, c.explored.buffer, ...(c.water ? [c.water.buffer] : []), ...(c.bridges ? [c.bridges.buffer] : [])]),
    ...(roomIds ? [roomIds.buffer] : []),
  ]);
}
ctx.onmessage = ({ data: d }) => {
  try {
    let result: unknown;
    if (d.type === 'previewSite' || d.type === 'newSite') {
      if (['seed', 'settings', 'generator', 'worldSite'].some(key => Object.hasOwn(d, key)))
        throw new Error('地区请求只接受 site，不能覆盖地图种子、气候或生成器');
    } else if (['init', 'preview', 'new'].includes(d.type) &&
        ['site', 'worldSite'].some(key => Object.hasOwn(d, key)))
      throw new Error('地区开局和预览请使用专用地区接口');
    if (d.type === 'previewSite') {
      const resolved = resolveWorldSite(d.site);
      ctx.postMessage({ type: 'reply', id: d.id, result: previewWorld(resolved.seed, resolved.settings, resolved.generator, resolved.riverRoute) });
      return;
    }
    if (d.type === 'preview') {
      ctx.postMessage({ type: 'reply', id: d.id, result: previewWorld(d.seed, d.settings) });
      return;
    }
    if (d.type === 'init') {
      if (d.seed !== undefined || d.settings !== undefined) {
        sim = new VoxelSimulation(d.seed, d.settings);
        publishedRooms = -1;
        speed = 0;
        elapsed = 0;
      }
      publish();
      return;
    }
    if (d.type === 'command') result = sim.command(d.command as VoxelCommand);
    else if (d.type === 'speed') {
      if (![0, 1, 2, 3].includes(d.value)) throw new Error('速度无效');
      speed = d.value;
      elapsed = 0;
      previous = performance.now();
      result = true;
    } else if (d.type === 'save') result = sim.save();
    else if (d.type === 'load') {
      const next = VoxelSimulation.load(d.save);
      sim = next;
      publishedRooms = -1;
      speed = 0;
      elapsed = 0;
      result = true;
    } else if (d.type === 'newSite') {
      const next = VoxelSimulation.fromWorldSite(d.site);
      sim = next;
      publishedRooms = -1;
      speed = 0;
      elapsed = 0;
      previous = performance.now();
      result = true;
    } else if (d.type === 'new') {
      if (!Number.isSafeInteger(d.seed)) throw new Error('种子必须是整数');
      sim = new VoxelSimulation(d.seed, d.settings);
      publishedRooms = -1;
      speed = 0;
      elapsed = 0;
      result = true;
    } else throw new Error('未知请求');
    if (d.type !== 'save') publish();
    ctx.postMessage({ type: 'reply', id: d.id, result });
  } catch (e) {
    ctx.postMessage({ type: 'reply', id: d.id, error: e instanceof Error ? e.message : String(e) });
  }
};
setInterval(() => {
  const now = performance.now();
  elapsed += Math.min(now - previous, 250) * speed;
  previous = now;
  if (elapsed >= 50) {
    const steps = Math.min(15, Math.floor(elapsed / 50));
    const start = performance.now();
    sim.step(steps);
    tickMs = (performance.now() - start) / steps;
    elapsed -= steps * 50;
  }
  if (now - lastPublish >= 200) {
    lastPublish = now;
    publish();
  }
}, 25);
