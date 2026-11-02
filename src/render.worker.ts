import { DOMAdapter, WebWorkerAdapter } from 'pixi.js';
import { ColonyRenderer } from './renderer';
DOMAdapter.set(WebWorkerAdapter);
const ctx = self as unknown as {
  postMessage: (m: unknown) => void;
  onmessage: ((e: MessageEvent) => void) | null;
};
let renderer: ColonyRenderer | null = null;
ctx.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      renderer = new ColonyRenderer((m) => ctx.postMessage(m));
      await renderer.init(data.canvas, data.width, data.height, data.dpr, data.backend, true);
      ctx.postMessage({ type: 'rendererReady', backend: renderer.backend, worker: true });
    } else if (data.type === 'connect') renderer?.connect(data.port);
    else renderer?.message(data);
  } catch (e) {
    ctx.postMessage({ type: 'rendererError', error: String(e) });
  }
};
