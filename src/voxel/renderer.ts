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
  leftLeg: Group;
  rightLeg: Group;
  leftArm: Group;
  rightArm: Group;
  tool: Group;
  cargo: Mesh;
  torso: Mesh;
  label: Sprite;
  sleepSymbol: Sprite;
  healthMarker: Group;
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
    const items = loose.filter((item) => item.resource !== 'chunk');
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
        const size = item.resource === 'wood' ? [0.52, 0.14, 0.16] : [0.24, 0.16, 0.28];
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
    const stock = this.data.stockpiles.filter((pos) => pos.z === this.level);
    const storage = this.batch('stock', stock.length, this.box, this.batchMaterial('stock', true));
    stock.forEach((pos, i) =>
      this.instance(storage, i, pos.x + 0.5, pos.z + 0.026, pos.y + 0.5, 0.9, 0.04, 0.9, 0x70bbac),
    );
    this.finish(storage);
    this.updateFarming();
    this.updateStonecutters();
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
      const deviceKind = Object.hasOwn(DEVICE_SIZES, job.kind)
        ? (job.kind as DeviceKind)
        : job.kind === 'refuel'
          ? 'generator'
          : null;
      const footprint = deviceKind
        ? deviceCells({ ...job, kind: deviceKind, axis: job.axis ?? 'x' })
        : job.kind === 'stonecutter' || job.kind === 'stonecut'
          ? stonecutterCells({ ...job, axis: job.axis ?? 'x' })
          : null;
      const height = floor
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
    part(body, skin, 0, 1.3, 0, 0.3, 0.31, 0.29);
    part(body, hair, 0, 1.47, -0.015, 0.33, 0.12, 0.31);
    part(body, skin, 0, 1.29, 0.17, 0.11, 0.12, 0.09);
    const leftLeg = new Group(),
      rightLeg = new Group();
    leftLeg.position.set(-0.12, 0.54, 0);
    rightLeg.position.set(0.12, 0.54, 0);
    part(leftLeg, dark, 0, -0.24, 0.02, 0.16, 0.44, 0.2);
    part(rightLeg, dark, 0, -0.24, 0.02, 0.16, 0.44, 0.2);
    const leftArm = new Group(),
      rightArm = new Group();
    leftArm.position.set(-0.3, 1.05, 0);
    rightArm.position.set(0.3, 1.05, 0);
    part(leftArm, cloth, 0, -0.18, 0, 0.13, 0.38, 0.16);
    part(rightArm, cloth, 0, -0.18, 0, 0.13, 0.38, 0.16);
    part(leftArm, skin, 0, -0.4, 0, 0.12, 0.14, 0.14);
    part(rightArm, skin, 0, -0.4, 0, 0.12, 0.14, 0.14);
    body.add(leftLeg, rightLeg, leftArm, rightArm);
    const tool = new Group();
    tool.position.set(0, -0.44, 0.1);
    rightArm.add(tool);
    part(tool, hair, 0, 0, 0.15, 0.055, 0.055, 0.6);
    part(tool, dark, 0, 0, 0.43, 0.38, 0.1, 0.11);
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
      torso,
      leftLeg,
      rightLeg,
      leftArm,
      rightArm,
      tool,
      cargo,
      label,
      sleepSymbol,
      healthMarker,
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
    for (const visual of this.pawnVisuals.values()) {
      const pawn = visual.pawn;
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
      visual.healthMarker.visible = pawn.downed && !pawn.dead;
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
      visual.cargo.visible = !!pawn.cargo;
      const moving = pawn.path.length > 0 || fraction < 1;
      const working =
        pawn.phase === 'work' && pawn.path.length === 0 && !pawn.cargo && fraction >= 1;
      const job = this.data.jobs.find((candidate) => candidate.id === pawn.jobId);
      const workTarget =
        job?.kind === 'stonecut'
          ? stonecutterCells({ ...job, axis: job.axis ?? 'x' })[1]
          : pawn.workTarget;
      const cooking = working && job?.kind === 'cook';
      const feeding = pawn.phase === 'care' && pawn.carePhase === 'feed' && !moving;
      const carryingPatient = pawn.carryingPawnId !== null;
      const tending =
        working && (job?.kind === 'sow' || job?.kind === 'plantTree' || job?.kind === 'harvest');
      if (cooking && job) cookingCells.add(index(job.x, job.y, job.z));
      const swing = Math.sin(time * 12 + pawn.id * 1.7);
      visual.leftLeg.rotation.x = moving ? swing * 0.55 : 0;
      visual.rightLeg.rotation.x = moving ? -swing * 0.55 : 0;
      visual.leftArm.rotation.x =
        pawn.cargo || carryingPatient
          ? -0.9
          : moving
            ? -swing * 0.35
            : tending
              ? -0.85 + swing * 0.15
              : working
                ? -0.45
                : 0;
      visual.rightArm.rotation.x = feeding
        ? -1 + Math.sin(time * 4 + pawn.id) * 0.2
        : pawn.cargo || carryingPatient
          ? -0.9
          : cooking
            ? -0.8 + Math.sin(time * 4 + pawn.id) * 0.14
            : tending
              ? -0.85 - swing * 0.15
              : working
                ? -1.05 + swing * 0.8
                : moving
                  ? swing * 0.35
                  : 0;
      visual.torso.rotation.x = cooking
        ? 0.03
        : tending
          ? 0.2
          : working
            ? 0.08 + Math.max(0, swing) * 0.08
            : 0;
      visual.tool.visible = working && !cooking && !tending;
      const patient = feeding ? this.data.pawns.find((v) => v.id === pawn.patientId) : undefined;
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
      if (visible && working && !cooking && workTarget) {
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
    this.animateDevices();
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
