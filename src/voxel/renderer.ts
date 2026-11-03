import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DataTexture,
  DirectionalLight,
  DynamicDrawUsage,
  EdgesGeometry,
  Euler,
  Float32BufferAttribute,
  Fog,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NearestFilter,
  OrthographicCamera,
  Plane,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  RepeatWrapping,
  RGBAFormat,
  Scene,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import {
  Block,
  CHUNK,
  DEPTH,
  DEVICE_SIZES,
  HEIGHT,
  SURFACE,
  TPS,
  WIDTH,
  index,
  deviceCells,
  stonecutterCells,
  stonecutterInteraction,
  tailorCells,
  tailorInteraction,
  researchBenchCells,
  researchBenchInteraction,
  weaponBenchCells,
  weaponBenchInteraction,
  type ChunkUpdate,
  type Device,
  type DeviceKind,
  type Pawn,
  type Pos,
  type Resource,
  type Stove,
  type VoxelSnapshot,
} from './types';
import { BATTERY_CAPACITY } from './power';
import { isPartMissing, partEfficiency } from './anatomy';
import { needsTending } from './injuries';
import { WEAPON_KINDS, type WeaponKind } from './weapons';
import { SMITHY_FUEL_CAPACITY } from './weaponProduction';
import { isRangedKind } from './ranged';
import { projectileViewPosition } from './rangedView';

/** x/y are horizontal simulation coordinates; Three uses x/z horizontally. */
export interface VoxelView {
  level?: number;
  /** Absolute azimuth in radians. Q/E normally add/subtract Math.PI / 2. */
  rotation?: number;
  zoom?: number;
  focus?: Pos;
}

export interface VoxelRenderMetrics {
  [key: string]: unknown;
  backend: 'Three.js · WebGL2';
  fps: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  chunkCount: number;
  pendingChunks: number;
  terrainVertices: number;
  terrainGeometryBytes: number;
  gridBytes: number;
  dpr: number;
  level: number;
  rotation: number;
  zoom: number;
}

type Batch = {
  mesh: InstancedMesh;
  capacity: number;
  geometry: BufferGeometry;
  material: MeshLambertMaterial | MeshBasicMaterial;
};
type PawnVisual = {
  root: Group;
  body: Group;
  head: Group;
  leftHand: Mesh;
  rightHand: Mesh;
  leftLeg: Group;
  rightLeg: Group;
  leftArm: Group;
  rightArm: Group;
  tool: Group;
  hammer: Group;
  pencil: Group;
  weapons: Record<WeaponKind, Group>;
  cargoWeapons: Record<WeaponKind, Group>;
  cargo: Mesh;
  torso: Mesh;
  label: Sprite;
  sleepSymbol: Sprite;
  healthMarker: Group;
  apparel: { hat: Group; coat: Mesh; sleeves: Mesh[]; shirt: Mesh[]; pants: Mesh[] };
  shadow: Mesh;
  from: Vector3;
  to: Vector3;
  start: number;
  duration: number;
  pawn: Pawn;
};
type DevicePart = {
  cell: Pos;
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  color: number;
  yaw?: number;
  pitch?: number;
  roll?: number;
};

const CHUNKS_X = Math.ceil(WIDTH / CHUNK);
const CHUNKS_Y = Math.ceil(DEPTH / CHUNK);
const CHUNK_COUNT = CHUNKS_X * CHUNKS_Y * Math.ceil(HEIGHT / CHUNK);
const UP = new Vector3(0, 1, 0);
const RESOURCE_COLORS: Record<Resource, number> = {
  wood: 0xbc874d,
  stone: 0x949fa5,
  chunk: 0x77878b,
  steel: 0x81b8c5,
  components: 0xe8b55c,
  food: 0x99b869,
  grain: 0xd6bd71,
  meal: 0xd88d5f,
  cloth: 0xe7dfc8,
  apparel: 0x86aaa2,
  weapon: 0xb9cbd0,
};
// Local Three coordinates: x across the grip, y thickness, z along the blade.
// The same four parts identify each actual item on the ground, in cargo and in hand.
type WeaponPart = [number, number, number, number, number, number, number];
const WEAPON_MODEL_PARTS: Record<WeaponKind, WeaponPart[]> = {
  shortBow: [
    [-0.29, 0, 0.25, 0.07, 0.06, 0.5, 0xb88a54],
    [0.29, 0, 0.25, 0.07, 0.06, 0.5, 0xb88a54],
    [0, 0, 0.49, 0.59, 0.07, 0.08, 0x936238],
    [0, 0, 0.01, 0.59, 0.02, 0.02, 0xe6dcc1],
  ],
  revolver: [
    [0, -0.09, 0.04, 0.11, 0.27, 0.13, 0x805536],
    [0, 0.055, 0.15, 0.17, 0.16, 0.19, 0x89959c],
    [0, 0.075, 0.36, 0.075, 0.075, 0.28, 0xd3dde0],
    [0, 0.06, 0.5, 0.095, 0.1, 0.035, 0x35464c],
  ],
  machinePistol: [
    [0, -0.12, 0.06, 0.13, 0.3, 0.15, 0x3a494c],
    [0, 0.055, 0.22, 0.17, 0.17, 0.42, 0x718a88],
    [0, 0.05, 0.49, 0.085, 0.09, 0.18, 0xb3c5c8],
    [0, -0.13, 0.29, 0.095, 0.27, 0.12, 0x3a494c],
  ],
  woodClub: [
    [0, 0, 0.13, 0.075, 0.075, 0.4, 0x93683e],
    [0, 0, 0.43, 0.18, 0.16, 0.29, 0xb88850],
    [0, 0, 0.58, 0.14, 0.14, 0.08, 0xc59a61],
    [0, 0, -0.04, 0.09, 0.09, 0.05, 0x6c4f36],
  ],
  steelKnife: [
    [0, 0, 0.02, 0.065, 0.07, 0.19, 0x76533b],
    [0, 0, 0.13, 0.17, 0.055, 0.045, 0x8a9b9f],
    [0, 0, 0.3, 0.08, 0.04, 0.3, 0xd7e2e5],
    [0, 0, 0.47, 0.04, 0.035, 0.06, 0xf0f4e9],
  ],
  steelLongsword: [
    [0, 0, 0.025, 0.07, 0.075, 0.25, 0x664a39],
    [0, 0, 0.18, 0.37, 0.065, 0.07, 0xc4b382],
    [0, 0, 0.53, 0.095, 0.045, 0.65, 0xd7e2e5],
    [0, 0, 0.89, 0.05, 0.04, 0.08, 0xf0f4e9],
  ],
};
const WEAPON_MODEL_CENTER: Record<WeaponKind, number> = {
  shortBow: 0.25,
  revolver: 0.25,
  machinePistol: 0.29,
  woodClub: 0.27,
  steelKnife: 0.21,
  steelLongsword: 0.415,
};
const BLOCK_COLORS: Record<number, number> = {
  [Block.Soil]: 0x9b7959,
  [Block.RichSoil]: 0x765b43,
  [Block.Sand]: 0xd2b47a,
  [Block.Gravel]: 0x9a9b8e,
  [Block.Stone]: 0x9ba3a2,
  [Block.Steel]: 0x7398a6,
  [Block.Wood]: 0xbf925d,
  [Block.Bedrock]: 0x59646a,
  [Block.Components]: 0xc4a26c,
  [Block.Masonry]: 0xa5b8bf,
};
const FACES = [
  {
    d: [1, 0, 0],
    n: [1, 0, 0],
    vertices: [
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
      [1, 0, 1],
    ],
    shade: 0.83,
  },
  {
    d: [-1, 0, 0],
    n: [-1, 0, 0],
    vertices: [
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
      [0, 0, 0],
    ],
    shade: 0.9,
  },
  {
    d: [0, 0, 1],
    n: [0, 1, 0],
    vertices: [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0],
    ],
    shade: 1,
  },
  {
    d: [0, 0, -1],
    n: [0, -1, 0],
    vertices: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
    shade: 0.62,
  },
  {
    d: [0, 1, 0],
    n: [0, 0, 1],
    vertices: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
    shade: 0.84,
  },
  {
    d: [0, -1, 0],
    n: [0, 0, -1],
    vertices: [
      [1, 0, 0],
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ],
    shade: 0.93,
  },
] as const;

function hash(x: number, y: number, z = 0) {
  let value =
    Math.imul(x + 19, 374761393) ^ Math.imul(y + 71, 668265263) ^ Math.imul(z + 3, 1442695041);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function grainTexture() {
  const side = 32,
    pixels = new Uint8Array(side * side * 4);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const v = Math.round(229 + hash(x, y) * 26 - (x === 0 || y === 0 ? 9 : 0));
      const i = (y * side + x) * 4;
      pixels[i] = v;
      pixels[i + 1] = v;
      pixels[i + 2] = v;
      pixels[i + 3] = 255;
    }
  }
  const texture = new DataTexture(pixels, side, side, RGBAFormat);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

function nameTexture(name: string, accent: number) {
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(256, 72)
      : Object.assign(document.createElement('canvas'), { width: 256, height: 72 });
  const context = canvas.getContext('2d') as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (context) {
    context.clearRect(0, 0, 256, 72);
    context.fillStyle = 'rgba(22, 34, 34, 0.87)';
    context.beginPath();
    context.roundRect(6, 7, 244, 58, 18);
    context.fill();
    context.fillStyle = `#${accent.toString(16).padStart(6, '0')}`;
    context.beginPath();
    context.roundRect(19, 21, 8, 30, 4);
    context.fill();
    context.fillStyle = '#fff4dc';
    context.font = '500 30px "Microsoft YaHei", "Segoe UI", sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(name, 137, 37, 201);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function sleepTexture() {
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(96, 96)
      : Object.assign(document.createElement('canvas'), { width: 96, height: 96 });
  const context = canvas.getContext('2d') as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (context) {
    context.clearRect(0, 0, 96, 96);
    context.font = 'bold 62px "Segoe UI", sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineWidth = 6;
    context.strokeStyle = '#344c50';
    context.strokeText('z', 48, 49);
    context.fillStyle = '#e4f2d9';
    context.fillText('z', 48, 49);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/**
 * A view-only renderer. It owns a small read cache, never changes simulation state,
 * and is usable with either an OffscreenCanvas or a normal canvas. The initial
 * backend is explicitly WebGL2; Three's WebGPU backend is not silently claimed.
 */
export class VoxelRenderer {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new OrthographicCamera();
  private terrainRoot = new Group();
  private blockData = new Uint8Array(WIDTH * DEPTH * HEIGHT);
  private ladderData = new Uint8Array(WIDTH * DEPTH * HEIGHT);
  private terrainMeshes = new Map<number, Mesh<BufferGeometry, MeshLambertMaterial>>();
  private dirty = new Set<number>();
  private loaded = new Set<number>();
  private geometrySizes = new Map<number, { vertices: number; bytes: number }>();
  private grain = grainTexture();
  private terrainMaterial = new MeshLambertMaterial({
    color: 0xffffff,
    vertexColors: true,
    map: this.grain,
  });
  private geometryPool = new Set<BufferGeometry>();
  private materialPool = new Set<
    MeshLambertMaterial | MeshBasicMaterial | LineBasicMaterial | SpriteMaterial
  >();
  private batches = new Map<string, Batch>();
  private inspectBatches = new Map<InstancedMesh, { cells: Pos[]; instancesPerCell: number }>();
  private box: BoxGeometry;
  private treeTrunk: CylinderGeometry;
  private treeCrown: ConeGeometry;
  private potGeometry: CylinderGeometry;
  private smokeGeometry: IcosahedronGeometry;
  private pawnVisuals = new Map<number, PawnVisual>();
  private data: VoxelSnapshot | null = null;
  private snapshotAt = 0;
  private level = SURFACE;
  private rotation = Math.PI / 4;
  private zoom = 1;
  private focus: Pos = { x: 32, y: 32, z: SURFACE };
  private width = 1;
  private height = 1;
  private dpr = 1;
  private ray = new Raycaster();
  private pointer = new Vector2();
  private plane = new Plane(new Vector3(0, 1, 0), -SURFACE);
  private hit = new Vector3();
  private matrix = new Matrix4();
  private quaternion = new Quaternion();
  private euler = new Euler();
  private beamDirection = new Vector3();
  private scale = new Vector3();
  private translation = new Vector3();
  private color = new Color();
  private hover: Pos | null = null;
  private cursor: Group;
  private grid: LineSegments;
  private jobLines: LineSegments;
  private workMotes: InstancedMesh;
  private motesMaterial: MeshBasicMaterial;
  private disposed = false;
  private contextLost = false;
  private canvas: HTMLCanvasElement | OffscreenCanvas;
  private fps = 0;
  private frameCount = 0;
  private fpsAt = performance.now();
  private ladderDirty = true;
  private entitiesDirty = true;
  private readonly lost = (event: Event) => {
    event.preventDefault();
    this.contextLost = true;
  };
  private readonly restored = () => {
    this.contextLost = false;
  };

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, width: number, height: number) {
    this.canvas = canvas;
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setClearColor(0xd3ddcc);
    this.scene.background = new Color(0xd3ddcc);
    this.scene.fog = new Fog(0xd3ddcc, 100, 185);
    this.scene.add(new HemisphereLight(0xfff3d8, 0x64797c, 2.1));
    this.scene.add(new AmbientLight(0xb4c2ad, 0.25));
    const sun = new DirectionalLight(0xffe5bb, 2.2);
    sun.position.set(-32, 60, 18);
    this.scene.add(sun);
    this.scene.add(this.terrainRoot);
    this.box = this.keepGeometry(new BoxGeometry(1, 1, 1));
    this.treeTrunk = this.keepGeometry(new CylinderGeometry(0.12, 0.18, 1.55, 6));
    this.treeCrown = this.keepGeometry(new ConeGeometry(1, 1.5, 6));
    this.potGeometry = this.keepGeometry(new CylinderGeometry(0.5, 0.44, 1, 10));
    this.smokeGeometry = this.keepGeometry(new IcosahedronGeometry(1, 0));

    const base = new Mesh(
      this.keepGeometry(new PlaneGeometry(WIDTH + 0.08, DEPTH + 0.08)),
      this.keepMaterial(new MeshLambertMaterial({ color: 0x4e615b })),
    );
    base.rotation.x = -Math.PI / 2;
    base.position.set(WIDTH / 2, -0.05, DEPTH / 2);
    this.scene.add(base);

    const gridPositions: number[] = [];
    for (let i = 0; i <= WIDTH; i++) gridPositions.push(i, 0, 0, i, 0, DEPTH);
    for (let i = 0; i <= DEPTH; i++) gridPositions.push(0, 0, i, WIDTH, 0, i);
    const gridGeometry = this.keepGeometry(new BufferGeometry());
    gridGeometry.setAttribute('position', new Float32BufferAttribute(gridPositions, 3));
    this.grid = new LineSegments(
      gridGeometry,
      this.keepMaterial(
        new LineBasicMaterial({
          color: 0xe9e5bf,
          transparent: true,
          opacity: 0.16,
          depthWrite: false,
        }),
      ),
    );
    this.grid.position.y = this.level + 0.018;
    this.scene.add(this.grid);

    const jobGeometry = new BufferGeometry();
    this.jobLines = new LineSegments(
      jobGeometry,
      this.keepMaterial(
        new LineBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.88,
          depthTest: false,
          depthWrite: false,
        }),
      ),
    );
    this.jobLines.renderOrder = 8;
    this.scene.add(this.jobLines);
    this.cursor = new Group();
    const cursorFill = new Mesh(
      this.keepGeometry(new PlaneGeometry(0.96, 0.96)),
      this.keepMaterial(
        new MeshBasicMaterial({
          color: 0xffe7a6,
          transparent: true,
          opacity: 0.24,
          depthWrite: false,
          depthTest: false,
        }),
      ),
    );
    cursorFill.rotation.x = -Math.PI / 2;
    cursorFill.renderOrder = 10;
    const cursorEdges = new LineSegments(
      this.keepGeometry(new EdgesGeometry(new BoxGeometry(1.02, 0.035, 1.02))),
      this.keepMaterial(
        new LineBasicMaterial({ color: 0xffe8a9, depthTest: false, depthWrite: false }),
      ),
    );
    cursorEdges.renderOrder = 11;
    this.cursor.add(cursorFill, cursorEdges);
    this.cursor.visible = false;
    this.scene.add(this.cursor);
    this.motesMaterial = this.keepMaterial(new MeshBasicMaterial({ color: 0xffdfa5 }));
    this.workMotes = new InstancedMesh(this.box, this.motesMaterial, 256);
    this.workMotes.instanceMatrix.setUsage(DynamicDrawUsage);
    this.workMotes.count = 0;
    this.workMotes.frustumCulled = false;
    this.scene.add(this.workMotes);
    canvas.addEventListener('webglcontextlost', this.lost);
    canvas.addEventListener('webglcontextrestored', this.restored);
    this.resize(width, height);
  }

  private keepGeometry<T extends BufferGeometry>(geometry: T): T {
    this.geometryPool.add(geometry);
    return geometry;
  }
  private keepMaterial<
    T extends MeshLambertMaterial | MeshBasicMaterial | LineBasicMaterial | SpriteMaterial,
  >(material: T): T {
    this.materialPool.add(material);
    return material;
  }

  resize(width: number, height: number) {
    if (this.disposed) return;
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    const ratio =
      (globalThis as typeof globalThis & { devicePixelRatio?: number }).devicePixelRatio ?? 1;
    this.dpr = Math.min(1.5, Math.max(1, ratio));
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.width, this.height, false);
    this.updateCamera();
  }

  chunks(updates: ChunkUpdate[]) {
    if (this.disposed) return;
    for (const update of updates) {
      if (
        !Number.isInteger(update.id) ||
        update.id < 0 ||
        update.id >= CHUNK_COUNT ||
        update.blocks.length !== CHUNK ** 3 ||
        update.ladders.length !== CHUNK ** 3
      ) {
        throw new Error(`Invalid voxel chunk ${update.id}`);
      }
      const cx = update.id % CHUNKS_X;
      const cy = Math.floor(update.id / CHUNKS_X) % CHUNKS_Y;
      const cz = Math.floor(update.id / (CHUNKS_X * CHUNKS_Y));
      for (let z = 0; z < CHUNK; z++)
        for (let y = 0; y < CHUNK; y++)
          for (let x = 0; x < CHUNK; x++) {
            const wx = cx * CHUNK + x,
              wy = cy * CHUNK + y,
              wz = cz * CHUNK + z;
            if (wx >= WIDTH || wy >= DEPTH || wz >= HEIGHT) continue;
            const src = (z * CHUNK + y) * CHUNK + x,
              dst = index(wx, wy, wz);
            this.blockData[dst] = update.blocks[src];
            this.ladderData[dst] = update.ladders[src];
          }
      this.loaded.add(update.id);
      this.dirty.add(update.id);
      for (const [dx, dy, dz] of [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ]) {
        const nx = cx + dx,
          ny = cy + dy,
          nz = cz + dz;
        if (
          nx >= 0 &&
          ny >= 0 &&
          nz >= 0 &&
          nx < CHUNKS_X &&
          ny < CHUNKS_Y &&
          nz * CHUNK < HEIGHT
        ) {
          const id = nx + ny * CHUNKS_X + nz * CHUNKS_X * CHUNKS_Y;
          if (this.loaded.has(id)) this.dirty.add(id);
        }
      }
    }
    this.ladderDirty = true;
    this.highlight(this.hover);
  }

  snapshot(snapshot: VoxelSnapshot) {
    if (this.disposed) return;
    const reset =
      !this.data ||
      snapshot.seed !== this.data.seed ||
      snapshot.tick < this.data.tick ||
      snapshot.generator !== this.data.generator ||
      JSON.stringify(snapshot.settings) !== JSON.stringify(this.data.settings);
    this.data = snapshot;
    this.snapshotAt = performance.now();
    const ids = new Set(snapshot.pawns.map((pawn) => pawn.id));
    for (const [id, visual] of this.pawnVisuals)
      if (!ids.has(id)) {
        this.removePawn(visual);
        this.pawnVisuals.delete(id);
      }
    for (const pawn of snapshot.pawns) {
      let visual = this.pawnVisuals.get(pawn.id);
      if (!visual) {
        visual = this.makePawn(pawn);
        this.pawnVisuals.set(pawn.id, visual);
        this.scene.add(visual.root);
      }
      const targetChanged =
        visual.to.x !== pawn.x + 0.5 || visual.to.y !== pawn.z || visual.to.z !== pawn.y + 0.5;
      // Stationary snapshots must not restart interpolation and suppress work animation.
      if (targetChanged) {
        visual.from.copy(visual.root.position);
        visual.to.set(pawn.x + 0.5, pawn.z, pawn.y + 0.5);
        visual.start = this.snapshotAt;
        visual.duration = Math.max(45, 130 / Math.sqrt(Math.max(1, snapshot.speed)));
      }
      if (reset || snapshot.speed === 0 || visual.from.distanceTo(visual.to) > 4) {
        visual.from.copy(visual.to);
        visual.root.position.copy(visual.to);
        visual.duration = 0;
      }
      visual.pawn = pawn;
      const plate = pawn.worn.some((p) => p.kind === 'plateArmor');
      const coat = pawn.worn.find(
        (p) => p.kind === 'parka' || p.kind === 'duster' || p.kind === 'plateArmor',
      );
      const helmet = pawn.worn.some((p) => p.kind === 'simpleHelmet');
      visual.apparel.hat.visible = helmet || pawn.worn.some((p) => p.kind === 'tuque');
      visual.apparel.hat.children.forEach((mesh, i) => {
        mesh.visible = !helmet || i < 2;
        ((mesh as Mesh).material as MeshLambertMaterial).color.setHex(helmet ? 0x9bafb9 : 0xdcd1b7);
      });
      visual.apparel.coat.visible = !!coat;
      visual.apparel.coat.scale.y = coat?.kind === 'duster' ? 0.88 : 0.69;
      visual.apparel.coat.position.y = coat?.kind === 'duster' ? 0.74 : 0.84;
      for (const mesh of [visual.apparel.coat, ...visual.apparel.sleeves]) {
        mesh.visible = !!coat;
        (mesh.material as MeshLambertMaterial).color.setHex(
          plate ? 0x9bafb9 : coat?.kind === 'duster' ? 0xbba47c : 0x789f9b,
        );
      }
      for (const mesh of visual.apparel.shirt)
        (mesh.material as MeshLambertMaterial).color.setHex(
          pawn.worn.some((p) => p.kind === 'shirt') ? pawn.color : 0x9c9587,
        );
      for (const mesh of visual.apparel.pants)
        (mesh.material as MeshLambertMaterial).color.setHex(
          plate ? 0x879ca8 : pawn.worn.some((p) => p.kind === 'pants') ? 0x485c61 : 0x8b857a,
        );
      visual.cargo.visible = !!pawn.cargo;
      if (pawn.cargo)
        (visual.cargo.material as MeshLambertMaterial).color.setHex(
          RESOURCE_COLORS[pawn.cargo.resource],
        );
    }
    this.entitiesDirty = true;
  }

  view(view: VoxelView) {
    if (this.disposed) return;
    if (view.level !== undefined && Number.isFinite(view.level)) {
      const level = MathUtils.clamp(Math.round(view.level), 1, HEIGHT - 2);
      if (level !== this.level) {
        this.level = level;
        for (const id of this.loaded) this.dirty.add(id);
        // Old-layer meshes cannot remain visible while new-layer meshes are rebuilt.
        for (const mesh of this.terrainMeshes.values()) mesh.visible = false;
        this.entitiesDirty = true;
        this.ladderDirty = true;
      }
    }
    if (view.rotation !== undefined && Number.isFinite(view.rotation))
      this.rotation = view.rotation;
    if (view.zoom !== undefined && Number.isFinite(view.zoom))
      this.zoom = MathUtils.clamp(view.zoom, 0.4, 3.5);
    if (view.focus)
      this.focus = {
        x: MathUtils.clamp(view.focus.x, 0, WIDTH - 1),
        y: MathUtils.clamp(view.focus.y, 0, DEPTH - 1),
        z: view.focus.z,
      };
    this.plane.constant = -this.level;
    this.grid.position.y = this.level + 0.018;
    this.updateCamera();
    this.highlight(this.hover);
  }

  private updateCamera() {
    const half = 19 / this.zoom,
      aspect = this.width / this.height;
    this.camera.left = -half * aspect;
    this.camera.right = half * aspect;
    this.camera.top = half;
    this.camera.bottom = -half;
    this.camera.near = 0.1;
    this.camera.far = 250;
    const x = this.focus.x + 0.5,
      z = this.focus.y + 0.5;
    this.camera.position.set(
      x + Math.sin(this.rotation) * 62,
      this.level + 58,
      z + Math.cos(this.rotation) * 62,
    );
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(x, this.level, z);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
  }

  /** CSS canvas-local coordinates. Edit the visible cut face, or the foot-height plane over air. */
  pick(clientXWithinCanvas: number, clientYWithinCanvas: number): Pos | null {
    if (
      this.disposed ||
      !Number.isFinite(clientXWithinCanvas) ||
      !Number.isFinite(clientYWithinCanvas) ||
      clientXWithinCanvas < 0 ||
      clientYWithinCanvas < 0 ||
      clientXWithinCanvas >= this.width ||
      clientYWithinCanvas >= this.height
    )
      return null;
    this.pointer.set(
      (clientXWithinCanvas / this.width) * 2 - 1,
      1 - (clientYWithinCanvas / this.height) * 2,
    );
    this.ray.setFromCamera(this.pointer, this.camera);
    this.terrainRoot.updateMatrixWorld(true);
    const surface = this.ray.intersectObjects(
      [...this.terrainMeshes.values()].filter((mesh) => mesh.visible),
      false,
    )[0];
    if (surface && surface.point.y >= this.level - 0.0001 && surface.point.y <= this.level + 0.56) {
      // A side-face hit lies on a cell boundary: step toward the owning solid.
      const normal = surface.face?.normal;
      const x = Math.floor(surface.point.x - (normal?.x ?? 0) * 0.0001);
      const y = Math.floor(surface.point.z - (normal?.z ?? 0) * 0.0001);
      if (x >= 0 && y >= 0 && x < WIDTH && y < DEPTH) return { x, y, z: this.level };
    }
    if (!this.ray.ray.intersectPlane(this.plane, this.hit)) return null;
    const x = Math.floor(this.hit.x),
      y = Math.floor(this.hit.z);
    return x >= 0 && y >= 0 && x < WIDTH && y < DEPTH ? { x, y, z: this.level } : null;
  }

  /** Inspect the visible object under the pointer; construction keeps using pick(). */
  inspect(clientXWithinCanvas: number, clientYWithinCanvas: number): Pos | null {
    const fallback = this.pick(clientXWithinCanvas, clientYWithinCanvas);
    if (
      this.disposed ||
      !Number.isFinite(clientXWithinCanvas) ||
      !Number.isFinite(clientYWithinCanvas) ||
      clientXWithinCanvas < 0 ||
      clientYWithinCanvas < 0 ||
      clientXWithinCanvas >= this.width ||
      clientYWithinCanvas >= this.height
    )
      return null;
    // pick() prepared the ray even if its plane intersection fell outside the map.
    if (this.entitiesDirty) {
      this.updateEntities();
      this.entitiesDirty = false;
    }
    this.animatePawns(performance.now());
    this.scene.updateMatrixWorld(true);
    const terrain = [...this.terrainMeshes.values()].filter((mesh) => mesh.visible);
    const obstruction = this.ray.intersectObjects(terrain, false)[0]?.distance ?? Infinity;
    const pawnHits: { distance: number; pos: Pos }[] = [];
    for (const visual of this.pawnVisuals.values()) {
      if (!visual.root.visible) continue;
      // Test body/tool geometry only. Labels and ground shadows are not solid bodies.
      const parts: Mesh[] = [];
      visual.root.traverseVisible((object) => {
        if (object instanceof Mesh && object.geometry === this.box) parts.push(object);
      });
      const intersection = this.ray.intersectObjects(parts, false)[0];
      if (intersection && intersection.distance <= obstruction + 0.02) {
        const { x, y, z } = visual.pawn;
        pawnHits.push({ distance: intersection.distance, pos: { x, y, z } });
      }
    }
    pawnHits.sort((a, b) => a.distance - b.distance);
    if (pawnHits.length) return pawnHits[0].pos;
    for (const intersection of this.ray.intersectObjects([...this.inspectBatches.keys()], false)) {
      if (intersection.distance > obstruction + 0.02) break;
      const batch = this.inspectBatches.get(intersection.object as InstancedMesh);
      if (!batch || intersection.instanceId === undefined) continue;
      const cell = batch.cells[Math.floor(intersection.instanceId / batch.instancesPerCell)];
      if (cell) return { x: cell.x, y: cell.y, z: cell.z };
    }
    return fallback;
  }

  /** Current-layer solids project to their cut top; air and body-height coordinates retain their height. */
  project(pos: Pos): { x: number; y: number } {
    const height =
      pos.z === this.level && this.block(pos.x, pos.y, pos.z) !== Block.Air ? pos.z + 0.55 : pos.z;
    const screen = new Vector3(pos.x + 0.5, height, pos.y + 0.5).project(this.camera);
    return { x: ((screen.x + 1) * this.width) / 2, y: ((1 - screen.y) * this.height) / 2 };
  }

  highlight(pos: Pos | null) {
    if (this.disposed) return;
    this.hover = pos ? { ...pos } : null;
    this.cursor.visible = !!pos && pos.z <= this.level;
    if (pos) {
      const solid = this.block(pos.x, pos.y, pos.z) !== Block.Air;
      const offset = solid ? (pos.z === this.level ? 0.57 : 1.02) : 0.045;
      this.cursor.position.set(pos.x + 0.5, pos.z + offset, pos.y + 0.5);
    }
  }

  private block(x: number, y: number, z: number) {
    if (x < 0 || y < 0 || z < 0 || x >= WIDTH || y >= DEPTH || z >= HEIGHT) return Block.Air;
    return this.blockData[index(x, y, z)];
  }

  private makeChunk(id: number) {
    const cx = id % CHUNKS_X,
      cy = Math.floor(id / CHUNKS_X) % CHUNKS_Y;
    const cz = Math.floor(id / (CHUNKS_X * CHUNKS_Y));
    const positions: number[] = [],
      normals: number[] = [],
      colors: number[] = [],
      uvs: number[] = [],
      indices: number[] = [];
    const cutHeight = this.level + 0.55;
    const color = new Color();
    for (let lz = 0; lz < CHUNK; lz++)
      for (let ly = 0; ly < CHUNK; ly++)
        for (let lx = 0; lx < CHUNK; lx++) {
          const x = cx * CHUNK + lx,
            y = cy * CHUNK + ly,
            z = cz * CHUNK + lz;
          if (x >= WIDTH || y >= DEPTH || z >= HEIGHT || z > this.level) continue;
          const block = this.block(x, y, z);
          if (!block) continue;
          const height = Math.min(1, cutHeight - z),
            variation = 0.93 + hash(x, y, z) * 0.12;
          for (let face = 0; face < FACES.length; face++) {
            const { d, n, vertices, shade } = FACES[face];
            const neighborZ = z + d[2];
            if (neighborZ <= this.level && this.block(x + d[0], y + d[1], neighborZ)) continue;
            let hex = BLOCK_COLORS[block] ?? 0xa8a195;
            // Only natural exposed top faces are grassy; a slice through soil is soil.
            const exposed = this.block(x, y, z + 1) === Block.Air;
            if (block === Block.Soil && exposed && face === 2) hex = 0x91ad65;
            if (block === Block.RichSoil && exposed && face === 2) hex = 0x5f854b;
            color.setHex(hex).multiplyScalar(variation * shade);
            const offset = positions.length / 3;
            for (let v = 0; v < 4; v++) {
              const vertex = vertices[v];
              positions.push(x + vertex[0], z + vertex[1] * height, y + vertex[2]);
              normals.push(...n);
              const edgeShade = face !== 2 && vertex[1] === 0 ? 0.91 : 1;
              colors.push(color.r * edgeShade, color.g * edgeShade, color.b * edgeShade);
              uvs.push(v === 1 || v === 2 ? 1 : 0, v >= 2 ? 1 : 0);
            }
            indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
          }
        }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    let mesh = this.terrainMeshes.get(id);
    if (mesh) {
      mesh.geometry.dispose();
      mesh.geometry = geometry;
      mesh.visible = true;
    } else {
      mesh = new Mesh(geometry, this.terrainMaterial);
      this.terrainMeshes.set(id, mesh);
      this.terrainRoot.add(mesh);
    }
    let bytes = geometry.index?.array.byteLength ?? 0;
    for (const attr of Object.values(geometry.attributes)) bytes += attr.array.byteLength;
    this.geometrySizes.set(id, { vertices: positions.length / 3, bytes });
  }

  private batch(
    name: string,
    count: number,
    geometry: BufferGeometry,
    material: MeshLambertMaterial | MeshBasicMaterial,
  ) {
    let batch = this.batches.get(name);
    if (!batch || batch.capacity < count) {
      if (batch) {
        this.scene.remove(batch.mesh);
        batch.mesh.dispose();
      }
      const capacity = Math.max(16, 2 ** Math.ceil(Math.log2(Math.max(1, count))));
      const mesh = new InstancedMesh(geometry, material, capacity);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      batch = { mesh, capacity, geometry, material };
      this.batches.set(name, batch);
      this.scene.add(mesh);
    }
    batch.mesh.count = count;
    return batch.mesh;
  }

  private instance(
    mesh: InstancedMesh,
    i: number,
    x: number,
    z: number,
    y: number,
    sx: number,
    sz: number,
    sy: number,
    color: number,
    yaw = 0,
    pitch = 0,
    roll = 0,
  ) {
    this.translation.set(x, z, y);
    this.scale.set(sx, sz, sy);
    this.quaternion.setFromEuler(this.euler.set(pitch, yaw, roll));
    this.matrix.compose(this.translation, this.quaternion, this.scale);
    mesh.setMatrixAt(i, this.matrix);
    this.color.setHex(color);
    mesh.setColorAt(i, this.color);
  }

  private finish(mesh: InstancedMesh) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    // InstancedMesh caches this for raycasting; changed positions invalidate it.
    mesh.boundingSphere = null;
  }

  private batchMaterial(name: string, transparent = false) {
    const existing = this.batches.get(name)?.material;
    if (existing) return existing;
    return this.keepMaterial(
      new MeshLambertMaterial({
        color: 0xffffff,
        transparent,
        opacity: transparent ? 0.24 : 1,
        depthWrite: !transparent,
      }),
    );
  }

  private updateEntities() {
    if (!this.data) return;
    this.inspectBatches.clear();
    const visibleTrees = this.data.trees.filter((tree) => tree.wood > 0 && tree.z <= this.level);
    const trees = visibleTrees.filter((tree) => tree.species === 'pine');
    const trunks = this.batch('trunks', trees.length, this.treeTrunk, this.batchMaterial('trunks'));
    const crowns = this.batch(
      'crowns',
      trees.length * 3,
      this.treeCrown,
      this.batchMaterial('crowns'),
    );
    this.inspectBatches.set(trunks, { cells: trees, instancesPerCell: 1 });
    this.inspectBatches.set(crowns, { cells: trees, instancesPerCell: 3 });
    trees.forEach((tree, i) => {
      const scale = 0.22 + 0.78 * MathUtils.clamp(tree.growth, 0, 1),
        size = (0.8 + hash(tree.x, tree.y) * 0.3) * scale,
        turn = hash(tree.y, tree.x) * Math.PI;
      this.instance(
        trunks,
        i,
        tree.x + 0.5,
        tree.z + 0.77 * scale,
        tree.y + 0.5,
        scale,
        scale,
        scale,
        0x80633f,
      );
      for (let layer = 0; layer < 3; layer++) {
        const radius = size * (1 - layer * 0.22);
        this.instance(
          crowns,
          i * 3 + layer,
          tree.x + 0.5,
          tree.z + (1.55 + layer * 0.57) * scale,
          tree.y + 0.5,
          radius,
          0.95 * scale,
          radius,
          [0x426e52, 0x567e59, 0x6b9361][layer],
          turn,
        );
      }
    });
    this.finish(trunks);
    this.finish(crowns);
    const poplars = visibleTrees.filter((tree) => !tree.species || tree.species === 'poplar');
    const poplarTrunks = this.batch(
      'poplar-trunks',
      poplars.length,
      this.treeTrunk,
      this.batchMaterial('poplar-trunks'),
    );
    const leaves = this.batch(
      'poplar-leaves',
      poplars.length * 3,
      this.smokeGeometry,
      this.batchMaterial('poplar-leaves'),
    );
    this.inspectBatches.set(poplarTrunks, { cells: poplars, instancesPerCell: 1 });
    this.inspectBatches.set(leaves, { cells: poplars, instancesPerCell: 3 });
    poplars.forEach((tree, i) => {
      const scale = 0.22 + 0.78 * MathUtils.clamp(tree.growth, 0, 1);
      this.instance(
        poplarTrunks,
        i,
        tree.x + 0.5,
        tree.z + 0.77 * scale,
        tree.y + 0.5,
        scale,
        scale,
        scale,
        0x927554,
      );
      for (let part = 0; part < 3; part++)
        this.instance(
          leaves,
          i * 3 + part,
          tree.x + 0.5 + (part - 1) * 0.34 * scale,
          tree.z + (1.75 + (part === 1 ? 0.45 : 0)) * scale,
          tree.y + 0.5,
          0.67 * scale,
          0.8 * scale,
          0.6 * scale,
          [0x6e974e, 0x86a95a, 0x5e8949][part],
          hash(tree.x, tree.y),
        );
    });
    this.finish(poplarTrunks);
    this.finish(leaves);
    const cacti = visibleTrees.filter((tree) => tree.species === 'saguaro');
    const cactus = this.batch('cacti', cacti.length * 5, this.box, this.batchMaterial('cacti'));
    this.inspectBatches.set(cactus, { cells: cacti, instancesPerCell: 5 });
    cacti.forEach((tree, i) => {
      const scale = 0.22 + 0.78 * MathUtils.clamp(tree.growth, 0, 1);
      const parts = [
        [0, 1, 0, 0.32, 2, 0.32],
        [-0.28, 1.05, 0, 0.55, 0.22, 0.25],
        [-0.5, 1.4, 0, 0.23, 0.9, 0.23],
        [0.28, 0.7, 0, 0.55, 0.22, 0.25],
        [0.5, 1, 0, 0.23, 0.8, 0.23],
      ];
      parts.forEach(([x, y, z, sx, sy, sz], k) =>
        this.instance(
          cactus,
          i * 5 + k,
          tree.x + 0.5 + x * scale,
          tree.z + y * scale,
          tree.y + 0.5 + z * scale,
          sx * scale,
          sy * scale,
          sz * scale,
          k ? 0x6e925b : 0x5e8250,
        ),
      );
    });
    this.finish(cactus);
    const loose = this.data.items.filter((item) => item.amount > 0 && item.z <= this.level);
    const items = loose.filter(
      (item) =>
        item.resource !== 'chunk' && item.resource !== 'apparel' && item.resource !== 'weapon',
    );
    const garments = loose.filter((item) => item.resource === 'apparel' && item.apparel);
    const chunks = loose.filter((item) => item.resource === 'chunk');
    const rocks = this.batch(
      'rock-chunks',
      chunks.length,
      this.smokeGeometry,
      this.batchMaterial('rock-chunks'),
    );
    this.inspectBatches.set(rocks, { cells: chunks, instancesPerCell: 1 });
    chunks.forEach((item, i) =>
      this.instance(
        rocks,
        i,
        item.x + 0.5,
        item.z + 0.33,
        item.y + 0.5,
        0.42,
        0.33,
        0.4,
        RESOURCE_COLORS.chunk,
        hash(item.x, item.y) * Math.PI,
      ),
    );
    this.finish(rocks);
    const piles = this.batch('items', items.length * 3, this.box, this.batchMaterial('items'));
    this.inspectBatches.set(piles, { cells: items, instancesPerCell: 3 });
    items.forEach((item, i) => {
      for (let j = 0; j < 3; j++) {
        const size =
          item.resource === 'wood'
            ? [0.52, 0.14, 0.16]
            : item.resource === 'cloth'
              ? [0.44, 0.09, 0.31]
              : [0.24, 0.16, 0.28];
        this.instance(
          piles,
          i * 3 + j,
          item.x + 0.34 + (j % 2) * 0.26,
          item.z + 0.1 + Math.floor(j / 2) * 0.18,
          item.y + 0.45 + (j % 2) * 0.12,
          size[0],
          size[1],
          size[2],
          RESOURCE_COLORS[item.resource],
          item.resource === 'wood' ? 0.2 : 0,
        );
      }
    });
    this.finish(piles);
    const clothes = this.batch(
      'loose-apparel',
      garments.length * 5,
      this.box,
      this.batchMaterial('loose-apparel'),
    );
    this.inspectBatches.set(clothes, { cells: garments, instancesPerCell: 5 });
    garments.forEach((item, i) => {
      const kind = item.apparel!.kind;
      const color =
        kind === 'simpleHelmet' || kind === 'plateArmor'
          ? 0x9bafb9
          : kind === 'duster'
            ? 0xbba47c
            : kind === 'parka'
              ? 0x789f9b
              : kind === 'pants'
                ? 0x485c61
                : 0xe5d7bb;
      const parts =
        kind === 'pants'
          ? [
              [0, 0, 0.48, 0.08, 0.18],
              [-0.13, 0.2, 0.2, 0.07, 0.46],
              [0.13, 0.2, 0.2, 0.07, 0.46],
              [0, 0, 0, 0, 0],
              [0, 0, 0, 0, 0],
            ]
          : kind === 'tuque' || kind === 'simpleHelmet'
            ? [
                [0, 0, 0.39, 0.18, 0.4],
                [0, 0, 0.46, 0.08, 0.46],
                [0, 0, 0.12, kind === 'simpleHelmet' ? 0 : 0.3, 0.12],
                [0, 0, 0, 0, 0],
                [0, 0, 0, 0, 0],
              ]
            : [
                [0, 0.04, 0.38, 0.08, kind === 'duster' ? 0.68 : 0.5],
                [-0.26, -0.05, 0.22, 0.07, 0.23],
                [0.26, -0.05, 0.22, 0.07, 0.23],
                [0, -0.22, 0.2, 0.1, 0.08],
                [0, 0.05, 0.025, 0.1, 0.4],
              ];
      parts.forEach(([x, y, sx, sz, sy], n) =>
        this.instance(
          clothes,
          i * 5 + n,
          item.x + 0.5 + x,
          item.z + 0.08,
          item.y + 0.5 + y,
          sx,
          sz,
          sy,
          n === 4 ? 0xeadfc7 : color,
        ),
      );
    });
    this.finish(clothes);
    const weapons = loose.filter((item) => item.resource === 'weapon' && item.weapon);
    const weaponModels = this.batch(
      'loose-weapons',
      weapons.length * 4,
      this.box,
      this.batchMaterial('loose-weapons'),
    );
    const forbidden = this.batch(
      'weapon-forbidden',
      weapons.length * 2,
      this.box,
      this.effectMaterial('weapon-forbidden', 0.85),
    );
    this.inspectBatches.set(weaponModels, { cells: weapons, instancesPerCell: 4 });
    this.inspectBatches.set(forbidden, { cells: weapons, instancesPerCell: 2 });
    weapons.forEach((item, i) => {
      const kind = item.weapon!.kind;
      const yaw = 0.28;
      WEAPON_MODEL_PARTS[kind].forEach(([x, y, z, sx, sy, sz, color], n) => {
        const along = z - WEAPON_MODEL_CENTER[kind];
        this.instance(
          weaponModels,
          i * 4 + n,
          item.x + 0.5 + (x * Math.cos(yaw) + along * Math.sin(yaw)) * 0.82,
          item.z + 0.12 + y * 0.82,
          item.y + 0.5 + (along * Math.cos(yaw) - x * Math.sin(yaw)) * 0.82,
          sx * 0.82,
          sy * 0.82,
          sz * 0.82,
          color,
          yaw,
        );
      });
      for (let n = 0; n < 2; n++)
        this.instance(
          forbidden,
          i * 2 + n,
          item.x + 0.78,
          item.z + 0.16,
          item.y + 0.22,
          item.forbidden ? 0.25 : 0,
          item.forbidden ? 0.025 : 0,
          item.forbidden ? 0.04 : 0,
          0xe76d63,
          n ? Math.PI / 4 : -Math.PI / 4,
        );
    });
    this.finish(weaponModels);
    this.finish(forbidden);
    const stock = this.data.stockpiles.filter((pos) => pos.z === this.level);
    const storage = this.batch('stock', stock.length, this.box, this.batchMaterial('stock', true));
    stock.forEach((pos, i) =>
      this.instance(storage, i, pos.x + 0.5, pos.z + 0.026, pos.y + 0.5, 0.9, 0.04, 0.9, 0x70bbac),
    );
    this.finish(storage);
    this.updateFarming();
    this.updateStonecutters();
    this.updateTailors();
    this.updateResearchBenches();
    this.updateWeaponBenches();
    this.updateSandbags();
    this.updateHousing();
    this.updatePower();
    this.updateJobLines();
  }

  /** Local device x/y follow the footprint contract; axis y exchanges those axes. */
  private devicePart(
    device: Device,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    color: number,
    tilt = 0,
  ): DevicePart {
    const alongX = device.axis === 'x';
    return {
      cell: device,
      x: device.x + (alongX ? x : y),
      y: device.y + (alongX ? y : x),
      z: device.z + z,
      sx: alongX ? sx : sy,
      sy: alongX ? sy : sx,
      sz,
      color,
      pitch: alongX ? tilt : 0,
      roll: alongX ? 0 : -tilt,
    };
  }

  private deviceBatch(
    name: string,
    parts: DevicePart[],
    geometry: BufferGeometry = this.box,
    effect = false,
    opacity = 1,
    inspectable = true,
  ) {
    const mesh = this.batch(
      name,
      parts.length,
      geometry,
      effect ? this.effectMaterial(name, opacity) : this.batchMaterial(name),
    );
    parts.forEach((p, i) =>
      this.instance(
        mesh,
        i,
        p.x,
        p.z,
        p.y,
        p.sx,
        p.sz,
        p.sy,
        p.color,
        p.yaw ?? 0,
        p.pitch ?? 0,
        p.roll ?? 0,
      ),
    );
    this.finish(mesh);
    if (inspectable)
      this.inspectBatches.set(mesh, { cells: parts.map((p) => p.cell), instancesPerCell: 1 });
    return mesh;
  }

  private updatePower() {
    if (!this.data) return;
    const bodies: DevicePart[] = [],
      cylinders: DevicePart[] = [],
      lights: DevicePart[] = [];
    for (const d of this.data.devices ?? []) {
      if (d.z > this.level) continue;
      const add = (
        x: number,
        y: number,
        z: number,
        sx: number,
        sy: number,
        sz: number,
        color: number,
        tilt = 0,
      ) => bodies.push(this.devicePart(d, x, y, z, sx, sy, sz, color, tilt));
      const light = (
        x: number,
        y: number,
        z: number,
        sx: number,
        sy: number,
        sz: number,
        color: number,
      ) => lights.push(this.devicePart(d, x, y, z, sx, sy, sz, color));
      const status = !d.on ? 0x71817c : d.active ? 0xa4e4a4 : d.powered ? 0xdcca7c : 0xd47562;
      if (d.kind === 'generator') {
        add(1, 1, 0.13, 1.9, 1.9, 0.24, 0x556464);
        add(1, 0.95, 0.61, 1.6, 1.45, 0.76, 0x697d70);
        add(1.32, 0.84, 1.03, 0.76, 0.8, 0.14, 0x303e42);
        add(0.45, 0.25, 0.62, 0.53, 0.07, 0.43, 0x374447);
        add(0.45, 0.2, 0.62, 0.32, 0.05, 0.26, 0x9a724e);
        for (let rib = 0; rib < 4; rib++)
          add(0.71 + rib * 0.24, 1.69, 0.64, 0.12, 0.08, 0.49, 0x465854);
        cylinders.push(this.devicePart(d, 0.42, 1.48, 1.25, 0.26, 0.26, 1.1, 0x445052));
        cylinders.push(this.devicePart(d, 0.42, 1.48, 1.82, 0.36, 0.36, 0.08, 0x2d3c3e));
        light(1.6, 0.19, 0.78, 0.17, 0.06, 0.13, status);
      } else if (d.kind === 'solar') {
        const tilt = 0.22;
        for (const x of [0.4, 3.6])
          for (const y of [0.4, 3.6]) {
            const height = 1.05 - (y - 2) * Math.sin(tilt);
            add(x, y, height / 2, 0.12, 0.12, height, 0x6d7c80);
          }
        add(2, 2, 1.06, 3.84, 3.84, 0.14, 0xa0aaa3, tilt);
        for (let row = 0; row < 4; row++)
          for (let col = 0; col < 4; col++) {
            const x = 0.63 + col * 0.91,
              y = 0.63 + row * 0.91;
            const height = 1.145 - (y - 2) * Math.sin(tilt);
            add(x, y, height, 0.84, 0.84, 0.028, (row + col) % 2 ? 0x315a77 : 0x3b6c88, tilt);
            add(x, y, height + 0.025, 0.022, 0.83, 0.012, 0x7498a4, tilt);
          }
        light(3.74, 3.74, 0.82, 0.11, 0.11, 0.09, status);
      } else if (d.kind === 'battery') {
        const ratio = MathUtils.clamp(d.energy / BATTERY_CAPACITY, 0, 1);
        add(0.5, 1, 0.12, 0.94, 1.9, 0.2, 0x576667);
        add(0.5, 1, 0.62, 0.8, 1.76, 0.86, 0x637e7a);
        add(0.5, 1, 1.07, 0.86, 1.8, 0.1, 0x93a59b);
        add(0.5, 1, 1.13, 0.58, 1.42, 0.035, 0x283d42);
        // The bar measures stored Wd against the same capacity used by the simulation.
        if (ratio > 0)
          light(
            0.5,
            0.32 + ratio * 0.68,
            1.155,
            0.48,
            1.36 * ratio,
            0.025,
            ratio < 0.2 ? 0xe4b56d : 0x7fc9b5,
          );
        add(0.22, 0.17, 1.18, 0.14, 0.14, 0.12, 0xae6450);
        add(0.78, 0.17, 1.18, 0.14, 0.14, 0.12, 0x3b4547);
        light(0.5, 1.83, 1.14, 0.16, 0.1, 0.07, status);
      } else if (d.kind === 'heater') {
        add(0.5, 0.5, 0.12, 0.9, 0.86, 0.2, 0x6e7973);
        add(0.5, 0.48, 0.48, 0.78, 0.7, 0.58, 0xb7aa8a);
        add(0.5, 0.845, 0.47, 0.65, 0.05, 0.42, 0x493c34);
        for (let rib = 0; rib < 4; rib++)
          add(0.5, 0.884, 0.29 + rib * 0.12, 0.67, 0.035, 0.035, 0x9c9277);
        light(0.72, 0.78, 0.77, 0.11, 0.1, 0.06, status);
      } else {
        add(0.5, 0.5, 1, 0.94, 0.86, 1.96, 0x9baaa6);
        add(0.5, 0.5, 1.94, 0.98, 0.92, 0.12, 0x6a807e);
        // Local negative x is the cold side; axis y exchanges x/y exactly once.
        add(0.015, 0.5, 1.1, 0.06, 0.68, 1.18, 0x679eb3);
        add(0.985, 0.5, 1.1, 0.06, 0.68, 1.18, 0xb88762);
        for (let rib = 0; rib < 5; rib++) {
          add(-0.025, 0.5, 0.65 + rib * 0.22, 0.025, 0.57, 0.065, 0xc7dedb);
          add(1.025, 0.5, 0.65 + rib * 0.22, 0.025, 0.57, 0.065, 0x6e5c4b);
        }
        // Top strips keep cold/hot orientation readable when the far face is occluded.
        light(0.18, 0.5, 2.01, 0.18, 0.65, 0.025, 0x83c1d4);
        light(0.82, 0.5, 2.01, 0.18, 0.65, 0.025, 0xe2a773);
        light(0.5, 0.5, 2.015, 0.16, 0.17, 0.045, status);
      }
    }
    this.deviceBatch('device-body', bodies);
    this.deviceBatch('device-cylinders', cylinders, this.potGeometry);
    this.deviceBatch('device-lights', lights, this.box, true);
    this.updateWires();
  }

  private updateWires() {
    const all = this.data?.wires ?? [],
      nodes = new Set(all.map((p) => index(p.x, p.y, p.z)));
    for (const d of this.data?.devices ?? [])
      if (['generator', 'solar', 'battery'].includes(d.kind))
        for (const p of deviceCells(d)) nodes.add(index(p.x, p.y, p.z));
    const height = (p: Pos) =>
      p.z + (this.block(p.x, p.y, p.z) ? (p.z === this.level ? 0.585 : 1.025) : 0.055);
    const pieces: {
      cell: Pos;
      x: number;
      y: number;
      z: number;
      dx: number;
      dy: number;
      dz: number;
    }[] = [];
    for (const p of all) {
      if (p.z > this.level) continue;
      const z = height(p);
      pieces.push({ cell: p, x: p.x + 0.5, y: p.y + 0.5, z, dx: 0, dy: 0, dz: 0 });
      for (const [dx, dy, dz] of [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ]) {
        const q = { x: p.x + dx, y: p.y + dy, z: p.z + dz };
        if (
          q.x < 0 ||
          q.x >= WIDTH ||
          q.y < 0 ||
          q.y >= DEPTH ||
          q.z < 0 ||
          q.z >= HEIGHT ||
          !nodes.has(index(q.x, q.y, q.z))
        )
          continue;
        const rise = (height(q) - z) / 2;
        pieces.push({
          cell: p,
          x: p.x + 0.5 + dx / 4,
          y: p.y + 0.5 + dy / 4,
          z: z + rise / 2,
          dx: dx / 2,
          dy: dy / 2,
          dz: rise,
        });
      }
    }
    const mesh = this.batch(
      'power-wires',
      pieces.length,
      this.box,
      this.batchMaterial('power-wires'),
    );
    this.inspectBatches.set(mesh, { cells: pieces.map((p) => p.cell), instancesPerCell: 1 });
    pieces.forEach((p, i) => {
      const length = Math.hypot(p.dx, p.dy, p.dz);
      this.translation.set(p.x, p.z, p.y);
      this.scale.set(length ? 0.055 : 0.13, length || 0.065, length ? 0.055 : 0.13);
      this.quaternion.identity();
      if (length)
        this.quaternion.setFromUnitVectors(
          UP,
          this.beamDirection.set(p.dx, p.dz, p.dy).normalize(),
        );
      this.matrix.compose(this.translation, this.quaternion, this.scale);
      mesh.setMatrixAt(i, this.matrix);
      this.color.setHex(length ? 0xc69b5c : 0xe4c788);
      mesh.setColorAt(i, this.color);
    });
    this.finish(mesh);
  }

  private animateDevices() {
    const time = (this.data?.tick ?? 0) / TPS;
    const rotors: DevicePart[] = [],
      smoke: DevicePart[] = [],
      heat: DevicePart[] = [],
      air: DevicePart[] = [];
    for (const d of this.data?.devices ?? []) {
      if (d.z > this.level || !d.on || !d.active) continue;
      if (d.kind === 'generator') {
        for (let blade = 0; blade < 2; blade++) {
          const rotor = this.devicePart(d, 1.32, 0.84, 1.12, 0.63, 0.09, 0.045, 0xaebbaa);
          rotor.yaw = time * 5 + (blade * Math.PI) / 2;
          rotors.push(rotor);
        }
        for (let puff = 0; puff < 4; puff++) {
          const phase = (time * 0.35 + puff * 0.25 + d.id * 0.13) % 1,
            size = 0.08 + phase * 0.16;
          smoke.push(
            this.devicePart(
              d,
              0.42 + phase * 0.19,
              1.48,
              1.88 + phase * 0.9,
              size,
              size,
              size * 0.8,
              0xabb2a8,
            ),
          );
        }
      } else if (d.kind === 'heater') {
        const pulse = 0.8 + Math.sin(time * 3 + d.id) * 0.2;
        for (let rib = 0; rib < 3; rib++)
          heat.push(
            this.devicePart(d, 0.5, 0.875, 0.35 + rib * 0.12, 0.56 * pulse, 0.025, 0.07, 0xef9a50),
          );
      } else if (d.kind === 'cooler') {
        for (let side = 0; side < 2; side++)
          for (let i = 0; i < 3; i++) {
            const phase = (time * 0.65 + i / 3 + d.id * 0.19) % 1,
              size = 0.045 + (1 - phase) * 0.035;
            air.push(
              this.devicePart(
                d,
                side ? 1.08 + phase * 0.6 : -0.08 - phase * 0.6,
                0.5 + Math.sin(i * 2) * 0.17,
                1.15 + (side ? phase * 0.25 : -phase * 0.08),
                size * 1.7,
                size,
                size,
                side ? 0xe8b77f : 0xa3d8e5,
              ),
            );
          }
      }
    }
    this.deviceBatch('generator-rotors', rotors);
    this.deviceBatch('generator-smoke', smoke, this.smokeGeometry, true, 0.25, false);
    this.deviceBatch('heater-glow', heat, this.box, true, 1, false);
    this.deviceBatch('cooler-air', air, this.smokeGeometry, true, 0.5, false);
  }

  private updateHousing() {
    if (!this.data) return;
    const beds = (this.data.beds ?? []).filter((bed) => bed.z <= this.level);
    const bedParts = this.batch(
      'bed-body',
      beds.length * 12,
      this.box,
      this.batchMaterial('bed-body'),
    );
    // Every visible part, including the foot tile, resolves to the bed's anchor.
    this.inspectBatches.set(bedParts, { cells: beds, instancesPerCell: 12 });
    beds.forEach((bed, i) => {
      const owner = this.data!.pawns.find((pawn) => pawn.id === bed.owner);
      const accent = bed.medical ? 0x81bdc4 : (owner?.color ?? 0x84958a);
      const part = (
        n: number,
        width: number,
        along: number,
        z: number,
        sw: number,
        sl: number,
        sz: number,
        color: number,
      ) => {
        const alongX = bed.axis === 'x';
        this.instance(
          bedParts,
          i * 12 + n,
          bed.x + (alongX ? along : width),
          bed.z + z,
          bed.y + (alongX ? width : along),
          alongX ? sl : sw,
          sz,
          alongX ? sw : sl,
          color,
        );
      };
      part(0, 0.5, 1, 0.26, 0.86, 1.88, 0.16, 0x936c46);
      part(1, 0.5, 1, 0.39, 0.76, 1.74, 0.16, 0xe3d6b3);
      part(2, 0.5, 0.35, 0.5, 0.57, 0.36, 0.08, 0xf1e6cc);
      part(3, 0.5, 1.22, 0.49, 0.77, 1.2, 0.05, accent);
      part(4, 0.5, 0.08, 0.43, 0.9, 0.12, 0.68, 0x9e774e);
      part(5, 0.5, 1.92, 0.31, 0.9, 0.12, 0.44, 0xa17b53);
      part(6, 0.5, 0.075, 0.68, 0.64, 0.13, 0.07, accent);
      part(7, 0.1, 1, 0.3, 0.07, 1.78, 0.18, 0x765b40);
      for (let leg = 0; leg < 4; leg++)
        part(
          8 + leg,
          0.15 + (leg % 2) * 0.7,
          0.18 + Math.floor(leg / 2) * 1.64,
          0.12,
          0.13,
          0.13,
          0.24,
          0x765b40,
        );
    });
    this.finish(bedParts);

    const doors = (this.data.doors ?? []).filter((door) => door.z <= this.level);
    const doorParts = this.batch(
      'door-body',
      doors.length * 7,
      this.box,
      this.batchMaterial('door-body'),
    );
    this.inspectBatches.set(doorParts, { cells: doors, instancesPerCell: 7 });
    doors.forEach((door, i) => {
      // Door state is authoritative simulation state, never extrapolated wall time.
      const open =
        door.mode === 'open' || (door.mode === 'auto' && this.data!.tick <= door.openUntil);
      const locked = door.mode === 'locked';
      const part = (
        n: number,
        along: number,
        across: number,
        z: number,
        sl: number,
        sw: number,
        sz: number,
        color: number,
      ) => {
        const alongX = door.axis === 'x';
        this.instance(
          doorParts,
          i * 7 + n,
          door.x + (alongX ? along : across),
          door.z + z,
          door.y + (alongX ? across : along),
          alongX ? sl : sw,
          sz,
          alongX ? sw : sl,
          color,
        );
      };
      part(0, 0.09, 0.5, 0.96, 0.14, 0.22, 1.92, 0x7d664b);
      part(1, 0.91, 0.5, 0.96, 0.14, 0.22, 1.92, 0x7d664b);
      part(2, 0.5, 0.5, 1.93, 0.96, 0.26, 0.14, 0xa48b62);
      part(
        3,
        open ? 0.19 : 0.5,
        open ? 0.81 : 0.5,
        0.91,
        open ? 0.13 : 0.66,
        open ? 0.66 : 0.13,
        1.78,
        locked ? 0x8c5546 : 0xb48a59,
      );
      part(
        4,
        open ? 0.19 : 0.5,
        open ? 0.81 : 0.5,
        1.34,
        open ? 0.145 : 0.5,
        open ? 0.5 : 0.145,
        0.08,
        locked ? 0x693f39 : 0x8b6e4e,
      );
      part(
        5,
        open ? 0.28 : 0.72,
        open ? 1.02 : 0.6,
        0.91,
        locked ? 0.14 : 0.08,
        0.09,
        locked ? 0.18 : 0.08,
        locked ? 0xd9a163 : 0xe4c57e,
      );
      part(6, 0.5, 0.65, 1.94, 0.2, 0.045, 0.07, locked ? 0xe48470 : open ? 0x90d1a0 : 0xdfbf7b);
    });
    this.finish(doorParts);
  }

  private updateFarming() {
    if (!this.data) return;
    const groves = this.data.treePlots.filter((plot) => plot.z === this.level);
    const markers = this.batch(
      'grove-markers',
      groves.length * 4,
      this.box,
      this.batchMaterial('grove-markers'),
    );
    this.inspectBatches.set(markers, { cells: groves, instancesPerCell: 4 });
    groves.forEach((plot, i) => {
      for (let edge = 0; edge < 4; edge++) {
        const horizontal = edge < 2;
        const offset = edge % 2 === 0 ? 0.07 : 0.93;
        this.instance(
          markers,
          i * 4 + edge,
          plot.x + (horizontal ? 0.5 : offset),
          plot.z + 0.035,
          plot.y + (horizontal ? offset : 0.5),
          horizontal ? 0.9 : 0.055,
          0.035,
          horizontal ? 0.055 : 0.9,
          plot.species === 'pine' ? 0x74aca4 : plot.species === 'saguaro' ? 0xb6b178 : 0x9bbb71,
        );
      }
    });
    this.finish(markers);
    const farms = (this.data.farms ?? []).filter((plot) => plot.z === this.level);
    const furrows = this.batch(
      'farm-soil',
      farms.length * 4,
      this.box,
      this.batchMaterial('farm-soil'),
    );
    this.inspectBatches.set(furrows, { cells: farms, instancesPerCell: 4 });
    farms.forEach((plot, i) => {
      this.instance(
        furrows,
        i * 4,
        plot.x + 0.5,
        plot.z + 0.026,
        plot.y + 0.5,
        0.96,
        0.045,
        0.96,
        0x77543a,
      );
      for (let row = 0; row < 3; row++)
        this.instance(
          furrows,
          i * 4 + row + 1,
          plot.x + 0.23 + row * 0.27,
          plot.z + 0.068,
          plot.y + 0.5,
          0.14,
          0.055,
          0.86,
          0x92704c,
        );
    });
    this.finish(furrows);

    // These dimensions and colors are visual interpolation, not crop growth rules.
    const parts: {
      cell: Pos;
      x: number;
      z: number;
      y: number;
      sx: number;
      sz: number;
      sy: number;
      color: number;
      yaw: number;
    }[] = [];
    const add = (
      cell: Pos,
      x: number,
      z: number,
      y: number,
      sx: number,
      sz: number,
      sy: number,
      color: number,
      yaw = 0,
    ) => parts.push({ cell, x: cell.x + x, z: cell.z + z, y: cell.y + y, sx, sz, sy, color, yaw });
    for (const crop of this.data.crops ?? []) {
      if (crop.z !== this.level) continue;
      const growth = MathUtils.clamp(crop.growth, 0, 1),
        size = 0.16 + growth * 0.84;
      if (crop.kind === 'rice') {
        const stemHeight = 0.57 * size;
        const grainColor = this.color
          .setHex(0x8da357)
          .lerp(new Color(0xe0c776), growth * growth)
          .getHex();
        for (let sprig = 0; sprig < 5; sprig++) {
          const angle = (sprig * Math.PI * 2) / 5,
            x = 0.5 + Math.cos(angle) * 0.22,
            y = 0.5 + Math.sin(angle) * 0.22;
          add(crop, x, 0.09 + stemHeight / 2, y, 0.035, stemHeight, 0.035, 0x6e9149);
          add(
            crop,
            x + 0.015,
            0.08 + stemHeight,
            y,
            0.065 * size,
            0.18 * size,
            0.065 * size,
            grainColor,
            angle,
          );
        }
      } else if (crop.kind === 'potato') {
        for (let leaf = 0; leaf < 5; leaf++) {
          const angle = (leaf * Math.PI * 2) / 5;
          add(
            crop,
            0.5 + Math.cos(angle) * 0.19 * size,
            0.09 + (0.11 + (leaf % 2) * 0.07) * size,
            0.5 + Math.sin(angle) * 0.19 * size,
            0.34 * size,
            0.13 * size,
            0.23 * size,
            leaf % 2 ? 0x568344 : 0x6d984b,
            angle,
          );
        }
        const blossom = Math.max(0.001, (growth - 0.55) / 0.45) * 0.075;
        for (let flower = 0; flower < 3; flower++)
          add(
            crop,
            0.34 + flower * 0.16,
            0.13 + 0.25 * size,
            0.45 + (flower % 2) * 0.12,
            blossom,
            blossom * 0.5,
            blossom,
            0xece2bd,
          );
      } else if (crop.kind === 'cotton') {
        add(crop, 0.5, 0.1 + 0.3 * size, 0.5, 0.055, 0.6 * size, 0.055, 0x718248);
        for (let n = 0; n < 4; n++) {
          const angle = (n * Math.PI) / 2;
          const x = 0.5 + Math.cos(angle) * 0.2 * size,
            y = 0.5 + Math.sin(angle) * 0.2 * size;
          add(
            crop,
            x,
            0.12 + (0.25 + (n % 2) * 0.18) * size,
            y,
            0.27 * size,
            0.1 * size,
            0.18 * size,
            0x6c9153,
            angle,
          );
          const boll = Math.max(0.001, (growth - 0.45) / 0.55) * 0.21;
          add(crop, x, 0.22 + (0.25 + (n % 2) * 0.18) * size, y, boll, boll * 0.85, boll, 0xf1ead9);
        }
      } else {
        const stalkHeight = 1.05 * size;
        add(crop, 0.5, 0.09 + stalkHeight / 2, 0.5, 0.055, stalkHeight, 0.055, 0x759447);
        for (let leaf = 0; leaf < 4; leaf++) {
          const angle = (leaf * Math.PI) / 2;
          add(
            crop,
            0.5 + Math.cos(angle) * 0.17 * size,
            0.09 + stalkHeight * (0.35 + leaf * 0.12),
            0.5 + Math.sin(angle) * 0.17 * size,
            0.42 * size,
            0.045 * size,
            0.1 * size,
            leaf % 2 ? 0x779a45 : 0x60883e,
            -angle,
          );
        }
        const ear = Math.max(0.001, (growth - 0.4) / 0.6);
        for (let side = 0; side < 2; side++)
          add(
            crop,
            0.5 + (side ? -0.09 : 0.09),
            0.09 + stalkHeight * (0.68 + side * 0.13),
            0.5,
            0.12 * ear,
            0.23 * ear,
            0.12 * ear,
            growth === 1 ? 0xf0c954 : 0xb9bc5b,
          );
      }
    }
    const plants = this.batch(
      'crop-parts',
      parts.length,
      this.box,
      this.batchMaterial('crop-parts'),
    );
    this.inspectBatches.set(plants, { cells: parts.map((part) => part.cell), instancesPerCell: 1 });
    parts.forEach((part, i) =>
      this.instance(
        plants,
        i,
        part.x,
        part.z,
        part.y,
        part.sx,
        part.sz,
        part.sy,
        part.color,
        part.yaw,
      ),
    );
    this.finish(plants);

    const stoves = (this.data.stoves ?? []).filter((stove) => stove.z <= this.level);
    const masonry = this.batch(
      'stove-body',
      stoves.length * 6,
      this.box,
      this.batchMaterial('stove-body'),
    );
    const pots = this.batch(
      'stove-pots',
      stoves.length * 2,
      this.potGeometry,
      this.batchMaterial('stove-pots'),
    );
    this.inspectBatches.set(masonry, { cells: stoves, instancesPerCell: 6 });
    this.inspectBatches.set(pots, { cells: stoves, instancesPerCell: 2 });
    stoves.forEach((stove, i) => {
      const body = (
        part: number,
        x: number,
        z: number,
        y: number,
        sx: number,
        sz: number,
        sy: number,
        color: number,
      ) =>
        this.instance(
          masonry,
          i * 6 + part,
          stove.x + x,
          stove.z + z,
          stove.y + y,
          sx,
          sz,
          sy,
          color,
        );
      body(0, 0.5, 0.34, 0.5, 0.76, 0.64, 0.68, 0x8f8171);
      body(1, 0.5, 0.69, 0.5, 0.84, 0.08, 0.76, 0x48565b);
      body(2, 0.5, 0.33, 0.849, 0.34, 0.25, 0.025, 0x273136);
      body(3, 0.27, 0.32, 0.855, 0.1, 0.38, 0.07, 0xb88b69);
      body(4, 0.73, 0.32, 0.855, 0.1, 0.38, 0.07, 0xb88b69);
      body(5, 0.5, 0.93, 0.5, 0.12, 0.06, 0.08, 0x313d43);
      this.instance(
        pots,
        i * 2,
        stove.x + 0.5,
        stove.z + 0.8,
        stove.y + 0.5,
        0.44,
        0.18,
        0.44,
        0x45545b,
      );
      this.instance(
        pots,
        i * 2 + 1,
        stove.x + 0.5,
        stove.z + 0.9,
        stove.y + 0.5,
        0.48,
        0.035,
        0.48,
        0x819293,
      );
    });
    this.finish(masonry);
    this.finish(pots);
  }

  private updateStonecutters() {
    if (!this.data) return;
    const tables = (this.data.stonecutters ?? []).filter((s) => s.z <= this.level);
    const bodies = this.batch(
      'stonecutter-body',
      tables.length * 9,
      this.box,
      this.batchMaterial('stonecutter-body'),
    );
    const chunks = this.batch(
      'stonecutter-rock',
      tables.length,
      this.smokeGeometry,
      this.batchMaterial('stonecutter-rock'),
    );
    const markers = this.batch(
      'stonecutter-operating-cell',
      tables.length,
      this.box,
      this.batchMaterial('stonecutter-operating-cell', true),
    );
    this.inspectBatches.set(bodies, { cells: tables, instancesPerCell: 9 });
    this.inspectBatches.set(chunks, { cells: tables, instancesPerCell: 1 });
    tables.forEach((table, i) => {
      const part = (
        n: number,
        x: number,
        y: number,
        z: number,
        sx: number,
        sy: number,
        sz: number,
        color: number,
      ) => {
        const swapped = table.axis === 'y';
        this.instance(
          bodies,
          i * 9 + n,
          table.x + (swapped ? y : x),
          table.z + z,
          table.y + (swapped ? x : y),
          swapped ? sy : sx,
          sz,
          swapped ? sx : sy,
          color,
        );
      };
      part(0, 1.5, 0.5, 0.76, 2.85, 0.86, 0.18, 0xaf8657);
      part(1, 0.2, 0.2, 0.35, 0.16, 0.16, 0.7, 0x6f563d);
      part(2, 2.8, 0.2, 0.35, 0.16, 0.16, 0.7, 0x6f563d);
      part(3, 0.2, 0.8, 0.35, 0.16, 0.16, 0.7, 0x6f563d);
      part(4, 2.8, 0.8, 0.35, 0.16, 0.16, 0.7, 0x6f563d);
      part(5, 1.5, 0.2, 0.35, 2.6, 0.12, 0.12, 0x6f563d);
      part(6, 1.5, 0.8, 0.35, 2.6, 0.12, 0.12, 0x6f563d);
      part(7, 1.5, 0.5, 0.87, 1.05, 0.7, 0.05, 0x5c7078);
      part(8, 2.55, 0.55, 0.92, 0.12, 0.5, 0.1, 0xc6d1d4);
      const hasInput = this.data!.jobs.some(
        (j) =>
          j.kind === 'stonecut' &&
          j.x === table.x &&
          j.y === table.y &&
          j.z === table.z &&
          (j.delivered.chunk ?? 0) > 0,
      );
      const center = stonecutterCells(table)[1];
      this.instance(
        chunks,
        i,
        center.x + 0.5,
        table.z + 1.05,
        center.y + 0.5,
        hasInput ? 0.3 : 0,
        hasInput ? 0.2 : 0,
        hasInput ? 0.3 : 0,
        RESOURCE_COLORS.chunk,
        0.25,
      );
      const front = stonecutterInteraction(table);
      this.instance(
        markers,
        i,
        front.x + 0.5,
        front.z + 0.02,
        front.y + 0.5,
        0.8,
        0.025,
        0.8,
        0xd4b876,
      );
    });
    this.finish(bodies);
    this.finish(chunks);
    this.finish(markers);
  }

  private updateTailors() {
    if (!this.data) return;
    const tables = this.data.tailors.filter((t) => t.z <= this.level);
    const bodies = this.batch(
      'tailor-body',
      tables.length * 11,
      this.box,
      this.batchMaterial('tailor-body'),
    );
    const markers = this.batch(
      'tailor-operating-cell',
      tables.length,
      this.box,
      this.batchMaterial('tailor-operating-cell', true),
    );
    this.inspectBatches.set(bodies, { cells: tables, instancesPerCell: 11 });
    tables.forEach((table, i) => {
      const active = this.data!.jobs.some(
        (j) =>
          j.kind === 'tailoring' &&
          j.x === table.x &&
          j.y === table.y &&
          j.z === table.z &&
          (j.delivered.cloth ?? 0) > 0,
      );
      const parts = [
        [1.5, 0.5, 0.76, 2.85, 0.88, 0.16, 0xb18a5e],
        [0.2, 0.2, 0.35, 0.15, 0.15, 0.7, 0x765b42],
        [2.8, 0.2, 0.35, 0.15, 0.15, 0.7, 0x765b42],
        [0.2, 0.8, 0.35, 0.15, 0.15, 0.7, 0x765b42],
        [2.8, 0.8, 0.35, 0.15, 0.15, 0.7, 0x765b42],
        [1.5, 0.2, 0.4, 2.6, 0.12, 0.12, 0x765b42],
        [1.4, 0.5, 0.86, 1.2, 0.6, 0.035, active ? 0xe8dcc0 : 0x6e9c99],
        [0.35, 0.4, 0.96, 0.24, 0.3, 0.25, 0xe6d2b3],
        [0.68, 0.4, 0.96, 0.18, 0.3, 0.25, 0x8baca1],
        [2.5, 0.4, 0.88, 0.32, 0.07, 0.045, 0xd3d9cb],
        [2.5, 0.55, 0.88, 0.32, 0.07, 0.045, 0xd3d9cb],
      ];
      parts.forEach(([x, y, z, sx, sy, sz, color], n) => {
        const swap = table.axis === 'y';
        this.instance(
          bodies,
          i * 11 + n,
          table.x + (swap ? y : x),
          table.z + z,
          table.y + (swap ? x : y),
          swap ? sy : sx,
          sz,
          swap ? sx : sy,
          color,
        );
      });
      const front = tailorInteraction(table);
      this.instance(
        markers,
        i,
        front.x + 0.5,
        front.z + 0.02,
        front.y + 0.5,
        0.8,
        0.025,
        0.8,
        0x91b7ae,
      );
    });
    this.finish(bodies);
    this.finish(markers);
  }

  private updateResearchBenches() {
    if (!this.data) return;
    const tables = this.data.researchBenches.filter((t) => t.z <= this.level);
    const parts = [
      [1.5, 1, 0.76, 2.85, 1.85, 0.16, 0x997b59],
      [0.2, 0.2, 0.35, 0.16, 0.16, 0.7, 0x665642],
      [2.8, 0.2, 0.35, 0.16, 0.16, 0.7, 0x665642],
      [0.2, 1.8, 0.35, 0.16, 0.16, 0.7, 0x665642],
      [2.8, 1.8, 0.35, 0.16, 0.16, 0.7, 0x665642],
      [1.5, 0.2, 0.38, 2.6, 0.12, 0.12, 0x665642],
      [1.5, 1.36, 0.865, 0.98, 0.68, 0.025, 0xe7ddba],
      [1.5, 1.36, 0.884, 0.025, 0.64, 0.012, 0xa39878],
      [0.5, 0.45, 0.91, 0.55, 0.7, 0.16, 0x526c72],
      [0.5, 0.45, 1.035, 0.48, 0.64, 0.09, 0x9b745c],
      [0.5, 0.45, 1.112, 0.52, 0.66, 0.06, 0xc5b88a],
      [2.4, 0.45, 0.94, 0.28, 0.28, 0.2, 0x607d73],
      [2.15, 1.32, 0.87, 0.08, 0.54, 0.035, 0xd1b268],
      [1.2, 0.45, 0.87, 0.38, 0.55, 0.035, 0xc9c1a1],
    ];
    const bodies = this.batch(
      'research-bench-body',
      tables.length * parts.length,
      this.box,
      this.batchMaterial('research-bench-body'),
    );
    const markers = this.batch(
      'research-operating-cell',
      tables.length,
      this.box,
      this.batchMaterial('research-operating-cell', true),
    );
    this.inspectBatches.set(bodies, { cells: tables, instancesPerCell: parts.length });
    tables.forEach((table, i) => {
      const swap = table.axis === 'y';
      parts.forEach(([x, y, z, sx, sy, sz, color], n) =>
        this.instance(
          bodies,
          i * parts.length + n,
          table.x + (swap ? 2 - y : x),
          table.z + z,
          table.y + (swap ? x : y),
          swap ? sy : sx,
          sz,
          swap ? sx : sy,
          color,
        ),
      );
      const front = researchBenchInteraction(table);
      this.instance(
        markers,
        i,
        front.x + 0.5,
        front.z + 0.02,
        front.y + 0.5,
        0.8,
        0.025,
        0.8,
        0xcbbd85,
      );
    });
    this.finish(bodies);
    this.finish(markers);
  }

  private updateWeaponBenches() {
    if (!this.data) return;
    const benches = this.data.weaponBenches.filter((b) => b.z <= this.level);
    const markers = this.batch(
      'weapon-bench-operating-cell',
      benches.length,
      this.box,
      this.batchMaterial('weapon-bench-operating-cell', true),
    );
    const workpieces = this.batch(
      'weapon-bench-workpieces',
      benches.length * 4,
      this.box,
      this.batchMaterial('weapon-bench-workpieces'),
    );
    this.inspectBatches.set(workpieces, { cells: benches, instancesPerCell: 4 });
    const armorWorkpieces = this.batch(
      'armor-bench-workpieces',
      benches.length * 3,
      this.box,
      this.batchMaterial('armor-bench-workpieces'),
    );
    this.inspectBatches.set(armorWorkpieces, { cells: benches, instancesPerCell: 3 });
    for (const kind of ['craftingSpot', 'smithy', 'machining'] as const) {
      const tables = benches.filter((b) => b.kind === kind);
      const count = kind === 'craftingSpot' ? 7 : 16;
      const bodies = this.batch(
        `weapon-bench-${kind}`,
        tables.length * count,
        this.box,
        this.batchMaterial(`weapon-bench-${kind}`),
      );
      this.inspectBatches.set(bodies, { cells: tables, instancesPerCell: count });
      tables.forEach((table, i) => {
        const fuel = MathUtils.clamp(table.fuel / SMITHY_FUEL_CAPACITY, 0, 1);
        // The mat is traversable; the smithy's anvil and firebox occupy its three tiles.
        const parts =
          kind === 'craftingSpot'
            ? [
                [0.5, 0.5, 0.035, 0.88, 0.88, 0.045, 0x826b4d],
                [0.12, 0.12, 0.07, 0.18, 0.08, 0.035, 0xe0c394],
                [0.88, 0.12, 0.07, 0.18, 0.08, 0.035, 0xe0c394],
                [0.12, 0.88, 0.07, 0.18, 0.08, 0.035, 0xe0c394],
                [0.88, 0.88, 0.07, 0.18, 0.08, 0.035, 0xe0c394],
                [0.77, 0.5, 0.1, 0.055, 0.28, 0.06, 0xa78559],
                [0.77, 0.64, 0.12, 0.15, 0.08, 0.08, 0x9aadb2],
              ]
            : kind === 'machining'
              ? [
                  [1.5, 0.5, 0.83, 2.86, 0.91, 0.16, 0x698d85],
                  [0.2, 0.2, 0.4, 0.2, 0.2, 0.8, 0x405c5a],
                  [2.8, 0.2, 0.4, 0.2, 0.2, 0.8, 0x405c5a],
                  [0.2, 0.8, 0.4, 0.2, 0.2, 0.8, 0x405c5a],
                  [2.8, 0.8, 0.4, 0.2, 0.2, 0.8, 0x405c5a],
                  [0.45, 0.42, 1.12, 0.49, 0.64, 0.47, 0x4c7771],
                  [2.15, 0.48, 1.06, 0.4, 0.48, 0.36, 0x4c7771],
                  [1.36, 0.43, 1.06, 1.32, 0.12, 0.12, 0xc0d2d3],
                  [1.36, 0.65, 0.96, 1.35, 0.11, 0.09, 0x91b2b4],
                  [1.55, 0.62, 1.05, 0.4, 0.4, 0.2, 0x90a5a5],
                  [0.47, 0.42, 1.4, 0.38, 0.48, 0.07, 0xc5b776],
                  [
                    0.43,
                    0.78,
                    1.16,
                    0.12,
                    0.07,
                    0.12,
                    !table.power?.on ? 0x75827c : table.power.powered ? 0xb4e99a : 0xe48361,
                  ],
                  [2.65, 0.44, 1.01, 0.3, 0.52, 0.19, 0x526b67],
                  [2.65, 0.45, 1.14, 0.21, 0.4, 0.08, 0xc9d3cf],
                  [1.45, 0.1, 0.55, 1.4, 0.08, 0.23, 0x38514d],
                  [1.45, 0.14, 0.56, 0.32, 0.07, 0.035, 0xb3c4b9],
                ]
              : [
                  [1.5, 0.5, 0.68, 2.86, 0.88, 0.18, 0x657177],
                  [0.2, 0.2, 0.3, 0.17, 0.17, 0.6, 0x49585e],
                  [2.8, 0.2, 0.3, 0.17, 0.17, 0.6, 0x49585e],
                  [0.2, 0.8, 0.3, 0.17, 0.17, 0.6, 0x49585e],
                  [2.8, 0.8, 0.3, 0.17, 0.17, 0.6, 0x49585e],
                  [1.55, 0.5, 0.83, 0.7, 0.58, 0.14, 0x46535a],
                  [1.55, 0.5, 1, 0.32, 0.32, 0.23, 0x788a92],
                  [1.55, 0.5, 1.14, 0.88, 0.42, 0.13, 0xb0c0c4],
                  [1.04, 0.5, 1.12, 0.23, 0.2, 0.1, 0x99acb2],
                  [0.42, 0.5, 0.83, 0.65, 0.75, 0.16, 0x594e46],
                  [0.42, 0.14, 1.02, 0.65, 0.12, 0.43, 0x8a7765],
                  [0.12, 0.5, 1.02, 0.12, 0.6, 0.43, 0x8a7765],
                  [0.72, 0.5, 1.02, 0.12, 0.6, 0.43, 0x8a7765],
                  [0.42, 0.2, 1.55, 0.35, 0.3, 0.7, 0x546269],
                  [2.5, 0.5, 0.16 + fuel * 0.14, 0.6, 0.6, fuel * 0.28, 0xa47c4f],
                  [2.52, 0.5, 0.83, 0.35, 0.13, 0.09, 0xb0c0c4],
                ];
        parts.forEach(([x, y, z, sx, sy, sz, color], n) => {
          const swap = table.axis === 'y';
          this.instance(
            bodies,
            i * count + n,
            table.x + (swap ? y : x),
            table.z + z,
            table.y + (swap ? x : y),
            swap ? sy : sx,
            sz,
            swap ? sx : sy,
            color,
          );
        });
      });
      this.finish(bodies);
    }
    benches.forEach((table, i) => {
      const job = this.data!.jobs.find(
        (j) =>
          (j.kind === 'smith' || j.kind === 'armorsmith') &&
          !j.cancelled &&
          j.x === table.x &&
          j.y === table.y &&
          j.z === table.z,
      );
      const hasInput =
        !!job?.weaponKind && Object.values(job.delivered).some((amount) => amount > 0);
      const kind = job?.weaponKind ?? 'woodClub';
      WEAPON_MODEL_PARTS[kind].forEach(([x, y, z, sx, sy, sz, color], n) => {
        const localX =
          (table.kind === 'craftingSpot' ? 0.5 : 1.55) + (z - WEAPON_MODEL_CENTER[kind]) * 0.72;
        const localY = 0.5 + x * 0.72;
        const swap = table.axis === 'y';
        const scale = hasInput ? 0.72 : 0;
        this.instance(
          workpieces,
          i * 4 + n,
          table.x + (swap ? localY : localX),
          table.z + (table.kind === 'craftingSpot' ? 0.14 : 1.24) + y * scale,
          table.y + (swap ? localX : localY),
          (swap ? sx : sz) * scale,
          sy * scale,
          (swap ? sz : sx) * scale,
          color,
        );
      });
      const front = weaponBenchInteraction(table);
      const armorInput =
        job?.kind === 'armorsmith' && Object.values(job.delivered).some((n) => n > 0);
      const armorShape =
        job?.apparelKind === 'simpleHelmet'
          ? [
              [0, 0, 0.42, 0.22, 0.42],
              [0, 0, 0.5, 0.05, 0.5],
              [0, 0, 0, 0, 0],
            ]
          : [
              [0, 0, 0.43, 0.08, 0.6],
              [-0.29, 0, 0.2, 0.1, 0.25],
              [0.29, 0, 0.2, 0.1, 0.25],
            ];
      armorShape.forEach(([x, y, sx, sz, sy], n) => {
        const scale = armorInput ? 1 : 0,
          swap = table.axis === 'y';
        const lx = 1.55 + x,
          ly = 0.5 + y;
        this.instance(
          armorWorkpieces,
          i * 3 + n,
          table.x + (swap ? ly : lx),
          table.z + 1.27,
          table.y + (swap ? lx : ly),
          (swap ? sy : sx) * scale,
          sz * scale,
          (swap ? sx : sy) * scale,
          0x9bafb9,
        );
      });
      this.instance(
        markers,
        i,
        front.x + 0.5,
        front.z + 0.02,
        front.y + 0.5,
        0.82,
        0.025,
        0.82,
        table.kind === 'machining' ? 0x84bfae : table.kind === 'smithy' ? 0xd69b5b : 0xc5b683,
      );
    });
    this.finish(workpieces);
    this.finish(armorWorkpieces);
    this.finish(markers);
  }

  private updateSandbags() {
    const bags = (this.data?.sandbags ?? []).filter((bag) => bag.z <= this.level);
    const mesh = this.batch('sandbags', bags.length * 6, this.box, this.batchMaterial('sandbags'));
    this.inspectBatches.set(mesh, { cells: bags, instancesPerCell: 6 });
    bags.forEach((bag, i) => {
      for (let n = 0; n < 6; n++) {
        const top = n >= 3,
          column = n % 3;
        this.instance(
          mesh,
          i * 6 + n,
          bag.x + 0.18 + column * 0.32,
          bag.z + (top ? 0.55 : 0.2),
          bag.y + 0.5 + (top ? 0.025 : -0.025),
          0.3,
          top ? 0.34 : 0.36,
          top ? 0.76 : 0.86,
          bag.hitPoints < 100 ? 0x8a7a57 : n % 2 ? 0xbba779 : 0xcab88d,
        );
      }
    });
    this.finish(mesh);
  }

  private animateWeaponBenches(time: number, working: Set<number>) {
    const active = (this.data?.weaponBenches ?? []).filter(
      (b) => b.kind === 'smithy' && b.z <= this.level && b.fuel > 0 && working.has(b.id),
    );
    const fire = this.batch(
      'smithy-fire',
      active.length * 3,
      this.treeCrown,
      this.effectMaterial('smithy-fire', 1),
    );
    const sparks = this.batch(
      'smithy-sparks',
      active.length * 5,
      this.box,
      this.effectMaterial('smithy-sparks', 1),
    );
    active.forEach((table, i) => {
      const swap = table.axis === 'y';
      for (let n = 0; n < 3; n++) {
        const pulse = 0.8 + Math.sin(time * 9 + table.id + n * 2) * 0.2;
        const x = 0.3 + n * 0.12,
          y = 0.48;
        this.instance(
          fire,
          i * 3 + n,
          table.x + (swap ? y : x),
          table.z + 0.98,
          table.y + (swap ? x : y),
          0.075,
          0.17 * pulse,
          0.075,
          n === 1 ? 0xffe2a2 : 0xf3a249,
        );
      }
      for (let n = 0; n < 5; n++) {
        const phase = (time * 2 + n * 0.2 + table.id * 0.17) % 1;
        const angle = n * Math.PI * 0.4 + table.id;
        const x = 1.55 + Math.cos(angle) * phase * 0.48;
        const y = 0.5 + Math.sin(angle) * phase * 0.4;
        const size = (1 - phase) * 0.045;
        this.instance(
          sparks,
          i * 5 + n,
          table.x + (swap ? y : x),
          table.z + 1.24 + Math.sin(phase * Math.PI) * 0.36,
          table.y + (swap ? x : y),
          size,
          size,
          size,
          n % 2 ? 0xffd389 : 0xf6a85c,
        );
      }
    });
    this.finish(fire);
    this.finish(sparks);
    const machines = (this.data?.weaponBenches ?? []).filter(
      (b) =>
        b.kind === 'machining' &&
        b.z <= this.level &&
        b.power?.on &&
        b.power.powered &&
        working.has(b.id),
    );
    const spindles = this.batch(
      'machining-spindles',
      machines.length * 2,
      this.box,
      this.batchMaterial('machining-spindles'),
    );
    machines.forEach((table, i) => {
      for (let n = 0; n < 2; n++) {
        const swap = table.axis === 'y',
          angle = time * 8 + (n * Math.PI) / 2;
        this.instance(
          spindles,
          i * 2 + n,
          table.x + (swap ? 0.43 : 0.75),
          table.z + 1.06,
          table.y + (swap ? 0.75 : 0.43),
          0.06,
          0.32,
          0.06,
          0xd4ddcf,
          0,
          swap ? 0 : angle,
          swap ? angle : 0,
        );
      }
    });
    this.finish(spindles);
  }

  private effectMaterial(name: string, opacity: number) {
    return (
      this.batches.get(name)?.material ??
      this.keepMaterial(
        new MeshBasicMaterial({
          color: 0xffffff,
          transparent: opacity < 1,
          opacity,
          depthWrite: opacity === 1,
        }),
      )
    );
  }

  private animateStoves(time: number, working: Set<number>) {
    const active: Stove[] = (this.data?.stoves ?? []).filter(
      (stove) =>
        stove.z <= this.level && !stove.paused && working.has(index(stove.x, stove.y, stove.z)),
    );
    const fire = this.batch(
      'stove-fire',
      active.length * 3,
      this.treeCrown,
      this.effectMaterial('stove-fire', 1),
    );
    const smoke = this.batch(
      'stove-smoke',
      active.length * 4,
      this.smokeGeometry,
      this.effectMaterial('stove-smoke', 0.2),
    );
    active.forEach((stove, i) => {
      for (let flame = 0; flame < 3; flame++) {
        const pulse = 0.8 + Math.sin(time * 7 + stove.id + flame * 2) * 0.2;
        this.instance(
          fire,
          i * 3 + flame,
          stove.x + 0.4 + flame * 0.1,
          stove.z + 0.3,
          stove.y + 0.87,
          0.055,
          0.1 * pulse,
          0.035,
          flame % 2 ? 0xffe7a0 : 0xf5ab55,
        );
      }
      for (let puff = 0; puff < 4; puff++) {
        const phase = (time * 0.45 + puff * 0.25 + stove.id * 0.17) % 1;
        const size = 0.045 + Math.sin(phase * Math.PI) * 0.095;
        this.instance(
          smoke,
          i * 4 + puff,
          stove.x + 0.5 + Math.sin(time * 0.5 + puff) * phase * 0.12,
          stove.z + 0.96 + phase * 0.85,
          stove.y + 0.5 - phase * 0.1,
          size,
          size * 0.75,
          size,
          0xd6d9c9,
        );
      }
    });
    this.finish(fire);
    this.finish(smoke);
  }

  private updateLadders() {
    const positions: Pos[] = [];
    for (let z = 0; z <= Math.min(HEIGHT - 1, this.level + 1); z++) {
      for (let y = 0; y < DEPTH; y++)
        for (let x = 0; x < WIDTH; x++) {
          if (this.ladderData[index(x, y, z)]) positions.push({ x, y, z });
        }
    }
    const ladders = this.batch(
      'ladders',
      positions.length * 6,
      this.box,
      this.batchMaterial('ladders'),
    );
    positions.forEach((p, i) => {
      for (let rail = 0; rail < 2; rail++)
        this.instance(
          ladders,
          i * 6 + rail,
          p.x + 0.21 + rail * 0.58,
          p.z + 0.5,
          p.y + 0.76,
          0.085,
          1,
          0.085,
          0xcca66b,
        );
      for (let rung = 0; rung < 4; rung++)
        this.instance(
          ladders,
          i * 6 + 2 + rung,
          p.x + 0.5,
          p.z + 0.125 + rung * 0.25,
          p.y + 0.76,
          0.64,
          0.075,
          0.085,
          0xf1cd8b,
        );
    });
    this.finish(ladders);
  }

  private updateJobLines() {
    const positions: number[] = [],
      colors: number[] = [];
    const edges = [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 4],
      [0, 4],
      [1, 5],
      [2, 6],
      [3, 7],
    ];
    for (const job of this.data?.jobs ?? []) {
      const floor = job.kind === 'floor';
      const bottom = floor ? job.z - 0.06 : job.z + 0.025;
      if (job.z > this.level + 1 || job.z < this.level - 2) continue;
      const planting = job.kind === 'sow' || job.kind === 'harvest';
      const weaponBench = this.data?.weaponBenches.find(
        (b) => b.x === job.x && b.y === job.y && b.z === job.z,
      );
      const weaponBenchKind =
        job.kind === 'smithy' || job.kind === 'craftingSpot' || job.kind === 'machining'
          ? job.kind
          : job.kind === 'armorsmith'
            ? 'smithy'
            : job.kind === 'smith'
              ? job.weaponBenchKind
              : job.kind === 'refuel' || job.kind === 'remove'
                ? weaponBench?.kind
                : undefined;
      const deviceKind = Object.hasOwn(DEVICE_SIZES, job.kind)
        ? (job.kind as DeviceKind)
        : job.kind === 'refuel' && !weaponBenchKind
          ? 'generator'
          : null;
      const researchBench = this.data?.researchBenches.find(
        (b) => b.x === job.x && b.y === job.y && b.z === job.z,
      );
      const footprint = weaponBenchKind
        ? weaponBenchCells({
            ...job,
            kind: weaponBenchKind,
            axis: weaponBench?.axis ?? job.axis ?? 'x',
          })
        : deviceKind
          ? deviceCells({ ...job, kind: deviceKind, axis: job.axis ?? 'x' })
          : job.kind === 'stonecutter' || job.kind === 'stonecut'
            ? stonecutterCells({ ...job, axis: job.axis ?? 'x' })
            : job.kind === 'researchBench' ||
                job.kind === 'research' ||
                (job.kind === 'remove' && researchBench)
              ? researchBenchCells({ ...job, axis: researchBench?.axis ?? job.axis ?? 'x' })
              : job.kind === 'tailor' || job.kind === 'tailoring'
                ? tailorCells({ ...job, axis: job.axis ?? 'x' })
                : null;
      const height = weaponBenchKind
        ? weaponBenchKind === 'craftingSpot'
          ? 0.16
          : weaponBenchKind === 'machining'
            ? 1.5
            : 1.9
        : floor
          ? 0.07
          : job.kind === 'wire'
            ? 0.06
            : deviceKind
              ? { generator: 1.85, solar: 1.6, battery: 1.2, heater: 0.8, cooler: 2 }[deviceKind]
              : planting
                ? 0.14
                : job.kind === 'bed'
                  ? 0.5
                  : job.kind === 'door'
                    ? 2
                    : job.kind === 'wall'
                      ? 0.57
                      : 0.9;
      const right = footprint
        ? Math.max(...footprint.map((p) => p.x)) + 0.96
        : job.x + (job.kind === 'bed' && job.axis === 'x' ? 1.96 : 0.96);
      const back = footprint
        ? Math.max(...footprint.map((p) => p.y)) + 0.96
        : job.y + (job.kind === 'bed' && job.axis === 'y' ? 1.96 : 0.96);
      const corners = [
        [job.x + 0.04, bottom, job.y + 0.04],
        [right, bottom, job.y + 0.04],
        [right, bottom, back],
        [job.x + 0.04, bottom, back],
        [job.x + 0.04, bottom + height, job.y + 0.04],
        [right, bottom + height, job.y + 0.04],
        [right, bottom + height, back],
        [job.x + 0.04, bottom + height, back],
      ];
      this.color.setHex(
        job.reason
          ? 0xdf896c
          : ['mine', 'digLadder', 'remove'].includes(job.kind)
            ? 0xe6bf6d
            : job.kind === 'cut' || planting
              ? 0xa4cc83
              : 0x82c4cb,
      );
      for (const [a, b] of edges) {
        positions.push(...corners[a], ...corners[b]);
        colors.push(
          this.color.r,
          this.color.g,
          this.color.b,
          this.color.r,
          this.color.g,
          this.color.b,
        );
      }
    }
    this.jobLines.geometry.dispose();
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    geometry.computeBoundingSphere();
    this.jobLines.geometry = geometry;
  }

  private makePawn(pawn: Pawn): PawnVisual {
    const root = new Group();
    const body = new Group();
    root.add(body);
    const cloth = this.keepMaterial(new MeshLambertMaterial({ color: pawn.color }));
    const skin = this.keepMaterial(
      new MeshLambertMaterial({ color: [0xd9b38b, 0xe7c4a2, 0xb68a67][pawn.id % 3] }),
    );
    const dark = this.keepMaterial(new MeshLambertMaterial({ color: 0x33484b }));
    const hair = this.keepMaterial(
      new MeshLambertMaterial({ color: [0x4f4436, 0x654e36, 0x9a7047][pawn.id % 3] }),
    );
    const part = (
      parent: Group,
      material: MeshLambertMaterial,
      x: number,
      z: number,
      y: number,
      sx: number,
      sz: number,
      sy: number,
    ) => {
      const mesh = new Mesh(this.box, material);
      mesh.position.set(x, z, y);
      mesh.scale.set(sx, sz, sy);
      parent.add(mesh);
      return mesh;
    };
    const torso = part(body, cloth, 0, 0.83, 0, 0.43, 0.56, 0.3);
    const head = new Group();
    body.add(head);
    part(head, skin, 0, 1.3, 0, 0.3, 0.31, 0.29);
    part(head, hair, 0, 1.47, -0.015, 0.33, 0.12, 0.31);
    part(head, skin, 0, 1.29, 0.17, 0.11, 0.12, 0.09);
    const leftLeg = new Group(),
      rightLeg = new Group();
    leftLeg.position.set(-0.12, 0.54, 0);
    rightLeg.position.set(0.12, 0.54, 0);
    const trouser = this.keepMaterial(new MeshLambertMaterial({ color: 0x485c61 }));
    const pants = [
      part(leftLeg, trouser, 0, -0.24, 0.02, 0.16, 0.44, 0.2),
      part(rightLeg, trouser, 0, -0.24, 0.02, 0.16, 0.44, 0.2),
    ];
    const leftArm = new Group(),
      rightArm = new Group();
    leftArm.position.set(-0.3, 1.05, 0);
    rightArm.position.set(0.3, 1.05, 0);
    const shirt = [
      torso,
      part(leftArm, cloth, 0, -0.18, 0, 0.13, 0.38, 0.16),
      part(rightArm, cloth, 0, -0.18, 0, 0.13, 0.38, 0.16),
    ];
    const leftHand = part(leftArm, skin, 0, -0.4, 0, 0.12, 0.14, 0.14);
    const rightHand = part(rightArm, skin, 0, -0.4, 0, 0.12, 0.14, 0.14);
    body.add(leftLeg, rightLeg, leftArm, rightArm);
    const outer = this.keepMaterial(new MeshLambertMaterial({ color: 0x789f9b }));
    const coat = part(body, outer, 0, 0.84, 0, 0.49, 0.69, 0.37);
    const sleeves = [
      part(leftArm, outer, 0, -0.18, 0, 0.17, 0.4, 0.2),
      part(rightArm, outer, 0, -0.18, 0, 0.17, 0.4, 0.2),
    ];
    const hat = new Group();
    const wool = this.keepMaterial(new MeshLambertMaterial({ color: 0xdcd1b7 }));
    part(hat, wool, 0, 1.53, 0, 0.37, 0.18, 0.35);
    part(hat, wool, 0, 1.43, 0, 0.41, 0.07, 0.39);
    part(hat, wool, 0, 1.66, 0, 0.13, 0.12, 0.13);
    head.add(hat);
    const tool = new Group();
    tool.position.set(0, -0.44, 0.1);
    rightArm.add(tool);
    part(tool, hair, 0, 0, 0.15, 0.055, 0.055, 0.6);
    part(tool, dark, 0, 0, 0.43, 0.38, 0.1, 0.11);
    const steel = this.keepMaterial(new MeshLambertMaterial({ color: 0xd1dce0 }));
    const hammer = new Group();
    hammer.position.set(0, -0.44, 0.1);
    rightArm.add(hammer);
    part(hammer, hair, 0, 0, 0.13, 0.055, 0.055, 0.35);
    part(hammer, steel, 0, 0, 0.32, 0.21, 0.13, 0.12);
    hammer.visible = false;
    const pencil = new Group();
    pencil.position.set(0, -0.44, 0.08);
    rightArm.add(pencil);
    part(pencil, hair, 0, 0, 0.1, 0.025, 0.025, 0.28);
    part(pencil, steel, 0, 0, 0.25, 0.018, 0.018, 0.035);
    pencil.visible = false;
    const weaponMaterials = new Map<number, MeshLambertMaterial>();
    const weaponModel = (kind: WeaponKind, centered: boolean) => {
      const group = new Group();
      for (const [x, y, z, sx, sy, sz, color] of WEAPON_MODEL_PARTS[kind]) {
        let material = weaponMaterials.get(color);
        if (!material) {
          material = this.keepMaterial(new MeshLambertMaterial({ color }));
          weaponMaterials.set(color, material);
        }
        part(group, material, x, y, z - (centered ? WEAPON_MODEL_CENTER[kind] : 0), sx, sy, sz);
      }
      group.visible = false;
      return group;
    };
    const weapons = {} as Record<WeaponKind, Group>;
    const cargoWeapons = {} as Record<WeaponKind, Group>;
    for (const kind of WEAPON_KINDS) {
      const held = weaponModel(kind, false);
      held.position.set(0, -0.44, 0.1);
      rightArm.add(held);
      weapons[kind] = held;
      const carried = weaponModel(kind, true);
      carried.position.set(0, 0.72, 0.4);
      carried.rotation.y = Math.PI / 2;
      carried.scale.setScalar(0.75);
      body.add(carried);
      cargoWeapons[kind] = carried;
    }
    const cargoMaterial = this.keepMaterial(new MeshLambertMaterial({ color: 0xc69b60 }));
    const cargo = part(body, cargoMaterial, 0, 0.72, 0.39, 0.43, 0.31, 0.33);
    cargo.visible = false;
    const shadow = new Mesh(
      this.keepGeometry(new CircleGeometry(0.34, 12)),
      this.keepMaterial(
        new MeshBasicMaterial({
          color: 0x24382f,
          transparent: true,
          opacity: 0.25,
          depthWrite: false,
        }),
      ),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.022;
    root.add(shadow);
    const label = new Sprite(
      this.keepMaterial(
        new SpriteMaterial({
          map: nameTexture(pawn.name, pawn.color),
          depthTest: false,
          depthWrite: false,
        }),
      ),
    );
    label.scale.set(1.32, 0.37, 1);
    label.position.set(0, 1.91, 0);
    label.renderOrder = 12;
    root.add(label);
    const sleepSymbol = new Sprite(
      this.keepMaterial(
        new SpriteMaterial({
          map: sleepTexture(),
          depthTest: false,
          depthWrite: false,
        }),
      ),
    );
    sleepSymbol.scale.set(0.38, 0.38, 1);
    sleepSymbol.visible = false;
    sleepSymbol.renderOrder = 12;
    root.add(sleepSymbol);
    const healthMarker = new Group();
    const warning = this.keepMaterial(new MeshLambertMaterial({ color: 0xf2a16f }));
    part(healthMarker, warning, 0, 0.1, 0, 0.075, 0.2, 0.075);
    part(healthMarker, warning, 0, -0.08, 0, 0.075, 0.065, 0.075);
    healthMarker.position.set(-0.38, 1.4, 0);
    healthMarker.visible = false;
    root.add(healthMarker);
    const pos = new Vector3(pawn.x + 0.5, pawn.z, pawn.y + 0.5);
    root.position.copy(pos);
    return {
      root,
      body,
      head,
      leftHand,
      rightHand,
      torso,
      leftLeg,
      rightLeg,
      leftArm,
      rightArm,
      tool,
      hammer,
      pencil,
      weapons,
      cargoWeapons,
      cargo,
      label,
      sleepSymbol,
      healthMarker,
      apparel: { hat, coat, sleeves, shirt, pants },
      shadow,
      from: pos.clone(),
      to: pos.clone(),
      start: performance.now(),
      duration: 0,
      pawn,
    };
  }

  private removePawn(visual: PawnVisual) {
    this.scene.remove(visual.root);
    const materials = new Set<MeshLambertMaterial | MeshBasicMaterial | SpriteMaterial>();
    visual.root.traverse((object) => {
      if (object instanceof Mesh || object instanceof Sprite) {
        const material = object.material;
        if (!Array.isArray(material))
          materials.add(material as MeshLambertMaterial | MeshBasicMaterial | SpriteMaterial);
      }
    });
    for (const material of materials) {
      if (material instanceof SpriteMaterial) material.map?.dispose();
      material.dispose();
      this.materialPool.delete(material);
    }
    visual.root.traverse((object) => {
      if (object instanceof Mesh && object.geometry !== this.box) {
        object.geometry.dispose();
        this.geometryPool.delete(object.geometry);
      }
    });
  }

  /** Draw a real 3D segment, clipping only the view at the upper visible cell. */
  private combatSegment(
    mesh: InstancedMesh,
    i: number,
    from: Pos,
    to: Pos,
    width: number,
    color: number,
  ) {
    let a = from,
      b = to;
    const ceiling = this.level + 1;
    if (a.z >= ceiling && b.z >= ceiling) return false;
    if (a.z >= ceiling || b.z >= ceiling) {
      const t = (ceiling - a.z) / (b.z - a.z);
      const cut = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: ceiling };
      if (a.z >= ceiling) a = cut;
      else b = cut;
    }
    const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    if (length < 0.001) return false;
    this.translation.set((a.x + b.x) / 2, (a.z + b.z) / 2, (a.y + b.y) / 2);
    this.scale.set(width, length, width);
    this.quaternion.setFromUnitVectors(
      UP,
      this.beamDirection.set(b.x - a.x, b.z - a.z, b.y - a.y).normalize(),
    );
    this.matrix.compose(this.translation, this.quaternion, this.scale);
    mesh.setMatrixAt(i, this.matrix);
    this.color.setHex(color);
    mesh.setColorAt(i, this.color);
    return true;
  }

  private animateCombat(tick: number) {
    if (!this.data) return;
    const projectiles = this.data.projectiles ?? [];
    const trails = this.batch(
      'projectile-flight',
      projectiles.length,
      this.box,
      this.effectMaterial('projectile-flight', 0.95),
    );
    const heads = this.batch(
      'projectile-heads',
      projectiles.length,
      this.box,
      this.effectMaterial('projectile-heads', 1),
    );
    let trailCount = 0;
    let headCount = 0;
    for (const projectile of projectiles) {
      const head = projectileViewPosition(projectile, tick);
      if (head.z < this.level + 1) {
        this.instance(
          heads,
          headCount++,
          head.x,
          head.z,
          head.y,
          0.075,
          0.075,
          0.075,
          projectile.kind === 'shortBow' ? 0xd8e1d2 : 0xfff3ce,
        );
      }
      const tail = projectileViewPosition(
        projectile,
        tick - (projectile.kind === 'shortBow' ? 0.4 : 0.28),
      );
      if (
        this.combatSegment(
          trails,
          trailCount,
          tail,
          head,
          projectile.kind === 'shortBow' ? 0.045 : 0.06,
          projectile.kind === 'shortBow' ? 0xe0c79e : 0xffe4a1,
        )
      )
        trailCount++;
    }
    trails.count = trailCount;
    heads.count = headCount;
    this.finish(trails);
    this.finish(heads);

    const shooters = this.data.pawns.filter((p) => p.shooting && !p.dead && !p.downed);
    const aims = this.batch(
      'shooting-aim',
      shooters.length,
      this.box,
      this.effectMaterial('shooting-aim', 0.24),
    );
    const gauges = this.batch(
      'shooting-progress',
      shooters.length * 2,
      this.box,
      this.effectMaterial('shooting-progress', 0.85),
    );
    let aimCount = 0,
      gaugeCount = 0;
    for (const pawn of shooters) {
      const state = pawn.shooting!,
        target = this.data.pawns.find((p) => p.id === state.targetId);
      if (!target) continue;
      const from = { x: state.origin.x + 0.5, y: state.origin.y + 0.5, z: state.origin.z + 0.5 };
      const to = { x: target.x + 0.5, y: target.y + 0.5, z: target.z + 0.5 };
      if (
        this.combatSegment(
          aims,
          aimCount,
          from,
          to,
          0.018,
          pawn.faction === 'colony' ? 0xa5ddc9 : 0xe6a788,
        )
      )
        aimCount++;
      if (pawn.z > this.level) continue;
      const progress =
        state.phase === 'burst'
          ? 1
          : MathUtils.clamp(
              (tick - state.startedTick) / Math.max(1, state.nextShotTick - state.startedTick),
              0,
              1,
            );
      this.instance(
        gauges,
        gaugeCount++,
        pawn.x + 0.5,
        pawn.z + 0.035,
        pawn.y + 0.88,
        0.64,
        0.025,
        0.065,
        0x344d48,
      );
      this.instance(
        gauges,
        gaugeCount++,
        pawn.x + 0.18 + progress * 0.32,
        pawn.z + 0.055,
        pawn.y + 0.88,
        0.64 * progress,
        0.025,
        0.065,
        0xe9ce83,
      );
    }
    aims.count = aimCount;
    gauges.count = gaugeCount;
    this.finish(aims);
    this.finish(gauges);

    const events = (this.data.combatEvents ?? []).filter(
      (event) =>
        event.z <= this.level &&
        tick >= event.tick &&
        tick - event.tick < (event.kind === 'fire' ? 4 : 13),
    );
    const effects = this.batch(
      'combat-impact',
      events.length * 6,
      this.box,
      this.effectMaterial('combat-impact', 0.9),
    );
    events.forEach((event, i) => {
      const fire = event.kind === 'fire',
        t = (tick - event.tick) / (fire ? 4 : 13);
      const color = fire
        ? 0xffd38d
        : event.kind === 'hit'
          ? 0xd97861
          : event.kind === 'miss'
            ? 0xa6b5ac
            : event.kind === 'deflect'
              ? 0xaad5df
              : 0xdbbe84;
      for (let n = 0; n < 6; n++) {
        const angle = (n * Math.PI) / 3 + event.shooterId * 0.31;
        const radius = (fire ? 0.1 : 0.08) + t * (fire ? 0.15 : 0.45);
        const size = Math.max(0.015, (1 - t) * (fire ? 0.11 : 0.065));
        this.instance(
          effects,
          i * 6 + n,
          event.x + 0.5 + Math.cos(angle) * radius,
          event.z + 0.5 + Math.sin(t * Math.PI) * 0.18 + (n % 2) * 0.06,
          event.y + 0.5 + Math.sin(angle) * radius,
          size,
          size,
          size,
          color,
          angle,
        );
      }
    });
    this.finish(effects);
  }

  private animatePawns(now: number) {
    if (!this.data) return;
    // Bound extrapolation: missed snapshots never keep working forever; pause uses exact tick.
    const extraTicks =
      this.data.speed > 0
        ? Math.min(4, ((now - this.snapshotAt) / 1000) * TPS * this.data.speed)
        : 0;
    const time = (this.data.tick + extraTicks) / TPS;
    let moteCount = 0;
    const cookingCells = new Set<number>();
    const workingWeaponBenches = new Set<number>();
    for (const visual of this.pawnVisuals.values()) {
      const pawn = visual.pawn;
      visual.head.visible = !isPartMissing(pawn.trauma, 'head');
      visual.leftArm.visible = !isPartMissing(pawn.trauma, 'leftArm');
      visual.rightArm.visible = !isPartMissing(pawn.trauma, 'rightArm');
      visual.leftLeg.visible = !isPartMissing(pawn.trauma, 'leftLeg');
      visual.rightLeg.visible = !isPartMissing(pawn.trauma, 'rightLeg');
      visual.leftHand.visible = !isPartMissing(pawn.trauma, 'leftHand');
      visual.rightHand.visible = !isPartMissing(pawn.trauma, 'rightHand');
      const useLeftHand =
        partEfficiency(pawn.trauma, 'rightHand') <= 0 &&
        partEfficiency(pawn.trauma, 'leftHand') > 0;
      const toolArm = useLeftHand ? visual.leftArm : visual.rightArm;
      for (const held of [
        visual.tool,
        visual.hammer,
        visual.pencil,
        ...Object.values(visual.weapons),
      ])
        if (held.parent !== toolArm) toolArm.add(held);
      for (const kind of WEAPON_KINDS) {
        visual.weapons[kind].visible = false;
        visual.weapons[kind].rotation.x = 0;
        visual.cargoWeapons[kind].visible = false;
      }
      visual.hammer.visible = false;
      visual.pencil.visible = false;
      const visible = pawn.z <= this.level;
      visual.root.visible = visible;
      const fraction =
        visual.duration === 0 ? 1 : MathUtils.clamp((now - visual.start) / visual.duration, 0, 1);
      visual.root.position.lerpVectors(visual.from, visual.to, fraction);
      const bed =
        (pawn.phase === 'rest' || pawn.downed || pawn.dead) && pawn.sleepBedId !== null
          ? (this.data.beds ?? []).find((candidate) => candidate.id === pawn.sleepBedId)
          : undefined;
      const sleeping = !!bed && !pawn.downed && !pawn.dead;
      const lying = !!bed || pawn.downed || pawn.dead;
      visual.body.rotation.x = lying ? -Math.PI / 2 : 0;
      visual.body.position.set(0, bed ? 0.61 : lying ? 0.2 : 0, lying ? 1.1 : 0);
      visual.shadow.visible = !bed && pawn.carriedBy === null;
      visual.sleepSymbol.visible = sleeping;
      visual.healthMarker.visible = !pawn.dead && (pawn.downed || needsTending(pawn.trauma));
      visual.healthMarker.position.set(-0.38, bed ? 1.2 : 0.9, 0.5);
      visual.label.material.color.setHex(pawn.dead ? 0xaaaaaa : 0xffffff);
      visual.label.position.set(0, lying ? 1.2 : 1.91, lying ? 0.5 : 0);
      if (lying) {
        // The anchor is the head tile. Do not interpolate a lying pawn in from the doorway.
        if (bed) {
          visual.root.position.set(bed.x + 0.5, bed.z, bed.y + 0.5);
          visual.root.rotation.y = bed.axis === 'x' ? Math.PI / 2 : 0;
        }
        const sleepPhase = ((this.data.tick / TPS) * 0.5 + pawn.id * 0.23) % 1;
        visual.sleepSymbol.position.set(-0.38 + sleepPhase * 0.12, 1 + sleepPhase * 0.65, -0.12);
        visual.sleepSymbol.material.opacity = 0.5 + Math.sin(sleepPhase * Math.PI) * 0.5;
        visual.leftLeg.rotation.x = visual.rightLeg.rotation.x = 0;
        visual.leftArm.rotation.x = visual.rightArm.rotation.x = 0;
        visual.torso.rotation.x = 0;
        visual.tool.visible = false;
        visual.cargo.visible = false;
        continue;
      }
      visual.cargo.visible = !!pawn.cargo && pawn.cargo.resource !== 'weapon';
      if (pawn.cargo?.weapon) visual.cargoWeapons[pawn.cargo.weapon.kind].visible = true;
      const moving = pawn.path.length > 0 || fraction < 1;
      const working =
        pawn.phase === 'work' && pawn.path.length === 0 && !pawn.cargo && fraction >= 1;
      const job = this.data.jobs.find((candidate) => candidate.id === pawn.jobId);
      const weaponBench =
        job?.kind === 'smith' || job?.kind === 'armorsmith'
          ? this.data.weaponBenches.find((b) => b.x === job.x && b.y === job.y && b.z === job.z)
          : undefined;
      const researchBench =
        job?.kind === 'research'
          ? this.data.researchBenches.find((b) => b.x === job.x && b.y === job.y && b.z === job.z)
          : undefined;
      const researchStand = researchBench && researchBenchInteraction(researchBench);
      const researching =
        working &&
        !!researchBench &&
        !!job &&
        !job.cancelled &&
        job.owner === pawn.id &&
        job.progress > 0 &&
        job.progress < job.work &&
        job.researchProject === this.data.research.current &&
        !!researchStand &&
        pawn.x === researchStand.x &&
        pawn.y === researchStand.y &&
        pawn.z === researchStand.z;
      const workTarget = weaponBench
        ? weaponBenchCells(weaponBench)[weaponBench.kind === 'craftingSpot' ? 0 : 1]
        : researchBench
          ? {
              x: researchBench.x + (researchBench.axis === 'x' ? 1 : 0),
              y: researchBench.y + 1,
              z: researchBench.z,
            }
          : job?.kind === 'stonecut'
            ? stonecutterCells({ ...job, axis: job.axis ?? 'x' })[1]
            : job?.kind === 'tailoring'
              ? tailorCells({ ...job, axis: job.axis ?? 'x' })[1]
              : pawn.workTarget;
      const cooking = working && job?.kind === 'cook';
      const sewing = working && job?.kind === 'tailoring';
      const weaponCrafting =
        working &&
        !!weaponBench &&
        !!job &&
        job.progress < job.work &&
        (weaponBench.kind === 'craftingSpot' ||
          (weaponBench.kind === 'smithy' && weaponBench.fuel > 0) ||
          (weaponBench.kind === 'machining' &&
            !!weaponBench.power?.on &&
            weaponBench.power.powered));
      const smithing = weaponCrafting && weaponBench?.kind === 'smithy';
      const carving = weaponCrafting && weaponBench?.kind === 'craftingSpot';
      const machining = weaponCrafting && weaponBench?.kind === 'machining';
      const dressing = pawn.phase === 'apparel' && pawn.apparelTask?.stage === 'work' && !moving;
      const feeding = pawn.phase === 'care' && pawn.carePhase === 'feed' && !moving;
      const bandaging = pawn.phase === 'care' && pawn.carePhase === 'tend' && !moving;
      const opponent =
        pawn.phase === 'combat'
          ? this.data.pawns.find((p) => p.id === pawn.attackTargetId)
          : undefined;
      const fighting =
        !!opponent &&
        !moving &&
        opponent.z === pawn.z &&
        Math.abs(opponent.x - pawn.x) + Math.abs(opponent.y - pawn.y) === 1;
      const shootingTarget = pawn.shooting
        ? this.data.pawns.find((p) => p.id === pawn.shooting!.targetId)
        : undefined;
      const aiming = !!shootingTarget && !!pawn.weapon && isRangedKind(pawn.weapon.kind) && !moving;
      const carryingPatient = pawn.carryingPawnId !== null;
      const holdingWeapon =
        !!pawn.weapon &&
        !pawn.weaponDropPending &&
        !pawn.weaponTask &&
        !pawn.cargo &&
        !carryingPatient &&
        !working &&
        pawn.phase !== 'care' &&
        (pawn.drafted || pawn.faction === 'raider' || pawn.phase === 'combat');
      if (holdingWeapon) visual.weapons[pawn.weapon!.kind].visible = true;
      const tending =
        working && (job?.kind === 'sow' || job?.kind === 'plantTree' || job?.kind === 'harvest');
      if (cooking && job) cookingCells.add(index(job.x, job.y, job.z));
      if (weaponCrafting && weaponBench) workingWeaponBenches.add(weaponBench.id);
      const swing = Math.sin(time * 12 + pawn.id * 1.7);
      if (carving) visual.body.position.y = -0.16;
      visual.leftLeg.rotation.x = carving ? -0.45 : moving ? swing * 0.55 : 0;
      visual.rightLeg.rotation.x = carving ? -0.45 : moving ? -swing * 0.55 : 0;
      visual.leftArm.rotation.x = aiming
        ? -0.85
        : weaponCrafting
          ? -0.92 + Math.sin(time * 5 + pawn.id) * 0.07
          : researching || sewing || dressing || bandaging
            ? -0.9 + Math.sin(time * 5 + pawn.id) * 0.13
            : pawn.cargo || carryingPatient
              ? -0.9
              : moving
                ? -swing * 0.35
                : tending
                  ? -0.85 + swing * 0.15
                  : working
                    ? -0.45
                    : 0;
      visual.rightArm.rotation.x = aiming
        ? -0.65
        : machining
          ? -0.92 + Math.sin(time * 6) * 0.06
          : fighting
            ? -0.7 + Math.sin(time * 10 + pawn.id) * 0.85
            : smithing
              ? -0.95 + Math.sin(time * 9 + pawn.id) * 0.7
              : carving
                ? -0.98 + Math.sin(time * 6 + pawn.id) * 0.18
                : researching
                  ? -1.02 + Math.sin(time * 7 + pawn.id) * 0.055
                  : sewing || dressing || bandaging
                    ? -1 - Math.sin(time * 5 + pawn.id) * 0.18
                    : feeding
                      ? -1 + Math.sin(time * 4 + pawn.id) * 0.2
                      : pawn.cargo || carryingPatient
                        ? -0.9
                        : cooking
                          ? -0.8 + Math.sin(time * 4 + pawn.id) * 0.14
                          : tending
                            ? -0.85 - swing * 0.15
                            : working
                              ? -1.05 + swing * 0.8
                              : holdingWeapon && !moving
                                ? -0.35
                                : moving
                                  ? swing * 0.35
                                  : 0;
      if (useLeftHand) {
        const leftRotation = visual.leftArm.rotation.x;
        visual.leftArm.rotation.x = visual.rightArm.rotation.x;
        visual.rightArm.rotation.x = leftRotation;
      }
      if (aiming && shootingTarget && pawn.weapon) {
        const elevation = Math.atan2(
          shootingTarget.z - pawn.z,
          Math.hypot(shootingTarget.x - pawn.x, shootingTarget.y - pawn.y),
        );
        visual.weapons[pawn.weapon.kind].rotation.x = -toolArm.rotation.x - elevation;
      }
      visual.torso.rotation.x = carving
        ? 0.3
        : smithing
          ? 0.12 + Math.max(0, swing) * 0.06
          : researching
            ? 0.09
            : cooking
              ? 0.03
              : tending
                ? 0.2
                : working
                  ? 0.08 + Math.max(0, swing) * 0.08
                  : 0;
      visual.tool.visible =
        working && !cooking && !tending && !sewing && !weaponBench && !researchBench;
      visual.pencil.visible = researching;
      visual.hammer.visible = weaponCrafting && !machining;
      visual.hammer.scale.setScalar(carving ? 0.6 : 1);
      const patient =
        feeding || bandaging
          ? this.data.pawns.find((v) => v.id === pawn.patientId)
          : (shootingTarget ?? opponent);
      if (patient) {
        visual.root.rotation.y = Math.atan2(patient.x - pawn.x, patient.y - pawn.y);
      } else if (working && workTarget) {
        visual.root.rotation.y = Math.atan2(
          workTarget.x + 0.5 - visual.root.position.x,
          workTarget.y + 0.5 - visual.root.position.z,
        );
      } else {
        const dx = visual.to.x - visual.from.x,
          dz = visual.to.z - visual.from.z;
        if (Math.abs(dx) + Math.abs(dz) > 0.001) visual.root.rotation.y = Math.atan2(dx, dz);
      }
      if (
        visible &&
        working &&
        !cooking &&
        !sewing &&
        !weaponBench &&
        !researchBench &&
        workTarget
      ) {
        for (let j = 0; j < 4 && moteCount < 256; j++) {
          const phase = (time * 2.5 + j * 0.25 + pawn.id * 0.13) % 1;
          const angle = (j * Math.PI) / 2 + pawn.id;
          const size = (1 - phase) * 0.055;
          this.translation.set(
            workTarget.x + 0.5 + Math.cos(angle) * phase * 0.5,
            Math.min(workTarget.z + (job?.kind === 'stonecut' ? 0.95 : 0.35), this.level + 1.2) +
              Math.sin(phase * Math.PI) * 0.5,
            workTarget.y + 0.5 + Math.sin(angle) * phase * 0.5,
          );
          this.scale.setScalar(size);
          this.quaternion.identity();
          this.matrix.compose(this.translation, this.quaternion, this.scale);
          this.workMotes.setMatrixAt(moteCount++, this.matrix);
        }
      }
    }
    // A second pass makes the patient's pose follow the carrier's interpolated
    // position regardless of snapshot array order. Simulation owns both positions.
    for (const visual of this.pawnVisuals.values()) {
      const carrierId = visual.pawn.carriedBy;
      if (carrierId === null) continue;
      const carrier = this.pawnVisuals.get(carrierId);
      if (!carrier) continue;
      visual.root.position.copy(carrier.root.position);
      visual.root.rotation.y = carrier.root.rotation.y + Math.PI / 2;
      visual.body.rotation.x = -Math.PI / 2;
      visual.body.position.set(0, 1.1, 0.65);
      visual.label.position.set(0, 2.55, 0);
      visual.healthMarker.position.set(-0.4, 2.2, 0);
      visual.shadow.visible = false;
    }
    this.workMotes.count = moteCount;
    this.workMotes.instanceMatrix.needsUpdate = true;
    this.animateStoves(time, cookingCells);
    this.animateWeaponBenches(time, workingWeaponBenches);
    this.animateDevices();
    this.animateCombat(this.data.tick + extraTicks);
  }

  render() {
    if (this.disposed || this.contextLost) return;
    const now = performance.now();
    let built = 0;
    for (const id of this.dirty) {
      this.makeChunk(id);
      this.dirty.delete(id);
      built++;
      if (built >= 3 || performance.now() - now > 7) break;
    }
    if (this.ladderDirty) {
      this.updateLadders();
      this.ladderDirty = false;
    }
    if (this.entitiesDirty) {
      this.updateEntities();
      this.entitiesDirty = false;
    }
    this.animatePawns(now);
    this.renderer.render(this.scene, this.camera);
    this.frameCount++;
    if (now - this.fpsAt >= 800) {
      this.fps = (this.frameCount * 1000) / (now - this.fpsAt);
      this.frameCount = 0;
      this.fpsAt = now;
    }
  }

  metrics(): VoxelRenderMetrics {
    let vertices = 0,
      bytes = 0;
    for (const size of this.geometrySizes.values()) {
      vertices += size.vertices;
      bytes += size.bytes;
    }
    return {
      backend: 'Three.js · WebGL2',
      fps: this.fps,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      chunkCount: this.terrainMeshes.size,
      pendingChunks: this.dirty.size,
      terrainVertices: vertices,
      terrainGeometryBytes: bytes,
      gridBytes: this.blockData.byteLength + this.ladderData.byteLength,
      dpr: this.dpr,
      level: this.level,
      rotation: this.rotation,
      zoom: this.zoom,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener('webglcontextlost', this.lost);
    this.canvas.removeEventListener('webglcontextrestored', this.restored);
    for (const visual of this.pawnVisuals.values()) this.removePawn(visual);
    this.pawnVisuals.clear();
    for (const mesh of this.terrainMeshes.values()) mesh.geometry.dispose();
    for (const batch of this.batches.values()) batch.mesh.dispose();
    this.workMotes.dispose();
    this.jobLines.geometry.dispose();
    for (const geometry of this.geometryPool) geometry.dispose();
    for (const material of this.materialPool) material.dispose();
    this.terrainMaterial.dispose();
    this.grain.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.scene.clear();
    this.batches.clear();
    this.inspectBatches.clear();
    this.terrainMeshes.clear();
    this.geometrySizes.clear();
    this.loaded.clear();
    this.dirty.clear();
  }
}
