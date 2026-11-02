/// <reference lib="webworker" />
import { VoxelSimulation } from './world';
import type { VoxelCommand } from './types';
const ctx = self as unknown as DedicatedWorkerGlobalScope;
let sim = new VoxelSimulation(),
  speed = 0,
  elapsed = 0,
  previous = performance.now(),
  lastPublish = 0,
  tickMs = 0;
function publish() {
  const chunks = sim.chunks();
  ctx.postMessage(
    { type: 'state', snapshot: sim.snapshot(speed, tickMs), chunks },
    chunks.flatMap((c) => [c.blocks.buffer, c.ladders.buffer]),
  );
}
ctx.onmessage = ({ data: d }) => {
  try {
    let result: unknown;
    if (d.type === 'init') {
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
      speed = 0;
      elapsed = 0;
      result = true;
    } else if (d.type === 'new') {
      if (!Number.isSafeInteger(d.seed)) throw new Error('种子必须是整数');
      sim = new VoxelSimulation(d.seed);
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
