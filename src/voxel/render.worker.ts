/// <reference lib="webworker" />
import { VoxelRenderer } from './renderer';
const ctx = self as unknown as DedicatedWorkerGlobalScope;
let renderer: VoxelRenderer | undefined;
ctx.onmessage = ({ data: d }) => {
  try {
    if (d.type === 'init') {
      renderer = new VoxelRenderer(d.canvas, d.width, d.height);
      ctx.postMessage({ type: 'ready' });
    }
    if (!renderer) return;
    if (d.type === 'resize') renderer.resize(d.width, d.height);
    if (d.type === 'chunks') renderer.chunks(d.chunks);
    if (d.type === 'snapshot') renderer.snapshot(d.snapshot);
    if (d.type === 'view') renderer.view(d.view);
    if (d.type === 'highlight') renderer.highlight(d.pos);
    if (d.type === 'pick')
      ctx.postMessage({ type: 'reply', id: d.id, result: renderer.pick(d.x, d.y) });
    if (d.type === 'inspect')
      ctx.postMessage({ type: 'reply', id: d.id, result: renderer.inspect(d.x, d.y) });
    if (d.type === 'project')
      ctx.postMessage({ type: 'reply', id: d.id, result: renderer.project(d.pos) });
    if (d.type === 'dispose') {
      renderer.dispose();
      renderer = undefined;
    }
  } catch (e) {
    ctx.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};
function frame() {
  renderer?.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
setInterval(() => {
  if (renderer) ctx.postMessage({ type: 'metrics', metrics: renderer.metrics() });
}, 1000);
