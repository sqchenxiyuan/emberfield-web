import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { BUILDINGS, RESOURCES } from './sim/defs';
import { SIZE } from './sim/types';
import { STRIDE, type Frame } from './protocol';
const TILE = 32,
  colors = [0x7c8c61, 0x6b8057, 0x315961];
const hash = (n: number) => {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return (n ^ (n >>> 16)) >>> 0;
};
interface EntityView {
  sprite: Sprite;
  shadow: Sprite | null;
  label: Text | null;
  type: number;
}
export class ColonyRenderer {
  app = new Application();
  backend = '';
  private port: MessagePort | null = null;
  private stage = new Container();
  private ground = new Container();
  private zonesLayer = new Graphics();
  private objects = new Container();
  private fx = new Graphics();
  private overlay = new Graphics();
  private shade = new Graphics();
  private textures = new Map<string, Texture>();
  private entities = new Map<number, EntityView>();
  private selection: number[] = [];
  private current: Frame | null = null;
  private previous: Frame | null = null;
  private receivedAt = 0;
  private frameInterval = 50;
  private previousPositions = new Map<number, { x: number; y: number }>();
  private width = 1;
  private height = 1;
  private camera = { x: 45, y: 47, zoom: 0.92 };
  private dragging = false;
  private dragStart = { x: 0, y: 0 };
  private pointer = { x: 0, y: 0 };
  private startCell: { x: number; y: number } | null = null;
  private moved = false;
  private tool = 'select';
  private buildKind = 'bed';
  private hover = { x: 45, y: 47 };
  private keys = new Set<string>();
  private tick = 0;
  private isWorker = false;
  private frames = 0;
  private lastMeasure = performance.now();
  private lastTime = performance.now();
  private grid = false;
  private textureBytes = 0;
  private generation = -1;
  private chunks: { container: Container; x: number; y: number }[] = [];
  constructor(private emit: (m: unknown) => void) {}
  async init(
    canvas: HTMLCanvasElement | OffscreenCanvas,
    width: number,
    height: number,
    dpr: number,
    backend: 'webgl' | 'webgpu',
    worker: boolean,
  ) {
    this.width = width;
    this.height = height;
    this.isWorker = worker;
    await this.app.init({
      canvas,
      width,
      height,
      resolution: Math.min(dpr, 2),
      autoDensity: true,
      preference: backend,
      antialias: false,
      background: 0x60704e,
      powerPreference: 'high-performance',
    });
    this.backend =
      this.app.renderer.type === 1 ? 'WebGL' : this.app.renderer.type === 2 ? 'WebGPU' : 'GPU';
    this.stage.addChild(this.ground, this.zonesLayer, this.objects, this.fx, this.overlay);
    this.objects.sortableChildren = true;
    this.app.stage.addChild(this.stage, this.shade);
    this.makeTextures();
    this.app.ticker.add(() => this.draw());
  }
  connect(port: MessagePort) {
    this.port = port;
    port.onmessage = ({ data }) => {
      if (data.type === 'terrain') {
        if (data.generation !== this.generation) {
          this.generation = data.generation;
          for (const frame of [this.current, this.previous])
            if (frame)
              this.port?.postMessage({ type: 'return', buffer: frame.buffer }, [frame.buffer]);
          this.current = null;
          this.previous = null;
          this.previousPositions.clear();
          for (const v of this.entities.values()) {
            v.sprite.destroy();
            v.shadow?.destroy();
            v.label?.destroy();
          }
          this.entities.clear();
          this.chunks = [];
          for (const c of this.ground.removeChildren()) c.destroy({ children: true });
        }
        this.terrain(data.terrain, data.zones);
      }
      if (data.type === 'frame') this.frame(data);
    };
    port.start();
    port.postMessage({ type: 'baseline' });
  }
  private texture(key: string, g: Graphics) {
    const t = this.app.renderer.generateTexture({ target: g, resolution: 1 });
    this.textures.set(key, t);
    this.textureBytes += t.width * t.height * 4;
    g.destroy();
    return t;
  }
  private makeTextures() {
    for (let kind = 0; kind < 3; kind++)
      for (let variant = 0; variant < 4; variant++) {
        const g = new Graphics().rect(0, 0, 32, 32).fill(colors[kind] + variant * 0x010101);
        for (let n = 0; n < 8; n++) {
          const v = hash(kind * 99 + variant * 22 + n);
          const x = v % 29,
            y = (v >>> 6) % 29;
          if (kind === 2) g.rect(x, y, 6, 1).fill({ color: 0x8ba49a, alpha: 0.2 });
          else
            g.rect(x, y, 1 + (v % 2), 2).fill({ color: n % 2 ? 0xadc388 : 0x4d6648, alpha: 0.2 });
        }
        this.texture(`tile${kind}-${variant}`, g);
      }
    this.texture(
      'shadow',
      new Graphics().ellipse(16, 8, 14, 6).fill({ color: 0x1e3329, alpha: 0.23 }),
    );
    for (let variant = 0; variant < 3; variant++) {
      const g = new Graphics().rect(24, 38, 6, 23).fill(0x766049);
      g.moveTo(5, 43)
        .lineTo(27, 2)
        .lineTo(49, 43)
        .closePath()
        .fill([0x304b3c, 0x3d5b41, 0x456346][variant]);
      g.moveTo(3, 51)
        .lineTo(26, 17)
        .lineTo(52, 51)
        .closePath()
        .fill([0x3f6247, 0x4c704c, 0x567751][variant]);
      g.moveTo(10, 38)
        .lineTo(26, 5)
        .lineTo(23, 36)
        .closePath()
        .fill({ color: 0x829767, alpha: 0.3 });
      this.texture(`tree${variant}`, g);
    }
    const ore = new Graphics()
      .poly([2, 23, 7, 10, 16, 4, 29, 9, 34, 25, 24, 31, 9, 30])
      .fill(0x78807a)
      .poly([7, 10, 16, 4, 26, 11, 17, 20])
      .fill(0x9da69a)
      .poly([4, 23, 17, 20, 25, 29, 9, 30])
      .fill(0x616d68)
      .rect(19, 10, 4, 3)
      .fill(0xb8bdba)
      .rect(10, 21, 3, 3)
      .fill(0xc3be95);
    this.texture('ore', ore);
    this.texture(
      'berry',
      new Graphics()
        .circle(10, 14, 10)
        .circle(23, 12, 10)
        .circle(17, 23, 10)
        .fill(0x4c6d45)
        .circle(8, 13, 2)
        .circle(22, 10, 2)
        .circle(17, 23, 2)
        .fill(0xb56c6a),
    );
    for (let i = 0; i < 18; i++) {
      const kind = Object.keys(BUILDINGS)[i] as keyof typeof BUILDINGS;
      const def = BUILDINGS[kind];
      const w = def.w * 32,
        h = def.h * 32;
      const g = new Graphics();
      if (kind === 'wire') {
        g.moveTo(0, 16)
          .lineTo(32, 16)
          .moveTo(16, 0)
          .lineTo(16, 32)
          .stroke({ color: 0xb7a15f, width: 2 });
      } else if (kind === 'bed' || kind === 'medical') {
        g.roundRect(3, 2, w - 6, h - 4, 3)
          .fill(0x594d3f)
          .roundRect(6, 5, w - 12, h - 10, 2)
          .fill(kind === 'medical' ? 0xa8bfb4 : 0xc5aa7a)
          .rect(7, 8, w - 14, 13)
          .fill(0xe1dcc4)
          .rect(7, 27, w - 14, 26)
          .fill(kind === 'medical' ? 0x73958d : 0x98794e)
          .moveTo(8, 29)
          .lineTo(w - 8, 29)
          .stroke({ color: 0xe4c998, width: 2 });
        if (kind === 'medical') g.rect(13, 36, 6, 16).rect(8, 41, 16, 6).fill(0xece6d5);
      } else if (kind === 'wall') {
        g.rect(0, 0, 32, 32)
          .fill(0x5c5040)
          .rect(1, 1, 30, 23)
          .fill(0xa5916d)
          .rect(1, 1, 30, 4)
          .fill(0xc3b088)
          .moveTo(10, 5)
          .lineTo(10, 22)
          .moveTo(22, 5)
          .lineTo(22, 22)
          .stroke({ color: 0x827050, width: 1 });
      } else if (kind === 'door') {
        g.rect(0, 0, 32, 32)
          .fill(0x504b39)
          .rect(4, 2, 24, 26)
          .fill(0x9c845b)
          .rect(7, 4, 8, 22)
          .fill(0xb19968)
          .circle(23, 17, 1.5)
          .fill(0xd9ce9e);
      } else if (kind === 'campfire') {
        g.ellipse(16, 21, 15, 10)
          .fill(0x585b4c)
          .moveTo(7, 25)
          .lineTo(25, 15)
          .moveTo(7, 15)
          .lineTo(25, 25)
          .stroke({ color: 0x91704d, width: 4 })
          .poly([11, 21, 10, 14, 17, 1, 20, 12, 25, 17, 20, 25])
          .fill(0xe3a054)
          .poly([15, 23, 16, 10, 21, 19, 19, 24])
          .fill(0xf6d78c);
      } else if (kind === 'lamp') {
        g.circle(16, 24, 7)
          .fill(0x586156)
          .rect(14, 8, 4, 16)
          .fill(0xa5b2a6)
          .circle(16, 7, 7)
          .fill(0xe2cf86)
          .circle(16, 7, 4)
          .fill(0xf6eac0);
      } else if (kind === 'solar') {
        g.rect(5, 10, w - 10, h - 12)
          .fill(0x424f4e)
          .rect(2, 3, w - 4, h - 14)
          .fill(0x8b9d9a)
          .rect(5, 6, w - 10, h - 20)
          .fill(0x41646e);
        for (let x = 6; x < w - 6; x += 14)
          g.moveTo(x, 6)
            .lineTo(x, h - 14)
            .stroke({ color: 0x7298a2, width: 1 });
        for (let y = 7; y < h - 14; y += 14)
          g.moveTo(5, y)
            .lineTo(w - 5, y)
            .stroke({ color: 0x7298a2, width: 1 });
      } else if (kind === 'beacon') {
        g.roundRect(8, 14, w - 16, h - 20, 12)
          .fill(0x697d78)
          .roundRect(14, 18, w - 28, h - 30, 10)
          .fill(0xa2aaa0)
          .rect(w / 2 - 5, 12, 10, h - 30)
          .fill(0x425e5b)
          .circle(w / 2, h / 2, 22)
          .fill(0xd1cfb4)
          .circle(w / 2, h / 2, 16)
          .fill(0x567e79)
          .circle(w / 2, h / 2, 7)
          .fill(0xc9e2c6)
          .moveTo(w / 2, h / 2)
          .lineTo(w / 2 + 20, 9)
          .stroke({ color: 0xc5cbb7, width: 4 });
      } else if (kind === 'sandbag') {
        for (let y = 6; y < 27; y += 9)
          for (let x = (y % 2) * 5; x < 27; x += 13)
            g.roundRect(x, y, 14, 9, 3).fill(y === 6 ? 0xb8ac7b : 0x9c9065);
      } else {
        g.roundRect(2, 6, w - 4, h - 8, 3)
          .fill(0x4e5145)
          .roundRect(3, 2, w - 6, h - 9, 3)
          .fill(['generator', 'battery', 'cooler'].includes(kind) ? 0x81918b : 0xa3875e)
          .rect(5, 4, w - 10, 3)
          .fill(0xb5bfa5);
        if (kind === 'stove') {
          g.rect(9, 7, 20, 16)
            .fill(0x343e38)
            .circle(18, 15, 6)
            .fill(0xb2814a)
            .circle(18, 15, 3)
            .fill(0xe2b470)
            .rect(37, 7, 17, 16)
            .fill(0x59635b);
        }
        if (kind === 'research') {
          g.rect(8, 6, 22, 16)
            .fill(0xe0dbc1)
            .moveTo(19, 7)
            .lineTo(19, 20)
            .stroke({ color: 0x99967b, width: 1 })
            .rect(39, 6, 13, 14)
            .fill(0x416b66)
            .rect(41, 8, 9, 8)
            .fill(0x83b3a1);
        }
        if (kind === 'generator' || kind === 'battery') {
          g.rect(8, 10, w - 16, h - 22).fill(0x4e665f);
          for (let y = 14; y < h - 16; y += 7) g.rect(11, y, w - 22, 2).fill(0x849a8a);
          g.circle(w - 12, 10, 3).fill(0xd1ae60);
        }
        if (kind === 'chair') g.rect(4, 1, 24, 5).fill(0xc0a173);
      }
      this.texture(`b${i}`, g);
    }
    RESOURCES.forEach((r, i) => {
      const c = [
        0xac8957, 0x9aa7a4, 0xc5aa72, 0xb4bf73, 0xd3aa6a, 0xbda179, 0xc3d3c1, 0x879087, 0xd4cba6,
      ][i];
      const g = new Graphics();
      if (r === 'wood') {
        for (let y = 8; y <= 20; y += 6)
          g.roundRect(4, y, 25, 5, 2)
            .fill(c)
            .circle(27, y + 2, 2)
            .fill(0xd7b587);
      } else {
        g.roundRect(6, 7, 22, 18, 3)
          .fill(0x50594a)
          .roundRect(5, 5, 22, 18, 3)
          .fill(c)
          .rect(7, 7, 18, 3)
          .fill({ color: 0xffffff, alpha: 0.2 });
        if (r === 'medicine') g.rect(14, 8, 5, 12).rect(10, 12, 13, 4).fill(0x6d9286);
      }
      this.texture(`i${i}`, g);
    });
    for (const name of ['pawn', 'enemy']) {
      const g = new Graphics()
        .roundRect(8, 16, 17, 18, 5)
        .fill(name === 'enemy' ? 0xa46450 : 0xffffff)
        .rect(10, 29, 5, 9)
        .rect(20, 29, 5, 9)
        .fill(0x35433d)
        .circle(17, 10, 8)
        .fill(0xd7b58f)
        .poly([8, 10, 9, 3, 17, 0, 25, 4, 25, 9, 17, 6])
        .fill(name === 'enemy' ? 0x57413a : 0x514f3c)
        .rect(24, 19, 10, 4)
        .fill(0x4a4d45);
      this.texture(name, g);
    }
    this.texture(
      'deer',
      new Graphics()
        .ellipse(17, 18, 14, 7)
        .fill(0xb39768)
        .rect(7, 19, 3, 13)
        .rect(23, 19, 3, 13)
        .fill(0x7d6e4f)
        .ellipse(30, 10, 5, 9)
        .fill(0xc1a478)
        .circle(32, 7, 1)
        .fill(0x363d31)
        .moveTo(28, 3)
        .lineTo(24, -4)
        .moveTo(30, 2)
        .lineTo(33, -5)
        .stroke({ color: 0xb9b59b, width: 2 }),
    );
    for (let stage = 0; stage < 4; stage++) {
      const g = new Graphics();
      for (let i = 0; i < 4; i++) {
        const x = 7 + (i % 2) * 15,
          y = 11 + Math.floor(i / 2) * 15;
        g.ellipse(x, y + 2, 5, 2)
          .fill({ color: 0x344733, alpha: 0.3 })
          .moveTo(x, y)
          .lineTo(x, y - 4 - stage * 3)
          .stroke({ color: stage === 3 ? 0xd3b66a : 0x71964e, width: 2 })
          .poly([x, y - 3, x - 5 - stage, y - 6 - stage * 2, x, y - 5])
          .fill(stage === 3 ? 0xc9b469 : 0x88a35a)
          .poly([x, y - 5, x + 5 + stage, y - 8 - stage * 2, x, y - 6])
          .fill(stage === 3 ? 0xe1ca7b : 0xadc16c);
      }
      this.texture(`crop${stage}`, g);
    }
  }
  private terrain(terrain: Uint8Array, zones: Uint8Array) {
    if (!this.ground.children.length) {
      for (let cy = 0; cy < SIZE; cy += 16)
        for (let cx = 0; cx < SIZE; cx += 16) {
          const container = new Container();
          container.position.set(cx * TILE, cy * TILE);
          this.ground.addChild(container);
          this.chunks.push({ container, x: cx, y: cy });
          for (let y = cy; y < cy + 16; y++)
            for (let x = cx; x < cx + 16; x++) {
              const i = y * SIZE + x;
              const sprite = new Sprite(this.textures.get(`tile${terrain[i]}-${hash(i) % 4}`));
              sprite.position.set((x - cx) * TILE, (y - cy) * TILE);
              container.addChild(sprite);
            }
        }
      const ruin = new Graphics()
        .roundRect(40 * TILE, 44 * TILE, 7 * TILE, 2 * TILE, 8)
        .fill({ color: 0xa7a28b, alpha: 0.4 });
      for (let x = 40; x < 47; x++)
        ruin
          .rect(x * TILE + 2, 44 * TILE + 2, 28, 28)
          .stroke({ color: 0xccc3a2, alpha: 0.35, width: 1 });
      ruin
        .roundRect(43 * TILE + 3, 44 * TILE + 2, 50, 30, 8)
        .fill(0x939d91)
        .roundRect(43 * TILE + 7, 44 * TILE + 5, 30, 22, 6)
        .fill(0x4d6962)
        .rect(43 * TILE + 11, 44 * TILE + 8, 17, 3)
        .fill(0x90ada0);
      this.ground.addChild(ruin);
    }
    this.zonesLayer.clear();
    zones.forEach((z, i) => {
      if (z) {
        const x = (i % SIZE) * TILE,
          y = Math.floor(i / SIZE) * TILE;
        this.zonesLayer
          .rect(x + 1, y + 1, 30, 30)
          .fill({ color: z === 1 ? 0xd5b77b : z === 3 ? 0xb1a0c6 : 0xced39a, alpha: 0.17 })
          .stroke({
            color: z === 1 ? 0xd5b77b : z === 3 ? 0xb1a0c6 : 0xc2cf86,
            alpha: 0.35,
            width: 1,
          });
      }
    });
  }
  private frame(m: Frame) {
    const now = performance.now();
    this.frameInterval = Math.min(150, Math.max(16, now - this.receivedAt));
    this.receivedAt = now;
    if (this.previous)
      this.port?.postMessage({ type: 'return', buffer: this.previous.buffer }, [
        this.previous.buffer,
      ]);
    this.previous = this.current;
    this.current = m;
    this.tick = m.tick;
    this.previousPositions.clear();
    if (this.previous) {
      const a = new Float32Array(this.previous.buffer);
      for (let i = 0; i < this.previous.count; i++) {
        const o = i * STRIDE;
        if (a[o + 1] >= 80 && a[o + 1] < 90)
          this.previousPositions.set(a[o], { x: a[o + 2], y: a[o + 3] });
      }
    }
    this.updateEntities();
  }
  private key(type: number, id: number, progress: number) {
    if (type === 1) return `tree${id % 3}`;
    if (type === 2 || type === 4) return 'ore';
    if (type === 3) return 'berry';
    if (type >= 20 && type < 50) return `b${type - 20}`;
    if (type >= 50 && type < 80) return `i${type - 50}`;
    if (type === 80) return 'pawn';
    if (type === 81) return 'enemy';
    if (type === 82) return 'deer';
    return `crop${Math.min(3, Math.floor(progress * 4))}`;
  }
  private updateEntities() {
    if (!this.current) return;
    const a = new Float32Array(this.current.buffer),
      alive = new Set<number>();
    for (let i = 0; i < this.current.count; i++) {
      const o = i * STRIDE,
        id = a[o],
        type = a[o + 1],
        key = this.key(type, id, a[o + 4]);
      alive.add(id);
      let view = this.entities.get(id);
      if (!view) {
        const sprite = new Sprite(this.textures.get(key) ?? Texture.WHITE);
        const shadow =
          type === 1 || (type >= 80 && type < 90) ? new Sprite(this.textures.get('shadow')) : null;
        if (shadow) this.objects.addChild(shadow);
        let label: Text | null = null;
        if (type === 80) {
          label = new Text({
            text: ['林野', '苏禾', '温岚'][
              [...this.entities.values()].filter((v) => v.type === 80).length % 3
            ],
            style: {
              fontFamily: 'Microsoft YaHei, sans-serif',
              fontSize: 11,
              fill: 0xf5f0d8,
              dropShadow: { color: 0x1b3029, alpha: 0.8, blur: 2, distance: 1 },
            },
          });
          label.anchor.set(0.5);
          this.objects.addChild(label);
        }
        view = { sprite, shadow, label, type };
        this.entities.set(id, view);
        this.objects.addChild(sprite);
      }
      view.sprite.texture = this.textures.get(key) ?? Texture.WHITE;
      view.sprite.alpha =
        type >= 20 && type < 50 && a[o + 4] < 1 ? 0.45 : a[o + 7] === 5 ? 0.45 : 1;
      view.sprite.tint = type === 80 ? a[o + 6] : 0xffffff;
    }
    for (const [id, v] of this.entities)
      if (!alive.has(id)) {
        v.sprite.destroy();
        v.shadow?.destroy();
        v.label?.destroy();
        this.entities.delete(id);
      }
  }
  private worldPoint(x: number, y: number) {
    return {
      x: (x - this.width / 2) / (TILE * this.camera.zoom) + this.camera.x,
      y: (y - this.height / 2) / (TILE * this.camera.zoom) + this.camera.y,
    };
  }
  message(m: any) {
    if (m.type === 'resize') {
      this.width = m.width;
      this.height = m.height;
      this.app.renderer.resolution = Math.min(m.dpr, 2);
      this.app.renderer.resize(m.width, m.height);
    }
    if (m.type === 'tool') {
      this.tool = m.tool;
      this.buildKind = m.kind ?? this.buildKind;
    }
    if (m.type === 'select') this.selection = m.ids;
    if (m.type === 'focus') {
      this.camera.x = m.x;
      this.camera.y = m.y;
    }
    if (m.type === 'grid') this.grid = m.value;
    if (m.type === 'key') {
      if (m.down) this.keys.add(m.key);
      else this.keys.delete(m.key);
    }
    if (m.type === 'keysClear') {
      this.keys.clear();
      this.startCell = null;
      this.dragging = false;
    }
    if (m.type === 'wheel') {
      const before = this.worldPoint(m.x, m.y);
      this.camera.zoom = Math.max(
        0.35,
        Math.min(2.4, this.camera.zoom * Math.exp(-m.delta * 0.001)),
      );
      const after = this.worldPoint(m.x, m.y);
      this.camera.x += before.x - after.x;
      this.camera.y += before.y - after.y;
    }
    if (m.type === 'pointer') {
      const p = this.worldPoint(m.x, m.y);
      this.hover = { x: Math.floor(p.x), y: Math.floor(p.y) };
      this.pointer = { x: m.x, y: m.y };
      if (m.action === 'down') {
        this.dragging = m.button === 1 || (m.button === 2 && m.alt);
        this.dragStart = { x: m.x, y: m.y };
        this.startCell = { ...this.hover };
        this.moved = false;
      }
      if (m.action === 'move') {
        if (this.dragging) {
          this.camera.x -= (m.x - this.dragStart.x) / (TILE * this.camera.zoom);
          this.camera.y -= (m.y - this.dragStart.y) / (TILE * this.camera.zoom);
          this.dragStart = { x: m.x, y: m.y };
        }
        if (
          this.startCell &&
          Math.abs(m.x - this.dragStart.x) + Math.abs(m.y - this.dragStart.y) > 6
        )
          this.moved = true;
        this.emit({ type: 'hover', ...this.hover });
      }
      if (m.action === 'up') {
        if (this.dragging) {
          this.dragging = false;
          this.startCell = null;
          return;
        }
        const start = this.startCell ?? this.hover;
        this.startCell = null;
        if (m.button === 2) {
          this.emit({ type: 'intent', kind: 'move', x: this.hover.x, y: this.hover.y });
          return;
        }
        if (m.button !== 0) return;
        if (this.tool === 'select') {
          const ids: number[] = [];
          if (this.current) {
            const a = new Float32Array(this.current.buffer);
            for (let i = 0; i < this.current.count; i++) {
              const o = i * STRIDE;
              if (a[o + 1] !== 80) continue;
              const inside = this.moved
                ? a[o + 2] >= Math.min(start.x, this.hover.x) &&
                  a[o + 2] <= Math.max(start.x, this.hover.x) + 1 &&
                  a[o + 3] >= Math.min(start.y, this.hover.y) &&
                  a[o + 3] <= Math.max(start.y, this.hover.y) + 1
                : Math.abs(a[o + 2] + 0.5 - p.x) < 0.8 && Math.abs(a[o + 3] + 0.5 - p.y) < 0.9;
              if (inside) ids.push(a[o]);
            }
          }
          this.emit({ type: 'selection', ids });
          if (!ids.length) this.emit({ type: 'inspect', x: this.hover.x, y: this.hover.y });
        } else
          this.emit({
            type: 'intent',
            kind: this.tool,
            building: this.buildKind,
            x: start.x,
            y: start.y,
            x2: this.hover.x,
            y2: this.hover.y,
          });
      }
    }
  }
  private draw() {
    const now = performance.now(),
      dt = Math.min(50, now - this.lastTime);
    this.lastTime = now;
    const speed = (dt * 0.012) / this.camera.zoom;
    if (this.keys.has('a') || this.keys.has('arrowleft')) this.camera.x -= speed;
    if (this.keys.has('d') || this.keys.has('arrowright')) this.camera.x += speed;
    if (this.keys.has('w') || this.keys.has('arrowup')) this.camera.y -= speed;
    if (this.keys.has('s') || this.keys.has('arrowdown')) this.camera.y += speed;
    this.camera.x = Math.max(0, Math.min(SIZE, this.camera.x));
    this.camera.y = Math.max(0, Math.min(SIZE, this.camera.y));
    const scale = this.camera.zoom;
    this.stage.scale.set(scale);
    this.stage.position.set(
      this.width / 2 - this.camera.x * TILE * scale,
      this.height / 2 - this.camera.y * TILE * scale,
    );
    this.fx.clear();
    this.overlay.clear();
    for (const chunk of this.chunks)
      chunk.container.visible =
        Math.abs(chunk.x + 8 - this.camera.x) < this.width / TILE / scale / 2 + 9 &&
        Math.abs(chunk.y + 8 - this.camera.y) < this.height / TILE / scale / 2 + 9;
    if (this.current) {
      const a = new Float32Array(this.current.buffer);
      const alpha = Math.min(1, (now - this.receivedAt) / this.frameInterval);
      for (let i = 0; i < this.current.count; i++) {
        const o = i * STRIDE,
          id = a[o],
          type = a[o + 1],
          v = this.entities.get(id)!;
        const prev = this.previousPositions.get(id);
        let x = a[o + 2],
          y = a[o + 3];
        if (prev && Math.hypot(prev.x - x, prev.y - y) < 4) {
          x = prev.x + (x - prev.x) * alpha;
          y = prev.y + (y - prev.y) * alpha;
        }
        let px = x * TILE,
          py = y * TILE;
        const visible =
          Math.abs(x - this.camera.x) < this.width / (TILE * scale) / 2 + 4 &&
          Math.abs(y - this.camera.y) < this.height / (TILE * scale) / 2 + 4;
        v.sprite.visible = visible;
        if (v.shadow) v.shadow.visible = visible;
        if (v.label) v.label.visible = visible;
        if (!visible) continue;
        if (type === 1) {
          px -= 10;
          py -= 29;
        } else if (type >= 80 && type < 90) {
          px += 1;
          py -= 9;
        }
        v.sprite.position.set(px, py);
        v.sprite.zIndex = (y + 1) * 100 + (type >= 80 ? 20 : 0);
        v.sprite.rotation = type >= 80 && type < 90 && a[o + 7] >= 4 ? -Math.PI / 2 : 0;
        if (v.shadow) {
          v.shadow.position.set(x * TILE, y * TILE + 20);
          v.shadow.zIndex = y * 100 - 2;
        }
        if (v.label) {
          v.label.position.set(x * TILE + 16, y * TILE - 17);
          v.label.zIndex = (y + 1) * 100 + 99;
        }
        if (type >= 80 && type < 82) {
          if (this.selection.includes(id))
            this.fx
              .ellipse(x * TILE + 16, y * TILE + 25, 15, 7)
              .stroke({ color: 0xf0d193, width: 2 });
          if (a[o + 10]) this.fx.rect(x * TILE + 3, y * TILE - 7, 26, 2).fill(0xe0bd79);
          if (a[o + 5] < 99)
            this.fx
              .rect(x * TILE + 3, y * TILE - 4, 26, 3)
              .fill(0x5e4840)
              .rect(x * TILE + 3, y * TILE - 4, (26 * Math.max(0, a[o + 5])) / 100, 3)
              .fill(0xd68975);
          if (a[o + 9]) this.fx.rect(x * TILE + 22, y * TILE + 14, 10, 8).fill(0xb8a16d);
          if (a[o + 11] > 32) this.fx.circle(x * TILE + 35, y * TILE + 13, 4).fill(0xffe5a5);
          if (a[o + 7] === 3) this.fx.circle(x * TILE + 28, y * TILE - 2, 2).fill(0xd3d8bd);
        }
        if (a[o + 10] && type < 20)
          this.fx
            .moveTo(x * TILE + 11, y * TILE + 10)
            .lineTo(x * TILE + 21, y * TILE + 20)
            .moveTo(x * TILE + 21, y * TILE + 10)
            .lineTo(x * TILE + 11, y * TILE + 20)
            .stroke({ color: 0xebbd7e, width: 2 });
        if (type >= 20 && type < 50 && a[o + 4] < 1) {
          const d = BUILDINGS[Object.keys(BUILDINGS)[type - 20] as keyof typeof BUILDINGS];
          this.fx
            .rect(x * TILE + 2, y * TILE + 2, d.w * TILE - 4, d.h * TILE - 4)
            .stroke({ color: 0xe8ce98, width: 1, alpha: 0.8 });
          this.fx
            .rect(x * TILE + 3, y * TILE + d.h * TILE - 5, (d.w * TILE - 6) * a[o + 4], 2)
            .fill(0xe2c784);
        }
      }
    }
    if (this.grid) {
      const minX = Math.max(0, Math.floor(this.camera.x - this.width / TILE / scale / 2)),
        maxX = Math.min(SIZE, Math.ceil(this.camera.x + this.width / TILE / scale / 2)),
        minY = Math.max(0, Math.floor(this.camera.y - this.height / TILE / scale / 2)),
        maxY = Math.min(SIZE, Math.ceil(this.camera.y + this.height / TILE / scale / 2));
      for (let x = minX; x <= maxX; x++)
        this.overlay.moveTo(x * TILE, minY * TILE).lineTo(x * TILE, maxY * TILE);
      for (let y = minY; y <= maxY; y++)
        this.overlay.moveTo(minX * TILE, y * TILE).lineTo(maxX * TILE, y * TILE);
      this.overlay.stroke({ color: 0xe4ddbd, alpha: 0.15, width: 1 });
    }
    if (this.tool !== 'select') {
      const d = BUILDINGS[this.buildKind as keyof typeof BUILDINGS];
      const s = this.startCell ?? this.hover;
      const x = this.tool === 'build' ? this.hover.x : Math.min(s.x, this.hover.x),
        y = this.tool === 'build' ? this.hover.y : Math.min(s.y, this.hover.y);
      const w = this.tool === 'build' ? d.w : Math.abs(s.x - this.hover.x) + 1,
        h = this.tool === 'build' ? d.h : Math.abs(s.y - this.hover.y) + 1;
      this.overlay
        .rect(x * TILE, y * TILE, w * TILE, h * TILE)
        .fill({ color: 0xe8d39b, alpha: 0.22 })
        .stroke({ color: 0xf4dfad, width: 2 });
    }
    if (this.tool === 'select' && this.startCell && this.moved) {
      const x = Math.min(this.startCell.x, this.hover.x),
        y = Math.min(this.startCell.y, this.hover.y);
      this.overlay
        .rect(
          x * TILE,
          y * TILE,
          (Math.abs(this.startCell.x - this.hover.x) + 1) * TILE,
          (Math.abs(this.startCell.y - this.hover.y) + 1) * TILE,
        )
        .fill({ color: 0xd5dcb0, alpha: 0.12 })
        .stroke({ color: 0xd5dcb0, width: 1 });
    }
    const hour = (this.tick / 500 + 8) % 24;
    const dark = hour >= 20 || hour < 5 ? 0.22 : hour >= 18 || hour < 7 ? 0.08 : 0;
    this.shade.clear();
    if (dark) this.shade.rect(0, 0, this.width, this.height).fill({ color: 0x112a3e, alpha: dark });
    this.frames++;
    if (now - this.lastMeasure > 1000) {
      this.emit({
        type: 'renderMetrics',
        value: {
          fps: (this.frames * 1000) / (now - this.lastMeasure),
          backend: this.backend,
          renderWorker: this.isWorker,
          textureBytes: this.textureBytes,
          displayBytes:
            (this.current?.buffer.byteLength ?? 0) + (this.previous?.buffer.byteLength ?? 0),
        },
      });
      this.frames = 0;
      this.lastMeasure = now;
    }
  }
  destroy() {
    this.app.destroy(true, { children: true, texture: true, textureSource: true });
    this.port?.close();
  }
}
