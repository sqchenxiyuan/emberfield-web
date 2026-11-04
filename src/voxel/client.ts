import { VoxelRenderer, type VoxelView, type PlacementPreview } from './renderer';
import { isDeviceKind } from './power';
import type { FurnitureKind } from './furniture';
import {
  HEIGHT,
  SURFACE,
  at,
  inside,
  type Axis,
  type ChunkUpdate,
  type CommandResult,
  type Pos,
  type Tool,
  type VoxelCommand,
  type VoxelSave,
  type VoxelSnapshot,
  type CropKind,
  type WorldSettings,
  type WorldPreview,
  type TreeSpecies,
  type ApparelQuality,
} from './types';
export interface FurniturePlacement {
  furnitureId: number;
  kind: FurnitureKind;
  quality: ApparelQuality;
  packed: boolean;
  reason: string | null;
}
export interface ClientState {
  snapshot: VoxelSnapshot | null;
  ready: boolean;
  selected: Pos | null;
  level: number;
  rotation: number;
  tool: Tool;
  crop: CropKind;
  treeSpecies: TreeSpecies;
  axis: Axis;
  material: 'wood' | 'stone';
  selectedPenId: number | null;
  selectedAnimalAreaId: number | null;
  animalAreaErase: boolean;
  placementPreview: PlacementPreview | null;
  furniturePlacement: FurniturePlacement | null;
  metrics: Record<string, unknown>;
  worker: boolean;
}
type Pending = { resolve: (result: any) => void; reject: (error: Error) => void };
export class VoxelClient {
  private sim = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
  private renderWorker: Worker | null = null;
  private renderer: VoxelRenderer | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private chunksCache = new Map<number, ChunkUpdate>();
  private roomIds = new Int32Array(0);
  private listeners = new Set<() => void>();
  private simPending = new Map<number, Pending>();
  private renderPending = new Map<number, Pending>();
  private sequence = 0;
  private alive = true;
  private cancelPlacement = () => {};
  private zoom = 1.25;
  private focus = { x: 32, y: 32, z: SURFACE };
  private state: ClientState = {
    snapshot: null,
    ready: false,
    selected: null,
    level: SURFACE,
    rotation: Math.PI / 4,
    tool: 'inspect',
    crop: 'rice',
    treeSpecies: 'poplar',
    axis: 'x',
    material: 'wood',
    selectedPenId: null,
    selectedAnimalAreaId: null,
    animalAreaErase: false,
    placementPreview: null,
    furniturePlacement: null,
    metrics: {},
    worker: false,
  };
  notice: (message: string) => void = () => {};
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.state;
  chooseCrop = (crop: CropKind) => this.emit({ crop });
  chooseTree = (treeSpecies: TreeSpecies) => this.emit({ treeSpecies });
  chooseMaterial = (material: 'wood' | 'stone') => this.emit({ material });
  rotatePlan = () => {
    const axis = this.state.axis === 'x' ? 'y' : 'x';
    this.emit({ axis });
    if (this.state.placementPreview) this.view({ placementPreview: { ...this.state.placementPreview, axis } });
  };
  beginFurniturePlacement = (kind: FurnitureKind, item: { id: number; quality: ApparelQuality; axis: Axis }, packed = false) => {
    this.choose('inspect');
    this.emit({ axis: item.axis, furniturePlacement: { kind, furnitureId: item.id, quality: item.quality, packed, reason: null } });
    this.notice('选择安装位置；R 旋转，可切换楼层，Esc 退出选址');
  };
  endFurniturePlacement = () => {
    this.cancelPlacement();
    this.emit({ furniturePlacement: null });
  };
  roomAt = (p: Pos) =>
    inside(p)
      ? (this.state.snapshot?.rooms.find((r) => r.id === this.roomIds[at(p)]) ?? null)
      : null;
  private emit(next: Partial<ClientState> = {}) {
    this.state = { ...this.state, ...next };
    for (const l of this.listeners) l();
  }
  constructor() {
    this.sim.onmessage = ({ data: d }) => {
      if (d.type === 'reply') {
        const p = this.simPending.get(d.id);
        this.simPending.delete(d.id);
        if (d.error) p?.reject(new Error(d.error));
        else p?.resolve(d.result);
        return;
      }
      if (d.type === 'state') {
        const first = !this.state.snapshot;
        if (d.roomIds) this.roomIds = d.roomIds;
        for (const c of d.chunks as ChunkUpdate[]) this.chunksCache.set(c.id, c);
        this.sendRender({ type: 'chunks', chunks: d.chunks });
        this.sendRender({ type: 'snapshot', snapshot: d.snapshot });
        this.emit({ snapshot: d.snapshot });
        if (first) this.home();
      }
    };
    this.sim.onerror = (e) => this.notice('模拟线程异常：' + e.message);
    this.sim.postMessage({ type: 'init' });
  }
  private request(type: string, fields: Record<string, unknown> = {}) {
    const id = ++this.sequence;
    return new Promise<any>((resolve, reject) => {
      this.simPending.set(id, { resolve, reject });
      this.sim.postMessage({ type, id, ...fields });
    });
  }
  command = async (command: VoxelCommand): Promise<CommandResult> => {
    const r = await this.request('command', { command });
    this.notice(r.message);
    return r;
  };
  speed = (value: number) => this.request('speed', { value });
  export = (): Promise<VoxelSave> => this.request('save');
  import = async (save: unknown) => {
    await this.request('load', { save });
    this.endFurniturePlacement();
    this.view({ penId: null, animalAreaId: null });
    this.home();
    this.select(null);
    const legacy =
      save && typeof save === 'object' && 'version' in save && Number(save.version) < 6;
    this.notice(
      legacy
        ? '旧存档物品已按容量拆分到附近空地，请检查冷库；时间暂停'
        : save && typeof save === 'object' && 'version' in save && Number(save.version) < 7
          ? '原有石材保留为石砖；收纳岩块请在仓储勾选，时间暂停'
          : '体素存档已恢复，时间暂停',
    );
  };
  previewWorld = (seed: number, settings: WorldSettings): Promise<WorldPreview> =>
    this.request('preview', { seed, settings });
  newGame = async (seed: number, settings?: WorldSettings) => {
    await this.request('new', { seed, settings });
    this.endFurniturePlacement();
    this.view({ penId: null, animalAreaId: null });
    this.home();
    this.select(null);
  };
  choose = (tool: Tool) => {
    this.cancelPlacement();
    this.emit({ tool, furniturePlacement: null });
  };
  showPen = (id: number | null) => {
    if (this.state.tool === 'animalArea') this.choose('inspect');
    this.view({ penId: id, animalAreaId: null });
  };
  showAnimalArea = (id: number | null) => {
    if (id === null && this.state.tool === 'animalArea') this.choose('inspect');
    this.view({ penId: null, animalAreaId: id });
  };
  editAnimalArea = (id: number, erase = false) => {
    this.choose('animalArea');
    this.emit({ animalAreaErase: erase });
    this.showAnimalArea(id);
  };
  select = (pos: Pos | null) => {
    this.emit({ selected: pos });
    this.sendRender({ type: 'highlight', pos });
  };
  blockAt = (p: Pos) => {
    const c = this.chunksCache.get(Math.floor(p.y / 16) * 4 + Math.floor(p.x / 16));
    return c ? c.blocks[(p.z * 16 + (p.y % 16)) * 16 + (p.x % 16)] : 0;
  };
  ladderAt = (p: Pos) => {
    const c = this.chunksCache.get(Math.floor(p.y / 16) * 4 + Math.floor(p.x / 16));
    return c ? c.ladders[(p.z * 16 + (p.y % 16)) * 16 + (p.x % 16)] : 0;
  };
  view = (view: VoxelView) => {
    if (view.level !== undefined) view.level = Math.max(1, Math.min(HEIGHT - 2, view.level));
    if (view.level !== undefined && view.level !== this.state.level) this.cancelPlacement();
    if (view.zoom !== undefined) {
      this.zoom = Math.max(0.45, Math.min(3, view.zoom));
      view.zoom = this.zoom;
    }
    if (view.focus) this.focus = view.focus;
    this.sendRender({ type: 'view', view });
    this.emit({
      level: view.level ?? this.state.level,
      rotation: view.rotation ?? this.state.rotation,
      ...(view.penId !== undefined ? { selectedPenId: view.penId } : {}),
      ...(view.animalAreaId !== undefined ? { selectedAnimalAreaId: view.animalAreaId } : {}),
      ...(view.placementPreview !== undefined ? { placementPreview: view.placementPreview } : {}),
    });
  };
  home = () => {
    const spawn = this.state.snapshot?.spawn ?? { x: 32, y: 32, z: SURFACE };
    this.view({
      level: spawn.z,
      rotation: Math.PI / 4,
      zoom: 1.25,
      focus: spawn,
    });
  };
  focusOn = (p: Pos) => this.view({ level: p.z, focus: p });
  private sendRender(d: any) {
    if (this.renderWorker) {
      this.renderWorker.postMessage(d);
      return;
    }
    const r = this.renderer;
    if (!r) return;
    if (d.type === 'chunks') r.chunks(d.chunks);
    if (d.type === 'snapshot') r.snapshot(d.snapshot);
    if (d.type === 'view') r.view(d.view);
    if (d.type === 'highlight') r.highlight(d.pos);
  }
  private renderRequest(
    type: 'pick' | 'project' | 'inspect',
    fields: Record<string, unknown>,
  ): Promise<any> {
    if (this.renderWorker) {
      const id = ++this.sequence;
      return new Promise((resolve, reject) => {
        this.renderPending.set(id, { resolve, reject });
        this.renderWorker!.postMessage({ type, id, ...fields });
      });
    }
    return Promise.resolve(
      type === 'pick'
        ? this.renderer?.pick(fields.x as number, fields.y as number)
        : type === 'inspect'
          ? this.renderer?.inspect(fields.x as number, fields.y as number)
          : this.renderer?.project(fields.pos as Pos),
    );
  }
  project = (pos: Pos): Promise<{ x: number; y: number }> => this.renderRequest('project', { pos });
  private async atPointer(e: PointerEvent) {
    const box = this.canvas!.getBoundingClientRect();
    return this.renderRequest(
      !this.state.furniturePlacement && (this.state.tool === 'inspect' || this.state.tool === 'cut') ? 'inspect' : 'pick',
      { x: e.clientX - box.left, y: e.clientY - box.top },
    ) as Promise<Pos | null>;
  }
  mount(host: HTMLElement) {
    const makeCanvas = () => {
      const canvas = document.createElement('canvas');
      canvas.setAttribute('aria-label', '多层体素地图');
      canvas.tabIndex = 0;
      host.replaceChildren(canvas);
      this.canvas = canvas;
      return canvas;
    };
    let canvas = makeCanvas();
    let failed = false;
    const ready = () => {
      this.sendRender({ type: 'chunks', chunks: [...this.chunksCache.values()] });
      if (this.state.snapshot) this.sendRender({ type: 'snapshot', snapshot: this.state.snapshot });
      this.view({
        level: this.state.level,
        rotation: this.state.rotation,
        zoom: this.zoom,
        focus: this.focus,
        penId: this.state.selectedPenId,
        animalAreaId: this.state.selectedAnimalAreaId,
        placementPreview: this.state.placementPreview,
      });
      this.emit({ ready: true });
    };
    const fallback = () => {
      if (failed) return;
      failed = true;
      this.renderWorker?.terminate();
      this.renderWorker = null;
      canvas = makeCanvas();
      try {
        this.renderer = new VoxelRenderer(canvas, host.clientWidth, host.clientHeight);
        this.emit({ worker: false });
        ready();
        bind(canvas);
        const draw = () => {
          if (!this.alive) return;
          this.renderer?.render();
          requestAnimationFrame(draw);
        };
        draw();
      } catch (e) {
        this.notice('3D 渲染无法启动：' + String(e));
      }
    };
    let start: Promise<Pos | null> | null = null,
      downX = 0,
      downY = 0;
    let dragTool: Tool | null = null, dragSequence = 0, previewSequence = 0;
    const previews = (tool: Tool) => !!this.state.furniturePlacement || ['bed', 'table', 'chair', 'fence', 'fenceGate', 'penMarker', 'animalArea'].includes(tool);
    const preview = (from: Pos, target: Pos, tool: Tool) => {
      const furniture = this.state.furniturePlacement;
      if (furniture) {
        this.view({ placementPreview: { tool: furniture.kind, from: target, to: target, axis: this.state.axis, furnitureId: furniture.furnitureId } });
        return;
      }
      const to = { ...target, z: from.z };
      if (tool === 'fence') {
        if (Math.abs(to.x - from.x) >= Math.abs(to.y - from.y)) to.y = from.y;
        else to.x = from.x;
      }
      if (['bed', 'table', 'chair', 'fenceGate', 'penMarker'].includes(tool)) Object.assign(to, from);
      this.view({ placementPreview: { tool: tool as PlacementPreview['tool'], from, to, axis: this.state.axis,
        erase: tool === 'animalArea' && this.state.animalAreaErase } });
    };
    const bind = (c: HTMLCanvasElement) => {
      this.cancelPlacement = () => {
        start = null; dragTool = null; dragSequence++; previewSequence++;
        if (this.state.placementPreview) this.view({ placementPreview: null });
      };
      c.oncontextmenu = (e) => e.preventDefault();
      c.onpointerdown = (e) => {
        if (e.button === 2) {
          this.choose('inspect');
          return;
        }
        c.focus();
        downX = e.clientX;
        downY = e.clientY;
        if (e.button === 1) {
          start = null;
          c.setPointerCapture(e.pointerId);
          return;
        }
        if (e.button === 0) {
          c.setPointerCapture(e.pointerId);
          dragTool = this.state.tool;
          const sequence = ++dragSequence;
          start = this.atPointer(e);
          void start.then((p) => {
            if (p && sequence === dragSequence) {
              this.select(p);
              if (dragTool && previews(dragTool)) preview(p, p, dragTool);
            }
          });
        }
      };
      c.onpointermove = (e) => {
        if (e.buttons === 4) {
          const dx = e.clientX - downX,
            dy = e.clientY - downY;
          downX = e.clientX;
          downY = e.clientY;
          this.view({
            rotation: this.state.rotation - dx * 0.008,
            zoom: this.zoom * Math.exp(-dy * 0.004),
          });
          return;
        }
        const tool = dragTool ?? this.state.tool;
        if (previews(tool)) {
          const request = ++previewSequence, gesture = dragSequence;
          const beginning = start;
          const target = this.atPointer(e);
          void Promise.all([beginning ?? target, target]).then(([from, to]) => {
            if (request !== previewSequence || gesture !== dragSequence || this.state.tool !== tool) return;
            if (from && to) preview(from, to, tool);
            else this.view({ placementPreview: null });
          });
        }
      };
      c.onpointerup = async (e) => {
        if (e.button !== 0 || !start) return;
        const pending = start;
        const tool = dragTool ?? this.state.tool, gesture = dragSequence;
        const furniture = this.state.furniturePlacement;
        start = null;
        const from = await pending;
        const to = await this.atPointer(e);
        if (gesture !== dragSequence) return;
        this.cancelPlacement();
        if (!from || !to) return;
        if (furniture && this.state.furniturePlacement === furniture) {
          const result = await this.command({ type: 'installFurniture', kind: furniture.kind, furnitureId: furniture.furnitureId, target: to, axis: this.state.axis });
          if (this.state.furniturePlacement !== furniture) return;
          if (result.ok) { this.endFurniturePlacement(); this.select(to); }
          else this.emit({ furniturePlacement: { ...furniture, reason: result.message } });
          return;
        }
        if (tool === 'inspect') {
          this.select(to);
          return;
        }
        if (tool === 'wall' || tool === 'fence') {
          if (Math.abs(to.x - from.x) >= Math.abs(to.y - from.y)) to.y = from.y;
          else to.x = from.x;
        }
        if (tool === 'animalArea') {
          const areaId = this.state.selectedAnimalAreaId;
          if (areaId === null) { this.notice('先在动物面板创建或选择活动范围'); return; }
          await this.command({ type: 'animalAreaPaint', areaId, from, to: { ...to, z: from.z }, erase: this.state.animalAreaErase });
          return;
        }
        const single =
          [
            'fenceGate',
            'penMarker',
            'shaft',
            'up',
            'ladder',
            'bed',
            'table',
            'chair',
            'door',
            'stonecutter',
            'tailor',
            'craftingSpot',
            'smithy',
            'machining',
            'researchBench',
          ].includes(tool) || isDeviceKind(tool);
        await this.command({
          type: 'designate',
          tool,
          from,
          to: single ? from : { ...to, z: from.z },
          crop: this.state.crop,
          ...(tool === 'grove' ? { treeSpecies: this.state.treeSpecies } : {}),
          axis: this.state.axis,
          ...(['wall', 'floor'].includes(tool) ? { material: this.state.material } : {}),
        });
      };
      c.onpointercancel = () => this.cancelPlacement();
      c.onpointerleave = () => { if (!start) this.view({ placementPreview: null }); };
      c.onlostpointercapture = () => { if (start) this.cancelPlacement(); };
      c.onwheel = (e) => {
        e.preventDefault();
        this.view({ zoom: this.zoom * Math.exp(-e.deltaY * 0.001) });
      };
    };
    if (
      canvas.transferControlToOffscreen &&
      new URLSearchParams(location.search).get('render') !== 'main'
    ) {
      try {
        this.renderWorker = new Worker(new URL('./render.worker.ts', import.meta.url), {
          type: 'module',
        });
        this.emit({ worker: true });
        this.renderWorker.onmessage = ({ data: d }) => {
          if (d.type === 'ready') {
            ready();
            bind(canvas);
          }
          if (d.type === 'error') {
            if (!this.state.ready) fallback();
            else this.notice('渲染错误：' + d.message);
          }
          if (d.type === 'reply') {
            this.renderPending.get(d.id)?.resolve(d.result);
            this.renderPending.delete(d.id);
          }
          if (d.type === 'metrics') this.emit({ metrics: d.metrics });
        };
        this.renderWorker.onerror = () => fallback();
        const offscreen = canvas.transferControlToOffscreen();
        this.renderWorker.postMessage(
          { type: 'init', canvas: offscreen, width: host.clientWidth, height: host.clientHeight },
          [offscreen],
        );
      } catch {
        fallback();
      }
    } else fallback();
    const observer = new ResizeObserver(() => {
      const width = host.clientWidth,
        height = host.clientHeight;
      if (this.renderWorker) this.renderWorker.postMessage({ type: 'resize', width, height });
      else this.renderer?.resize(width, height);
    });
    observer.observe(host);
    const metrics = setInterval(() => {
      if (this.renderer) this.emit({ metrics: { ...this.renderer.metrics() } });
    }, 1000);
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.matches('input,select,textarea') || e.ctrlKey || e.metaKey)
        return;
      if (e.code === 'Space') {
        e.preventDefault();
        void this.speed(this.state.snapshot?.speed ? 0 : 1);
      }
      if (e.code === 'KeyQ' || e.code === 'KeyE')
        this.view({ rotation: this.state.rotation + ((e.code === 'KeyQ' ? -1 : 1) * Math.PI) / 2 });
      if (e.code === 'KeyR') this.rotatePlan();
      if (e.code === 'BracketLeft') this.view({ level: this.state.level - 1 });
      if (e.code === 'BracketRight') this.view({ level: this.state.level + 1 });
      if (e.code === 'Escape') {
        this.choose('inspect');
        this.select(null);
      }
      if (['Digit1', 'Digit2', 'Digit3'].includes(e.code))
        void this.speed(Number(e.code.slice(-1)));
      const moves: Record<string, [number, number]> = {
        KeyW: [0, -1],
        KeyS: [0, 1],
        KeyA: [-1, 0],
        KeyD: [1, 0],
      };
      if (moves[e.code]) {
        const [x, y] = moves[e.code],
          a = this.state.rotation;
        this.focus = {
          ...this.focus,
          x: Math.max(0, Math.min(63, this.focus.x + x * Math.cos(a) + y * Math.sin(a))),
          y: Math.max(0, Math.min(63, this.focus.y - x * Math.sin(a) + y * Math.cos(a))),
        };
        this.view({ focus: this.focus });
      }
    };
    window.addEventListener('keydown', key);
    const hidden = () => {
      if (document.hidden) void this.speed(0);
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      this.alive = false;
      observer.disconnect();
      clearInterval(metrics);
      window.removeEventListener('keydown', key);
      document.removeEventListener('visibilitychange', hidden);
      this.sim.terminate();
      this.renderWorker?.terminate();
      this.renderer?.dispose();
      for (const p of [...this.simPending.values(), ...this.renderPending.values()])
        p.reject(new Error('页面已关闭'));
    };
  }
}
