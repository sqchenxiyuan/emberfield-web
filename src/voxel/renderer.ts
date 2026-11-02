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
  Float32BufferAttribute,
  Fog,
  Group,
  HemisphereLight,
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
  HEIGHT,
  SURFACE,
  TPS,
  WIDTH,
  index,
  type ChunkUpdate,
  type Pawn,
  type Pos,
  type Resource,
  type VoxelSnapshot,
} from './types';

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
  leftLeg: Group;
  rightLeg: Group;
  leftArm: Group;
  rightArm: Group;
  tool: Group;
  cargo: Mesh;
  torso: Mesh;
  label: Sprite;
  from: Vector3;
  to: Vector3;
  start: number;
  duration: number;
  pawn: Pawn;
};

const CHUNKS_X = Math.ceil(WIDTH / CHUNK);
const CHUNKS_Y = Math.ceil(DEPTH / CHUNK);
const CHUNK_COUNT = CHUNKS_X * CHUNKS_Y * Math.ceil(HEIGHT / CHUNK);
const UP = new Vector3(0, 1, 0);
const RESOURCE_COLORS: Record<Resource, number> = {
  wood: 0xbc874d,
  stone: 0x949fa5,
  steel: 0x81b8c5,
  components: 0xe8b55c,
  food: 0x99b869,
};
const BLOCK_COLORS: Record<number, number> = {
  [Block.Soil]: 0x9b7959,
  [Block.Stone]: 0x9ba3a2,
  [Block.Steel]: 0x7398a6,
  [Block.Wood]: 0xbf925d,
  [Block.Bedrock]: 0x59646a,
  [Block.Components]: 0xc4a26c,
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
    const reset = !this.data || snapshot.seed !== this.data.seed || snapshot.tick < this.data.tick;
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
            if (block === Block.Soil && z === SURFACE - 1 && face === 2) hex = 0x91ad65;
            if (block === Block.Soil && z === SURFACE - 1 && face !== 2) hex = 0x8e8d58;
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
  ) {
    this.translation.set(x, z, y);
    this.scale.set(sx, sz, sy);
    this.quaternion.setFromAxisAngle(UP, yaw);
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
    const trees = this.data.trees.filter((tree) => tree.wood > 0 && tree.z === this.level);
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
      const size = 0.8 + hash(tree.x, tree.y) * 0.3,
        turn = hash(tree.y, tree.x) * Math.PI;
      this.instance(trunks, i, tree.x + 0.5, tree.z + 0.77, tree.y + 0.5, 1, 1, 1, 0x80633f);
      for (let layer = 0; layer < 3; layer++) {
        const radius = size * (1 - layer * 0.22);
        this.instance(
          crowns,
          i * 3 + layer,
          tree.x + 0.5,
          tree.z + 1.55 + layer * 0.57,
          tree.y + 0.5,
          radius,
          0.95,
          radius,
          [0x426e52, 0x567e59, 0x6b9361][layer],
          turn,
        );
      }
    });
    this.finish(trunks);
    this.finish(crowns);
    const items = this.data.items.filter((item) => item.amount > 0 && item.z <= this.level);
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
    this.updateJobLines();
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
      const height = floor ? 0.07 : job.kind === 'wall' ? 0.57 : 0.9;
      const corners = [
        [job.x + 0.04, bottom, job.y + 0.04],
        [job.x + 0.96, bottom, job.y + 0.04],
        [job.x + 0.96, bottom, job.y + 0.96],
        [job.x + 0.04, bottom, job.y + 0.96],
        [job.x + 0.04, bottom + height, job.y + 0.04],
        [job.x + 0.96, bottom + height, job.y + 0.04],
        [job.x + 0.96, bottom + height, job.y + 0.96],
        [job.x + 0.04, bottom + height, job.y + 0.96],
      ];
      this.color.setHex(
        job.reason
          ? 0xdf896c
          : ['mine', 'digLadder', 'remove'].includes(job.kind)
            ? 0xe6bf6d
            : job.kind === 'cut'
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
    const torso = part(root, cloth, 0, 0.83, 0, 0.43, 0.56, 0.3);
    part(root, skin, 0, 1.3, 0, 0.3, 0.31, 0.29);
    part(root, hair, 0, 1.47, -0.015, 0.33, 0.12, 0.31);
    part(root, skin, 0, 1.29, 0.17, 0.11, 0.12, 0.09);
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
    root.add(leftLeg, rightLeg, leftArm, rightArm);
    const tool = new Group();
    tool.position.set(0, -0.44, 0.1);
    rightArm.add(tool);
    part(tool, hair, 0, 0, 0.15, 0.055, 0.055, 0.6);
    part(tool, dark, 0, 0, 0.43, 0.38, 0.1, 0.11);
    const cargoMaterial = this.keepMaterial(new MeshLambertMaterial({ color: 0xc69b60 }));
    const cargo = part(root, cargoMaterial, 0, 0.72, 0.39, 0.43, 0.31, 0.33);
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
    const pos = new Vector3(pawn.x + 0.5, pawn.z, pawn.y + 0.5);
    root.position.copy(pos);
    return {
      root,
      torso,
      leftLeg,
      rightLeg,
      leftArm,
      rightArm,
      tool,
      cargo,
      label,
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
    for (const visual of this.pawnVisuals.values()) {
      const pawn = visual.pawn;
      const visible = pawn.z <= this.level;
      visual.root.visible = visible;
      const fraction =
        visual.duration === 0 ? 1 : MathUtils.clamp((now - visual.start) / visual.duration, 0, 1);
      visual.root.position.lerpVectors(visual.from, visual.to, fraction);
      const moving = pawn.path.length > 0 || fraction < 1;
      const working =
        pawn.phase === 'work' && pawn.path.length === 0 && !pawn.cargo && fraction >= 1;
      const swing = Math.sin(time * 12 + pawn.id * 1.7);
      visual.leftLeg.rotation.x = moving ? swing * 0.55 : 0;
      visual.rightLeg.rotation.x = moving ? -swing * 0.55 : 0;
      visual.leftArm.rotation.x = pawn.cargo ? -0.9 : moving ? -swing * 0.35 : working ? -0.45 : 0;
      visual.rightArm.rotation.x = pawn.cargo
        ? -0.9
        : working
          ? -1.05 + swing * 0.8
          : moving
            ? swing * 0.35
            : 0;
      visual.torso.rotation.x = working ? 0.08 + Math.max(0, swing) * 0.08 : 0;
      visual.tool.visible = working;
      if (working && pawn.workTarget) {
        visual.root.rotation.y = Math.atan2(
          pawn.workTarget.x + 0.5 - visual.root.position.x,
          pawn.workTarget.y + 0.5 - visual.root.position.z,
        );
      } else {
        const dx = visual.to.x - visual.from.x,
          dz = visual.to.z - visual.from.z;
        if (Math.abs(dx) + Math.abs(dz) > 0.001) visual.root.rotation.y = Math.atan2(dx, dz);
      }
      if (visible && working && pawn.workTarget) {
        for (let j = 0; j < 4 && moteCount < 256; j++) {
          const phase = (time * 2.5 + j * 0.25 + pawn.id * 0.13) % 1;
          const angle = (j * Math.PI) / 2 + pawn.id;
          const size = (1 - phase) * 0.055;
          this.translation.set(
            pawn.workTarget.x + 0.5 + Math.cos(angle) * phase * 0.5,
            Math.min(pawn.workTarget.z + 0.35, this.level + 0.65) + Math.sin(phase * Math.PI) * 0.5,
            pawn.workTarget.y + 0.5 + Math.sin(angle) * phase * 0.5,
          );
          this.scale.setScalar(size);
          this.quaternion.identity();
          this.matrix.compose(this.translation, this.quaternion, this.scale);
          this.workMotes.setMatrixAt(moteCount++, this.matrix);
        }
      }
    }
    this.workMotes.count = moteCount;
    this.workMotes.instanceMatrix.needsUpdate = true;
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
