import type { Command, SaveData } from './sim/types';
import { EMPTY_METRICS, type ClientState } from './protocol';
import { campAudio } from './audio';
export class GameClient {
  private sim = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
  private render: Worker | null = null;
  private fallback: import('./renderer').ColonyRenderer | null = null;
  private state: ClientState = {
    summary: null,
    speed: 0,
    metrics: { ...EMPTY_METRICS },
    ready: false,
    error: null,
    selection: [],
    hover: null,
  };
  private listeners = new Set<() => void>();
  private requests = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private nextRequest = 1;
  private resize: ResizeObserver | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private activeTool = 'select';
  private cleanup: (() => void)[] = [];
  onNotice: (text: string) => void = () => {};
  onInspect: (x: number, y: number) => void = () => {};
  constructor() {
    this.sim.onmessage = ({ data: m }) => {
      if (m.type === 'summary') {
        const old = this.state.summary;
        if (old && m.summary.tick >= old.tick) {
          const last = old.logs.at(-1)?.id ?? 0;
          const added = m.summary.logs.filter((l: any) => l.id > last);
          if (added.some((l: any) => l.type === 'danger')) campAudio.play('danger');
          else if (added.some((l: any) => l.type === 'good')) campAudio.play('good');
          for (const p of m.summary.pawns) {
            const before = old.pawns.find((q) => q.id === p.id);
            if (before && p.cooldown > before.cooldown && p.job?.kind === 'attack')
              campAudio.play('shot');
          }
        }
        this.set({
          summary: m.summary,
          speed: m.speed,
          metrics: { ...this.state.metrics, saveStatus: m.saveStatus },
        });
      }
      if (m.type === 'metrics') this.set({ metrics: { ...this.state.metrics, ...m.value } });
      if (m.type === 'notice') this.onNotice(m.text);
      if (m.type === 'response' || m.type === 'result') {
        const req = this.requests.get(m.requestId);
        if (req) {
          this.requests.delete(m.requestId);
          if (m.ok) req.resolve(m.value ?? m);
          else req.reject(new Error(m.error ?? m.reason));
        }
      }
    };
    this.sim.onerror = (e) => this.set({ error: `模拟线程异常：${e.message}` });
    this.sim.postMessage({ type: 'init', seed: 73129 });
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  snapshot = () => this.state;
  private set(part: Partial<ClientState>) {
    this.state = { ...this.state, ...part };
    for (const l of this.listeners) l();
  }
  private ask(type: string, data: Record<string, unknown> = {}) {
    const requestId = this.nextRequest++;
    return new Promise<any>((resolve, reject) => {
      this.requests.set(requestId, { resolve, reject });
      this.sim.postMessage({ type, requestId, ...data });
    });
  }
  command(command: Command) {
    campAudio.play('click');
    return this.ask('command', { command });
  }
  speed(value: number) {
    this.sim.postMessage({ type: 'speed', value });
  }
  save(slot = 'manual') {
    return this.ask('save', { slot });
  }
  load(slot = 'manual') {
    this.select([]);
    return this.ask('load', { slot });
  }
  export() {
    return this.ask('export') as Promise<SaveData>;
  }
  import(value: unknown) {
    this.select([]);
    return this.ask('import', { value });
  }
  newGame(seed: number) {
    this.select([]);
    return this.ask('new', { seed });
  }
  select(ids: number[]) {
    this.set({ selection: ids });
    this.sendRender({ type: 'select', ids });
  }
  tool(tool: string, kind?: string) {
    this.activeTool = tool;
    this.sendRender({ type: 'tool', tool, kind });
  }
  focus(x: number, y: number) {
    this.sendRender({ type: 'focus', x, y });
  }
  grid(value: boolean) {
    this.sendRender({ type: 'grid', value });
  }
  private sendRender(m: unknown) {
    if (this.render) this.render.postMessage(m);
    else this.fallback?.message(m);
  }
  private rendered = (m: any) => {
    if (m.type === 'renderMetrics') this.set({ metrics: { ...this.state.metrics, ...m.value } });
    if (m.type === 'hover') this.set({ hover: { x: m.x, y: m.y } });
    if (m.type === 'selection') this.select(m.ids);
    if (m.type === 'inspect') this.onInspect(m.x, m.y);
    if (m.type === 'rendererError') {
      this.set({ error: `渲染线程异常：${m.error}` });
      this.speed(0);
    }
    if (m.type === 'intent') {
      const rect = { x: m.x, y: m.y, x2: m.x2, y2: m.y2 };
      let cmd: Command | null = null;
      if (m.kind === 'move') cmd = { type: 'move', ids: this.state.selection, x: m.x, y: m.y };
      if (m.kind === 'build') cmd = { type: 'build', kind: m.building, x: m.x2, y: m.y2 };
      if (['stock', 'farm', 'herb', 'erase'].includes(m.kind))
        cmd = {
          type: 'zone',
          zone: ({ stock: 1, farm: 2, herb: 3, erase: 0 } as Record<string, number>)[m.kind],
          ...rect,
        };
      if (['cut', 'mine', 'harvest', 'cancel', 'demolish'].includes(m.kind))
        cmd = { type: 'mark', mode: m.kind, ...rect };
      if (cmd) this.command(cmd).catch((e) => this.onNotice(e.message));
    }
  };
  async mount(host: HTMLDivElement) {
    const width = host.clientWidth,
      height = host.clientHeight,
      dpr = window.devicePixelRatio;
    const requested = new URLSearchParams(location.search).get('backend') ?? 'auto';
    const modes =
      requested === 'main'
        ? ['main']
        : requested === 'webgl'
          ? ['webgl', 'main']
          : ['webgpu', 'webgl', 'main'];
    const failures: string[] = [];
    for (const mode of modes) {
      const canvas = document.createElement('canvas');
      canvas.tabIndex = 0;
      canvas.setAttribute('aria-label', '殖民地地图：左键选择，右键移动，中键拖动，滚轮缩放');
      host.replaceChildren(canvas);
      this.canvas = canvas;
      try {
        if (mode !== 'main' && typeof canvas.transferControlToOffscreen === 'function') {
          const worker = new Worker(new URL('./render.worker.ts', import.meta.url), {
            type: 'module',
          });
          this.render = worker;
          const ready = new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('渲染初始化超时')), 15000);
            worker.onmessage = ({ data }) => {
              if (data.type === 'rendererReady') {
                clearTimeout(timer);
                this.set({
                  metrics: { ...this.state.metrics, backend: data.backend, renderWorker: true },
                });
                resolve();
              } else if (data.type === 'rendererError') {
                clearTimeout(timer);
                reject(new Error(data.error));
              } else this.rendered(data);
            };
            worker.onerror = (e) => {
              clearTimeout(timer);
              reject(new Error(e.message));
            };
          });
          const offscreen = canvas.transferControlToOffscreen();
          worker.postMessage(
            { type: 'init', canvas: offscreen, width, height, dpr, backend: mode },
            [offscreen],
          );
          await ready;
          worker.onmessage = ({ data }) => this.rendered(data);
          const channel = new MessageChannel();
          this.sim.postMessage({ type: 'connect', port: channel.port1 }, [channel.port1]);
          worker.postMessage({ type: 'connect', port: channel.port2 }, [channel.port2]);
        } else {
          this.render = null;
          const { ColonyRenderer } = await import('./renderer');
          this.fallback = new ColonyRenderer(this.rendered);
          await this.fallback.init(canvas, width, height, dpr, 'webgl', false);
          const channel = new MessageChannel();
          this.sim.postMessage({ type: 'connect', port: channel.port1 }, [channel.port1]);
          this.fallback.connect(channel.port2);
          this.set({
            metrics: { ...this.state.metrics, backend: this.fallback.backend, renderWorker: false },
          });
        }
        this.set({ ready: true, error: null });
        if (failures.length) this.onNotice(`已使用兼容渲染路径：${this.state.metrics.backend}`);
        break;
      } catch (e) {
        failures.push(`${mode}: ${String(e)}`);
        this.render?.terminate();
        this.render = null;
        this.fallback?.destroy();
        this.fallback = null;
      }
    }
    if (!this.state.ready) {
      this.set({ error: failures.join('\n') });
      return;
    }
    const canvas = this.canvas!;
    const pointer = (e: PointerEvent, action: string) => {
      if (action === 'down') {
        canvas.focus();
        canvas.setPointerCapture(e.pointerId);
      }
      const r = canvas.getBoundingClientRect();
      this.sendRender({
        type: 'pointer',
        action,
        x: e.clientX - r.left,
        y: e.clientY - r.top,
        button: e.button,
        alt: e.altKey,
      });
    };
    canvas.addEventListener('pointerdown', (e) => pointer(e, 'down'));
    canvas.addEventListener('pointermove', (e) => pointer(e, 'move'));
    canvas.addEventListener('pointerup', (e) => pointer(e, 'up'));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const r = canvas.getBoundingClientRect();
        this.sendRender({
          type: 'wheel',
          x: e.clientX - r.left,
          y: e.clientY - r.top,
          delta: e.deltaY,
        });
      },
      { passive: false },
    );
    const key = (e: KeyboardEvent, down: boolean) => {
      if ((e.target as HTMLElement)?.matches('input,select,textarea')) return;
      this.sendRender({ type: 'key', key: e.key.toLowerCase(), down });
      if (!down || e.repeat) return;
      if (e.code === 'Space') {
        e.preventDefault();
        this.speed(this.state.speed ? 0 : 1);
      }
      if (e.key === '1') this.speed(1);
      if (e.key === '2') this.speed(3);
      if (e.key === '3') this.speed(6);
      if (e.key.toLowerCase() === 'r' && this.state.selection.length) {
        const drafted = this.state.summary?.pawns
          .filter((p) => this.state.selection.includes(p.id))
          .every((p) => p.drafted);
        this.command({ type: 'draft', ids: this.state.selection, value: !drafted }).catch((e) =>
          this.onNotice(e.message),
        );
      }
    };
    const blur = () => this.sendRender({ type: 'keysClear' });
    const down = (e: KeyboardEvent) => key(e, true),
      up = (e: KeyboardEvent) => key(e, false),
      visibility = () => {
        if (document.hidden) {
          blur();
          this.sim.postMessage({ type: 'hidden' });
        }
      };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', visibility);
    canvas.addEventListener('pointercancel', blur);
    this.cleanup.push(() => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', visibility);
    });
    this.resize = new ResizeObserver(() => {
      this.sendRender({
        type: 'resize',
        width: host.clientWidth,
        height: host.clientHeight,
        dpr: window.devicePixelRatio,
      });
    });
    this.resize.observe(host);
  }
  destroy() {
    this.cleanup.forEach((f) => f());
    this.resize?.disconnect();
    this.render?.terminate();
    this.fallback?.destroy();
    this.sim.terminate();
  }
}
