import {
  Block,
  CELLS,
  CHUNK,
  DEPTH,
  HEIGHT,
  TPS,
  DAY,
  SURFACE,
  WIDTH,
  at,
  emptyCounts,
  index,
  inside,
  position,
  JOB_NAMES,
  RESOURCE_NAMES,
  bedCells,
  deviceCells,
  stonecutterCells,
  stonecutterInteraction,
  tailorCells,
  tailorInteraction,
  weaponBenchCells,
  weaponBenchInteraction,
} from './types';
import {
  APPAREL_DEFS,
  APPAREL_KINDS,
  APPAREL_NAMES,
  TAILOR_COST,
  TAILOR_WORK,
  makeApparel,
  validApparel,
  compatibleApparel,
  apparelDelay,
  apparelWearDamage,
  APPAREL_WEAR_INTERVAL,
} from './apparel';
import {
  WEAPON_DEFS,
  WEAPON_KINDS,
  WEAPON_NAMES,
  WEAPON_DROP_TICKS,
  makeWeapon,
  validWeapon,
  weaponWork,
  selectMeleeAttack,
  meleeBodyFromTrauma,
  type WeaponKind,
  type WeaponPiece,
  type WeaponBenchKind,
} from './weapons';
import {
  SMITHY_COST,
  SMITHY_WORK,
  SMITHY_FUEL_CAPACITY,
  SMITHY_REFUEL_AT,
  SMITHY_FUEL_PER_TICK,
  isWeaponBenchKind,
  makeWeaponBench,
} from './weaponProduction';
import { VoxelRooms } from './rooms';
import { VoxelPower, DEVICE_COSTS, DEVICE_WORK, isDeviceKind } from './power';
import { VoxelThermal } from './thermal';
import {
  DEFAULT_WORLD_SETTINGS,
  TREE_DATA,
  generateWorld,
  sanitizeWorldSettings,
  summarizeWorld,
  validWorldSettings,
} from './worldgen';
import { outdoorTemperature } from './climate';
import {
  TREE_NAMES,
  treeYield,
  treeGrowth,
  treeWorkSpeed,
  treeCutWork,
  treeSowWork,
  treeDamage,
  treeCover,
  naturalSpecies,
  plantRandom,
  PLANTED_GROWTH,
  NATURAL_GROWTH,
  ECOLOGY_INTERVAL,
  ECOLOGY_SAMPLES,
  NATURAL_TREE_CAP,
} from './plants';
import {
  advanceRot,
  compatibleBatches,
  freshBatch,
  isPerishable,
  mergeBatch,
  portion,
  validBatch,
} from './preservation';
import { carryLimit, stackLimit, stackSpace, DROP_DISTANCE, MIGRATION_DISTANCE } from './logistics';
import {
  STONECUTTER_COST,
  STONECUTTER_WORK,
  STONECUTTING,
  STONE_CONSTRUCTION,
  naturalChunkDrop,
} from './crafting';
import {
  initialSurvival,
  healthSummary,
  updateHealth,
  healthDeathReason,
  FEED_WORK,
  hungerMultiplier,
} from './survival';
import { defaultSchedule, assignmentAt, restLoss, restGain, wantsSleep } from './rest';
import {
  initialTrauma,
  advanceTrauma,
  traumaSummary,
  validTrauma,
  tendOne,
  applyInjury,
  BODY_REGIONS,
  type BodyRegion,
} from './injuries';
import {
  CROPS,
  SIMPLE_MEAL,
  NUTRITION,
  FOOD_FALL_PER_TICK,
  hourAt,
  fertilityOf,
  MIN_CROP_FERTILITY,
  daylight,
  cropGrowth,
} from './farming';
import type {
  ChunkUpdate,
  CommandResult,
  Counts,
  Job,
  JobKind,
  Pawn,
  Pos,
  Resource,
  Stack,
  Tree,
  VoxelCommand,
  VoxelSave,
  VoxelSnapshot,
  VoxelStats,
  WorldSettings,
  WorldSummary,
  Work,
  Crop,
  CropKind,
  FarmPlot,
  Stove,
  Bed,
  Door,
  Axis,
  Device,
  Cargo,
  Stockpile,
  StorageCapacity,
  Stonecutter,
  ConstructionMaterial,
  TreeSpecies,
  TreePlot,
  TreeCondition,
  ApparelKind,
  ApparelPiece,
  Tailor,
  WeaponBench,
} from './types';

const same = (a: Pos, b: Pos) => a.x === b.x && a.y === b.y && a.z === b.z;
const horizontal = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const resources = Object.keys(emptyCounts()) as Resource[];
const costOf = (
  kind: JobKind,
  material: ConstructionMaterial = 'wood',
  apparelKind?: ApparelKind,
  weaponKind?: WeaponKind,
  weaponBenchKind?: WeaponBenchKind,
): Partial<Counts> =>
  kind === 'smithy'
    ? { ...SMITHY_COST }
    : kind === 'smith'
      ? { ...WEAPON_DEFS[weaponKind!].cost }
      : kind === 'tailor'
        ? { ...TAILOR_COST }
        : kind === 'tailoring'
          ? { cloth: APPAREL_DEFS[apparelKind ?? 'shirt'].cloth }
          : kind === 'stonecutter'
            ? { ...STONECUTTER_COST }
            : kind === 'stonecut'
              ? { chunk: STONECUTTING.input }
              : material === 'stone' && (kind === 'wall' || kind === 'floor')
                ? { stone: STONE_CONSTRUCTION[kind].cost }
                : isDeviceKind(kind)
                  ? { ...DEVICE_COSTS[kind] }
                  : kind === 'wire'
                    ? { steel: 1 }
                    : kind === 'cook'
                      ? { grain: SIMPLE_MEAL.ingredients, wood: SIMPLE_MEAL.wood }
                      : (
                            {
                              floor: 3,
                              wall: 6,
                              ladder: 2,
                              digLadder: 2,
                              stove: 20,
                              bed: 45,
                              door: 25,
                            } as Partial<Record<JobKind, number>>
                          )[kind]
                        ? {
                            wood: (
                              {
                                floor: 3,
                                wall: 6,
                                ladder: 2,
                                digLadder: 2,
                                stove: 20,
                                bed: 45,
                                door: 25,
                              } as Partial<Record<JobKind, number>>
                            )[kind]!,
                          }
                        : {};
const workOf = (
  kind: JobKind,
  material: ConstructionMaterial = 'wood',
  species: TreeSpecies = 'poplar',
  legacyCut = false,
  apparelKind?: ApparelKind,
  weaponKind?: WeaponKind,
  weaponBenchKind?: WeaponBenchKind,
) =>
  kind === 'smithy'
    ? SMITHY_WORK
    : kind === 'craftingSpot'
      ? 1
      : kind === 'smith'
        ? weaponWork(weaponKind!, weaponBenchKind!)
        : kind === 'tailor'
          ? TAILOR_WORK
          : kind === 'tailoring'
            ? APPAREL_DEFS[apparelKind ?? 'shirt'].work
            : kind === 'cut'
              ? legacyCut
                ? 60
                : treeCutWork(species)
              : kind === 'plantTree'
                ? treeSowWork(species)
                : material === 'stone' && (kind === 'wall' || kind === 'floor')
                  ? STONE_CONSTRUCTION[kind].work
                  : {
                      ...DEVICE_WORK,
                      wire: 12,
                      refuel: 80,
                      mine: 70,
                      cut: 60,
                      floor: 45,
                      wall: 80,
                      ladder: 40,
                      digLadder: 90,
                      remove: 40,
                      sow: 57,
                      harvest: 67,
                      stove: 120,
                      bed: 187,
                      door: 199,
                      cook: SIMPLE_MEAL.work,
                      stonecutter: STONECUTTER_WORK,
                      stonecut: STONECUTTING.work,
                    }[kind];
const workType = (kind: JobKind): Work =>
  kind === 'stonecut' || kind === 'tailoring' || kind === 'smith'
    ? 'craft'
    : kind === 'refuel'
      ? 'haul'
      : kind === 'sow' || kind === 'harvest' || kind === 'plantTree'
        ? 'grow'
        : kind === 'cook'
          ? 'cook'
          : kind === 'mine' || kind === 'digLadder'
            ? 'dig'
            : kind === 'cut'
              ? 'cut'
              : 'build';
const missing = (j: Job) => resources.find((r) => (j.cost[r] ?? 0) > (j.delivered[r] ?? 0));
function encode(a: Uint8Array) {
  const out: number[] = [];
  let last = a[0],
    n = 0;
  for (const b of a) {
    if (b !== last) {
      out.push(last, n);
      last = b;
      n = 0;
    }
    n++;
  }
  out.push(last, n);
  return out;
}
function decode(raw: unknown, max: number): Uint8Array<ArrayBuffer> {
  if (!Array.isArray(raw) || raw.length > CELLS * 2 || raw.length % 2)
    throw new Error('体素编码无效');
  const out = new Uint8Array(CELLS);
  let cursor = 0;
  for (let i = 0; i < raw.length; i += 2) {
    const v = raw[i],
      n = raw[i + 1];
    if (
      !Number.isInteger(v) ||
      v < 0 ||
      v > max ||
      !Number.isInteger(n) ||
      n < 1 ||
      cursor + n > CELLS
    )
      throw new Error('体素区段无效');
    out.fill(v, cursor, cursor + n);
    cursor += n;
  }
  if (cursor !== CELLS) throw new Error('体素尺寸不匹配');
  return out;
}

export class VoxelSimulation {
  combat = { enabled: false, nextRaid: 0, wave: 0 };
  blocks = new Uint8Array(CELLS);
  ladders = new Uint8Array(CELLS);
  pawns: Pawn[] = [];
  items: Stack[] = [];
  trees: Tree[] = [];
  treePlots: TreePlot[] = [];
  jobs: Job[] = [];
  farms: FarmPlot[] = [];
  crops: Crop[] = [];
  stoves: Stove[] = [];
  stonecutters: Stonecutter[] = [];
  tailors: Tailor[] = [];
  weaponBenches: WeaponBench[] = [];
  beds: Bed[] = [];
  doors: Door[] = [];
  devices: Device[] = [];
  wires: Pos[] = [];
  power = new VoxelPower();
  thermal = new VoxelThermal();
  private powerDirty = true;
  private deviceBlocks = new Set<number>();
  rooms = new VoxelRooms();
  roomRevision = 0;
  private roomsDirty = true;
  stockpiles: Stockpile[] = [];
  generator: 1 | 2 = 2;
  settings: WorldSettings;
  spawn: Pos = { x: 32, y: 34, z: SURFACE };
  private summaryCache?: WorldSummary;
  private summaryRevision = -1;
  stats: VoxelStats = {
    mined: 0,
    cut: 0,
    built: 0,
    hauled: 0,
    sown: 0,
    harvested: 0,
    cooked: 0,
    stonecut: 0,
    tailored: 0,
    weaponsMade: 0,
    destroyed: emptyCounts(),
    treesPlanted: 0,
    treesRegrown: 0,
    treesDied: 0,
    eaten: 0,
    consumed: emptyCounts(),
    produced: emptyCounts(),
    spoiled: emptyCounts(),
  };
  tick = 0;
  nextId = 1;
  revision = 0;
  notice = '先采木，再向下开凿梯井，或向上搭梯建设二层。';
  private dirty = new Set<number>();
  private distance = new Int32Array(CELLS);
  private parents = new Int32Array(CELLS);
  private queue = new Int32Array(CELLS);
  private treeCells = new Set<number>();
  private stoveCells = new Set<number>();
  private skyCache = new Map<number, boolean>();
  private storageReservations = new Map<
    number,
    { cell: number; batch: Cargo; sourceId: number | null }
  >();
  private craftSources = new Map<number, number>();
  private ecologySurface: Pos[] = [];
  private ecologyRevision = -1;
  private treeRouteSeen = new Uint8Array(CELLS);
  private treeRouteQueue = new Int32Array(CELLS);
  constructor(
    public seed = 73129,
    settings?: Partial<WorldSettings>,
    restoreOnly = false,
  ) {
    if (!Number.isSafeInteger(seed)) throw new Error('种子必须是安全整数');
    this.settings = sanitizeWorldSettings(settings);
    if (!restoreOnly) this.generate();
  }
  private id() {
    return this.nextId++;
  }
  private generate() {
    const generated = generateWorld(this.seed, this.settings);
    this.blocks = generated.blocks;
    this.spawn = generated.spawn;
    this.trees = generated.trees.map((tree) => ({ ...tree, id: this.id() }));
    this.summaryCache = generated.summary;
    this.summaryRevision = this.revision;
    this.stockpiles = [-1, 0].map((dx) => ({
      x: this.spawn.x + dx,
      y: this.spawn.y - 1,
      z: this.spawn.z,
      priority: 1,
      accepts: [...resources],
    }));
    for (let i = 0; i < 3; i++)
      this.pawns.push({
        id: this.id(),
        name: ['林澈', '温岚', '阿砾'][i],
        color: [0xe7b66b, 0x91b7a1, 0x9faec8][i],
        x: this.spawn.x - 1 + i,
        y: this.spawn.y + 1,
        z: this.spawn.z,
        food: 100,
        rest: 100,
        priorities: { dig: 1, build: 1, cut: 1, haul: 2, grow: 1, cook: 1, craft: 1, care: 1 },
        ...initialSurvival(this.seed, this.nextId - 1),
        worn: [],
        apparelTask: null,
        apparelWearTicks: 0,
        jobId: null,
        path: [],
        destination: null,
        phase: 'idle',
        cargo: null,
        reason: '等待安排',
        moveTick: 0,
        workTarget: null,
        eating: null,
        sleepBedId: null,
        sleepingSince: null,
        schedule: defaultSchedule(),
      });
    for (const p of this.pawns)
      p.worn = [makeApparel(this.id(), 'shirt'), makeApparel(this.id(), 'pants')];
    this.rebuildTrees();
    if (
      !this.addItem('wood', 90, this.stockpiles[0]) ||
      !this.addItem('food', 60, this.stockpiles[1])
    )
      throw new Error('开局物资缺少合法放置空间');
    this.markAll();
  }
  private rebuildTrees() {
    this.treeCells = new Set(this.trees.flatMap((t) => [at(t), index(t.x, t.y, t.z + 1)]));
  }
  markAll() {
    for (let i = 0; i < 16; i++) this.dirty.add(i);
  }
  private changed(p: Pos) {
    this.roomsDirty = true;
    this.skyCache.clear();
    this.revision++;
    const cx = Math.floor(p.x / CHUNK),
      cy = Math.floor(p.y / CHUNK);
    this.dirty.add(cy * 4 + cx);
    for (const [dx, dy] of horizontal) {
      const nx = p.x + dx,
        ny = p.y + dy;
      if (nx >= 0 && nx < WIDTH && ny >= 0 && ny < DEPTH)
        this.dirty.add(Math.floor(ny / CHUNK) * 4 + Math.floor(nx / CHUNK));
    }
  }
  chunks(): ChunkUpdate[] {
    const out: ChunkUpdate[] = [];
    for (const id of this.dirty) {
      const blocks = new Uint8Array(CHUNK ** 3),
        ladders = new Uint8Array(CHUNK ** 3);
      const ox = (id % 4) * CHUNK,
        oy = Math.floor(id / 4) * CHUNK;
      for (let z = 0; z < 16; z++)
        for (let y = 0; y < 16; y++) {
          const src = index(ox, oy + y, z),
            dst = (z * 16 + y) * 16;
          blocks.set(this.blocks.subarray(src, src + 16), dst);
          ladders.set(this.ladders.subarray(src, src + 16), dst);
        }
      out.push({ id, blocks, ladders });
    }
    this.dirty.clear();
    return out;
  }
  solid(p: Pos) {
    return !inside(p) || this.blocks[at(p)] !== Block.Air;
  }
  standable(p: Pos) {
    if (!inside(p) || p.z < 1 || p.z + 1 >= HEIGHT) return false;
    const i = at(p);
    return (
      this.blocks[i] === 0 &&
      this.blocks[i + WIDTH * DEPTH] === 0 &&
      !this.treeCells.has(i) &&
      !this.treeCells.has(i + WIDTH * DEPTH) &&
      !this.stoveCells.has(i) &&
      !this.deviceBlocks.has(i) &&
      !this.deviceBlocks.has(i + WIDTH * DEPTH) &&
      !this.doors.some(
        (d) =>
          d.mode === 'locked' &&
          d.x === p.x &&
          d.y === p.y &&
          (d.z === p.z || d.z + 1 === p.z || d.z === p.z + 1),
      ) &&
      (this.blocks[i - WIDTH * DEPTH] !== 0 || this.ladders[i] === 1)
    );
  }
  private neighbors(p: Pos): number[] {
    const out: number[] = [];
    for (const [dx, dy] of horizontal) {
      for (const dz of [0, 1, -1]) {
        const n = { x: p.x + dx, y: p.y + dy, z: p.z + dz };
        if (!this.standable(n)) continue;
        // Step up needs clearance over the old head; descending needs the inverse.
        if (dz === 1 && this.solid({ x: p.x, y: p.y, z: p.z + 2 })) continue;
        if (dz === -1 && this.solid({ x: n.x, y: n.y, z: n.z + 2 })) continue;
        out.push(at(n));
      }
    }
    if (this.ladders[at(p)])
      for (const dz of [-1, 1]) {
        const n = { ...p, z: p.z + dz };
        if (this.standable(n) && this.ladders[at(n)]) out.push(at(n));
      }
    return out;
  }
  private search(p: Pos) {
    this.distance.fill(-1);
    this.parents.fill(-1);
    let head = 0,
      tail = 1;
    const start = at(p);
    this.queue[0] = start;
    this.distance[start] = 0;
    while (head < tail) {
      const current = this.queue[head++];
      for (const n of this.neighbors(position(current))) {
        if (this.distance[n] >= 0) continue;
        this.distance[n] = this.distance[current] + 1;
        this.parents[n] = current;
        this.queue[tail++] = n;
      }
    }
  }
  private route(target: number) {
    const path: number[] = [];
    let n = target;
    while (this.parents[n] >= 0) {
      path.push(n);
      n = this.parents[n];
    }
    return path.reverse();
  }
  path(from: Pos, to: Pos) {
    if (!inside(from) || !inside(to) || !this.standable(from) || !this.standable(to)) return null;
    this.search(from);
    return this.distance[at(to)] >= 0 ? this.route(at(to)) : null;
  }
  private stands(j: Job): number[] {
    if (j.kind === 'smith') {
      const bench = this.weaponBenches.find((b) => same(b, j));
      if (!bench) return [];
      const point = weaponBenchInteraction(bench);
      return this.standable(point) ? [at(point)] : [];
    }
    if (j.kind === 'tailoring') {
      const bench = this.tailors.find((b) => same(b, j));
      if (!bench) return [];
      const point = tailorInteraction(bench);
      return this.standable(point) ? [at(point)] : [];
    }
    if (j.kind === 'stonecut') {
      const bench = this.stonecutters.find((b) => same(b, j));
      if (!bench) return [];
      const point = stonecutterInteraction(bench);
      return this.standable(point) ? [at(point)] : [];
    }
    const device = j.kind === 'refuel' || j.kind === 'remove' ? this.deviceAt(j) : undefined;
    const bench =
      j.kind === 'remove' || j.kind === 'refuel'
        ? (this.stonecutterAt(j) ?? this.tailorAt(j) ?? this.weaponBenchAt(j))
        : undefined;
    const cells =
      j.kind === 'stonecutter' || j.kind === 'tailor' || j.kind === 'smithy'
        ? stonecutterCells({ ...j, axis: j.axis ?? 'x' })
        : bench
          ? 'kind' in bench
            ? weaponBenchCells(bench)
            : stonecutterCells(bench)
          : isDeviceKind(j.kind)
            ? deviceCells({ ...j, kind: j.kind, axis: j.axis ?? 'x' })
            : device
              ? deviceCells(device)
              : [j];
    const candidates: Pos[] = cells.flatMap((v) =>
      horizontal.map(([dx, dy]) => ({ x: v.x + dx, y: v.y + dy, z: v.z })),
    );
    if (j.kind === 'wire') candidates.push(j, { ...j, z: j.z - 1 }, { ...j, z: j.z + 1 });
    if (j.kind === 'floor' || j.kind === 'sow' || j.kind === 'harvest') candidates.push({ ...j });
    if (j.kind === 'ladder' || j.kind === 'digLadder')
      candidates.push({ ...j, z: j.z + 1 }, { ...j, z: j.z - 1 });
    if (j.kind === 'remove' && this.ladders[at(j)])
      candidates.push({ ...j, z: j.z - 1 }, { ...j, z: j.z + 1 });
    return candidates
      .filter(
        (p) =>
          this.standable(p) &&
          (!(
            isDeviceKind(j.kind) ||
            j.kind === 'stonecutter' ||
            j.kind === 'tailor' ||
            j.kind === 'smithy'
          ) ||
            !cells.some((c) => same(c, p))),
      )
      .map(at);
  }
  private reachableStand(j: Job) {
    let best = -1;
    for (const n of this.stands(j))
      if (this.distance[n] >= 0 && (best < 0 || this.distance[n] < this.distance[best])) best = n;
    return best;
  }
  private groundAllowed(p: Pos): boolean {
    return (
      this.standable(p) &&
      this.blocks[at(p) - WIDTH * DEPTH] !== 0 &&
      !this.ladders[at(p)] &&
      !this.bedAt(p)
    );
  }
  /** A bounded walk, never a straight-line jump through a wall or another floor. */
  private nearby(origin: Pos, distance = DROP_DISTANCE): Pos[] {
    if (!this.standable(origin)) return [];
    const cells = [at(origin)],
      depths = [0],
      seen = new Set(cells);
    for (let n = 0; n < cells.length; n++) {
      if (depths[n] === distance) continue;
      for (const cell of this.neighbors(position(cells[n])))
        if (!seen.has(cell)) {
          seen.add(cell);
          cells.push(cell);
          depths.push(depths[n] + 1);
        }
    }
    return cells.map(position);
  }
  private reservedSpace(
    cell: number,
    batch: Pick<Cargo, 'resource' | 'crop'>,
    items: Stack[],
    ignorePawnId?: number,
  ): number {
    let remaining = stackSpace(
      items.find((i) => at(i) === cell),
      batch,
    );
    for (const [id, reservation] of this.storageReservations)
      if (id !== ignorePawnId && reservation.cell === cell) {
        if (!compatibleBatches(reservation.batch, { ...batch, amount: 1 })) return 0;
        remaining -= reservation.batch.amount;
      }
    return Math.max(0, remaining);
  }
  /** Trial placement is atomic: no ids, amounts, ages or containers mutate on failure. */
  private planPlacement(
    entries: { batch: Cargo; origin: Pos; cells?: Pos[] }[],
    base = this.items,
    distance = DROP_DISTANCE,
    forbidden = new Set<number>(),
    ignorePawnId?: number,
  ) {
    const items = base.map((i) => ({ ...i }));
    let nextId = this.nextId;
    for (const { batch, origin, cells } of entries) {
      let left = batch.amount;
      for (const p of cells ?? this.nearby(origin, distance)) {
        if (forbidden.has(at(p)) || !this.groundAllowed(p)) continue;
        const n = Math.min(left, this.reservedSpace(at(p), batch, items, ignorePawnId));
        if (!n) continue;
        const target = items.find((i) => same(i, p));
        if (target) mergeBatch(target, portion(batch, n));
        else items.push({ ...portion(batch, n), x: p.x, y: p.y, z: p.z, id: nextId++ });
        left -= n;
        if (!left) break;
      }
      if (left) return null;
    }
    if (items.length > 10000 || nextId >= 10000000) return null;
    return { items, nextId };
  }
  private commitPlacement(plan: NonNullable<ReturnType<VoxelSimulation['planPlacement']>>) {
    const existing = new Map(this.items.map((item) => [item.id, item]));
    this.items = plan.items.map((item) =>
      existing.has(item.id) ? Object.assign(existing.get(item.id)!, item) : item,
    );
    this.nextId = plan.nextId;
    this.revision++;
  }
  private addItem(resource: Resource, amount: number, p: Pos, source?: Cargo): boolean {
    if (amount <= 0) return true;
    const plan = this.planPlacement([
      { batch: source ? portion(source, amount) : freshBatch(resource, amount), origin: p },
    ]);
    if (!plan) return false;
    this.commitPlacement(plan);
    return true;
  }
  private dropCargo(p: Pawn): boolean {
    if (!p.cargo) return true;
    const plan = this.planPlacement(
      [{ batch: p.cargo, origin: p }],
      this.items,
      DROP_DISTANCE,
      new Set(),
      p.id,
    );
    if (!plan) return false;
    this.commitPlacement(plan);
    p.cargo = null;
    this.storageReservations.delete(p.id);
    return true;
  }
  private deliverFood(job: Job, source: Cargo, amount: number) {
    if (!isPerishable(source.resource)) return;
    const incoming = portion(source, amount),
      old = job.deliveredFood.find((batch) => compatibleBatches(batch, incoming));
    if (old) mergeBatch(old, incoming);
    else job.deliveredFood.push(incoming);
  }
  private storagePriority(item: Cargo & Pos): number {
    return (
      this.stockpiles.find((s) => same(s, item) && s.accepts.includes(item.resource))?.priority ??
      -1
    );
  }
  storageSpace(p: Pos, batch: Pick<Cargo, 'resource' | 'crop'>, ignorePawnId?: number): number {
    const stock = this.stockpiles.find((s) => same(s, p));
    return stock?.accepts.includes(batch.resource) && this.groundAllowed(p)
      ? this.reservedSpace(at(p), batch, this.items, ignorePawnId)
      : 0;
  }
  storageCapacity(): StorageCapacity[] {
    return this.stockpiles.map((p) => {
      const item = this.items.find((i) => same(i, p)),
        available = emptyCounts();
      const availableGrain = { rice: 0, potato: 0, corn: 0 };
      for (const crop of ['rice', 'potato', 'corn'] as const)
        availableGrain[crop] = this.storageSpace(p, { resource: 'grain', crop });
      for (const resource of resources)
        available[resource] =
          resource === 'grain'
            ? Math.max(...Object.values(availableGrain))
            : this.storageSpace(p, { resource });
      return {
        x: p.x,
        y: p.y,
        z: p.z,
        occupied: !!item,
        resource: item?.resource ?? null,
        crop: item?.crop ?? null,
        amount: item?.amount ?? 0,
        limit: item ? stackLimit(item.resource) : 0,
        reserved: [...this.storageReservations.values()]
          .filter((r) => r.cell === at(p))
          .reduce((n, r) => n + r.batch.amount, 0),
        available,
        availableGrain,
      };
    });
  }
  /** Requires search(origin) first; prefer strictly higher priority, then distance. */
  private storageDestination(
    batch: Cargo,
    minimumPriority = -1,
    ignorePawnId?: number,
  ): Stockpile | undefined {
    let best: Stockpile | undefined;
    for (const s of this.stockpiles) {
      if (
        s.priority <= minimumPriority ||
        this.storageSpace(s, batch, ignorePawnId) <= 0 ||
        this.distance[at(s)] < 0
      )
        continue;
      if (
        !best ||
        s.priority > best.priority ||
        (s.priority === best.priority && this.distance[at(s)] < this.distance[at(best)])
      )
        best = s;
    }
    return best;
  }
  private canImproveStorage(item: Stack): boolean {
    const priority = this.storagePriority(item);
    return this.stockpiles.some((s) => s.priority > priority && this.storageSpace(s, item) > 0);
  }
  private reserveStorage(
    p: Pawn,
    batch: Cargo,
    target: Stockpile,
    sourceId: number | null,
  ): number {
    const n = Math.min(
      batch.amount,
      carryLimit(batch.resource),
      this.storageSpace(target, batch, p.id),
    );
    if (n > 0)
      this.storageReservations.set(p.id, { cell: at(target), batch: portion(batch, n), sourceId });
    return n;
  }
  private refreshReservations() {
    for (const [id, r] of this.storageReservations) {
      const pawn = this.pawns.find((p) => p.id === id);
      if (
        !pawn ||
        pawn.phase !== 'haul' ||
        this.storageSpace(position(r.cell), r.batch, id) < r.batch.amount ||
        (r.sourceId === null
          ? !pawn.cargo || !compatibleBatches(pawn.cargo, r.batch)
          : !this.items.some((i) => i.id === r.sourceId && compatibleBatches(i, r.batch)))
      )
        this.storageReservations.delete(id);
    }
  }
  private pileFor(p: Pawn, resource?: Resource) {
    let best: Stack | undefined;
    for (const item of this.items) {
      if (
        this.availableStack(item, p.id) < 1 ||
        (resource && item.resource !== resource) ||
        this.chunkReserved(item, p.id)
      )
        continue;
      const d = this.distance[at(item)];
      if (d < 0) continue;
      if (!best || d < this.distance[at(best)]) best = item;
    }
    return best;
  }
  private chunkReserved(item: Stack, pawnId: number): boolean {
    if (item.weapon) {
      const assigned = this.pawns.find((p) => p.weaponTask?.weaponId === item.weapon!.id);
      if ((item.forbidden && assigned?.id !== pawnId) || (assigned && assigned.id !== pawnId))
        return true;
    }
    if (
      item.apparel &&
      this.pawns.some((p) => p.id !== pawnId && p.apparelTask?.apparelId === item.apparel!.id)
    )
      return true;
    return (
      item.resource === 'chunk' &&
      ([...this.craftSources].some(([id, source]) => id !== pawnId && source === item.id) ||
        [...this.storageReservations].some(([id, r]) => id !== pawnId && r.sourceId === item.id))
    );
  }
  private go(p: Pawn, target: number, phase: Pawn['phase']) {
    p.destination = target;
    p.path = this.route(target);
    p.phase = phase;
  }
  private footprint(j: Pos & { kind: JobKind; axis?: Axis }): Pos[] {
    if (j.kind === 'stonecutter' || j.kind === 'tailor' || j.kind === 'smithy')
      return stonecutterCells({ ...j, axis: j.axis ?? 'x' }).flatMap((p) => [
        p,
        { ...p, z: p.z + 1 },
      ]);
    if (isDeviceKind(j.kind))
      return deviceCells({ ...j, kind: j.kind, axis: j.axis ?? 'x' }).flatMap((p) => [
        p,
        { ...p, z: p.z + 1 },
      ]);
    if (j.kind === 'bed') return bedCells({ ...j, axis: j.axis ?? 'x' });
    if (j.kind === 'floor') return [{ ...j, z: j.z - 1 }];
    if (['wall', 'mine', 'door'].includes(j.kind)) return [j, { ...j, z: j.z + 1 }];
    return [j];
  }
  private jobCellConflict(
    j: Pos & { kind: JobKind; axis?: Axis },
    k: Pos & { kind: JobKind; axis?: Axis },
  ) {
    if ((j.kind === 'wire') !== (k.kind === 'wire')) return false;
    return this.footprint(j).some((a) => this.footprint(k).some((b) => same(a, b)));
  }
  private deviceAt(p: Pos) {
    return this.devices.find((d) =>
      deviceCells(d).some((q) => q.x === p.x && q.y === p.y && (q.z === p.z || q.z + 1 === p.z)),
    );
  }
  private rebuildDevices() {
    this.deviceBlocks = new Set(
      [
        ...this.devices.flatMap(deviceCells),
        ...this.stonecutters.flatMap(stonecutterCells),
        ...this.tailors.flatMap(tailorCells),
        ...this.weaponBenches.filter((b) => b.kind === 'smithy').flatMap(weaponBenchCells),
      ].flatMap((p) => [at(p), at({ ...p, z: p.z + 1 })]),
    );
    this.skyCache.clear();
  }
  private bedAt(p: Pos) {
    return this.beds.find((b) => bedCells(b).some((c) => same(c, p)));
  }
  private stonecutterAt(p: Pos) {
    return this.stonecutters.find((b) =>
      stonecutterCells(b).some(
        (q) => q.x === p.x && q.y === p.y && (p.z === q.z || p.z === q.z + 1),
      ),
    );
  }
  private tailorAt(p: Pos) {
    return this.tailors.find((b) =>
      tailorCells(b).some((q) => q.x === p.x && q.y === p.y && (p.z === q.z || p.z === q.z + 1)),
    );
  }
  private weaponBenchAt(p: Pos) {
    return this.weaponBenches.find((b) =>
      weaponBenchCells(b).some(
        (q) =>
          q.x === p.x && q.y === p.y && (q.z === p.z || (b.kind === 'smithy' && q.z + 1 === p.z)),
      ),
    );
  }
  private furnitureAt(p: Pos) {
    return (
      this.deviceAt(p) ||
      this.stonecutterAt(p) ||
      this.tailorAt(p) ||
      this.weaponBenchAt(p) ||
      this.beds.find((b) =>
        bedCells(b).some((q) => q.x === p.x && q.y === p.y && (p.z === q.z || p.z === q.z + 1)),
      ) ||
      this.doors.find((d) => d.x === p.x && d.y === p.y && (p.z === d.z || p.z === d.z + 1))
    );
  }
  private farmable(p: Pos) {
    return (
      this.standable(p) &&
      fertilityOf(this.blocks[at(p) - WIDTH * DEPTH]) >= MIN_CROP_FERTILITY &&
      !this.ladders[at(p)] &&
      !this.furnitureAt(p)
    );
  }
  private skyAt(p: Pos, tree = false) {
    const key = at(p) + (tree ? CELLS : 0);
    let sky = this.skyCache.get(key);
    if (sky === undefined) {
      sky = true;
      for (let z = p.z + (tree ? 2 : 0); z < HEIGHT; z++) {
        const i = index(p.x, p.y, z);
        if (
          this.blocks[i] ||
          this.treeCells.has(i) ||
          this.stoveCells.has(i) ||
          this.deviceBlocks.has(i)
        ) {
          sky = false;
          break;
        }
      }
      this.skyCache.set(key, sky);
    }
    return sky;
  }
  private treeEnvironment(tree: Tree) {
    const fertility = fertilityOf(this.blocks[at(tree) - WIDTH * DEPTH]);
    const hour = hourAt(this.tick),
      sky = this.skyAt(tree, true),
      light = sky ? daylight(hour) : 0;
    const temperature = this.temperature(tree);
    return {
      fertility,
      hour,
      sky,
      light,
      temperature,
      growthRate:
        tree.growth >= 1 ? 0 : treeGrowth(tree.species, fertility, light, temperature, hour),
    };
  }
  treeCondition(tree: Tree): TreeCondition {
    const e = this.treeEnvironment(tree);
    return {
      id: tree.id,
      fertility: e.fertility,
      light: e.light,
      temperature: e.temperature,
      growthRate: e.growthRate,
      yield: treeYield(tree, this.seed),
      mature: tree.growth > 0.999,
      ageDays: tree.age / DAY,
      reason:
        tree.health < 1
          ? '衰老或长期缺光损伤'
          : tree.growth > 0.999
            ? '成熟，可手动采伐'
            : e.fertility < TREE_DATA[tree.species].minFertility
              ? '土壤肥力不足'
              : !e.sky
                ? '上方遮挡，无阳光'
                : e.hour < 6 || e.hour > 19.2
                  ? '夜间休眠'
                  : e.light <= 0.51
                    ? '光照不足'
                    : e.growthRate > 0
                      ? '生长中'
                      : '温度不适',
    };
  }
  private treeSiteReason(p: Pos, species: TreeSpecies, ownJob?: number, natural = false) {
    if (
      !this.standable(p) ||
      fertilityOf(this.blocks[at(p) - WIDTH * DEPTH]) < TREE_DATA[species].minFertility
    )
      return '需要适生土壤、支撑和两格净空';
    if (!this.skyAt(p)) return '树苗需要露天位置';
    if (
      this.ladders[at(p)] ||
      this.ladders[at(p) + WIDTH * DEPTH] ||
      this.furnitureAt(p) ||
      this.stoves.some((s) => same(s, p)) ||
      this.farms.some((f) => same(f, p)) ||
      this.stockpiles.some((s) => same(s, p)) ||
      this.items.some((i) => same(i, p)) ||
      this.wires.some((w) => same(w, p)) ||
      (natural && this.treePlots.some((f) => same(f, p)))
    )
      return '与物资、区域或设施重叠';
    if (
      this.jobs.some(
        (j) =>
          j.id !== ownJob &&
          this.footprint(j).some((q) => q.x === p.x && q.y === p.y && Math.abs(q.z - p.z) < 2),
      )
    )
      return '与现有工作规划重叠';
    const adjacent = (q: Pos) =>
      Math.abs(q.x - p.x) <= 1 && Math.abs(q.y - p.y) <= 1 && Math.abs(q.z - p.z) <= 1;
    if (
      this.trees.some(adjacent) ||
      this.treePlots.some((q) => !same(q, p) && adjacent(q)) ||
      this.crops.some(adjacent) ||
      this.farms.some(adjacent)
    )
      return '与相邻树木或作物至少间隔一格';
    return '';
  }
  private treeCanAppear(p: Pos, species: TreeSpecies, ownJob?: number, natural = false) {
    if (this.trees.length >= 4096 || this.treeSiteReason(p, species, ownJob, natural)) return false;
    const overlap = (q: Pos) => p.x === q.x && p.y === q.y && Math.abs(p.z - q.z) < 2;
    if (
      this.pawns.some(
        (pawn) =>
          overlap(pawn) ||
          (pawn.destination !== null && overlap(position(pawn.destination))) ||
          pawn.path.some((i) => overlap(position(i))) ||
          (pawn.jobId !== ownJob && pawn.workTarget && overlap(pawn.workTarget)),
      ) ||
      this.jobs.some((j) => j.id !== ownJob && this.stands(j).some((i) => overlap(position(i)))) ||
      this.stonecutters.some((b) => overlap(stonecutterInteraction(b))) ||
      this.tailors.some((b) => overlap(tailorInteraction(b))) ||
      this.weaponBenches.some((b) => overlap(weaponBenchInteraction(b)))
    )
      return false;
    // A tree removes one walking vertex. It may not split any previously joined
    // neighbors, even if no pawn is currently using that narrow route.
    const neighbors = this.neighbors(p),
      lower = at(p),
      upper = lower + WIDTH * DEPTH;
    this.treeCells.add(lower);
    this.treeCells.add(upper);
    try {
      if (neighbors.length <= 1) return true;
      const seen = this.treeRouteSeen,
        queue = this.treeRouteQueue,
        remaining = new Set(neighbors.slice(1));
      seen.fill(0);
      queue[0] = neighbors[0];
      seen[neighbors[0]] = 1;
      let head = 0,
        tail = 1;
      while (head < tail && remaining.size) {
        for (const next of this.neighbors(position(queue[head++])))
          if (!seen[next]) {
            seen[next] = 1;
            queue[tail++] = next;
            remaining.delete(next);
          }
      }
      return remaining.size === 0;
    } finally {
      this.treeCells.delete(lower);
      this.treeCells.delete(upper);
    }
  }
  private createTree(p: Pos, species: TreeSpecies, planted: boolean) {
    this.trees.push({
      id: this.id(),
      x: p.x,
      y: p.y,
      z: p.z,
      species,
      wood: TREE_DATA[species].wood,
      growth: planted ? PLANTED_GROWTH : NATURAL_GROWTH,
      age: 0,
      health: 1,
      unlitTicks: 0,
      planted,
    });
    this.rebuildTrees();
    this.skyCache.clear();
    this.revision++;
    if (planted) this.stats.treesPlanted++;
    else this.stats.treesRegrown++;
  }
  private updateTrees() {
    const dead = new Set<number>();
    for (const tree of this.trees) {
      const e = this.treeEnvironment(tree);
      tree.age++;
      tree.unlitTicks = e.light <= 0.001 ? tree.unlitTicks + 1 : 0;
      tree.growth = Math.min(1, tree.growth + e.growthRate);
      tree.health = Math.max(0, tree.health - treeDamage(tree));
      if (tree.health <= 0) dead.add(tree.id);
    }
    if (dead.size) {
      for (const job of [...this.jobs])
        if (job.kind === 'cut' && this.trees.some((t) => dead.has(t.id) && same(t, job)))
          this.cancel(job);
      this.trees = this.trees.filter((t) => !dead.has(t.id));
      this.stats.treesDied += dead.size;
      this.rebuildTrees();
      this.skyCache.clear();
      this.revision++;
    }
    if (this.tick % ECOLOGY_INTERVAL !== 0 || this.trees.length >= NATURAL_TREE_CAP) return;
    const species = naturalSpecies(this.settings),
      data = TREE_DATA[species];
    if (this.ecologyRevision !== this.revision) {
      this.ecologySurface = [];
      for (let y = 0; y < DEPTH; y++)
        for (let x = 0; x < WIDTH; x++) {
          let z = HEIGHT - 1;
          while (z > 0 && !this.blocks[index(x, y, z)]) z--;
          if (z < HEIGHT - 2 && fertilityOf(this.blocks[index(x, y, z)]) >= data.minFertility)
            this.ecologySurface.push({ x, y, z: z + 1 });
        }
      this.ecologyRevision = this.revision;
    }
    const area = this.ecologySurface.length,
      cover = treeCover(this.settings);
    const capacity = Math.min(NATURAL_TREE_CAP, Math.ceil(area * cover * 1.25));
    if (!area || this.trees.length >= capacity) return;
    // Explicit 3D cadence/density adaptation: 16 sampled surface cells per 200
    // local ticks; scan-interval-normalized MTB of 20/25/35 days, bounded capacity.
    const mtbDays =
      this.settings.biome === 'desert' ? 35 : this.settings.biome === 'boreal' ? 25 : 20;
    const mtb = Math.min(1, (ECOLOGY_INTERVAL * area) / (ECOLOGY_SAMPLES * mtbDays * DAY));
    const epoch = this.tick / ECOLOGY_INTERVAL;
    for (let sample = 0; sample < ECOLOGY_SAMPLES && this.trees.length < capacity; sample++) {
      const p = this.ecologySurface[Math.floor(plantRandom(this.seed, epoch, sample, 8100) * area)];
      const fertility = fertilityOf(this.blocks[at(p) - WIDTH * DEPTH]);
      const chance =
        mtb * cover * (species === 'saguaro' ? 1 : Math.min(1.5, fertility * fertility));
      if (
        plantRandom(this.seed, epoch, sample, 8101) >= chance ||
        !this.skyAt(p) ||
        treeGrowth(
          species,
          fertility,
          daylight(hourAt(this.tick)),
          this.temperature(p),
          hourAt(this.tick),
        ) <= 0 ||
        !this.treeCanAppear(p, species, undefined, true)
      )
        continue;
      this.createTree(p, species, false);
    }
  }
  cropCondition(p: Pos, kind: CropKind) {
    const i = at(p);
    let sky = this.skyCache.get(i);
    if (sky === undefined) {
      sky = true;
      for (let z = p.z; z < HEIGHT; z++) {
        if (
          this.blocks[index(p.x, p.y, z)] ||
          this.treeCells.has(index(p.x, p.y, z)) ||
          this.stoveCells.has(index(p.x, p.y, z)) ||
          this.deviceBlocks.has(index(p.x, p.y, z))
        ) {
          sky = false;
          break;
        }
      }
      this.skyCache.set(i, sky);
    }
    const fertility = fertilityOf(this.blocks[i - WIDTH * DEPTH]);
    const hour = hourAt(this.tick),
      light = sky ? daylight(hour) : 0,
      temperature = this.temperature(p);
    const growthRate =
      fertility >= MIN_CROP_FERTILITY ? cropGrowth(kind, fertility, light, temperature, hour) : 0;
    const reason =
      fertility < MIN_CROP_FERTILITY
        ? '需要肥力至少 0.7 的土壤'
        : !sky
          ? '上方遮挡，无阳光'
          : hour < 6 || hour >= 19.2
            ? '夜间休眠'
            : light <= 0.51
              ? '光照不足'
              : growthRate > 0
                ? '生长中'
                : '温度不适';
    return { fertility, light, temperature, growthRate, reason };
  }
  private syncProduction() {
    for (const j of [...this.jobs]) {
      if (j.cancelled) {
        this.cancel(j);
        continue;
      }
      if (
        j.kind === 'sow' &&
        (!this.farms.some((f) => same(f, j)) ||
          !this.farmable(j) ||
          this.crops.some((v) => same(v, j)))
      )
        this.cancel(j);
      if (j.kind === 'harvest' && !this.crops.some((v) => same(v, j) && v.growth >= 1))
        this.cancel(j);
      if (
        j.kind === 'plantTree' &&
        (!this.treePlots.some((f) => same(f, j) && f.species === j.treeSpecies) ||
          this.trees.some((t) => same(t, j)))
      )
        this.cancel(j);
      if (j.kind === 'cut' && !this.trees.some((t) => same(t, j))) this.cancel(j);
      if (j.kind === 'cook' && !this.stoves.some((v) => same(v, j) && !v.paused)) this.cancel(j);
      if (j.kind === 'stonecut' && !this.stonecutters.some((b) => same(b, j) && !b.paused))
        this.cancel(j);
      if (
        j.kind === 'tailoring' &&
        !this.tailors.some(
          (b) => same(b, j) && b.bills.some((bill) => bill.kind === j.apparelKind && !bill.paused),
        )
      )
        this.cancel(j);
      if (
        j.kind === 'smith' &&
        !this.weaponBenches.some(
          (b) => same(b, j) && b.bills.some((v) => v.kind === j.weaponKind && !v.paused),
        )
      )
        this.cancel(j);
      if (
        j.kind === 'refuel' &&
        !this.devices.some((d) => d.kind === 'generator' && same(d, j)) &&
        !this.weaponBenches.some((b) => b.kind === 'smithy' && same(b, j))
      )
        this.cancel(j);
    }
    for (const f of this.farms) {
      if (this.jobs.length >= 512 || this.jobs.some((j) => same(j, f)) || !this.farmable(f))
        continue;
      const c = this.crops.find((c) => same(c, f));
      if (!c) this.jobs.push(this.makeJob('sow', f));
      else if (c.growth >= 1) this.jobs.push(this.makeJob('harvest', f));
    }
    for (const plot of this.treePlots) {
      if (
        this.jobs.length >= 512 ||
        this.jobs.some((j) => same(j, plot)) ||
        this.trees.some((t) => same(t, plot))
      )
        continue;
      if (!this.treeSiteReason(plot, plot.species)) this.jobs.push(this.makeJob('plantTree', plot));
    }
    let meals =
      this.counts().meal + this.jobs.filter((j) => j.kind === 'cook').length * SIMPLE_MEAL.output;
    for (const stove of this.stoves) {
      if (
        this.jobs.length >= 512 ||
        stove.paused ||
        meals >= stove.target ||
        this.jobs.some((j) => same(j, stove))
      )
        continue;
      this.jobs.push(this.makeJob('cook', stove));
      meals += SIMPLE_MEAL.output;
    }
    let stone =
      this.counts().stone +
      this.jobs.filter((j) => j.kind === 'stonecut' && !j.cancelled).length * STONECUTTING.output;
    for (const bench of this.stonecutters) {
      if (
        this.jobs.length >= 512 ||
        bench.paused ||
        stone >= bench.target ||
        this.jobs.some((j) => same(j, bench))
      )
        continue;
      this.jobs.push(this.makeJob('stonecut', bench));
      stone += STONECUTTING.output;
    }
    const apparelCounts = Object.fromEntries(
      APPAREL_KINDS.map((kind) => [
        kind,
        this.apparelPieces().filter((p) => p.kind === kind).length +
          this.jobs.filter((j) => j.kind === 'tailoring' && !j.cancelled && j.apparelKind === kind)
            .length,
      ]),
    ) as Record<ApparelKind, number>;
    for (const bench of this.tailors) {
      if (this.jobs.length >= 512 || this.jobs.some((j) => same(j, bench))) continue;
      const bill = bench.bills.find((b) => !b.paused && apparelCounts[b.kind] < b.target);
      if (!bill) continue;
      this.jobs.push(this.makeJob('tailoring', bench, bench.axis, 'wood', bill.kind));
      apparelCounts[bill.kind]++;
    }
    const weaponCounts = Object.fromEntries(
      WEAPON_KINDS.map((kind) => [
        kind,
        this.weaponPieces().filter((w) => w.kind === kind).length +
          this.jobs.filter((j) => j.kind === 'smith' && !j.cancelled && j.weaponKind === kind)
            .length,
      ]),
    ) as Record<WeaponKind, number>;
    for (const bench of this.weaponBenches) {
      if (
        this.jobs.length >= 512 ||
        this.jobs.some((j) => same(j, bench) && !['smith', 'refuel'].includes(j.kind))
      )
        continue;
      if (
        bench.kind === 'smithy' &&
        !this.jobs.some((j) => same(j, bench) && j.kind === 'refuel') &&
        bench.fuel <= SMITHY_REFUEL_AT
      ) {
        const job = this.makeJob('refuel', bench);
        job.cost = { wood: Math.ceil(SMITHY_FUEL_CAPACITY - bench.fuel) };
        this.jobs.push(job);
      }
      if (this.jobs.some((j) => same(j, bench) && j.kind === 'smith')) continue;
      const bill = bench.bills.find((b) => !b.paused && weaponCounts[b.kind] < b.target);
      if (!bill) continue;
      this.jobs.push(
        this.makeJob('smith', bench, bench.axis, 'wood', undefined, bill.kind, bench.kind),
      );
      weaponCounts[bill.kind]++;
    }
    for (const d of this.devices) {
      if (
        d.kind !== 'generator' ||
        d.fuel > 22.5 ||
        this.jobs.length >= 512 ||
        this.jobs.some((j) => same(j, d))
      )
        continue;
      const j = this.makeJob('refuel', d);
      j.cost = { wood: Math.ceil(75 - d.fuel) };
      this.jobs.push(j);
    }
  }
  command(c: VoxelCommand): CommandResult {
    if (!c || typeof c !== 'object') return { ok: false, message: '命令格式无效' };
    const nextId = this.nextId;
    const result = this.applyCommand(c);
    if (!result.ok) this.nextId = nextId;
    else for (const p of this.pawns) if (p.carePhase && !this.validCare(p)) this.release(p);
    return result;
  }
  private applyCommand(c: VoxelCommand): CommandResult {
    if (
      'pawnId' in c &&
      c.pawnId !== null &&
      this.pawns.some((p) => p.id === c.pawnId && p.faction !== 'colony')
    )
      return { ok: false, message: '无法指挥敌对人物' };
    if (c.type === 'weaponBill') {
      const bench = this.weaponBenches.find((b) => b.id === c.benchId);
      const bill = bench?.bills.find((b) => b.kind === c.kind);
      if (
        !bench ||
        !bill ||
        !Number.isInteger(c.target) ||
        c.target < 0 ||
        c.target > 100 ||
        typeof c.paused !== 'boolean'
      )
        return { ok: false, message: '武器配方或目标无效' };
      bill.target = c.target;
      bill.paused = c.paused;
      if (c.paused)
        for (const job of [...this.jobs])
          if (job.kind === 'smith' && same(job, bench) && job.weaponKind === c.kind)
            this.cancel(job);
      this.syncProduction();
      return { ok: true, message: c.paused ? '已暂停配方，已运原料会退回' : '武器制作目标已更新' };
    }
    if (c.type === 'equipWeapon' || c.type === 'dropWeapon') {
      const pawn = this.pawns.find((p) => p.id === c.pawnId);
      const ok =
        !!pawn &&
        this.startWeapon(
          pawn,
          c.type === 'equipWeapon' ? c.weaponId : (pawn.weapon?.id ?? -1),
          c.type === 'equipWeapon' ? 'equip' : 'drop',
        );
      return { ok, message: ok ? pawn!.reason : '当前无法取用武器，请检查通路、预约与人物状态' };
    }
    if (c.type === 'weaponForbidden') {
      const item = this.items.find((i) => i.weapon?.id === c.weaponId);
      if (!item || typeof c.forbidden !== 'boolean')
        return { ok: false, message: '地面武器不存在' };
      item.forbidden = c.forbidden;
      for (const pawn of this.pawns)
        if (pawn.weaponTask?.weaponId === c.weaponId) this.release(pawn);
      this.refreshReservations();
      return { ok: true, message: c.forbidden ? '已禁止自动搬运此武器' : '已允许自动搬运此武器' };
    }
    if (c.type === 'threats') {
      if (typeof c.enabled !== 'boolean') return { ok: false, message: '袭击设置无效' };
      if (c.enabled !== this.combat.enabled) {
        this.combat.enabled = c.enabled;
        this.combat.nextRaid = c.enabled ? this.tick + DAY * 3 : 0;
      }
      return {
        ok: true,
        message: c.enabled
          ? '已开启袭击；首次来袭前有三天准备时间'
          : '已关闭后续袭击，场上的敌人仍然存在',
      };
    }
    if (c.type === 'draft') {
      const p = this.pawns.find((p) => p.id === c.pawnId);
      if (!p || p.dead || p.downed || p.carriedBy !== null || typeof c.drafted !== 'boolean')
        return { ok: false, message: '人物当前无法征召' };
      p.drafted = c.drafted;
      this.release(p);
      p.reason = p.drafted ? '已征召，等待战斗指令' : '解除征召，恢复工作';
      return { ok: true, message: p.reason };
    }
    if (c.type === 'attack') {
      const p = this.pawns.find((p) => p.id === c.pawnId),
        target = this.pawns.find((p) => p.id === c.targetId);
      if (
        !p ||
        !target ||
        p === target ||
        !p.drafted ||
        p.dead ||
        p.downed ||
        target.dead ||
        target.downed ||
        target.carriedBy !== null
      )
        return { ok: false, message: '需要可行动的征召人物和有效攻击目标' };
      this.search(p);
      const stand = this.careStand(target);
      if (stand < 0) return { ok: false, message: '目标附近没有可达近战位置' };
      this.release(p);
      p.attackTargetId = target.id;
      this.go(p, stand, 'combat');
      p.reason = '前往近战攻击' + target.name;
      return { ok: true, message: p.reason };
    }
    if (c.type === 'storage') {
      if (
        !inside(c.from) ||
        (c.to !== undefined && !inside(c.to)) ||
        (c.connected !== undefined && typeof c.connected !== 'boolean') ||
        (c.connected && c.to !== undefined) ||
        !Number.isInteger(c.priority) ||
        c.priority < 0 ||
        c.priority > 3 ||
        !Array.isArray(c.accepts) ||
        c.accepts.length > resources.length ||
        new Set(c.accepts).size !== c.accepts.length ||
        c.accepts.some((resource) => !resources.includes(resource))
      )
        return { ok: false, message: '仓储设置无效：优先级 0～3，物资种类不能重复' };
      let selected: Stockpile[];
      if (c.connected) {
        const seed = this.stockpiles.find((s) => same(s, c.from));
        if (!seed) return { ok: false, message: '这里没有仓储区' };
        const byCell = new Map(
          this.stockpiles.filter((s) => s.z === seed.z).map((s) => [at(s), s]),
        );
        selected = [seed];
        const seen = new Set([at(seed)]);
        for (let n = 0; n < selected.length; n++)
          for (const [dx, dy] of horizontal) {
            const p = { x: selected[n].x + dx, y: selected[n].y + dy, z: seed.z };
            if (!inside(p)) continue;
            const adjacent = byCell.get(at(p));
            if (adjacent && !seen.has(at(adjacent))) {
              seen.add(at(adjacent));
              selected.push(adjacent);
            }
          }
      } else {
        const to = c.to ?? c.from;
        selected = this.stockpiles.filter(
          (s) =>
            s.x >= Math.min(c.from.x, to.x) &&
            s.x <= Math.max(c.from.x, to.x) &&
            s.y >= Math.min(c.from.y, to.y) &&
            s.y <= Math.max(c.from.y, to.y) &&
            s.z >= Math.min(c.from.z, to.z) &&
            s.z <= Math.max(c.from.z, to.z),
        );
      }
      if (!selected.length || selected.some((s) => !this.standable(s) || this.ladders[at(s)]))
        return { ok: false, message: '请选择有支撑、两格净空的现有仓储区' };
      for (const s of selected) {
        s.priority = c.priority;
        s.accepts = resources.filter((resource) => c.accepts.includes(resource));
      }
      this.refreshReservations();
      this.revision++;
      return {
        ok: true,
        count: selected.length,
        message: `已更新 ${selected.length} 格仓储；搬运会优先选择更高优先级区域`,
      };
    }
    if (c.type === 'device') {
      const d = this.devices.find((d) => d.id === c.deviceId);
      if (
        !d ||
        typeof c.on !== 'boolean' ||
        !Number.isInteger(c.target) ||
        c.target < -50 ||
        c.target > 50
      )
        return { ok: false, message: '设备设置无效，目标温度范围 -50～50°C' };
      d.on = c.on;
      d.target = c.target;
      if (!d.on) {
        d.powered = false;
        d.active = false;
      }
      return { ok: true, message: d.on ? '设备已启用' : '设备已关闭' };
    }
    if (c.type === 'bedMedical') {
      const bed = this.beds.find((b) => b.id === c.bedId);
      if (!bed || typeof c.medical !== 'boolean') return { ok: false, message: '医疗床设置无效' };
      if (bed.medical !== c.medical) {
        for (const p of this.pawns)
          if (p.sleepBedId === bed.id || p.careBedId === bed.id) this.release(p);
        bed.medical = c.medical;
        bed.owner = null;
      }
      return {
        ok: true,
        message: bed.medical ? '已设为医疗床，医护会优先救援倒地者' : '已恢复普通床位',
      };
    }
    if (c.type === 'care') {
      const p = this.pawns.find((p) => p.id === c.pawnId),
        patient = this.pawns.find((p) => p.id === c.patientId);
      if (
        !p ||
        !patient ||
        !['rescue', 'feed', 'tend'].includes(c.action) ||
        p.dead ||
        p.downed ||
        p.carriedBy !== null
      )
        return { ok: false, message: '医护或病人无效' };
      const ok = this.startCare(p, patient, c.action);
      return {
        ok,
        message: ok
          ? p.reason
          : '无法护理：需要未被预定的倒地病人、可达医疗床或实物食物，并有卸货空间',
      };
    }
    if (c.type === 'bedOwner') {
      const b = this.beds.find((b) => b.id === c.bedId);
      if (
        !b ||
        b.medical ||
        (c.pawnId !== null && !this.pawns.some((p) => p.id === c.pawnId && !p.dead))
      )
        return { ok: false, message: '床位或人物无效' };
      const affected = this.beds.filter(
        (v) => v.id === b.id || (c.pawnId !== null && v.owner === c.pawnId),
      );
      for (const p of this.pawns) if (affected.some((v) => v.id === p.sleepBedId)) this.release(p);
      for (const v of affected) v.owner = null;
      b.owner = c.pawnId;
      return {
        ok: true,
        message: c.pawnId === null ? '床位已取消分配；无人床可自动认领' : '床位已分配',
      };
    }
    if (c.type === 'door') {
      const d = this.doors.find((v) => v.id === c.doorId);
      if (!d || !['auto', 'open', 'locked'].includes(c.mode))
        return { ok: false, message: '门设置无效' };
      if (
        c.mode === 'locked' &&
        (this.pawns.some((p) => same(p, d)) || this.items.some((p) => same(p, d)))
      )
        return { ok: false, message: '门口有人或物资，请移开后再锁门' };
      d.mode = c.mode;
      d.openUntil = c.mode === 'open' ? this.tick + 37 : 0;
      return {
        ok: true,
        message:
          c.mode === 'locked'
            ? '门已锁定，重新规划通路'
            : c.mode === 'open'
              ? '门保持敞开'
              : '门恢复自动开关',
      };
    }
    if (c.type === 'schedule') {
      const p = this.pawns.find((p) => p.id === c.pawnId);
      if (
        !p ||
        !Number.isInteger(c.hour) ||
        c.hour < 0 ||
        c.hour > 23 ||
        !['anything', 'work', 'sleep'].includes(c.assignment)
      )
        return { ok: false, message: '作息安排无效' };
      p.schedule[c.hour] = c.assignment;
      return { ok: true, message: `${c.hour}:00 作息已更新` };
    }
    if (c.type === 'rest') {
      const p = this.pawns.find((p) => p.id === c.pawnId);
      if (!p || p.dead || p.downed || p.drafted || p.carriedBy !== null || p.rest >= 75)
        return { ok: false, message: '精力低于 75% 时可安排入睡' };
      this.startSleep(p);
      return { ok: true, message: p.reason };
    }
    if (c.type === 'priority') {
      const p = this.pawns.find((p) => p.id === c.pawnId);
      if (
        !p ||
        p.dead ||
        !['dig', 'build', 'cut', 'haul', 'grow', 'cook', 'craft', 'care'].includes(c.work) ||
        !Number.isInteger(c.value) ||
        c.value < 0 ||
        c.value > 4
      )
        return { ok: false, message: '工作优先级无效' };
      p.priorities[c.work] = c.value;
      this.release(p);
      return { ok: true, message: '工作优先级已更新；0 为禁用' };
    }
    if (c.type === 'bill') {
      const stove = this.stoves.find((v) => v.id === c.stoveId);
      if (
        !stove ||
        !Number.isInteger(c.target) ||
        c.target < 0 ||
        c.target > 100 ||
        typeof c.paused !== 'boolean'
      )
        return { ok: false, message: '简餐目标需为 0–100 的整数' };
      Object.assign(stove, { target: c.target, paused: c.paused });
      // Restart this stove's reservation when the target changes, refunding all delivered inputs.
      for (const j of [...this.jobs]) if (j.kind === 'cook' && same(j, stove)) this.cancel(j);
      this.syncProduction();
      return {
        ok: true,
        message: stove.paused
          ? '烹饪已暂停；无落地空间时材料保留原任务等待退回'
          : `简餐不足 ${stove.target} 份时制作`,
      };
    }
    if (c.type === 'wear' || c.type === 'removeApparel') {
      const p = this.pawns.find((p) => p.id === c.pawnId);
      const ok = !!p && this.startApparel(p, c.apparelId, c.type === 'wear' ? 'wear' : 'remove');
      return {
        ok,
        message: ok ? p!.reason : '无法换装：需要可行动人物、可达且未被预定的衣物及卸货空间',
      };
    }
    if (c.type === 'tailorBill') {
      const bench = this.tailors.find((b) => b.id === c.tailorId);
      if (
        !bench ||
        !Object.hasOwn(APPAREL_DEFS, c.kind) ||
        !Number.isInteger(c.target) ||
        c.target < 0 ||
        c.target > 100 ||
        typeof c.paused !== 'boolean'
      )
        return { ok: false, message: '衣物目标需为0～100，配方必须有效' };
      const bill = bench.bills.find((b) => b.kind === c.kind)!;
      bill.target = c.target;
      bill.paused = c.paused;
      if (c.paused)
        for (const job of [...this.jobs])
          if (job.kind === 'tailoring' && job.apparelKind === c.kind && same(job, bench))
            this.cancel(job);
      this.syncProduction();
      return {
        ok: true,
        message: c.paused
          ? '此配方已暂停，实物材料保留或安全退回'
          : '衣物目标已更新，当前批次完成后重新计算',
      };
    }
    if (c.type === 'stoneBill') {
      const bench = this.stonecutters.find((b) => b.id === c.stonecutterId);
      if (
        !bench ||
        !Number.isInteger(c.target) ||
        c.target < 0 ||
        c.target > 2000 ||
        typeof c.paused !== 'boolean'
      )
        return { ok: false, message: '石砖目标需为 0～2000 的整数' };
      bench.target = c.target;
      bench.paused = c.paused;
      // A target change only affects the next batch. Pausing interrupts this one.
      if (bench.paused)
        for (const job of [...this.jobs])
          if (job.kind === 'stonecut' && same(job, bench)) this.cancel(job);
      this.syncProduction();
      return {
        ok: true,
        message: bench.paused
          ? '切石已暂停；无退料空间则保留岩块等待'
          : `石砖不足 ${bench.target} 块时，每份岩块切出 20 砖`,
      };
    }
    if (c.type === 'move') {
      const p = this.pawns.find((p) => p.id === c.pawnId);
      if (
        !p ||
        p.dead ||
        p.downed ||
        p.carriedBy !== null ||
        !inside(c.target) ||
        !this.standable(c.target)
      )
        return { ok: false, message: '目标没有支撑或两格净空' };
      const path = this.path(p, c.target);
      if (!path) return { ok: false, message: '没有可达通路；检查梯子和楼板' };
      this.release(p);
      p.path = path;
      p.destination = at(c.target);
      p.phase = p.drafted ? 'combat' : 'travel';
      p.reason = '前往指定位置';
      return { ok: true, message: '已安排移动' };
    }
    if (c.type !== 'designate' || !inside(c.from) || c.from.z < 1 || c.from.z > HEIGHT - 2)
      return { ok: false, message: '请选择世界内的有效工作层' };
    if (
      c.treeSpecies !== undefined &&
      (c.tool !== 'grove' || !Object.hasOwn(TREE_DATA, c.treeSpecies))
    )
      return { ok: false, message: '林地区需要有效树种' };
    if (
      c.material !== undefined &&
      (!['wood', 'stone'].includes(c.material) || !['wall', 'floor'].includes(c.tool))
    )
      return { ok: false, message: '只有墙壁和楼板可选择木材或石砖' };
    const to = c.to ?? c.from;
    if (!inside(to) || to.z !== c.from.z)
      return { ok: false, message: '一次规划必须锁定同一工作层' };
    const positions: Pos[] = [];
    const x0 = Math.min(c.from.x, to.x),
      x1 = Math.max(c.from.x, to.x),
      y0 = Math.min(c.from.y, to.y),
      y1 = Math.max(c.from.y, to.y);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 128)
      return { ok: false, message: '一次最多安排 128 格，请分批规划' };
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) positions.push({ x, y, z: c.from.z });
    if (c.tool === 'inspect') return { ok: true, message: '选择查看' };
    if (c.tool === 'clearZone') {
      for (const pos of positions) {
        this.farms = this.farms.filter((f) => !same(f, pos));
        this.treePlots = this.treePlots.filter((f) => !same(f, pos));
        this.stockpiles = this.stockpiles.filter((f) => !same(f, pos));
        this.crops = this.crops.filter((f) => !same(f, pos));
        for (const j of [...this.jobs])
          if ((j.kind === 'sow' || j.kind === 'harvest' || j.kind === 'plantTree') && same(j, pos))
            this.cancel(j);
      }
      this.revision++;
      return {
        ok: true,
        message: '区域已擦除；粮食作物清理，现有树木保留',
        count: positions.length,
      };
    }
    if (c.tool === 'grove') {
      const species = c.treeSpecies ?? naturalSpecies(this.settings);
      let count = 0,
        reason = '';
      // Greedy row order leaves one empty cell between planned tree centers.
      for (const p of positions) {
        const old = this.treePlots.find((f) => same(f, p));
        if (old) {
          if (fertilityOf(this.blocks[at(p) - WIDTH * DEPTH]) < TREE_DATA[species].minFertility) {
            reason = `${TREE_NAMES[species]}所需土壤肥力至少${TREE_DATA[species].minFertility}`;
            continue;
          }
          old.species = species;
          for (const j of [...this.jobs])
            if (j.kind === 'plantTree' && same(j, p) && j.treeSpecies !== species) this.cancel(j);
          count++;
          continue;
        }
        const invalid = this.treeSiteReason(p, species);
        if (invalid || this.treePlots.length >= 512) {
          reason = invalid || '林地上限512个种植点';
          continue;
        }
        this.treePlots.push({ ...p, species });
        count++;
      }
      if (!count) return { ok: false, message: reason || '没有适合栽树的位置' };
      this.syncProduction();
      this.revision++;
      return {
        ok: true,
        count,
        message: `安排${count}个${TREE_NAMES[species]}种植点，间隔一格；成熟后手动伐木，采后自动补植${positions.length > count ? `；跳过${positions.length - count}格：${reason}` : ''}`,
      };
    }
    if (c.tool === 'farm') {
      const kind = c.crop ?? 'rice';
      if (!Object.hasOwn(CROPS, kind)) return { ok: false, message: '未知作物' };
      if (
        positions.some(
          (p) =>
            !this.farmable(p) ||
            this.treePlots.some((f) => same(f, p)) ||
            this.stockpiles.some((s) => same(s, p)) ||
            this.jobs.some(
              (j) =>
                this.footprint(j).some((q) => same(q, p)) &&
                j.kind !== 'sow' &&
                j.kind !== 'harvest',
            ),
        )
      )
        return { ok: false, message: '种植区需要肥力至少 0.7、两格净空，不能与仓储或施工重叠' };
      if (
        this.farms.length + positions.filter((p) => !this.farms.some((f) => same(f, p))).length >
        512
      )
        return { ok: false, message: '种植区最多 512 格' };
      for (const p of positions) {
        const old = this.farms.find((f) => same(f, p));
        if (old) old.crop = kind;
        else this.farms.push({ ...p, crop: kind });
      }
      this.syncProduction();
      this.revision++;
      return {
        ok: true,
        message: `安排 ${positions.length} 格${CROPS[kind].name}；更换作物在下一次播种生效`,
        count: positions.length,
      };
    }
    if (c.tool === 'cancel') {
      let n = 0;
      for (const p of positions)
        for (const j of [...this.jobs])
          if (this.footprint(j).some((q) => same(q, p))) {
            this.cancel(j);
            n++;
          }
      return {
        ok: n > 0,
        message: n ? `取消 ${n} 项规划；无落地空间时材料保留原任务等待退回` : '这里没有规划',
        count: n,
      };
    }
    if (c.tool === 'stock') {
      if (
        positions.some(
          (p) =>
            !this.standable(p) ||
            this.ladders[at(p)] ||
            this.farms.some((f) => same(f, p)) ||
            this.treePlots.some((f) => same(f, p)) ||
            this.furnitureAt(p) ||
            this.jobs.some(
              (j) =>
                ([
                  'bed',
                  'door',
                  'stove',
                  'stonecutter',
                  'tailor',
                  'smithy',
                  'craftingSpot',
                ].includes(j.kind) ||
                  isDeviceKind(j.kind)) &&
                this.footprint(j).some((q) => same(q, p)),
            ),
        )
      )
        return { ok: false, message: '仓储需要有支撑、两格净空的地板，不能设在梯井内' };
      if (
        this.stockpiles.length +
          positions.filter((p) => !this.stockpiles.some((s) => same(s, p))).length >
        4096
      )
        return { ok: false, message: '仓储最多 4096 格，请缩小范围' };
      for (const p of positions)
        if (!this.stockpiles.some((s) => same(s, p)))
          this.stockpiles.push({ ...p, priority: 1, accepts: [...resources] });
      return {
        ok: true,
        message: `划定 ${positions.length} 格仓储；可搬运的物资将送往最近仓储`,
        count: positions.length,
      };
    }
    if (c.tool === 'craftingSpot') {
      const p = positions[0];
      if (
        positions.length !== 1 ||
        this.weaponBenches.length >= 128 ||
        this.placementReason('craftingSpot', p) ||
        this.jobs.some((j) => this.footprint(j).some((q) => same(p, q)))
      )
        return { ok: false, message: '制作点需要一格有支撑的空地，不能重叠区域或已有设施' };
      this.weaponBenches.push(makeWeaponBench(this.id(), 'craftingSpot', p, 'x'));
      this.revision++;
      return { ok: true, message: '已划定制作点，点击设置木棒或匕首配方', count: 1 };
    }
    const plans: Job[] = [];
    const errors: string[] = [];
    if (c.axis !== undefined && c.axis !== 'x' && c.axis !== 'y')
      return { ok: false, message: '朝向无效' };
    if (
      (['bed', 'door', 'stonecutter', 'tailor', 'smithy'].includes(c.tool) ||
        isDeviceKind(c.tool)) &&
      positions.length !== 1
    )
      return { ok: false, message: '设施每次放置一件，R 切换朝向' };
    for (const p of positions) {
      if (c.tool === 'shaft' || c.tool === 'up') {
        if (positions.length !== 1) return { ok: false, message: '梯井每次规划一个竖直入口' };
        if (!this.standable(p) || this.treeCells.has(at(p)))
          return { ok: false, message: '请从有两格净空的可站立位置开设梯井' };
        const dir = c.tool === 'shaft' ? -1 : 1;
        if (p.z + dir * 3 < 1 || p.z + dir * 3 > HEIGHT - 2)
          return { ok: false, message: '三格梯井超出世界高度' };
        if (!this.ladders[at(p)]) plans.push(this.makeJob('ladder', p));
        for (let i = 1; i <= 3; i++) {
          const q = { ...p, z: p.z + dir * i };
          if (this.ladders[at(q)]) continue;
          const b = this.blocks[at(q)];
          if (
            dir < 0 &&
            (
              [
                Block.Stone,
                Block.Soil,
                Block.Steel,
                Block.Components,
                Block.RichSoil,
                Block.Sand,
                Block.Gravel,
              ] as number[]
            ).includes(b)
          )
            plans.push(this.makeJob('digLadder', q));
          else if (!b) plans.push(this.makeJob('ladder', q));
          else return { ok: false, message: '梯井遇到建筑或基岩；请更换位置' };
        }
      } else {
        const kind = c.tool as JobKind;
        const target = kind === 'remove' ? (this.furnitureAt(p) ?? p) : p;
        const reason = this.placementReason(kind, target, c.axis);
        if (reason) {
          errors.push(reason);
          continue;
        }
        if (!plans.some((j) => same(j, target)))
          plans.push(this.makeJob(kind, target, c.axis, c.material));
      }
    }
    // Natural-resource drags skip empty cells; construction rejects the whole invalid stroke.
    if (
      plans.some(
        (j) =>
          (j.kind === 'ladder' || j.kind === 'digLadder') &&
          (this.farms.some((f) => same(f, j)) ||
            this.treePlots.some((f) => same(f, j)) ||
            this.furnitureAt(j) ||
            this.stoves.some((s) => same(s, j))),
      )
    )
      return { ok: false, message: '梯井与种植区重叠，请先擦除区域' };
    if (errors.length && c.tool !== 'mine' && c.tool !== 'cut')
      return { ok: false, message: errors[0] };
    if (
      plans.some((j) =>
        this.jobs.some(
          (k) =>
            this.jobCellConflict(j, k) &&
            !(
              j.kind === 'remove' &&
              ['cook', 'refuel', 'stonecut', 'tailoring', 'smith'].includes(k.kind)
            ),
        ),
      )
    )
      return { ok: false, message: '规划与已有任务重叠，请先取消原规划' };
    if (!plans.length) return { ok: false, message: errors[0] ?? '没有可安排的目标' };
    if (this.jobs.length + plans.length > 512)
      return { ok: false, message: '规划上限为 512 项，请等部分任务完成' };
    if (
      this.devices.length + [...this.jobs, ...plans].filter((j) => isDeviceKind(j.kind)).length >
        256 ||
      this.wires.length + [...this.jobs, ...plans].filter((j) => j.kind === 'wire').length > 4096
    )
      return { ok: false, message: '电力设施或线路数量达到上限' };
    if (
      this.beds.length + [...this.jobs, ...plans].filter((j) => j.kind === 'bed').length > 128 ||
      this.doors.length + [...this.jobs, ...plans].filter((j) => j.kind === 'door').length > 512 ||
      this.stonecutters.length +
        [...this.jobs, ...plans].filter((j) => j.kind === 'stonecutter').length >
        128 ||
      this.tailors.length + [...this.jobs, ...plans].filter((j) => j.kind === 'tailor').length >
        128 ||
      this.weaponBenches.length +
        [...this.jobs, ...plans].filter((j) => j.kind === 'smithy').length >
        128
    )
      return { ok: false, message: '设施数量已达到上限' };
    for (const j of plans)
      if (j.kind === 'remove')
        for (const k of [...this.jobs])
          if (['cook', 'refuel', 'stonecut', 'tailoring', 'smith'].includes(k.kind) && same(k, j))
            this.cancel(k);
    this.jobs.push(...plans);
    this.notice = `安排 ${plans.length} 项工作，需求木材 ${plans.reduce((n, j) => n + (j.cost.wood ?? 0), 0)}；缺料和不可达任务会等待`;
    return { ok: true, message: this.notice, count: plans.length };
  }
  private makeJob(
    kind: JobKind,
    p: Pos,
    axis: Axis = 'x',
    material: ConstructionMaterial = 'wood',
    apparelKind?: ApparelKind,
    weaponKind?: WeaponKind,
    weaponBenchKind?: WeaponBenchKind,
  ): Job {
    const species =
      kind === 'cut'
        ? this.trees.find((t) => same(t, p))?.species
        : kind === 'plantTree'
          ? this.treePlots.find((f) => same(f, p))?.species
          : undefined;
    return {
      id: this.id(),
      kind,
      x: p.x,
      y: p.y,
      z: p.z,
      work: workOf(kind, material, species, false, apparelKind, weaponKind, weaponBenchKind),
      progress: 0,
      owner: null,
      delivered: {},
      deliveredFood: [],
      cancelled: false,
      cost: costOf(kind, material, apparelKind, weaponKind, weaponBenchKind),
      reason: '等待可达工人',
      ...(['bed', 'door', 'stonecutter', 'tailor', 'smithy'].includes(kind) || isDeviceKind(kind)
        ? { axis }
        : {}),
      ...(['wall', 'floor'].includes(kind) ? { material } : {}),
      ...(species ? { treeSpecies: species } : {}),
      ...(apparelKind ? { apparelKind } : {}),
      ...(weaponKind ? { weaponKind, weaponBenchKind } : {}),
    };
  }
  private placementReason(kind: JobKind, p: Pos, axis: Axis = 'x') {
    if (kind === 'craftingSpot')
      return !this.standable(p) ||
        this.ladders[at(p)] ||
        this.furnitureAt(p) ||
        this.farms.some((f) => same(f, p)) ||
        this.stockpiles.some((f) => same(f, p)) ||
        this.treePlots.some((f) => same(f, p))
        ? '制作点需要空地'
        : '';
    if (
      !['cut', 'remove', 'plantTree'].includes(kind) &&
      this.treePlots.some((f) => this.footprint({ ...p, kind, axis }).some((q) => same(q, f)))
    )
      return '请先擦除林地区';
    if (kind === 'wire')
      return this.wires.some((q) => same(q, p))
        ? '这里已有电线'
        : !this.standable(p) && !this.solid(p) && !this.deviceAt(p) && !this.furnitureAt(p)
          ? '电线需要地面、墙体或梯井支撑'
          : '';
    if (kind !== 'remove' && this.footprint({ ...p, kind, axis }).some((q) => this.furnitureAt(q)))
      return '这里已有床或门，请先拆除';
    if (isDeviceKind(kind) || kind === 'stonecutter' || kind === 'tailor' || kind === 'smithy') {
      const cells =
        kind === 'stonecutter' || kind === 'tailor' || kind === 'smithy'
          ? stonecutterCells({ ...p, axis })
          : deviceCells({ ...p, kind, axis });
      if (
        (kind === 'stonecutter' || kind === 'tailor' || kind === 'smithy') &&
        !this.standable(stonecutterInteraction({ ...p, axis }))
      )
        return '切石台正面需要有支撑、两格净空的工作位置';
      return cells.some(
        (q) =>
          !inside(q) ||
          !this.standable(q) ||
          !this.blocks[at(q) - WIDTH * DEPTH] ||
          this.ladders[at(q)] ||
          this.farms.some((f) => same(f, q)) ||
          this.stockpiles.some((s) => same(s, q)) ||
          this.furnitureAt(q),
      )
        ? '设备占地需要完整支撑与两格净空，不能重叠区域、梯井或设施'
        : '';
    }
    if (kind === 'bed' || kind === 'door') {
      const cells = kind === 'bed' ? bedCells({ ...p, axis }) : [p];
      return cells.some(
        (q) =>
          !this.standable(q) ||
          this.ladders[at(q)] ||
          !this.blocks[at(q) - WIDTH * DEPTH] ||
          this.farms.some((f) => same(f, q)) ||
          this.stockpiles.some((s) => same(s, q)) ||
          this.furnitureAt(q),
      )
        ? '床和门需要有支撑的空置地板与两格净空，不能重叠区域或设施'
        : '';
    }
    if (kind !== 'remove' && this.stoves.some((s) => same(s, p))) return '这里已有灶台';
    if (
      this.farms.some((f) => f.x === p.x && f.y === p.y && Math.abs(f.z - p.z) <= 1) &&
      ['wall', 'floor', 'ladder', 'stove'].includes(kind)
    )
      return '先用擦除区域工具清理种植区';
    const b = this.blocks[at(p)],
      above = this.blocks[index(p.x, p.y, p.z + 1)];
    if (kind === 'mine')
      return [b, above].some((b) =>
        (
          [
            Block.Soil,
            Block.Stone,
            Block.Steel,
            Block.Components,
            Block.RichSoil,
            Block.Sand,
            Block.Gravel,
          ] as number[]
        ).includes(b),
      )
        ? ''
        : '此处没有可开挖的自然方块';
    if (kind === 'cut') return this.trees.some((t) => same(t, p)) ? '' : '此处没有树木';
    if (kind === 'stove')
      return !this.standable(p) || this.ladders[at(p)] || this.stockpiles.some((s) => same(s, p))
        ? '灶台需要有支撑的空置地板，不能与仓储重叠'
        : '';
    if (kind === 'floor')
      return this.blocks[index(p.x, p.y, p.z - 1)] || b || above || this.treeCells.has(at(p))
        ? '楼板位置需为空，楼面上方保留两格净空'
        : '';
    if (kind === 'wall')
      return b || above || this.ladders[at(p)] || this.treeCells.has(at(p))
        ? '墙壁需要空置的两格空间'
        : '';
    if (kind === 'ladder')
      return b || above || this.ladders[at(p)] || this.treeCells.has(at(p))
        ? '梯子需要空置的两格空间'
        : '';
    if (kind === 'remove')
      return this.wires.some((q) => same(q, p)) ||
        this.furnitureAt(p) ||
        this.stoves.some((s) => same(s, p)) ||
        b === Block.Wood ||
        b === Block.Masonry ||
        this.ladders[at(p)] ||
        [Block.Wood, Block.Masonry].includes(this.blocks[index(p.x, p.y, p.z - 1)] as 4 | 7)
        ? ''
        : '只能拆除建造的墙、楼板、梯子或设施';
    return '未知的规划类型';
  }
  /** Reservations reference physical stacks; no shadow food inventory exists. */
  private availableStack(item: Stack, ignorePawnId?: number): number {
    return Math.max(
      0,
      item.amount -
        this.pawns.reduce(
          (n, p) => n + (p.id !== ignorePawnId && p.careFoodId === item.id ? p.careAmount : 0),
          0,
        ),
    );
  }
  private releaseCare(p: Pawn) {
    if (p.carryingPawnId !== null) {
      const patient = this.pawns.find((q) => q.id === p.carryingPawnId);
      if (patient) {
        Object.assign(patient, { x: p.x, y: p.y, z: p.z });
        patient.carriedBy = null;
        patient.phase = patient.dead ? 'dead' : patient.downed ? 'downed' : 'idle';
        patient.reason = patient.dead
          ? patient.deathReason!
          : patient.downed
            ? '救援中断，原地等待医护'
            : '已恢复行动';
      }
    }
    p.carryingPawnId = null;
    p.patientId = null;
    p.careBedId = null;
    p.careFoodId = null;
    p.careAmount = 0;
    p.carePhase = null;
    p.careProgress = 0;
  }
  private patientBed(p: Pawn): Bed | undefined {
    return this.beds.find((b) => same(b, p) && (b.medical || b.owner === p.id));
  }
  /** search(origin) must precede this call; helpers share the navigation workspace. */
  private careStand(patient: Pawn): number {
    const candidates = horizontal.map(([dx, dy]) => ({
      x: patient.x + dx,
      y: patient.y + dy,
      z: patient.z,
    }));
    return (
      candidates
        .filter((q) => this.standable(q) && this.distance[at(q)] >= 0)
        .sort((a, b) => this.distance[at(a)] - this.distance[at(b)])
        .map(at)[0] ?? -1
    );
  }
  private freeMedicalBed(p: Pawn, patient: Pawn): Bed | undefined {
    return this.beds
      .filter(
        (b) =>
          b.medical &&
          this.distance[at(b)] >= 0 &&
          !this.pawns.some(
            (q) =>
              q.id !== patient.id &&
              q.id !== p.id &&
              (bedCells(b).some((cell) => same(cell, q)) ||
                q.sleepBedId === b.id ||
                q.careBedId === b.id),
          ),
      )
      .sort((a, b) => this.distance[at(a)] - this.distance[at(b)])[0];
  }
  private startCare(p: Pawn, patient: Pawn, action: 'rescue' | 'feed' | 'tend'): boolean {
    if (
      p === patient ||
      p.dead ||
      p.downed ||
      p.drafted ||
      p.faction !== 'colony' ||
      patient.faction !== 'colony' ||
      p.carriedBy !== null ||
      patient.dead ||
      (action !== 'tend' && !patient.downed) ||
      patient.carriedBy !== null ||
      this.pawns.some((q) => q.id !== p.id && q.patientId === p.id) ||
      this.pawns.some((q) => q.id !== p.id && q.patientId === patient.id)
    )
      return false;
    const patientBed = this.patientBed(patient);
    if (action === 'tend') {
      if (patient.drafted || !patient.trauma.wounds.some((w) => w.tendQuality === null))
        return false;
    } else if (action === 'rescue' ? !!patientBed : !patientBed || patient.food > 26) return false;
    this.search(p);
    const stand = this.careStand(patient);
    if (stand < 0) return false;
    const bed = action === 'rescue' ? this.freeMedicalBed(p, patient) : undefined;
    if (action === 'rescue' && !bed) return false;
    const carriedFood = action === 'feed' && p.cargo && NUTRITION[p.cargo.resource];
    const food =
      action === 'feed' && !carriedFood
        ? (['meal', 'food', 'grain'] as Resource[]).map((r) => this.pileFor(p, r)).find(Boolean)
        : undefined;
    if (action === 'feed' && !carriedFood && !food) return false;
    // A full ground never destroys existing cargo to make room for a rescue.
    if (!carriedFood && !this.dropCargo(p)) return false;
    this.release(p);
    this.search(p);
    p.patientId = patient.id;
    p.careBedId = bed?.id ?? null;
    p.careProgress = 0;
    if (action === 'tend') {
      // The patient waits at the actual treatment site. No teleport or instant healing.
      const sleeping = patient.phase === 'rest';
      const sleepBedId = patient.sleepBedId,
        sleepingSince = patient.sleepingSince;
      this.release(patient);
      if (patient.downed && patientBed) patient.sleepBedId = patientBed.id;
      else if (sleeping) Object.assign(patient, { phase: 'rest', sleepBedId, sleepingSince });
      p.carePhase = 'tendApproach';
      this.go(p, this.careStand(patient), 'care');
      p.reason = '前往包扎' + patient.name;
    } else if (action === 'rescue') {
      p.carePhase = 'rescueApproach';
      this.go(p, this.careStand(patient), 'care');
      p.reason = '前往救援' + patient.name;
    } else if (carriedFood) {
      p.carePhase = 'feedApproach';
      this.go(p, this.careStand(patient), 'care');
      p.reason = '携带食物前往' + patient.name;
    } else {
      p.careFoodId = food!.id;
      p.careAmount = Math.min(
        this.availableStack(food!, p.id),
        food!.resource === 'grain' ? Math.ceil((100 - patient.food) / (100 * NUTRITION.grain!)) : 1,
      );
      p.carePhase = 'feedFetch';
      this.go(p, at(food!), 'care');
      p.reason = '为' + patient.name + '取食物';
    }
    return true;
  }
  private tryCare(p: Pawn): boolean {
    const patients = this.pawns
      .filter(
        (q) =>
          (q.downed || q.trauma.wounds.some((w) => w.tendQuality === null)) &&
          q.faction === 'colony' &&
          !q.drafted &&
          q.carePhase === null &&
          !q.dead &&
          q.carriedBy === null &&
          q.id !== p.id &&
          !this.pawns.some((r) => r.id !== p.id && r.patientId === q.id),
      )
      .sort(
        (a, b) =>
          Math.max(b.health.malnutrition, b.health.hypothermia, b.health.heatstroke) -
          Math.max(a.health.malnutrition, a.health.hypothermia, a.health.heatstroke),
      );
    for (const patient of patients)
      if (
        this.startCare(
          p,
          patient,
          patient.trauma.wounds.some((w) => w.tendQuality === null)
            ? 'tend'
            : this.patientBed(patient)
              ? 'feed'
              : 'rescue',
        )
      )
        return true;
    return false;
  }
  private validCare(p: Pawn): boolean {
    const patient = this.pawns.find((q) => q.id === p.patientId);
    if (!patient || patient.dead || patient.faction !== 'colony' || patient.drafted || !p.carePhase)
      return false;
    if (p.carePhase.startsWith('tend'))
      return (
        patient.carriedBy === null && patient.trauma.wounds.some((w) => w.tendQuality === null)
      );
    if (!patient.downed) return false;
    if (p.carePhase === 'rescueApproach' || p.carePhase === 'rescueCarry')
      return (
        this.beds.some((b) => b.id === p.careBedId && b.medical) &&
        (p.carePhase === 'rescueCarry' ? patient.carriedBy === p.id : patient.carriedBy === null)
      );
    return (
      patient.carriedBy === null &&
      !!this.patientBed(patient) &&
      patient.food <= 26 &&
      (p.carePhase === 'feedFetch'
        ? this.items.some(
            (i) => i.id === p.careFoodId && this.availableStack(i, p.id) >= p.careAmount,
          )
        : !!p.cargo && !!NUTRITION[p.cargo.resource])
    );
  }
  private arriveCare(p: Pawn) {
    if (!this.validCare(p)) {
      this.release(p);
      p.reason = '护理条件改变，重新安排';
      return;
    }
    const patient = this.pawns.find((q) => q.id === p.patientId)!;
    if (p.carePhase === 'feedFetch') {
      const food = this.items.find((i) => i.id === p.careFoodId);
      if (!food || !same(food, p) || !this.take(p, food.resource, p.careAmount, food.id)) {
        this.release(p);
        return;
      }
      p.careFoodId = null;
      p.careAmount = 0;
      this.search(p);
      const stand = this.careStand(patient);
      if (stand < 0) {
        this.release(p);
        p.reason = '病人通路中断，保留携带食物';
        return;
      }
      p.carePhase = 'feedApproach';
      this.go(p, stand, 'care');
      p.reason = '把食物送到' + patient.name;
      return;
    }
    if (p.carePhase === 'rescueCarry') {
      const bed = this.beds.find((b) => b.id === p.careBedId && b.medical)!;
      if (!same(p, bed)) {
        this.release(p);
        return;
      }
      Object.assign(patient, { x: bed.x, y: bed.y, z: bed.z });
      patient.carriedBy = null;
      patient.sleepBedId = bed.id;
      patient.phase = 'downed';
      patient.reason = '卧床等待喂食或适宜温度恢复';
      p.carryingPawnId = null;
      this.release(p);
      p.reason = '已把' + patient.name + '送到医疗床';
      return;
    }
    if (p.z !== patient.z || Math.abs(p.x - patient.x) + Math.abs(p.y - patient.y) !== 1) {
      this.release(p);
      p.reason = '病人位置改变，重新安排';
      return;
    }
    if (p.carePhase === 'rescueApproach') {
      this.search(p);
      const bed = this.beds.find((b) => b.id === p.careBedId && b.medical)!;
      if (this.distance[at(bed)] < 0) {
        this.release(p);
        p.reason = '医疗床通路中断';
        return;
      }
      patient.carriedBy = p.id;
      patient.sleepBedId = null;
      Object.assign(patient, { x: p.x, y: p.y, z: p.z });
      p.carryingPawnId = patient.id;
      p.carePhase = 'rescueCarry';
      this.go(p, at(bed), 'care');
      p.reason = '抱起' + patient.name + '前往医疗床';
      patient.reason = '由' + p.name + '抱往医疗床';
      return;
    }
    if (p.carePhase === 'tendApproach' || p.carePhase === 'tend') {
      p.carePhase = 'tend';
      p.destination = null;
      p.careProgress += Math.max(0.01, healthSummary(p).manipulation);
      p.reason = '无药包扎' + patient.name;
      if (p.careProgress < 200) return;
      tendOne(patient.trauma, this.seed, p.id, this.tick, 0.75 * healthSummary(p).manipulation);
      p.careProgress = 0;
      if (!patient.trauma.wounds.some((w) => w.tendQuality === null)) {
        this.release(p);
        p.reason = '已完成包扎，伤口继续自然愈合';
      }
      return;
    }
    p.carePhase = 'feed';
    p.destination = null;
    p.careProgress += healthSummary(p).manipulation;
    p.reason = '喂食' + patient.name;
    if (p.careProgress < FEED_WORK) return;
    const amount = this.consume(patient, p.cargo!.resource, p.cargo!.amount);
    p.cargo!.amount -= amount;
    if (p.cargo!.amount === 0) p.cargo = null;
    this.release(p);
    p.reason = '已喂食' + patient.name;
    patient.reason = '已进食，营养不良逐步恢复';
  }
  private updateSurvival() {
    for (const p of this.pawns) {
      if (p.dead) continue;
      const factor = p.food <= 0 ? 0 : p.food < 12 ? 0.25 : p.food < 24 ? 0.5 : 1;
      p.food = Math.max(0, p.food - FOOD_FALL_PER_TICK * factor * hungerMultiplier(p.health));
      updateHealth(p.health, p.food, this.temperature(p), this.tick, p.worn);
      advanceTrauma(p.trauma, this.tick, {
        seed: this.seed,
        pawnId: p.id,
        starving: p.food <= 0,
        resting: p.phase === 'rest' || p.downed,
        inBed: !!this.patientBed(p),
      });
      this.reconcileHealth(p);
    }
  }
  private reconcileHealth(p: Pawn) {
    const death = healthDeathReason(p.health, p.trauma),
      summary = healthSummary(p);
    const downed =
      !death && (summary.pain >= 0.8 || summary.consciousness < 0.3 || summary.moving <= 0.15);
    const inBed = this.beds.some((b) => b.id === p.sleepBedId && same(b, p));
    if (p.weapon && (death || summary.manipulation <= 0 || (downed && !inBed)))
      p.weaponDropPending = true;
    // Losing both usable arms need not knock a pawn down. Cancel its equipment
    // action before forced drops or arrival can reuse an invalid reservation.
    if (summary.manipulation <= 0 && p.weaponTask) this.release(p);
    if (death || p.downed !== downed) {
      const bed = this.beds.find((b) => b.id === p.sleepBedId && same(b, p)) ?? this.patientBed(p);
      for (const q of this.pawns) if (q.patientId === p.id) this.release(q);
      p.dead = !!death;
      p.downed = downed;
      p.deathReason = death;
      if (downed && p.faction === 'raider') p.retreating = true;
      if (death || downed) p.drafted = false;
      if (death || downed)
        for (const q of this.pawns) if (q.attackTargetId === p.id) this.release(q);
      this.release(p);
      if (p.downed && bed) p.sleepBedId = bed.id;
      p.reason = death ?? (p.downed ? summary.reason + '，倒地等待救援' : '恢复行动');
      if (p.dead) for (const b of this.beds) if (b.owner === p.id) b.owner = null;
    }
  }
  private updateRaids() {
    if (!this.combat.enabled || this.tick < this.combat.nextRaid) return;
    const colonists = this.pawns.filter((p) => p.faction === 'colony' && !p.dead && !p.downed);
    if (
      !colonists.length ||
      this.pawns.some((p) => p.faction === 'raider' && !p.dead && !p.downed)
    ) {
      this.combat.nextRaid = this.tick + DAY;
      return;
    }
    // Do not grow an unbounded retained corpse list. No existing body or gear is deleted.
    if (this.pawns.length >= 64) {
      this.combat.enabled = false;
      this.combat.nextRaid = 0;
      this.notice = '地图上的人物与遗体已达上限，后续袭击暂停';
      return;
    }
    let entry: Pos | null = null,
      score = -Infinity;
    for (const colonist of colonists) {
      this.search(colonist);
      for (let y = 0; y < DEPTH; y++)
        for (let x = 0; x < WIDTH; x++) {
          if (x > 1 && y > 1 && x < WIDTH - 2 && y < DEPTH - 2) continue;
          for (let z = HEIGHT - 2; z > 0; z--) {
            const candidate = { x, y, z };
            if (!this.standable(candidate) || this.distance[at(candidate)] < 0) continue;
            const distance = Math.min(
              ...colonists.map((p) => Math.abs(x - p.x) + Math.abs(y - p.y) + Math.abs(z - p.z)),
            );
            if (distance >= 16 && distance > score) {
              entry = candidate;
              score = distance;
            }
            break;
          }
        }
    }
    if (!entry) {
      this.combat.nextRaid = this.tick + DAY / 4;
      this.notice = '袭击者找不到通往营地的地图边缘入口';
      return;
    }
    const id = this.id();
    this.pawns.push({
      ...entry,
      id,
      name: `袭击者 ${this.combat.wave + 1}`,
      color: 0xc65b52,
      food: 100,
      rest: 100,
      ...initialSurvival(this.seed, id),
      faction: 'raider',
      weapon: makeWeapon(this.id(), 'steelKnife'),
      priorities: { dig: 0, build: 0, cut: 0, haul: 0, grow: 0, cook: 0, craft: 0, care: 0 },
      worn: [],
      apparelTask: null,
      apparelWearTicks: 0,
      jobId: null,
      path: [],
      destination: null,
      phase: 'combat',
      cargo: null,
      reason: '正在袭击营地',
      moveTick: this.tick,
      workTarget: null,
      eating: null,
      sleepBedId: null,
      sleepingSince: null,
      schedule: defaultSchedule(),
    });
    this.combat.wave++;
    this.combat.nextRaid = this.tick + DAY * 5;
    this.notice = '一名持钢匕首的袭击者从地图边缘逼近。征召同伴，利用门与多层通路防守。';
  }
  private combatTick(p: Pawn) {
    if (p.retreating) {
      p.attackTargetId = null;
      if (p.x === 0 || p.y === 0 || p.x === WIDTH - 1 || p.y === DEPTH - 1) {
        for (const q of this.pawns) if (q.attackTargetId === p.id) this.release(q);
        this.pawns = this.pawns.filter((q) => q.id !== p.id);
        this.notice = p.name + '已撤离地图';
        return;
      }
      if (!p.path.length) {
        this.search(p);
        let destination = -1,
          distance = Infinity;
        for (let y = 0; y < DEPTH; y++)
          for (let x = 0; x < WIDTH; x++) {
            if (x !== 0 && y !== 0 && x !== WIDTH - 1 && y !== DEPTH - 1) continue;
            for (let z = 1; z < HEIGHT - 1; z++) {
              const q = { x, y, z },
                i = at(q);
              if (this.distance[i] >= 0 && this.distance[i] < distance && this.standable(q)) {
                destination = i;
                distance = this.distance[i];
              }
            }
          }
        if (destination >= 0) this.go(p, destination, 'combat');
      }
      p.reason = p.path.length ? '负伤撤离' : '撤离通路受阻';
      return;
    }
    // An explicit move order takes precedence over automatic adjacent retaliation.
    if (p.faction === 'colony' && p.attackTargetId === null && p.path.length > 0) return;
    let target = this.pawns.find((q) => q.id === p.attackTargetId);
    if (!target || target.dead || target.downed || target.carriedBy !== null) {
      p.attackTargetId = null;
      target = undefined;
      if (p.faction === 'raider') {
        if ((this.tick + p.id) % 20 !== 0) return;
        this.search(p);
        target = this.pawns
          .filter((q) => q.faction === 'colony' && !q.dead && !q.downed)
          .map((q) => ({ pawn: q, stand: this.careStand(q) }))
          .filter((q) => q.stand >= 0)
          .sort((a, b) => this.distance[a.stand] - this.distance[b.stand])[0]?.pawn;
      } else if (p.drafted) {
        target = this.pawns.find(
          (q) =>
            q.faction !== p.faction &&
            !q.dead &&
            !q.downed &&
            q.z === p.z &&
            Math.abs(p.x - q.x) + Math.abs(p.y - q.y) === 1,
        );
      }
      if (target) p.attackTargetId = target.id;
    }
    if (!target) {
      if (!p.path.length) p.reason = p.drafted ? '征召待命' : '没有可攻击目标';
      return;
    }
    if (p.z === target.z && Math.abs(p.x - target.x) + Math.abs(p.y - target.y) === 1) {
      p.path = [];
      p.destination = null;
      if (this.tick < p.nextAttackTick) return;
      const strike = selectMeleeAttack(
        p.weaponDropPending ? null : p.weapon,
        plantRandom(this.seed, p.id, this.tick, 11),
        meleeBodyFromTrauma(p.trauma),
      );
      if (!strike) {
        p.reason = '没有可用近战动作';
        return;
      }
      p.nextAttackTick = this.tick + strike.cooldown;
      // No skill system yet. This fixed hit chance is not a reconstructed RimWorld stat calculation.
      if (
        plantRandom(this.seed, p.id, this.tick, 12) >=
        0.75 * Math.max(0.1, healthSummary(p).manipulation)
      ) {
        p.reason = '近战落空：' + target.name;
        return;
      }
      const regions = (Object.keys(BODY_REGIONS) as BodyRegion[]).filter(
        (r) => !target!.trauma.brokenParts.includes(r),
      );
      let weight =
        plantRandom(this.seed, p.id, this.tick, 13) *
        regions.reduce((n, r) => n + BODY_REGIONS[r].weight, 0);
      const part = regions.find((r) => (weight -= BODY_REGIONS[r].weight) <= 0) ?? 'torso';
      const damage = Math.max(
        1,
        Math.round(strike.damage * (0.8 + plantRandom(this.seed, p.id, this.tick, 14) * 0.4)),
      );
      applyInjury(target.trauma, this.id(), part, strike.kind, damage);
      p.reason = '击中' + target.name + '的' + BODY_REGIONS[part].name;
      this.reconcileHealth(target);
      if (target.dead || target.downed) {
        p.attackTargetId = null;
        this.notice = target.name + '：' + target.reason;
      }
    } else if (!p.path.length || (this.tick + p.id) % 20 === 0) {
      this.search(p);
      const stand = this.careStand(target);
      if (stand >= 0) {
        this.go(p, stand, 'combat');
        p.reason = '接近' + target.name;
      } else {
        p.path = [];
        p.destination = null;
        p.reason = '目标不可达，等待通路';
        if (p.faction === 'raider') p.attackTargetId = null;
      }
    }
  }
  private apparelPieces(): ApparelPiece[] {
    return [
      ...this.items.flatMap((i) => (i.apparel ? [i.apparel] : [])),
      ...this.pawns.flatMap((p) => [...p.worn, ...(p.cargo?.apparel ? [p.cargo.apparel] : [])]),
    ];
  }
  private weaponPieces(): WeaponPiece[] {
    return [
      ...this.items.flatMap((i) => (i.weapon ? [i.weapon] : [])),
      ...this.pawns.flatMap((p) => [
        ...(p.weapon ? [p.weapon] : []),
        ...(p.cargo?.weapon ? [p.cargo.weapon] : []),
      ]),
    ];
  }
  private dropPrimary(p: Pawn, forbidden: boolean): boolean {
    if (!p.weapon) {
      p.weaponDropPending = false;
      return true;
    }
    if (p.carriedBy !== null) return false;
    const plan = this.planPlacement(
      [{ batch: { resource: 'weapon', amount: 1, weapon: { ...p.weapon }, forbidden }, origin: p }],
      this.items,
      DROP_DISTANCE,
      new Set(),
      p.id,
    );
    if (!plan) return false;
    this.commitPlacement(plan);
    p.weapon = null;
    p.weaponDropPending = false;
    return true;
  }
  private startWeapon(p: Pawn, weaponId: number, action: 'equip' | 'drop'): boolean {
    if (
      p.dead ||
      p.downed ||
      p.carriedBy !== null ||
      p.weaponDropPending ||
      healthSummary(p).manipulation <= 0 ||
      !Number.isSafeInteger(weaponId)
    )
      return false;
    if (this.pawns.some((q) => q.id !== p.id && q.weaponTask?.weaponId === weaponId)) return false;
    if (action === 'drop') {
      if (p.weapon?.id !== weaponId) return false;
      this.release(p);
      p.weaponTask = { action, weaponId, stage: 'work', progress: 0 };
      p.phase = 'weapon';
      p.reason = '准备放下武器';
      return true;
    }
    const item = this.items.find((i) => i.weapon?.id === weaponId),
      own = p.cargo?.weapon?.id === weaponId;
    if (!item && !own) return false;
    if (item && this.path(p, item) === null) return false;
    if (!own && !this.dropCargo(p)) return false;
    this.release(p);
    // Native player Equip removes forbidden before the physical job starts.
    if (item) item.forbidden = false;
    p.weaponTask = { action, weaponId, stage: own ? 'work' : 'fetch', progress: 0 };
    if (item) {
      this.search(p);
      this.go(p, at(item), 'weapon');
    } else p.phase = 'weapon';
    p.reason = '前往装备' + WEAPON_NAMES[(item?.weapon ?? p.cargo!.weapon)!.kind];
    return true;
  }
  private arriveWeapon(p: Pawn) {
    const task = p.weaponTask;
    if (!task) {
      this.release(p);
      return;
    }
    if (task.action === 'drop') {
      task.progress = Math.min(WEAPON_DROP_TICKS, task.progress + 1);
      if (task.progress < WEAPON_DROP_TICKS) return;
      if (!this.dropPrimary(p, true)) {
        p.reason = '附近没有武器落地空间，保留武器等待';
        return;
      }
      this.release(p);
      p.reason = '已放下武器，标为禁止自动搬运';
      return;
    }
    if (task.stage === 'fetch') {
      const item = this.items.find((i) => i.weapon?.id === task.weaponId);
      if (!item || !same(item, p) || !this.take(p, 'weapon', 1, item.id)) {
        this.release(p);
        p.reason = '目标武器已移动，请重新安排';
        return;
      }
      task.stage = 'work';
      p.path = [];
      p.destination = null;
    }
    const piece = p.cargo?.weapon;
    if (!piece || piece.id !== task.weaponId) {
      this.release(p);
      return;
    }
    if (!this.dropPrimary(p, false)) {
      p.reason = '旧武器无处放下，保留新旧武器等待';
      return;
    }
    p.weapon = piece;
    p.cargo = null;
    this.release(p);
    p.reason = '已装备' + WEAPON_NAMES[piece.kind];
  }
  private updateApparelWear() {
    for (const p of this.pawns) {
      if (p.dead) continue;
      p.apparelWearTicks++;
      for (const piece of p.worn) {
        piece.wearTicks++;
        if (p.apparelWearTicks % APPAREL_WEAR_INTERVAL === 0)
          piece.hitPoints -= apparelWearDamage(
            this.seed,
            piece.id,
            p.apparelWearTicks / APPAREL_WEAR_INTERVAL,
          );
      }
      const lost = p.worn.filter((piece) => piece.hitPoints <= 0);
      if (lost.length) {
        p.worn = p.worn.filter((piece) => piece.hitPoints > 0);
        this.stats.destroyed.apparel += lost.length;
        if (p.apparelTask && lost.some((piece) => piece.id === p.apparelTask!.apparelId))
          this.release(p);
        p.reason = '衣物磨损耗尽，已失去对应保温';
        this.revision++;
      }
    }
  }
  private startApparel(p: Pawn, apparelId: number, action: 'wear' | 'remove'): boolean {
    if (p.dead || p.downed || p.drafted || p.carriedBy !== null || !Number.isSafeInteger(apparelId))
      return false;
    if (this.pawns.some((q) => q.id !== p.id && q.apparelTask?.apparelId === apparelId))
      return false;
    if (action === 'remove') {
      if (!p.worn.some((piece) => piece.id === apparelId)) return false;
      this.release(p);
      p.apparelTask = { action, apparelId, stage: 'work', progress: 0 };
      p.phase = 'apparel';
      p.reason = '脱下衣物';
      return true;
    }
    const own = p.cargo?.apparel?.id === apparelId;
    const item = this.items.find((i) => i.apparel?.id === apparelId);
    if (!own && !item) return false;
    if (item && !this.path(p, item)) return false;
    if (!own && !this.dropCargo(p)) return false;
    this.release(p);
    p.apparelTask = { action, apparelId, stage: own ? 'work' : 'fetch', progress: 0 };
    if (own) {
      p.phase = 'apparel';
      p.reason = '穿上' + APPAREL_NAMES[p.cargo!.apparel!.kind];
    } else {
      this.search(p);
      this.go(p, at(item!), 'apparel');
      p.reason = '前往取用' + APPAREL_NAMES[item!.apparel!.kind];
    }
    return true;
  }
  private arriveApparel(p: Pawn) {
    const task = p.apparelTask;
    if (!task) {
      this.release(p);
      return;
    }
    if (task.stage === 'fetch') {
      const item = this.items.find((i) => i.apparel?.id === task.apparelId);
      if (!item || !same(item, p) || !this.take(p, 'apparel', 1, item.id)) {
        this.release(p);
        p.reason = '衣物已移动，重新安排';
        return;
      }
      task.stage = 'work';
      p.destination = null;
      p.path = [];
      p.reason = '穿上' + APPAREL_NAMES[p.cargo!.apparel!.kind];
      return;
    }
    const piece =
      task.action === 'wear'
        ? p.cargo?.apparel
        : p.worn.find((piece) => piece.id === task.apparelId);
    if (!piece || piece.id !== task.apparelId) {
      this.release(p);
      return;
    }
    const removed =
      task.action === 'remove' ? [piece] : p.worn.filter((old) => !compatibleApparel(old, piece));
    const work =
      apparelDelay(piece) +
      (task.action === 'wear' ? removed.reduce((n, old) => n + apparelDelay(old), 0) : 0);
    task.progress = Math.min(work, task.progress + 1);
    if (task.progress < work) return;
    const plan = this.planPlacement(
      removed.map((old) => ({
        batch: { resource: 'apparel' as const, amount: 1, apparel: { ...old } },
        origin: p,
      })),
      this.items,
      DROP_DISTANCE,
      new Set(),
      p.id,
    );
    if (!plan) {
      p.reason = '附近无衣物落地空间，保留当前穿戴和携带衣物';
      return;
    }
    this.commitPlacement(plan);
    p.worn = p.worn.filter((old) => !removed.some((piece) => piece.id === old.id));
    if (task.action === 'wear') {
      p.worn.push(piece);
      p.cargo = null;
    }
    const message = task.action === 'wear' ? '已穿上' : '已脱下';
    this.release(p);
    p.reason = message + APPAREL_NAMES[piece.kind];
  }
  private release(p: Pawn) {
    p.attackTargetId = null;
    this.releaseCare(p);
    p.apparelTask = null;
    p.weaponTask = null;
    this.craftSources.delete(p.id);
    this.storageReservations.delete(p.id);
    const j = this.jobs.find((j) => j.id === p.jobId);
    if (j?.owner === p.id) j.owner = null;
    p.jobId = null;
    p.path = [];
    p.destination = null;
    p.phase = p.dead
      ? 'dead'
      : p.downed
        ? 'downed'
        : p.drafted || p.faction === 'raider'
          ? 'combat'
          : 'idle';
    p.workTarget = null;
    p.eating = null;
    p.sleepBedId = null;
    p.sleepingSince = null;
  }
  private cancel(j: Job) {
    for (const p of this.pawns) if (p.jobId === j.id) this.release(p);
    j.cancelled = true;
    const origin = this.dropPoint(j);
    const batches = [
      ...resources
        .filter((r) => j.delivered[r] && !isPerishable(r))
        .map((r) => freshBatch(r, j.delivered[r]!)),
      ...j.deliveredFood,
    ];
    const plan = origin
      ? this.planPlacement(batches.map((batch) => ({ batch, origin })))
      : batches.length
        ? null
        : { items: this.items, nextId: this.nextId };
    if (!plan) {
      j.reason = '已取消，现场没有退料空间；材料保留原任务等待';
      return false;
    }
    this.commitPlacement(plan);
    this.jobs = this.jobs.filter((k) => k.id !== j.id);
    return true;
  }
  private dropPoint(p: Pos): Pos | undefined {
    if (this.standable(p)) return p;
    for (const [dx, dy] of horizontal) {
      const q = { x: p.x + dx, y: p.y + dy, z: p.z };
      if (this.standable(q)) return q;
    }
    return undefined;
  }
  private supported(j: Job) {
    if (j.kind === 'plantTree')
      return (
        this.treePlots.some((f) => same(f, j) && f.species === j.treeSpecies) &&
        !this.treeSiteReason(j, j.treeSpecies!, j.id)
      );
    if (j.kind === 'cut') return this.trees.some((t) => same(t, j) && t.species === j.treeSpecies);
    if (
      isDeviceKind(j.kind) ||
      j.kind === 'stonecutter' ||
      j.kind === 'tailor' ||
      j.kind === 'smithy'
    )
      return !this.placementReason(j.kind, j, j.axis);
    if (j.kind === 'smith')
      return this.weaponBenches.some(
        (b) =>
          same(b, j) &&
          b.kind === j.weaponBenchKind &&
          b.bills.some((v) => v.kind === j.weaponKind && !v.paused),
      );
    if (j.kind === 'tailoring')
      return this.tailors.some(
        (b) => same(b, j) && b.bills.some((bill) => bill.kind === j.apparelKind && !bill.paused),
      );
    if (j.kind === 'stonecut') return this.stonecutters.some((b) => same(b, j) && !b.paused);
    if (j.kind === 'refuel')
      return (
        this.devices.some(
          (d) => d.kind === 'generator' && same(d, j) && (j.cost.wood ?? 0) <= 75,
        ) ||
        this.weaponBenches.some(
          (b) => b.kind === 'smithy' && same(b, j) && (j.cost.wood ?? 0) <= 50,
        )
      );
    if (j.kind === 'bed' || j.kind === 'door') return !this.placementReason(j.kind, j, j.axis);
    if (j.kind === 'wall' || j.kind === 'stove') return this.blocks[index(j.x, j.y, j.z - 1)] !== 0;
    if (j.kind === 'cook') return this.stoves.some((s) => same(s, j) && !s.paused);
    if (j.kind === 'sow')
      return (
        this.farms.some((f) => same(f, j)) &&
        this.farmable(j) &&
        !this.crops.some((c) => same(c, j))
      );
    if (j.kind === 'harvest') return this.crops.some((c) => same(c, j) && c.growth >= 1);
    if (j.kind === 'floor')
      return horizontal.some(([dx, dy]) => {
        const q = { x: j.x + dx, y: j.y + dy, z: j.z - 1 };
        return inside(q) && (this.blocks[at(q)] !== 0 || this.ladders[at(q)] !== 0);
      });
    if (j.kind === 'ladder')
      return (
        this.blocks[index(j.x, j.y, j.z - 1)] !== 0 ||
        this.ladders[index(j.x, j.y, j.z - 1)] !== 0 ||
        this.ladders[index(j.x, j.y, j.z + 1)] !== 0
      );
    if (j.kind === 'digLadder') return this.ladders[index(j.x, j.y, j.z + 1)] !== 0;
    return true;
  }
  private assign(p: Pawn) {
    if (p.food < 30 && this.tryFood(p)) return;
    if (p.priorities.care > 0 && this.tryCare(p)) return;
    if (wantsSleep(p.rest, assignmentAt(p.schedule, this.tick))) {
      this.startSleep(p);
      return;
    }
    if (p.cargo) {
      this.deliverCargo(p);
      return;
    }
    const jobs = this.jobs
      .filter((j) => !j.cancelled && j.owner === null && p.priorities[workType(j.kind)] > 0)
      .sort(
        (a, b) => p.priorities[workType(a.kind)] - p.priorities[workType(b.kind)] || a.id - b.id,
      );
    const loose =
      p.priorities.haul > 0 &&
      this.stockpiles.length > 0 &&
      this.items.some((i) => this.canImproveStorage(i));
    // Most growing ticks have no work. Avoid traversing the full 3D map for idle people.
    if (
      !loose &&
      !jobs.some(
        (j) =>
          this.supported(j) &&
          (!missing(j) ||
            (j.kind === 'refuel' && (j.delivered.wood ?? 0) > 0) ||
            this.items.some((i) => i.resource === missing(j))),
      )
    ) {
      for (const j of jobs) {
        const needed = missing(j);
        j.reason = !this.supported(j)
          ? '等待支撑或相邻梯子施工'
          : needed
            ? `缺少${RESOURCE_NAMES[needed]}`
            : '等待工作面';
      }
      p.reason =
        p.food < 30
          ? '饥饿，暂无可用食物'
          : jobs.length
            ? '等待材料或支撑'
            : p.priorities.haul > 0 && this.items.some((i) => this.storagePriority(i) < 3)
              ? '仓储已满或不可达，等待可用仓位'
              : '暂无工作';
      return;
    }
    this.search(p);
    for (const j of jobs) {
      if (
        j.kind === 'smith' &&
        j.progress < j.work &&
        this.weaponBenches.some((b) => same(b, j) && b.kind === 'smithy' && b.fuel <= 0)
      ) {
        j.reason = '等待补充燃料';
        continue;
      }
      if (!this.supported(j)) {
        j.reason = '等待支撑或相邻梯子施工';
        continue;
      }
      const stand = this.reachableStand(j);
      if (stand < 0) {
        j.reason = '无可达工作面；需要两格净空与层间通路';
        continue;
      }
      if (
        j.kind === 'stonecut' &&
        this.jobs.some(
          (other) =>
            other.id !== j.id &&
            other.kind === 'stonecut' &&
            other.owner !== null &&
            this.stands(other).includes(stand),
        )
      ) {
        j.reason = '切石工作位置已被占用';
        continue;
      }
      this.allowPartialRefuel(j);
      const needed = missing(j);
      if (needed && !this.pileFor(p, needed)) {
        j.reason = `缺少可达${RESOURCE_NAMES[needed]}`;
        continue;
      }
      j.owner = p.id;
      p.jobId = j.id;
      p.workTarget = { x: j.x, y: j.y, z: j.z };
      this.continueJob(p, j);
      return;
    }
    if (p.priorities.haul > 0) {
      let best: Stack | undefined;
      let priority = -1;
      for (const i of this.items)
        if (this.distance[at(i)] >= 0 && !this.chunkReserved(i, p.id)) {
          const destination = this.storageDestination(i, this.storagePriority(i), p.id);
          if (
            destination &&
            (!best ||
              destination.priority > priority ||
              (destination.priority === priority && this.distance[at(i)] < this.distance[at(best)]))
          ) {
            best = i;
            priority = destination.priority;
          }
        }
      if (best) {
        const target = this.storageDestination(best, this.storagePriority(best), p.id)!;
        this.reserveStorage(p, best, target, best.id);
        this.go(p, at(best), 'haul');
        p.reason = '收集散落物资';
        return;
      }
    }
    p.phase = 'idle';
    p.reason = jobs.length ? '等待材料或可达通路' : '暂无工作';
  }
  private startSleep(p: Pawn) {
    this.release(p);
    const retainedCargo = !this.dropCargo(p);
    this.search(p);
    const available = this.beds
      .filter(
        (b) =>
          !b.medical &&
          (b.owner === null || b.owner === p.id) &&
          this.distance[at(b)] >= 0 &&
          !this.pawns.some(
            (other) =>
              other.id !== p.id &&
              (other.sleepBedId === b.id ||
                ((other.dead || other.downed) && bedCells(b).some((cell) => same(cell, other)))),
          ),
      )
      .sort(
        (a, b) =>
          Number(b.owner === p.id) - Number(a.owner === p.id) ||
          this.distance[at(a)] - this.distance[at(b)],
      );
    const bed = available[0];
    if (bed) {
      if (bed.owner === null) {
        for (const b of this.beds) if (b.owner === p.id) b.owner = null;
        bed.owner = p.id;
      }
      p.sleepBedId = bed.id;
      this.go(p, at(bed), 'sleepTravel');
      p.reason = retainedCargo ? '无卸货空间，保留随身物资前往床位' : '前往床位睡觉';
    } else {
      p.phase = 'rest';
      p.sleepingSince = this.tick;
      p.reason = retainedCargo ? '无卸货空间，保留随身物资地面睡眠' : '地面睡眠（无可达空床）';
    }
  }
  private continueJob(p: Pawn, j: Job) {
    if (j.cancelled) {
      this.release(p);
      return;
    }
    if (p.cargo) {
      this.deliverCargo(p);
      return;
    }
    this.search(p);
    this.allowPartialRefuel(j);
    const needed = missing(j);
    if (needed) {
      const stack = this.pileFor(p, needed);
      if (!stack) {
        j.reason = `等待可达${RESOURCE_NAMES[needed]}`;
        this.release(p);
        return;
      }
      this.go(p, at(stack), 'fetch');
      if (stack.resource === 'chunk') this.craftSources.set(p.id, stack.id);
      p.reason = `搬运${RESOURCE_NAMES[needed]}`;
      return;
    }
    const stand = this.reachableStand(j);
    if (stand < 0) {
      j.reason = '通路已改变，等待重新连通';
      this.release(p);
      return;
    }
    this.go(p, stand, 'work');
    p.reason = '前往工作面';
    j.reason = JOB_NAMES[j.kind] + '中';
  }
  private allowPartialRefuel(j: Job) {
    if (j.kind !== 'refuel') return;
    // Ordinary (non-atomic) refuelling may use the wood actually reachable now.
    // Other construction recipes still require every ingredient before work starts.
    const available =
      (j.delivered.wood ?? 0) +
      this.items.reduce(
        (n, i) => n + (i.resource === 'wood' && this.distance[at(i)] >= 0 ? i.amount : 0),
        0,
      );
    if (available > 0) j.cost.wood = Math.min(j.cost.wood ?? 75, available);
  }
  private deliverCargo(p: Pawn) {
    if (!p.cargo) return;
    this.search(p);
    let j = this.jobs.find((j) => j.id === p.jobId && !j.cancelled);
    // Loading deliberately clears reservations, but the carried physical input
    // can be rebound to a reachable job before requiring a stockpile detour.
    if (!j) {
      j = this.jobs.find(
        (k) =>
          !k.cancelled &&
          k.owner === null &&
          p.priorities[workType(k.kind)] > 0 &&
          (k.cost[p.cargo!.resource] ?? 0) > (k.delivered[p.cargo!.resource] ?? 0) &&
          this.supported(k) &&
          this.reachableStand(k) >= 0,
      );
      if (j) {
        j.owner = p.id;
        p.jobId = j.id;
        p.workTarget = { x: j.x, y: j.y, z: j.z };
      }
    }
    if (j && (j.delivered[p.cargo.resource] ?? 0) < (j.cost[p.cargo.resource] ?? 0)) {
      const stand = this.reachableStand(j);
      if (stand >= 0) {
        this.storageReservations.delete(p.id);
        this.go(p, stand, 'work');
        p.reason = '把材料送往工作面';
        return;
      }
    }
    const best = this.storageDestination(p.cargo, -1, p.id);
    if (!best) {
      this.storageReservations.delete(p.id);
      p.reason = '仓储已满或不可达，保留随身物资等待可用仓位';
      p.phase = 'idle';
      p.path = [];
      p.destination = null;
      return;
    }
    this.reserveStorage(p, p.cargo, best, null);
    this.go(p, at(best), 'haul');
    p.reason = '运往仓储';
  }
  private take(p: Pawn, resource: Resource | undefined, amount: number, stackId?: number) {
    const item = this.items.find(
      (i) =>
        same(i, p) &&
        (!resource || i.resource === resource) &&
        (stackId === undefined || i.id === stackId),
    );
    if (!item || amount <= 0 || p.cargo || this.chunkReserved(item, p.id)) return false;
    const n = Math.min(amount, this.availableStack(item, p.id), carryLimit(item.resource));
    if (n <= 0) return false;
    p.cargo = portion(item, n);
    this.craftSources.delete(p.id);
    item.amount -= n;
    this.items = this.items.filter((i) => i.amount > 0);
    return true;
  }
  private consume(p: Pawn, resource: Resource, available: number) {
    const nutrition = NUTRITION[resource];
    if (!nutrition) return 0;
    const amount =
      resource === 'grain'
        ? Math.min(available, Math.ceil((100 - p.food) / (nutrition * 100)))
        : Math.min(1, available);
    p.food = Math.min(100, p.food + amount * nutrition * 100);
    this.stats.consumed[resource] += amount;
    this.stats.eaten += amount;
    return amount;
  }
  private tryFood(p: Pawn) {
    if (p.dead || p.downed || p.carriedBy !== null) return false;
    if (p.cargo && NUTRITION[p.cargo.resource]) {
      p.cargo.amount -= this.consume(p, p.cargo.resource, p.cargo.amount);
      if (!p.cargo.amount) p.cargo = null;
      this.release(p);
      p.reason = '吃过随身食物';
      return true;
    }
    if (!this.items.some((i) => NUTRITION[i.resource])) return false;
    this.search(p);
    const food = (['meal', 'food', 'grain'] as Resource[])
      .map((r) => this.pileFor(p, r))
      .find(Boolean);
    if (!food) return false;
    this.release(p);
    const retainedCargo = !this.dropCargo(p);
    // Drop planning uses bounded navigation; restore the path tree to the food.
    this.search(p);
    p.eating = food.resource;
    this.go(p, at(food), 'fetch');
    p.reason = `${retainedCargo ? '无卸货空间，保留随身物资；' : ''}寻找${RESOURCE_NAMES[food.resource]}`;
    return true;
  }
  private arrive(p: Pawn) {
    if (p.phase === 'combat') {
      p.destination = null;
      return;
    }
    if (p.phase === 'weapon') {
      this.arriveWeapon(p);
      return;
    }
    if (p.phase === 'apparel') {
      this.arriveApparel(p);
      return;
    }
    const j = this.jobs.find((j) => j.id === p.jobId);
    if (p.phase === 'care') {
      this.arriveCare(p);
      return;
    }
    if (p.phase === 'sleepTravel') {
      const b = this.beds.find((b) => b.id === p.sleepBedId && b.owner === p.id && same(b, p));
      if (!b) {
        this.release(p);
        return;
      }
      p.phase = 'rest';
      p.sleepingSince = this.tick;
      p.reason = '在床上睡觉';
      return;
    }
    if (p.phase === 'fetch') {
      if (!j) {
        const food = this.items.find((i) => same(i, p) && i.resource === p.eating);
        if (food) food.amount -= this.consume(p, food.resource, this.availableStack(food, p.id));
        this.items = this.items.filter((i) => i.amount > 0);
        this.release(p);
        return;
      }
      const needed = missing(j);
      if (needed && this.take(p, needed, (j.cost[needed] ?? 0) - (j.delivered[needed] ?? 0)))
        this.deliverCargo(p);
      else this.continueJob(p, j);
      return;
    }
    if (p.phase === 'haul') {
      if (p.cargo) {
        this.search(p);
        const current = this.stockpiles.find(
          (s) => same(s, p) && s.accepts.includes(p.cargo!.resource),
        );
        if (
          !current ||
          this.storageSpace(p, p.cargo, p.id) <= 0 ||
          this.storageDestination(p.cargo, current.priority, p.id)
        ) {
          this.deliverCargo(p);
          return;
        }
        const n = Math.min(p.cargo.amount, this.storageSpace(p, p.cargo, p.id));
        const plan = this.planPlacement(
          [{ batch: portion(p.cargo, n), origin: p, cells: [p] }],
          this.items,
          0,
          new Set(),
          p.id,
        )!;
        this.commitPlacement(plan);
        this.stats.hauled += n;
        p.cargo.amount -= n;
        if (!p.cargo.amount) p.cargo = null;
        this.release(p);
        if (p.cargo) this.deliverCargo(p);
      } else {
        this.search(p);
        const reservation = this.storageReservations.get(p.id);
        const item = this.items.find(
          (i) => same(i, p) && (!reservation || reservation.sourceId === i.id),
        );
        const target = item && this.storageDestination(item, this.storagePriority(item), p.id);
        const n = item && target ? this.reserveStorage(p, item, target, item.id) : 0;
        if (item && n && this.take(p, item.resource, n, item.id)) {
          this.storageReservations.get(p.id)!.sourceId = null;
          this.deliverCargo(p);
        } else this.release(p);
      }
      return;
    }
    if (p.phase === 'travel') {
      this.release(p);
      p.reason = '已到达';
      return;
    }
    if (p.phase === 'work' && j) {
      if (!this.stands(j).includes(at(p))) {
        this.continueJob(p, j);
        return;
      }
      if (p.cargo) {
        const resource = p.cargo.resource,
          needed = (j.cost[resource] ?? 0) - (j.delivered[resource] ?? 0);
        if (needed <= 0) {
          this.deliverCargo(p);
          return;
        }
        const n = Math.min(p.cargo.amount, needed);
        this.deliverFood(j, p.cargo, n);
        j.delivered[resource] = (j.delivered[resource] ?? 0) + n;
        p.cargo.amount -= n;
        if (p.cargo.amount === 0) p.cargo = null;
      }
      if (missing(j)) {
        this.continueJob(p, j);
        return;
      }
      if (j.kind === 'smith') {
        const bench = this.weaponBenches.find((b) => same(b, j))!;
        if (bench.kind === 'smithy') {
          if (j.progress < j.work && bench.fuel <= 0) {
            j.reason = '缺少燃料，保留加工进度';
            this.release(p);
            return;
          }
          if (j.progress < j.work) bench.fuel = Math.max(0, bench.fuel - SMITHY_FUEL_PER_TICK);
        }
      }
      p.reason = '正在' + JOB_NAMES[j.kind];
      const cutting =
        j.kind === 'cut' && !j.legacyCut ? this.trees.find((t) => same(t, j)) : undefined;
      j.progress = Math.min(
        j.work,
        j.progress + (cutting ? treeWorkSpeed(cutting.growth) : 1) * healthSummary(p).manipulation,
      );
      if (j.progress >= j.work) this.finish(p, j);
    }
  }
  private finish(p: Pawn, j: Job) {
    if (j.cancelled) {
      this.release(p);
      return;
    }
    if (j.kind === 'plantTree' && !this.treeCanAppear(j, j.treeSpecies!, j.id)) {
      j.reason = '树苗会阻挡人物、工作位置或唯一通路，等待位置腾空';
      this.release(p);
      return;
    }
    const devicePlan =
      j.kind === 'stonecutter' || j.kind === 'tailor' || j.kind === 'smithy'
        ? stonecutterCells({ ...j, axis: j.axis ?? 'x' })
        : isDeviceKind(j.kind)
          ? deviceCells({ ...j, kind: j.kind, axis: j.axis ?? 'x' })
          : [];
    const changes: { pos: Pos; block?: number; ladder?: number }[] = [];
    const yields: Partial<Counts> = {};
    let harvestedCrop: CropKind | undefined;
    const reward = (b: number, p: Pos) => {
      const resource =
        b === Block.Steel
          ? 'steel'
          : b === Block.Components
            ? 'components'
            : b === Block.Stone
              ? 'chunk'
              : null;
      if (resource)
        yields[resource] =
          (yields[resource] ?? 0) +
          (resource === 'steel'
            ? 40
            : resource === 'components'
              ? 2
              : naturalChunkDrop(this.seed, p));
    };
    if (j.kind === 'mine' || j.kind === 'digLadder') {
      for (const z of j.kind === 'mine' ? [j.z, j.z + 1] : [j.z]) {
        const q = { x: j.x, y: j.y, z },
          b = this.blocks[at(q)];
        if (b === Block.Bedrock || b === Block.Wood || b === Block.Masonry) continue;
        if (b) {
          reward(b, q);
          changes.push({ pos: q, block: 0 });
        }
      }
      if (j.kind === 'digLadder') changes.push({ pos: j, ladder: 1 });
    } else if (j.kind === 'floor')
      changes.push({
        pos: { ...j, z: j.z - 1 },
        block: j.material === 'stone' ? Block.Masonry : Block.Wood,
      });
    else if (j.kind === 'wall')
      for (const z of [j.z, j.z + 1])
        changes.push({
          pos: { ...j, z },
          block: j.material === 'stone' ? Block.Masonry : Block.Wood,
        });
    else if (j.kind === 'ladder') changes.push({ pos: j, ladder: 1 });
    else if (j.kind === 'remove') {
      const device = this.deviceAt(j);
      if (device) {
        for (const [r, n] of Object.entries(DEVICE_COSTS[device.kind]))
          yields[r as Resource] = Math.floor(n / 2);
        if (device.kind === 'generator') yields.wood = Math.floor(device.fuel);
      } else if (this.weaponBenchAt(j)) {
        const bench = this.weaponBenchAt(j)!;
        if (bench.kind === 'smithy') {
          yields.steel = 50;
          yields.wood = Math.floor(bench.fuel);
        }
      } else if (this.tailorAt(j)) {
        yields.wood = Math.floor(TAILOR_COST.wood! / 2);
      } else if (this.stonecutterAt(j)) {
        for (const [resource, n] of Object.entries(STONECUTTER_COST))
          yields[resource as Resource] = Math.floor(n / 2);
      } else if (this.wires.some((w) => same(w, j))) {
        yields.steel = 1;
      } else if (this.bedAt(j)) {
        yields.wood = 22;
      } else if (this.doors.some((d) => same(d, j))) {
        yields.wood = 12;
      } else if (this.stoves.some((s) => same(s, j))) {
        yields.wood = 10;
      } else if (this.ladders[at(j)]) {
        changes.push({ pos: j, ladder: 0 });
        yields.wood = 1;
      } else {
        const start = [Block.Wood, Block.Masonry].includes(this.blocks[at(j)] as 4 | 7)
          ? j.z
          : j.z - 1;
        for (const z of start === j.z ? [start, start + 1] : [start]) {
          const block = this.blocks[index(j.x, j.y, z)];
          if (block === Block.Wood || block === Block.Masonry) {
            changes.push({ pos: { ...j, z }, block: 0 });
            const resource = block === Block.Masonry ? 'stone' : 'wood';
            yields[resource] = (yields[resource] ?? 0) + (resource === 'stone' ? 2 : 1);
          }
        }
      }
    }
    if (!this.supported(j)) {
      j.reason = '支撑已改变，等待恢复';
      this.release(p);
      return;
    }
    // Determine every output before mutating its physical source. A full local
    // floor keeps the tree, ore, crop or delivered recipe intact for a retry.
    if (j.kind === 'cut') {
      const tree = this.trees.find((t) => same(t, j));
      yields.wood = tree ? treeYield(tree, this.seed) : 0;
    }
    if (j.kind === 'harvest') {
      harvestedCrop = this.crops.find((c) => same(c, j))!.kind;
      yields[harvestedCrop === 'cotton' ? 'cloth' : 'grain'] = CROPS[harvestedCrop].yield;
    }
    if (j.kind === 'cook') yields.meal = SIMPLE_MEAL.output;
    if (j.kind === 'stonecut') yields.stone = STONECUTTING.output;
    if (j.kind === 'tailoring') yields.apparel = 1;
    if (j.kind === 'smith') yields.weapon = 1;
    const previous = changes.map((c) => ({
      i: at(c.pos),
      block: this.blocks[at(c.pos)],
      ladder: this.ladders[at(c.pos)],
    }));
    const supportedItems = this.items.filter((i) => this.standable(i));
    // Demolition must not strand an otherwise supported upper platform. Preserve
    // existing access to the camp for people and loose goods, not just foot support.
    const exit = this.stockpiles.find((q) => this.standable(q)) ?? this.spawn;
    let mustKeepExit: Pos[] = [];
    if (j.kind === 'remove' && changes.length && this.standable(exit)) {
      this.search(exit);
      mustKeepExit = [...this.pawns, ...supportedItems].filter((q) => this.distance[at(q)] >= 0);
    }
    const rollback = (reason: string) => {
      if (j.kind === 'stove') this.stoveCells.delete(at(j));
      if (devicePlan.length) this.rebuildDevices();
      for (let i = previous.length - 1; i >= 0; i--) {
        const c = previous[i];
        this.blocks[c.i] = c.block;
        this.ladders[c.i] = c.ladder;
      }
      j.reason = reason;
      this.release(p);
    };
    for (const c of changes) {
      if (c.block !== undefined) this.blocks[at(c.pos)] = c.block;
      if (c.ladder !== undefined) this.ladders[at(c.pos)] = c.ladder;
    }
    if (j.kind === 'stove') this.stoveCells.add(at(j));
    for (const q of devicePlan) {
      this.deviceBlocks.add(at(q));
      this.deviceBlocks.add(at({ ...q, z: q.z + 1 }));
    }
    if (
      this.pawns.some((p) => !this.standable(p)) ||
      this.stockpiles.some((s) => !this.standable(s) || this.ladders[at(s)]) ||
      [...this.stoves, ...this.weaponBenches.filter((b) => b.kind === 'craftingSpot')].some(
        (s) =>
          !this.blocks[at(s) - WIDTH * DEPTH] ||
          this.blocks[at(s)] ||
          this.blocks[at(s) + WIDTH * DEPTH],
      ) ||
      [
        ...this.beds.flatMap(bedCells),
        ...this.doors,
        ...this.devices.flatMap(deviceCells),
        ...this.stonecutters.flatMap(stonecutterCells),
        ...this.tailors.flatMap(tailorCells),
        ...this.weaponBenches.filter((b) => b.kind === 'smithy').flatMap(weaponBenchCells),
      ].some(
        (s) =>
          !this.blocks[at(s) - WIDTH * DEPTH] ||
          this.blocks[at(s)] ||
          this.blocks[at(s) + WIDTH * DEPTH],
      )
    ) {
      rollback('有人占用或依赖这处支撑，请先移开人物');
      return;
    }
    if (mustKeepExit.length) {
      this.search(exit);
      if (!this.standable(exit) || mustKeepExit.some((q) => this.distance[at(q)] < 0)) {
        rollback('拆除会切断人物或物资返回营地的通路，请从远端逐步拆除');
        return;
      }
    }
    // Construction nudges loose stacks one horizontal cell, never buries them or
    // silently teleports them to distant storage. Validate every displacement before committing.
    const forbidden = new Set(
      j.kind === 'bed' ? bedCells({ ...j, axis: j.axis ?? 'x' }).map(at) : [],
    );
    const displaced: { batch: Cargo; origin: Pos; cells: Pos[] }[] = [];
    const displacedIds = new Set<number>();
    this.search(p);
    for (const item of supportedItems)
      if (!this.groundAllowed(item) || forbidden.has(at(item))) {
        const cells = horizontal
          .map(([dx, dy]) => ({ x: item.x + dx, y: item.y + dy, z: item.z }))
          .filter((q) => inside(q) && this.distance[at(q)] >= 0);
        displaced.push({ batch: item, origin: item, cells });
        displacedIds.add(item.id);
      }
    const output = Object.entries(yields)
      .filter(([, n]) => n > 0)
      .map(([resource, n]) => ({
        batch:
          resource === 'weapon'
            ? { resource: 'weapon' as const, amount: 1, weapon: makeWeapon(j.id, j.weaponKind!) }
            : resource === 'apparel'
              ? {
                  resource: 'apparel' as const,
                  amount: 1,
                  apparel: makeApparel(j.id, j.apparelKind!),
                }
              : freshBatch(
                  resource as Resource,
                  n,
                  resource === 'grain' && harvestedCrop !== 'cotton' ? harvestedCrop : undefined,
                ),
        origin: p,
      }));
    const placement = this.planPlacement(
      [...displaced, ...output],
      this.items.filter((i) => !displacedIds.has(i.id)),
      DROP_DISTANCE,
      forbidden,
    );
    if (!placement) {
      rollback(
        displaced.length
          ? '散落物资无相邻空位或容量，请先搬走再施工'
          : '产物没有附近可达落地空间，保留原料等待清理',
      );
      return;
    }
    this.commitPlacement(placement);
    if (j.kind === 'cut') {
      const tree = this.trees.find((t) => same(t, j));
      if (tree) {
        this.trees = this.trees.filter((t) => t.id !== tree.id);
        this.rebuildTrees();
        this.skyCache.clear();
        this.revision++;
        this.stats.cut++;
      }
    }
    if (j.kind === 'plantTree') this.createTree(j, j.treeSpecies!, true);
    if (j.kind === 'smithy') {
      this.weaponBenches.push(makeWeaponBench(this.id(), 'smithy', j, j.axis ?? 'x'));
      this.rebuildDevices();
      this.revision++;
    } else if (j.kind === 'smith') {
      this.stats.weaponsMade++;
    } else if (j.kind === 'remove' && this.weaponBenchAt(j)) {
      const bench = this.weaponBenchAt(j)!;
      this.weaponBenches = this.weaponBenches.filter((b) => b.id !== bench.id);
      this.rebuildDevices();
      this.revision++;
    } else if (j.kind === 'tailor') {
      this.tailors.push({
        id: this.id(),
        x: j.x,
        y: j.y,
        z: j.z,
        axis: j.axis ?? 'x',
        bills: APPAREL_KINDS.map((kind) => ({ kind, target: 0, paused: false })),
      });
      this.rebuildDevices();
      this.revision++;
    } else if (j.kind === 'tailoring') {
      this.stats.tailored++;
    } else if (j.kind === 'remove' && this.tailorAt(j)) {
      const bench = this.tailorAt(j)!;
      this.tailors = this.tailors.filter((b) => b.id !== bench.id);
      this.rebuildDevices();
      this.revision++;
    } else if (j.kind === 'stonecutter') {
      this.stonecutters.push({
        id: this.id(),
        x: j.x,
        y: j.y,
        z: j.z,
        axis: j.axis ?? 'x',
        target: 80,
        paused: false,
      });
      this.rebuildDevices();
      this.revision++;
    } else if (j.kind === 'stonecut') {
      this.stats.stonecut++;
    } else if (j.kind === 'remove' && this.stonecutterAt(j)) {
      const bench = this.stonecutterAt(j)!;
      this.stonecutters = this.stonecutters.filter((b) => b.id !== bench.id);
      this.rebuildDevices();
      this.revision++;
    } else if (isDeviceKind(j.kind)) {
      this.devices.push({
        id: this.id(),
        x: j.x,
        y: j.y,
        z: j.z,
        kind: j.kind,
        axis: j.axis ?? 'x',
        on: true,
        fuel: 0,
        energy: 0,
        target: 21,
        powered: false,
        active: false,
        networkId: null,
        watts: 0,
        reason: '等待接入电网',
      });
      this.rebuildDevices();
      this.powerDirty = true;
      this.roomsDirty = true;
      this.revision++;
    } else if (j.kind === 'wire') {
      if (!this.wires.some((w) => same(w, j))) this.wires.push({ x: j.x, y: j.y, z: j.z });
      this.powerDirty = true;
      this.revision++;
    } else if (j.kind === 'refuel') {
      const bench = this.weaponBenchAt(j);
      if (bench?.kind === 'smithy') bench.fuel = Math.min(50, bench.fuel + (j.delivered.wood ?? 0));
      else {
        const device = this.deviceAt(j)!;
        device.fuel = Math.min(75, device.fuel + (j.delivered.wood ?? 0));
      }
    } else if (j.kind === 'remove' && this.deviceAt(j)) {
      const device = this.deviceAt(j)!;
      this.devices = this.devices.filter((d) => d.id !== device.id);
      this.rebuildDevices();
      this.powerDirty = true;
      this.roomsDirty = true;
      this.revision++;
    } else if (j.kind === 'remove' && this.wires.some((w) => same(w, j))) {
      this.wires = this.wires.filter((w) => !same(w, j));
      this.powerDirty = true;
      this.revision++;
    } else if (j.kind === 'sow') {
      const plot = this.farms.find((f) => same(f, j))!;
      this.crops.push({
        id: this.id(),
        x: j.x,
        y: j.y,
        z: j.z,
        kind: plot.crop,
        growth: 0,
        sownAt: this.tick,
      });
      this.stats.sown++;
      this.revision++;
    } else if (j.kind === 'harvest') {
      const crop = this.crops.find((c) => same(c, j))!;
      harvestedCrop = crop.kind;
      yields[crop.kind === 'cotton' ? 'cloth' : 'grain'] = CROPS[crop.kind].yield;
      this.crops = this.crops.filter((c) => c.id !== crop.id);
      this.stats.harvested++;
      this.revision++;
    } else if (j.kind === 'stove') {
      this.stoves.push({ id: this.id(), x: j.x, y: j.y, z: j.z, target: 10, paused: false });
      this.skyCache.clear();
      this.revision++;
    } else if (j.kind === 'bed') {
      this.beds.push({
        id: this.id(),
        x: j.x,
        y: j.y,
        z: j.z,
        axis: j.axis ?? 'x',
        owner: null,
        medical: false,
      });
      this.revision++;
    } else if (j.kind === 'door') {
      this.doors.push({
        id: this.id(),
        x: j.x,
        y: j.y,
        z: j.z,
        axis: j.axis ?? 'x',
        mode: 'auto',
        openUntil: 0,
      });
      this.roomsDirty = true;
      this.revision++;
    } else if (j.kind === 'remove' && this.bedAt(j)) {
      const bed = this.bedAt(j)!;
      for (const p of this.pawns)
        if (p.sleepBedId === bed.id || p.careBedId === bed.id) this.release(p);
      this.beds = this.beds.filter((b) => b.id !== bed.id);
      this.revision++;
    } else if (j.kind === 'remove' && this.doors.some((d) => same(d, j))) {
      this.doors = this.doors.filter((d) => !same(d, j));
      this.roomsDirty = true;
      this.revision++;
    } else if (j.kind === 'cook') {
      yields.meal = SIMPLE_MEAL.output;
      this.stats.cooked++;
    } else if (j.kind === 'remove' && this.stoves.some((s) => same(s, j))) {
      this.stoves = this.stoves.filter((s) => !same(s, j));
      this.stoveCells.delete(at(j));
      this.skyCache.clear();
      this.revision++;
    }
    for (const c of changes) this.changed(c.pos);
    for (const [resource, n] of Object.entries(yields)) {
      this.stats.produced[resource as Resource] += n;
    }
    for (const r of resources) this.stats.consumed[r] += j.delivered[r] ?? 0;
    if (
      (j.cost.wood && !['cook', 'refuel', 'smith', 'tailoring'].includes(j.kind)) ||
      (j.material === 'stone' && ['wall', 'floor'].includes(j.kind)) ||
      isDeviceKind(j.kind) ||
      j.kind === 'wire'
    )
      this.stats.built++;
    if (j.kind === 'mine' || j.kind === 'digLadder')
      this.stats.mined += changes.filter((c) => c.block === 0).length;
    this.jobs = this.jobs.filter((k) => k.id !== j.id);
    this.release(p);
  }
  step(count = 1) {
    for (let n = 0; n < count; n++) {
      this.tick++;
      this.updateEnvironment();
      this.updatePreservation();
      this.updateTrees();
      this.refreshReservations();
      this.updateApparelWear();
      this.updateSurvival();
      for (const pawn of this.pawns) if (pawn.weaponDropPending) this.dropPrimary(pawn, true);
      this.updateRaids();
      // Only temperature/daylight change each tick; occlusion is cached until terrain changes.
      for (const c of this.crops)
        if (c.growth < 1)
          c.growth = Math.min(1, c.growth + this.cropCondition(c, c.kind).growthRate);
      if (this.tick % 20 === 0) this.syncProduction();
      for (const p of this.pawns) {
        if (p.dead || p.downed || p.carriedBy !== null) continue;
        const combatant = (p.drafted || p.faction === 'raider') && p.weaponTask === null;
        if (combatant) this.combatTick(p);
        if (
          !combatant &&
          !p.drafted &&
          this.pawns.some((q) => q.patientId === p.id && q.carePhase?.startsWith('tend'))
        ) {
          p.reason = '等待同伴包扎';
          continue;
        }
        if (p.phase === 'care' && !this.validCare(p)) {
          this.release(p);
          p.reason = '护理条件改变，重新安排';
        }
        if (
          p.phase !== 'care' &&
          !combatant &&
          !p.drafted &&
          p.phase !== 'travel' &&
          !p.eating &&
          p.food >= 30 &&
          p.rest > 14 &&
          p.priorities.care > 0 &&
          (this.tick + p.id) % 20 === 0 &&
          this.tryCare(p)
        )
          continue;
        if (
          p.food < 30 &&
          !combatant &&
          !p.drafted &&
          p.phase !== 'idle' &&
          p.phase !== 'travel' &&
          !p.eating &&
          (p.phase !== 'rest' || (p.food < 12 && p.rest > 14)) &&
          (this.tick + p.id) % 20 === 0 &&
          this.tryFood(p)
        )
          continue;
        if (p.phase === 'rest') {
          p.rest = Math.min(100, p.rest + restGain(p.sleepBedId !== null));
          if (p.rest >= 100 || (assignmentAt(p.schedule, this.tick) === 'work' && p.rest >= 20)) {
            this.release(p);
            p.reason = '醒来';
          }
          continue;
        }
        p.rest = Math.max(0, p.rest - restLoss(p.rest));
        if (
          !['rest', 'sleepTravel', 'travel', 'care'].includes(p.phase) &&
          !combatant &&
          !p.drafted &&
          !p.eating &&
          (this.tick + p.id) % 20 === 0 &&
          wantsSleep(p.rest, assignmentAt(p.schedule, this.tick))
        ) {
          this.startSleep(p);
          continue;
        }
        if (p.path.length) {
          if (this.tick < p.moveTick) continue;
          const next = p.path[0];
          if (!this.neighbors(p).includes(next)) {
            this.release(p);
            p.reason = '通路改变，等待重新规划';
            continue;
          }
          const door = this.doors.find((d) => same(d, position(next)));
          if (door?.mode === 'auto') {
            // 38 original ticks -> 13 at 20 TPS; 110 closing ticks -> 37.
            if (door.openUntil < this.tick) door.openUntil = this.tick + 13 + 37;
            if (this.tick < door.openUntil - 37) {
              p.reason = '等待木门打开';
              continue;
            }
            door.openUntil = this.tick + 37;
          }
          Object.assign(p, position(next));
          p.path.shift();
          p.moveTick =
            this.tick +
            Math.ceil(
              (p.cargo || p.carryingPawnId !== null ? 6 : 4) /
                Math.max(0.01, healthSummary(p).moving),
            );
          if (p.carryingPawnId !== null) {
            const patient = this.pawns.find((q) => q.id === p.carryingPawnId)!;
            Object.assign(patient, { x: p.x, y: p.y, z: p.z });
          }
          continue;
        }
        if (combatant) continue;
        if (p.phase === 'idle') {
          if ((this.tick + p.id) % 20 === 0) this.assign(p);
        } else this.arrive(p);
      }
      for (const d of this.doors)
        if (
          d.mode !== 'locked' &&
          (this.pawns.some((p) => same(p, d)) || this.items.some((i) => same(i, d)))
        )
          d.openUntil = this.tick + 37;
      this.updateRooms();
    }
  }
  updateRooms() {
    if (this.roomsDirty) {
      const coolers = this.devices.filter((d) => d.kind === 'cooler');
      this.rooms.rebuild(this.blocks, [...this.doors, ...coolers]);
      this.thermal.sync(
        this.blocks,
        this.rooms,
        [
          ...this.doors.map((d) => ({ ...d, kind: 'door' as const })),
          ...coolers.map((d) => ({ ...d, kind: 'cooler' as const })),
        ],
        this.outdoorTemperature(),
      );
      this.roomsDirty = false;
      this.roomRevision++;
    }
  }
  temperature(p: Pos) {
    this.updateRooms();
    return this.thermal.temperatureAt(p, this.outdoorTemperature());
  }
  outdoorTemperature() {
    return outdoorTemperature(this.tick, this.settings, this.generator);
  }
  get worldSummary(): WorldSummary {
    if (!this.summaryCache || this.summaryRevision !== this.revision) {
      this.summaryCache = summarizeWorld(this.blocks, this.trees, this.spawn, this.settings);
      this.summaryRevision = this.revision;
    }
    return this.summaryCache;
  }
  private updatePower() {
    if (this.powerDirty) {
      this.power.rebuild(this.wires, this.devices);
      this.powerDirty = false;
    }
  }
  private solarLight(d: Device) {
    let clear = 0;
    for (const p of deviceCells(d)) {
      let open = true;
      for (let z = p.z + 2; z < HEIGHT; z++) {
        const i = index(p.x, p.y, z);
        if (
          this.blocks[i] ||
          this.treeCells.has(i) ||
          this.stoveCells.has(i) ||
          this.deviceBlocks.has(i)
        ) {
          open = false;
          break;
        }
      }
      if (open) clear++;
    }
    return (daylight(hourAt(this.tick)) * clear) / deviceCells(d).length;
  }
  private thermalIntent(d: Device) {
    const cold = { x: d.x - (d.axis === 'x' ? 1 : 0), y: d.y - (d.axis === 'y' ? 1 : 0), z: d.z };
    const hot = { x: d.x + (d.axis === 'x' ? 1 : 0), y: d.y + (d.axis === 'y' ? 1 : 0), z: d.z };
    if (d.kind === 'heater') {
      const t = this.temperature(d),
        eff = Math.max(0, Math.min(1, (120 - t) / 100));
      return {
        cold: d,
        hot: d,
        heat: (21 / TPS) * eff,
        active: t < d.target && eff > 0,
        reason: t >= d.target ? '达到目标，低功耗待机' : '加热中',
      };
    }
    const blocked =
      !inside(cold) ||
      !inside(hot) ||
      this.solid(cold) ||
      this.solid(hot) ||
      this.deviceBlocks.has(at(cold)) ||
      this.deviceBlocks.has(at(hot)) ||
      this.rooms.roomAt(cold) === null ||
      this.rooms.roomAt(hot) === null;
    const c = this.temperature(cold),
      h = this.temperature(hot),
      eff = Math.max(0, 1 - (h - Math.min(c, 40)) / 130);
    return {
      cold,
      hot,
      heat: (21 / TPS) * eff,
      active: !blocked && c > d.target && eff > 0,
      reason: blocked
        ? '进风口或排热口被堵住'
        : c <= d.target
          ? '达到目标，低功耗待机'
          : eff <= 0
            ? '排热侧过热'
            : '制冷中',
    };
  }
  private updateEnvironment() {
    this.updateRooms();
    this.updatePower();
    const intents = new Map<number, ReturnType<VoxelSimulation['thermalIntent']>>();
    for (const d of this.devices)
      if (d.kind === 'heater' || d.kind === 'cooler') {
        const intent = this.thermalIntent(d);
        intents.set(d.id, intent);
        d.active = d.on && intent.active;
      }
    this.power.step(this.tick, this.devices, (d) => this.solarLight(d));
    for (const d of this.devices) {
      if (d.kind === 'generator' && d.powered)
        this.thermal.pushHeat(d, (6 / TPS) * (d.watts / 1000));
      const intent = intents.get(d.id);
      if (!intent) continue;
      d.active = d.powered && d.on && intent.active;
      if (d.powered) d.reason = intent.reason;
      if (!d.active) continue;
      if (d.kind === 'heater') this.thermal.pushHeat(d, intent.heat, d.target);
      else {
        this.thermal.pushHeat(intent.cold, -intent.heat, d.target);
        // Native cooler exhaust uses available energy before cold-side target clipping.
        this.thermal.pushHeat(intent.hot, intent.heat * 1.25);
      }
    }
    this.thermal.step(1 / TPS, this.outdoorTemperature(), this.doors, this.tick);
  }
  private updatePreservation() {
    // Ground stacks, carried food, and delivered recipe inputs are all physical
    // containers. Their current cell determines temperature; moving is not a
    // freshness reset. Food expires before the tick's eating/cooking actions.
    let removed = false;
    this.items = this.items.filter((item) => {
      if (!isPerishable(item.resource) || !advanceRot(item, this.temperature(item))) return true;
      this.stats.spoiled[item.resource] += item.amount;
      removed = true;
      return false;
    });
    for (const pawn of this.pawns)
      if (
        pawn.cargo &&
        isPerishable(pawn.cargo.resource) &&
        advanceRot(pawn.cargo, this.temperature(pawn))
      ) {
        this.stats.spoiled[pawn.cargo.resource] += pawn.cargo.amount;
        pawn.cargo = null;
        this.release(pawn);
        pawn.reason = '携带的食物已腐坏';
        removed = true;
      }
    for (const job of this.jobs)
      if (job.deliveredFood.length) {
        const temperature = this.temperature(job);
        job.deliveredFood = job.deliveredFood.filter((batch) => {
          if (!advanceRot(batch, temperature)) return true;
          this.stats.spoiled[batch.resource] += batch.amount;
          const remaining = (job.delivered[batch.resource] ?? 0) - batch.amount;
          if (remaining) job.delivered[batch.resource] = remaining;
          else delete job.delivered[batch.resource];
          job.progress = 0;
          job.reason = '已配送食材腐坏，等待新原料';
          removed = true;
          return false;
        });
      }
    if (removed) this.revision++;
  }
  counts(): Counts {
    const out = emptyCounts();
    for (const i of this.items) out[i.resource] += i.amount;
    for (const p of this.pawns) {
      if (p.cargo) out[p.cargo.resource] += p.cargo.amount;
      out.apparel += p.worn.length;
      out.weapon += p.weapon ? 1 : 0;
    }
    for (const j of this.jobs) for (const r of resources) out[r] += j.delivered[r] ?? 0;
    return out;
  }
  snapshot(speed = 0, tickMs = 0): VoxelSnapshot {
    this.updateRooms();
    this.updatePower();
    const stored = emptyCounts();
    for (const i of this.items)
      if (this.stockpiles.some((s) => same(s, i) && s.accepts.includes(i.resource)))
        stored[i.resource] += i.amount;
    return structuredClone({
      combat: this.combat,
      seed: this.seed,
      generator: this.generator,
      settings: this.settings,
      spawn: this.spawn,
      worldSummary: this.worldSummary,
      tick: this.tick,
      revision: this.revision,
      speed,
      pawns: this.pawns,
      items: this.items,
      trees: this.trees,
      treePlots: this.treePlots,
      treeConditions: this.trees.map((tree) => ({
        x: tree.x,
        y: tree.y,
        z: tree.z,
        ...this.treeCondition(tree),
      })),
      jobs: this.jobs,
      stockpiles: this.stockpiles,
      storageCapacity: this.storageCapacity(),
      farms: this.farms,
      crops: this.crops,
      stoves: this.stoves,
      stonecutters: this.stonecutters,
      tailors: this.tailors,
      weaponBenches: this.weaponBenches,
      beds: this.beds,
      doors: this.doors,
      rooms: this.rooms.snapshot(),
      roomRevision: this.roomRevision,
      roomBytes: this.rooms.memoryBytes,
      devices: this.devices,
      wires: this.wires,
      networks: this.power.snapshot(),
      roomTemperatures: this.thermal.snapshot(),
      thermalBytes: this.thermal.memoryBytes,
      powerBytes: this.power.memoryBytes,
      cropConditions: this.farms.map((f) => ({
        ...f,
        ...this.cropCondition(f, this.crops.find((c) => same(c, f))?.kind ?? f.crop),
      })),
      hour: hourAt(this.tick),
      temperature: this.outdoorTemperature(),
      inventory: this.counts(),
      stored,
      stats: this.stats,
      notice: this.notice,
      gridBytes: this.blocks.byteLength + this.ladders.byteLength,
      navigationBytes:
        this.distance.byteLength +
        this.parents.byteLength +
        this.queue.byteLength +
        this.treeRouteSeen.byteLength +
        this.treeRouteQueue.byteLength,
      tickMs,
    });
  }
  save(): VoxelSave {
    this.updateRooms();
    return structuredClone({
      format: 'emberfield-voxel',
      version: 13,
      combat: this.combat,
      generator: this.generator,
      settings: this.settings,
      spawn: this.spawn,
      seed: this.seed,
      tick: this.tick,
      nextId: this.nextId,
      blocks: encode(this.blocks),
      ladders: encode(this.ladders),
      pawns: this.pawns,
      items: this.items,
      trees: this.trees,
      treePlots: this.treePlots,
      jobs: this.jobs,
      stockpiles: this.stockpiles,
      farms: this.farms,
      crops: this.crops,
      stoves: this.stoves,
      stonecutters: this.stonecutters,
      tailors: this.tailors,
      weaponBenches: this.weaponBenches,
      beds: this.beds,
      doors: this.doors,
      devices: this.devices,
      wires: this.wires,
      thermal: this.thermal.save(),
      stats: this.stats,
    });
  }
  static load(raw: unknown) {
    if (!raw || typeof raw !== 'object') throw new Error('存档无效');
    const old = structuredClone(raw) as Record<string, any>;
    if (
      old.format !== 'emberfield-voxel' ||
      ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].includes(old.version) ||
      (old.version < 8 ? old.generator !== 1 : ![1, 2].includes(old.generator))
    )
      throw new Error('请使用体素版存档；二维存档仍在原营地入口读取');
    const sourceVersion = old.version;
    if (old.version === 1) {
      if (!Array.isArray(old.jobs) || !Array.isArray(old.pawns) || !old.stats)
        throw new Error('旧存档数据无效');
      for (const j of old.jobs) {
        if (!j || typeof j.cost !== 'number' || typeof j.delivered !== 'number')
          throw new Error('旧存档任务数据无效');
        j.cost = j.cost === 0 ? {} : { wood: j.cost };
        j.delivered = j.delivered === 0 ? {} : { wood: j.delivered };
      }
      for (const p of old.pawns) {
        if (!p) throw new Error('人物数据无效');
        p.priorities = { ...p.priorities, grow: 1, cook: 1 };
        p.eating = null;
      }
      old.farms = [];
      old.crops = [];
      old.stoves = [];
      old.stats = {
        ...old.stats,
        sown: 0,
        harvested: 0,
        cooked: 0,
        eaten: 0,
        produced: { ...old.stats.produced, grain: 0, meal: 0 },
        consumed: { ...old.stats.consumed, grain: 0, meal: 0 },
      };
      old.version = 2;
    }
    if (old.version === 2) {
      if (!Array.isArray(old.pawns)) throw new Error('旧存档人物无效');
      old.beds = [];
      old.doors = [];
      for (const p of old.pawns) {
        if (!p) throw new Error('人物数据无效');
        p.schedule = defaultSchedule();
        p.sleepBedId = null;
        p.sleepingSince = null;
        if (p.phase === 'rest') p.phase = 'idle';
      }
      old.version = 3;
    }
    if (old.version === 3) {
      old.devices = [];
      old.wires = [];
      old.thermal = [];
      old.version = 4;
    }
    if (old.version === 4) {
      if (![old.items, old.pawns, old.jobs, old.stockpiles].every(Array.isArray) || !old.stats)
        throw new Error('旧存档食物或库存数据无效');
      // Earlier saves did not retain species or age. Fresh rice is an explicit
      // compatibility boundary, not recovered historical freshness information.
      for (const item of old.items) {
        if (!item) throw new Error('旧存档物资无效');
        delete item.crop;
        delete item.rotProgress;
        Object.assign(item, freshBatch(item.resource, item.amount));
      }
      for (const pawn of old.pawns)
        if (pawn?.cargo) pawn.cargo = freshBatch(pawn.cargo.resource, pawn.cargo.amount);
      for (const job of old.jobs) {
        if (!job || !job.delivered) throw new Error('旧存档配送物资无效');
        job.deliveredFood = ['grain', 'meal'].flatMap((resource) =>
          job.delivered[resource] > 0
            ? [freshBatch(resource as Resource, job.delivered[resource])]
            : [],
        );
      }
      old.stockpiles = old.stockpiles.map((s: Pos) => ({
        ...s,
        priority: 1,
        accepts: resources.filter((r) => !['chunk', 'cloth', 'apparel', 'weapon'].includes(r)),
      }));
      old.stats.spoiled = emptyCounts();
      old.version = 5;
    }
    const migrateLogistics = old.version === 5;
    if (migrateLogistics) {
      if (!Array.isArray(old.jobs)) throw new Error('旧存档任务无效');
      for (const job of old.jobs) {
        if (!job) throw new Error('旧存档任务无效');
        job.cancelled = false;
      }
      old.version = 6;
    }
    const migrateCrafting = old.version === 6;
    if (migrateCrafting) {
      if (
        !Array.isArray(old.jobs) ||
        !Array.isArray(old.pawns) ||
        !old.stats ||
        !['produced', 'consumed', 'spoiled'].every(
          (key) => old.stats[key] && typeof old.stats[key] === 'object',
        )
      )
        throw new Error('旧存档加工数据无效');
      old.stonecutters = [];
      old.stats.stonecut = 0;
      for (const key of ['produced', 'consumed', 'spoiled']) old.stats[key].chunk = 0;
      for (const pawn of old.pawns) {
        if (!pawn?.priorities) throw new Error('旧存档工作优先级无效');
        pawn.priorities.craft = 1;
      }
      for (const job of old.jobs)
        if (job && ['wall', 'floor'].includes(job.kind)) job.material = 'wood';
      // Legacy stone already represented usable building material. Preserve its
      // quantity; old storage filters remain explicit and do not gain chunk.
      old.version = 7;
    }
    if (old.version === 7) {
      if (!Array.isArray(old.trees)) throw new Error('旧存档树木数据无效');
      old.settings = {
        ...DEFAULT_WORLD_SETTINGS,
        hilliness: 'flat',
        meanTemperature: 21,
        latitude: 0,
      };
      old.spawn = { x: 32, y: 34, z: SURFACE };
      for (const tree of old.trees) {
        if (!tree) throw new Error('旧存档树木数据无效');
        tree.species = 'poplar';
      }
      old.version = 8;
    }
    if (old.version === 8) {
      if (!Array.isArray(old.trees) || !Array.isArray(old.jobs) || !old.stats)
        throw new Error('旧存档植被数据无效');
      old.treePlots = [];
      for (const tree of old.trees) {
        if (!tree) throw new Error('旧存档树木数据无效');
        Object.assign(tree, { growth: 1, age: 0, health: 1, unlitTicks: 0, planted: false });
      }
      for (const job of old.jobs)
        if (job?.kind === 'cut') {
          const tree = old.trees.find((t: Tree) => same(t, job));
          if (!tree && !job.cancelled) throw new Error('旧存档采伐对象不存在');
          job.treeSpecies = tree?.species ?? 'poplar';
          job.legacyCut = true;
        }
      old.stats.treesPlanted = 0;
      old.stats.treesRegrown = 0;
      old.stats.treesDied = 0;
      old.version = 9;
    }
    if (old.version === 9) {
      if (!Array.isArray(old.pawns) || !Array.isArray(old.beds))
        throw new Error('旧存档生存数据无效');
      for (const p of old.pawns) {
        if (!p?.priorities) throw new Error('旧存档工作优先级无效');
        Object.assign(p, initialSurvival(old.seed, p.id));
        p.priorities.care = 1;
      }
      for (const bed of old.beds) {
        if (!bed) throw new Error('旧存档床位数据无效');
        bed.medical = false;
      }
      old.version = 10;
    }
    if (old.version === 10) {
      if (!Array.isArray(old.pawns) || !old.stats) throw new Error('旧存档衣物数据无效');
      old.tailors = [];
      for (const p of old.pawns) {
        p.worn = [];
        p.apparelTask = null;
        p.weaponTask = null;
        p.apparelWearTicks = 0;
      }
      for (const key of ['produced', 'consumed', 'spoiled']) {
        old.stats[key].cloth = 0;
        old.stats[key].apparel = 0;
      }
      old.stats.tailored = 0;
      old.stats.destroyed = emptyCounts();
      old.version = 11;
    }
    if (old.version === 11) {
      old.combat = { enabled: false, nextRaid: 0, wave: 0 };
      if (!Array.isArray(old.pawns)) throw new Error('旧人物数据无效');
      for (const p of old.pawns)
        Object.assign(p, {
          trauma: initialTrauma(),
          faction: 'colony',
          drafted: false,
          retreating: false,
          attackTargetId: null,
          nextAttackTick: 0,
          weapon: 'fists',
        });
      old.version = 12;
    }
    if (old.version === 12) {
      if (!Array.isArray(old.pawns) || !old.stats || !Number.isSafeInteger(old.nextId))
        throw new Error('旧武器数据无效');
      old.weaponBenches = [];
      for (const p of old.pawns) {
        if (!['fists', 'steelKnife'].includes(p.weapon)) throw new Error('旧武器种类无效');
        p.weapon = p.weapon === 'steelKnife' ? makeWeapon(old.nextId++, 'steelKnife') : null;
        p.weaponTask = null;
        p.weaponDropPending = !!p.weapon && (p.dead || p.downed);
      }
      for (const key of ['produced', 'consumed', 'spoiled', 'destroyed']) old.stats[key].weapon = 0;
      old.stats.weaponsMade = 0;
      old.version = 13;
    }
    const d = old as VoxelSave;
    if (
      !validWorldSettings(d.settings) ||
      !inside(d.spawn) ||
      d.spawn.z < 1 ||
      d.spawn.z >= HEIGHT - 1
    )
      throw new Error('世界配置或出生点无效');
    if (
      !Number.isSafeInteger(d.seed) ||
      !Number.isSafeInteger(d.tick) ||
      d.tick < 0 ||
      !Number.isSafeInteger(d.nextId) ||
      d.nextId < 1
    )
      throw new Error('存档计时或种子无效');
    const arrays: [unknown, number][] = [
      [d.pawns, 64],
      [d.items, 10000],
      [d.trees, 4096],
      [d.treePlots, 512],
      [d.jobs, 512],
      [d.stockpiles, 4096],
      [d.farms, 512],
      [d.crops, 512],
      [d.stoves, 512],
      [d.stonecutters, 128],
      [d.tailors, 128],
      [d.weaponBenches, 128],
      [d.beds, 128],
      [d.doors, 512],
      [d.devices, 256],
      [d.wires, 4096],
    ];
    for (const [a, max] of arrays)
      if (!Array.isArray(a) || a.length > max || (a as Pos[]).some((p) => !p || !inside(p)))
        throw new Error('存档对象数量或坐标无效');
    if (d.pawns.length > 64 || d.pawns.filter((p) => p.faction === 'colony').length !== 3)
      throw new Error('存档需要三名殖民者，人物与遗体上限64');
    if (
      !d.combat ||
      typeof d.combat.enabled !== 'boolean' ||
      !Number.isSafeInteger(d.combat.nextRaid) ||
      d.combat.nextRaid < 0 ||
      !Number.isSafeInteger(d.combat.wave) ||
      d.combat.wave < 0 ||
      (!d.combat.enabled && d.combat.nextRaid !== 0)
    )
      throw new Error('袭击日程无效');
    const positive = (n: number) => Number.isSafeInteger(n) && n > 0 && n <= 10000000;
    const zero = (n: number) => Number.isFinite(n) && n >= 0 && n <= 10000000;
    const ids = new Set<number>();
    for (const e of [
      ...d.pawns,
      ...d.items,
      ...d.trees,
      ...d.jobs,
      ...d.crops,
      ...d.stoves,
      ...d.stonecutters,
      ...d.tailors,
      ...d.weaponBenches,
      ...d.beds,
      ...d.doors,
      ...d.devices,
    ]) {
      if (!positive(e.id) || ids.has(e.id) || e.id >= d.nextId)
        throw new Error('重复或无效的对象编号');
      ids.add(e.id);
    }
    for (const i of d.items) if (!validBatch(i)) throw new Error('物资种类、数量或腐坏进度无效');
    if (
      !migrateLogistics &&
      (d.items.some(
        (i) =>
          i.amount > stackLimit(i.resource) ||
          Object.keys(i).some(
            (key) =>
              ![
                'id',
                'resource',
                'amount',
                'crop',
                'rotProgress',
                'apparel',
                'weapon',
                'forbidden',
                'x',
                'y',
                'z',
              ].includes(key),
          ),
      ) ||
        new Set(d.items.map(at)).size !== d.items.length)
    )
      throw new Error('地面每格仅允许一堆且不能超过堆叠上限');
    for (const t of d.trees)
      if (
        !positive(t.wood) ||
        t.z < 1 ||
        t.z + 1 >= HEIGHT ||
        !Object.hasOwn(TREE_DATA, t.species) ||
        !Number.isFinite(t.growth) ||
        t.growth < 0 ||
        t.growth > 1 ||
        !Number.isSafeInteger(t.age) ||
        t.age < 0 ||
        !Number.isSafeInteger(t.unlitTicks) ||
        t.unlitTicks < 0 ||
        t.unlitTicks > t.age ||
        !Number.isFinite(t.health) ||
        t.health <= 0 ||
        t.health > 1 ||
        typeof t.planted !== 'boolean'
      )
        throw new Error('树木数据无效');
    const uniqueCells = (a: Pos[]) => new Set(a.map(at)).size === a.length;
    if (
      ![
        d.trees,
        d.treePlots,
        d.farms,
        d.crops,
        d.stoves,
        d.stonecutters,
        d.tailors,
        d.weaponBenches,
        d.stockpiles,
        d.doors,
        d.wires,
      ].every(uniqueCells)
    )
      throw new Error('区域或设施位置重复');
    for (const plot of d.treePlots)
      if (
        !Object.hasOwn(TREE_DATA, plot.species) ||
        plot.z < 1 ||
        plot.z >= HEIGHT - 1 ||
        d.farms.some((f) => same(f, plot)) ||
        d.stockpiles.some((s) => same(s, plot)) ||
        d.treePlots.some(
          (other) =>
            other !== plot &&
            Math.abs(other.x - plot.x) <= 1 &&
            Math.abs(other.y - plot.y) <= 1 &&
            Math.abs(other.z - plot.z) <= 1,
        )
      )
        throw new Error('林地区树种、间距或位置无效');
    for (const stock of d.stockpiles)
      if (
        !Number.isInteger(stock.priority) ||
        stock.priority < 0 ||
        stock.priority > 3 ||
        !Array.isArray(stock.accepts) ||
        stock.accepts.length > resources.length ||
        new Set(stock.accepts).size !== stock.accepts.length ||
        stock.accepts.some((resource) => !resources.includes(resource))
      )
        throw new Error('仓储优先级或接收规则无效');
    for (const f of d.farms)
      if (
        !Object.hasOwn(CROPS, f.crop) ||
        f.z < 1 ||
        f.z >= HEIGHT - 1 ||
        d.stockpiles.some((s) => same(s, f))
      )
        throw new Error('种植区数据无效');
    for (const c of d.crops)
      if (
        !Object.hasOwn(CROPS, c.kind) ||
        !zero(c.growth) ||
        c.growth > 1 ||
        !Number.isSafeInteger(c.sownAt) ||
        c.sownAt < 0 ||
        c.sownAt > d.tick ||
        !d.farms.some((f) => same(c, f))
      )
        throw new Error('作物数据无效');
    for (const s of d.stoves)
      if (
        !Number.isInteger(s.target) ||
        s.target < 0 ||
        s.target > 100 ||
        typeof s.paused !== 'boolean' ||
        s.z < 1 ||
        s.z >= HEIGHT - 1 ||
        d.farms.some((f) => same(f, s))
      )
        throw new Error('灶台数据无效');
    for (const b of d.beds)
      if (
        typeof b.medical !== 'boolean' ||
        (b.medical && b.owner !== null) ||
        !['x', 'y'].includes(b.axis) ||
        bedCells(b).some((p) => !inside(p) || p.z < 1 || p.z >= HEIGHT - 1) ||
        (b.owner !== null && !d.pawns.some((p) => p.id === b.owner))
      )
        throw new Error('床位数据无效');
    for (const b of d.tailors) {
      if (
        !['x', 'y'].includes(b.axis) ||
        tailorCells(b).some((p) => !inside(p) || p.z < 1 || p.z >= HEIGHT - 1) ||
        !inside(tailorInteraction(b)) ||
        !Array.isArray(b.bills) ||
        b.bills.length !== APPAREL_KINDS.length ||
        new Set(b.bills.map((bill) => bill.kind)).size !== APPAREL_KINDS.length ||
        b.bills.some(
          (bill) =>
            !Object.hasOwn(APPAREL_DEFS, bill.kind) ||
            !Number.isInteger(bill.target) ||
            bill.target < 0 ||
            bill.target > 100 ||
            typeof bill.paused !== 'boolean',
        )
      )
        throw new Error('裁缝台或衣物配方无效');
    }
    for (const bench of d.weaponBenches) {
      if (
        !isWeaponBenchKind(bench.kind) ||
        !['x', 'y'].includes(bench.axis) ||
        !zero(bench.fuel) ||
        bench.fuel > SMITHY_FUEL_CAPACITY ||
        (bench.kind === 'craftingSpot' && bench.fuel !== 0) ||
        weaponBenchCells(bench).some((p) => !inside(p) || p.z < 1 || p.z >= HEIGHT - 1) ||
        !inside(weaponBenchInteraction(bench)) ||
        !Array.isArray(bench.bills)
      )
        throw new Error('武器工作台数据无效');
      const kinds = WEAPON_KINDS.filter((k) => WEAPON_DEFS[k].benches.includes(bench.kind));
      if (
        bench.bills.length !== kinds.length ||
        new Set(bench.bills.map((b) => b.kind)).size !== kinds.length ||
        bench.bills.some(
          (b) =>
            !kinds.includes(b.kind) ||
            !Number.isInteger(b.target) ||
            b.target < 0 ||
            b.target > 100 ||
            typeof b.paused !== 'boolean',
        )
      )
        throw new Error('武器配方无效');
    }
    for (const bench of d.stonecutters)
      if (
        !['x', 'y'].includes(bench.axis) ||
        !Number.isInteger(bench.target) ||
        bench.target < 0 ||
        bench.target > 2000 ||
        typeof bench.paused !== 'boolean' ||
        stonecutterCells(bench).some((p) => !inside(p) || p.z < 1 || p.z >= HEIGHT - 1) ||
        !inside(stonecutterInteraction(bench))
      )
        throw new Error('切石台数据无效');
    const owners = d.beds.flatMap((b) => (b.owner === null ? [] : [b.owner]));
    if (new Set(owners).size !== owners.length) throw new Error('人物拥有多个床位');
    for (const device of d.devices) {
      if (
        !isDeviceKind(device.kind) ||
        !['x', 'y'].includes(device.axis) ||
        typeof device.on !== 'boolean' ||
        !zero(device.fuel) ||
        device.fuel > 75 ||
        !zero(device.energy) ||
        device.energy > 600 ||
        !Number.isInteger(device.target) ||
        device.target < -50 ||
        device.target > 50 ||
        deviceCells(device).some((p) => !inside(p) || p.z < 1 || p.z >= HEIGHT - 1) ||
        (device.kind !== 'generator' && device.fuel !== 0) ||
        (device.kind !== 'battery' && device.energy !== 0)
      )
        throw new Error('电力设备数据无效');
      if (typeof device.powered !== 'boolean') throw new Error('供电状态无效');
      device.active = false;
      device.watts = 0;
      device.networkId = null;
      device.reason = '存档恢复，等待电网更新';
    }
    const furniture = [
      ...d.beds.flatMap(bedCells),
      ...d.doors,
      ...d.stoves,
      ...d.stonecutters.flatMap(stonecutterCells),
      ...d.tailors.flatMap(tailorCells),
      ...d.weaponBenches.flatMap(weaponBenchCells),
      ...d.devices.flatMap(deviceCells),
    ];
    if (
      !uniqueCells(furniture.flatMap((p) => [p, { ...p, z: p.z + 1 }])) ||
      furniture.some(
        (v) =>
          d.farms.some((f) => same(f, v)) ||
          d.stockpiles.some((s) => same(s, v)) ||
          d.treePlots.some((f) => same(f, v)),
      )
    )
      throw new Error('设施位置重叠');
    for (const door of d.doors)
      if (
        !['x', 'y'].includes(door.axis) ||
        !['auto', 'open', 'locked'].includes(door.mode) ||
        !Number.isSafeInteger(door.openUntil) ||
        door.openUntil < 0 ||
        door.z < 1 ||
        door.z >= HEIGHT - 1
      )
        throw new Error('门数据无效');
    const materialMap = (m: Partial<Counts>) =>
      m &&
      typeof m === 'object' &&
      !Array.isArray(m) &&
      Object.entries(m).every(
        ([r, n]) =>
          resources.includes(r as Resource) && Number.isSafeInteger(n) && n >= 0 && n <= 10000000,
      );
    const plainCargo = (batch: Cargo) =>
      validBatch(batch) &&
      Object.keys(batch).every((key) =>
        ['resource', 'amount', 'crop', 'rotProgress', 'apparel', 'weapon', 'forbidden'].includes(
          key,
        ),
      );
    for (const j of d.jobs) {
      if (
        j.kind === 'smith'
          ? !WEAPON_KINDS.includes(j.weaponKind!) ||
            !isWeaponBenchKind(j.weaponBenchKind!) ||
            !WEAPON_DEFS[j.weaponKind!].benches.includes(j.weaponBenchKind!) ||
            (!j.cancelled &&
              !d.weaponBenches.some(
                (b) =>
                  same(b, j) &&
                  b.kind === j.weaponBenchKind &&
                  b.bills.some((v) => v.kind === j.weaponKind && !v.paused),
              ))
          : j.weaponKind !== undefined || j.weaponBenchKind !== undefined
      )
        throw new Error('武器加工任务无效');
      if (
        ['smith', 'refuel'].includes(j.kind) &&
        d.jobs.some(
          (other) =>
            other !== j &&
            !other.cancelled &&
            !j.cancelled &&
            other.kind === j.kind &&
            same(other, j),
        )
      )
        throw new Error('工作台存在重复加工或加油任务');
      if (
        !Object.hasOwn(JOB_NAMES, j.kind) ||
        j.z < 1 ||
        j.z >= HEIGHT - 1 ||
        !zero(j.progress) ||
        !positive(j.work) ||
        typeof j.cancelled !== 'boolean' ||
        (j.kind === 'tailoring'
          ? !Object.hasOwn(APPAREL_DEFS, j.apparelKind ?? '')
          : j.apparelKind !== undefined) ||
        j.work !==
          workOf(
            j.kind,
            j.material,
            j.treeSpecies,
            j.legacyCut,
            j.apparelKind,
            j.weaponKind,
            j.weaponBenchKind,
          ) ||
        (['cut', 'plantTree'].includes(j.kind)
          ? !Object.hasOwn(TREE_DATA, j.treeSpecies ?? '')
          : j.treeSpecies !== undefined) ||
        (j.legacyCut !== undefined && (j.legacyCut !== true || j.kind !== 'cut')) ||
        (!j.cancelled &&
          j.kind === 'cut' &&
          !d.trees.some((t) => same(t, j) && t.species === j.treeSpecies)) ||
        (!j.cancelled &&
          j.kind === 'plantTree' &&
          !d.treePlots.some((f) => same(f, j) && f.species === j.treeSpecies)) ||
        (['wall', 'floor'].includes(j.kind)
          ? !['wood', 'stone'].includes(j.material ?? '')
          : j.material !== undefined) ||
        ((['bed', 'door', 'stonecutter', 'tailor', 'smithy'].includes(j.kind) ||
          isDeviceKind(j.kind)) &&
          (!['x', 'y'].includes(j.axis ?? '') ||
            (j.kind === 'bed' && bedCells({ ...j, axis: j.axis! }).some((p) => !inside(p))) ||
            ((j.kind === 'stonecutter' || j.kind === 'tailor' || j.kind === 'smithy') &&
              (stonecutterCells({ ...j, axis: j.axis! }).some((p) => !inside(p)) ||
                !inside(stonecutterInteraction({ ...j, axis: j.axis! })))) ||
            (isDeviceKind(j.kind) &&
              deviceCells({ ...j, kind: j.kind, axis: j.axis! }).some((p) => !inside(p))))) ||
        !materialMap(j.cost) ||
        !materialMap(j.delivered) ||
        resources.some(
          (r) =>
            (j.cost[r] ?? 0) !==
              (j.kind === 'refuel'
                ? r === 'wood'
                  ? j.cost.wood
                  : 0
                : (costOf(j.kind, j.material, j.apparelKind, j.weaponKind, j.weaponBenchKind)[r] ??
                  0)) || (j.delivered[r] ?? 0) > (j.cost[r] ?? 0),
        ) ||
        (!j.cancelled && j.kind === 'cook' && !d.stoves.some((s) => same(s, j))) ||
        (!j.cancelled && j.kind === 'stonecut' && !d.stonecutters.some((b) => same(b, j))) ||
        (!j.cancelled && j.kind === 'tailoring' && !d.tailors.some((b) => same(b, j))) ||
        (j.kind === 'refuel' &&
          (!positive(j.cost.wood!) ||
            j.cost.wood! > 75 ||
            (!j.cancelled &&
              !d.devices.some((v) => v.kind === 'generator' && same(v, j)) &&
              !d.weaponBenches.some(
                (b) => b.kind === 'smithy' && same(b, j) && j.cost.wood! <= 50,
              ))))
      )
        throw new Error('任务数据无效');
      if (
        !Array.isArray(j.deliveredFood) ||
        j.deliveredFood.length > 4 ||
        j.deliveredFood.some(
          (batch) =>
            !(migrateLogistics ? validBatch(batch) : plainCargo(batch)) ||
            !isPerishable(batch.resource),
        ) ||
        new Set(j.deliveredFood.map((batch) => `${batch.resource}/${batch.crop ?? ''}`)).size !==
          j.deliveredFood.length ||
        (['grain', 'meal'] as const).some(
          (resource) =>
            j.deliveredFood
              .filter((batch) => batch.resource === resource)
              .reduce((sum, batch) => sum + batch.amount, 0) !== (j.delivered[resource] ?? 0),
        )
      )
        throw new Error('配送食材容器与任务数量不一致');
    }
    for (const p of d.pawns) {
      if (
        !validTrauma(p.trauma, d.tick) ||
        !['colony', 'raider'].includes(p.faction) ||
        (p.weapon !== null && !validWeapon(p.weapon)) ||
        typeof p.weaponDropPending !== 'boolean' ||
        (p.weaponDropPending && !p.weapon) ||
        typeof p.drafted !== 'boolean' ||
        typeof p.retreating !== 'boolean' ||
        (p.retreating && (p.faction !== 'raider' || p.attackTargetId !== null)) ||
        (p.faction === 'raider' && (p.cargo !== null || p.worn.length !== 0)) ||
        (p.drafted && (p.faction !== 'colony' || p.dead || p.downed)) ||
        !Number.isSafeInteger(p.nextAttackTick) ||
        p.nextAttackTick < 0 ||
        p.nextAttackTick > d.tick + 200 ||
        (p.attackTargetId !== null &&
          (!d.pawns.some(
            (q) => q.id === p.attackTargetId && q.id !== p.id && !q.dead && !q.downed,
          ) ||
            (!p.drafted && p.faction !== 'raider'))) ||
        (!p.dead &&
          !p.downed &&
          (p.drafted || p.faction === 'raider') &&
          p.phase !== 'combat' &&
          p.phase !== 'weapon')
      )
        throw new Error('人物外伤或战斗状态无效');
      for (const wound of p.trauma.wounds) {
        if (ids.has(wound.id) || wound.id >= d.nextId) throw new Error('伤口身份重复或无效');
        ids.add(wound.id);
      }
      if (
        !Array.isArray(p.worn) ||
        p.worn.length > 5 ||
        p.worn.some((piece) => !validApparel(piece)) ||
        p.worn.some((piece, i) =>
          p.worn.slice(i + 1).some((other) => !compatibleApparel(piece, other)),
        ) ||
        !Number.isSafeInteger(p.apparelWearTicks) ||
        p.apparelWearTicks < 0 ||
        p.apparelWearTicks > d.tick ||
        (p.apparelTask === null) !== (p.phase !== 'apparel')
      )
        throw new Error('人物衣物或穿戴任务无效');
      if ((p.weaponTask === null) !== (p.phase !== 'weapon')) throw new Error('武器任务阶段无效');
      if (p.weaponTask !== null) {
        const task = p.weaponTask;
        if (
          !task ||
          !['equip', 'drop'].includes(task.action) ||
          !['fetch', 'work'].includes(task.stage) ||
          !positive(task.weaponId) ||
          !Number.isInteger(task.progress) ||
          task.progress < 0 ||
          task.progress > (task.action === 'drop' ? WEAPON_DROP_TICKS : 0) ||
          p.dead ||
          p.downed ||
          p.carriedBy !== null ||
          p.weaponDropPending ||
          healthSummary(p).manipulation <= 0 ||
          p.faction !== 'colony' ||
          p.jobId !== null ||
          p.eating !== null ||
          p.carePhase !== null ||
          p.apparelTask !== null ||
          d.pawns.some((q) => q !== p && q.weaponTask?.weaponId === task.weaponId)
        )
          throw new Error('武器预定无效');
        const piece =
          task.action === 'drop'
            ? p.weapon
            : task.stage === 'fetch'
              ? d.items.find((i) => i.weapon?.id === task.weaponId)?.weapon
              : p.cargo?.weapon;
        if (
          !piece ||
          piece.id !== task.weaponId ||
          (task.action === 'drop' && task.stage !== 'work') ||
          (task.stage === 'fetch' && (p.cargo !== null || task.progress !== 0))
        )
          throw new Error('武器实例不存在或取用阶段无效');
      }
      if (p.apparelTask !== null) {
        const task = p.apparelTask;
        if (
          !task ||
          !['wear', 'remove'].includes(task.action) ||
          !['fetch', 'work'].includes(task.stage) ||
          !Number.isSafeInteger(task.apparelId) ||
          task.apparelId <= 0 ||
          !Number.isFinite(task.progress) ||
          task.progress < 0 ||
          (task.stage === 'fetch' && task.progress !== 0) ||
          p.dead ||
          p.downed ||
          p.carriedBy !== null ||
          d.pawns.some((q) => q.id !== p.id && q.apparelTask?.apparelId === task.apparelId)
        )
          throw new Error('穿脱衣物预定无效');
        const piece =
          task.action === 'remove'
            ? p.worn.find((piece) => piece.id === task.apparelId)
            : task.stage === 'fetch'
              ? d.items.find((i) => i.apparel?.id === task.apparelId)?.apparel
              : p.cargo?.apparel;
        if (
          !piece ||
          piece.id !== task.apparelId ||
          (task.action === 'remove' && task.stage !== 'work') ||
          (task.stage === 'fetch' && p.cargo !== null) ||
          task.progress >
            apparelDelay(piece) +
              (task.action === 'wear'
                ? p.worn
                    .filter((old) => !compatibleApparel(old, piece))
                    .reduce((n, old) => n + apparelDelay(old), 0)
                : 0)
        )
          throw new Error('穿戴衣物实例不存在或进度无效');
      }
      if (
        !p.health ||
        Object.keys(p.health).length !== 4 ||
        !['malnutrition', 'hypothermia', 'heatstroke'].every(
          (key) =>
            Number.isFinite(p.health[key as 'malnutrition']) &&
            p.health[key as 'malnutrition'] >= 0 &&
            p.health[key as 'malnutrition'] <= 1,
        ) ||
        !Number.isFinite(p.health.starvationFactor) ||
        p.health.starvationFactor < 0.8 ||
        p.health.starvationFactor > 1.2 ||
        typeof p.dead !== 'boolean' ||
        typeof p.downed !== 'boolean' ||
        p.dead !== (healthDeathReason(p.health, p.trauma) !== null) ||
        p.deathReason !== (p.dead ? healthDeathReason(p.health, p.trauma) : null) ||
        p.downed !==
          (!p.dead &&
            (healthSummary(p).pain >= 0.8 ||
              healthSummary(p).consciousness < 0.3 ||
              healthSummary(p).moving <= 0.15)) ||
        ![
          'idle',
          'travel',
          'work',
          'fetch',
          'haul',
          'rest',
          'sleepTravel',
          'care',
          'apparel',
          'combat',
          'weapon',
          'downed',
          'dead',
        ].includes(p.phase) ||
        (p.dead
          ? p.phase !== 'dead'
          : p.downed
            ? p.phase !== 'downed'
            : ['dead', 'downed'].includes(p.phase)) ||
        !Array.isArray(p.path) ||
        p.path.length > CELLS ||
        p.path.some((v) => !Number.isInteger(v) || v < 0 || v >= CELLS) ||
        (p.destination !== null &&
          (!Number.isInteger(p.destination) || p.destination < 0 || p.destination >= CELLS)) ||
        !Number.isFinite(p.careProgress) ||
        p.careProgress < 0 ||
        p.careProgress >= (p.carePhase === 'tend' ? 200 : FEED_WORK) ||
        !Number.isSafeInteger(p.careAmount) ||
        p.careAmount < 0 ||
        p.careAmount > 75 ||
        ![
          null,
          'rescueApproach',
          'rescueCarry',
          'feedFetch',
          'feedApproach',
          'feed',
          'tendApproach',
          'tend',
        ].includes(p.carePhase) ||
        (p.carePhase === null) !== (p.patientId === null) ||
        (p.carePhase === null) !== (p.phase !== 'care') ||
        (p.carePhase === null &&
          (p.careBedId !== null ||
            p.careFoodId !== null ||
            p.careAmount !== 0 ||
            p.careProgress !== 0 ||
            p.carryingPawnId !== null)) ||
        (!['feed', 'tend'].includes(p.carePhase ?? '') && p.careProgress !== 0) ||
        (p.carePhase !== 'feedFetch' && (p.careFoodId !== null || p.careAmount !== 0)) ||
        (p.downed &&
          p.sleepBedId !== null &&
          !d.beds.some((b) => b.id === p.sleepBedId && same(b, p))) ||
        ((p.dead || p.downed) &&
          (p.jobId !== null ||
            p.path.length !== 0 ||
            p.destination !== null ||
            p.eating !== null ||
            p.carePhase !== null))
      )
        throw new Error('人物生存状态无效');
      const patient = d.pawns.find((q) => q.id === p.patientId);
      if (
        p.carePhase !== null &&
        (!patient ||
          patient === p ||
          patient.dead ||
          (!p.carePhase.startsWith('tend') && !patient.downed) ||
          patient.faction !== 'colony' ||
          p.faction !== 'colony' ||
          p.drafted ||
          patient.drafted ||
          d.pawns.some((q) => q.id !== p.id && q.patientId === patient.id))
      )
        throw new Error('病人护理预定无效');
      if (
        p.carePhase?.startsWith('tend') &&
        (!patient?.trauma.wounds.some((w) => w.tendQuality === null) || patient.carriedBy !== null)
      )
        throw new Error('包扎目标无有效伤口');
      if (p.carriedBy !== null) {
        const carrier = d.pawns.find((q) => q.id === p.carriedBy);
        if (
          !carrier ||
          carrier === p ||
          carrier.dead ||
          carrier.downed ||
          !p.downed ||
          carrier.carryingPawnId !== p.id ||
          carrier.patientId !== p.id ||
          carrier.carePhase !== 'rescueCarry' ||
          !same(p, carrier) ||
          p.sleepBedId !== null
        )
          throw new Error('被救援人物状态无效');
      }
      if (
        p.carryingPawnId !== null &&
        (p.carePhase !== 'rescueCarry' ||
          patient?.id !== p.carryingPawnId ||
          patient.carriedBy !== p.id)
      )
        throw new Error('救援携带关系无效');
      if (p.carePhase === 'rescueCarry' && p.carryingPawnId === null)
        throw new Error('救援缺少被搬运者');
      if (p.carePhase === 'rescueApproach' || p.carePhase === 'rescueCarry') {
        if (
          !d.beds.some((b) => b.id === p.careBedId && b.medical) ||
          d.pawns.some((q) => q.id !== p.id && q.careBedId === p.careBedId) ||
          (p.carePhase === 'rescueApproach' &&
            (patient?.carriedBy !== null ||
              d.beds.some((b) => same(b, patient!) && (b.medical || b.owner === patient!.id)))) ||
          p.cargo !== null
        )
          throw new Error('救援医疗床预定无效');
      } else if (p.careBedId !== null) throw new Error('护理床位引用无效');
      if (p.carePhase?.startsWith('feed')) {
        if (
          !patient ||
          patient.food > 26 ||
          patient.carriedBy !== null ||
          !d.beds.some((b) => same(b, patient) && (b.medical || b.owner === patient.id))
        )
          throw new Error('喂食病人不在床上');
        if (p.carePhase === 'feedFetch') {
          const source = d.items.find((i) => i.id === p.careFoodId);
          const reserved = d.pawns.reduce(
            (n, q) => n + (q.careFoodId === p.careFoodId ? q.careAmount : 0),
            0,
          );
          if (
            !source ||
            !NUTRITION[source.resource] ||
            p.careAmount < 1 ||
            reserved > source.amount ||
            p.cargo !== null
          )
            throw new Error('喂食食物预留无效');
        } else if (!p.cargo || !NUTRITION[p.cargo.resource]) throw new Error('喂食缺少携带食物');
      }
      if (
        typeof p.name !== 'string' ||
        p.name.length > 40 ||
        !Number.isFinite(p.color) ||
        !zero(p.food) ||
        p.food > 100 ||
        !zero(p.rest) ||
        p.rest > 100 ||
        !Array.isArray(p.schedule) ||
        p.schedule.length !== 24 ||
        p.schedule.some((a) => !['anything', 'work', 'sleep'].includes(a)) ||
        (p.sleepBedId !== null &&
          !d.beds.some(
            (b) =>
              b.id === p.sleepBedId &&
              (b.owner === p.id || (b.medical && (p.downed || p.dead) && same(b, p))),
          )) ||
        (p.sleepingSince !== null &&
          (!Number.isSafeInteger(p.sleepingSince) ||
            p.sleepingSince < 0 ||
            p.sleepingSince > d.tick)) ||
        !p.priorities ||
        Object.values(p.priorities).length !== 8 ||
        (['dig', 'cut', 'build', 'haul', 'grow', 'cook', 'craft', 'care'] as Work[]).some(
          (k) => !Number.isInteger(p.priorities[k]) || p.priorities[k] < 0 || p.priorities[k] > 4,
        ) ||
        (p.cargo !== null && !(migrateLogistics ? validBatch(p.cargo) : plainCargo(p.cargo))) ||
        (!migrateLogistics && p.cargo !== null && p.cargo.amount > carryLimit(p.cargo.resource)) ||
        (p.eating !== null && !NUTRITION[p.eating])
      )
        throw new Error('人物数据无效');
    }
    const apparelInstances = [
      ...d.items.flatMap((i) => (i.apparel ? [i.apparel] : [])),
      ...d.pawns.flatMap((p) => [...p.worn, ...(p.cargo?.apparel ? [p.cargo.apparel] : [])]),
    ];
    const apparelIds = new Set<number>();
    for (const piece of apparelInstances) {
      if (
        !validApparel(piece) ||
        piece.wearTicks > d.tick ||
        piece.id >= d.nextId ||
        ids.has(piece.id) ||
        apparelIds.has(piece.id)
      )
        throw new Error('衣物实例身份重复或无效');
      apparelIds.add(piece.id);
    }
    const weaponIds = new Set<number>();
    for (const piece of [
      ...d.items.flatMap((i) => (i.weapon ? [i.weapon] : [])),
      ...d.pawns.flatMap((p) => [
        ...(p.weapon ? [p.weapon] : []),
        ...(p.cargo?.weapon ? [p.cargo.weapon] : []),
      ]),
    ]) {
      if (
        !validWeapon(piece) ||
        piece.id >= d.nextId ||
        ids.has(piece.id) ||
        apparelIds.has(piece.id) ||
        weaponIds.has(piece.id)
      )
        throw new Error('武器实例身份重复或无效');
      weaponIds.add(piece.id);
    }
    if (
      !d.stats ||
      ![
        'mined',
        'cut',
        'built',
        'hauled',
        'sown',
        'harvested',
        'cooked',
        'stonecut',
        'tailored',
        'weaponsMade',
        'treesPlanted',
        'treesRegrown',
        'treesDied',
        'eaten',
      ].every((k) => zero(d.stats[k as 'mined'])) ||
      !['produced', 'consumed', 'spoiled', 'destroyed'].every((k) =>
        resources.every((r) => zero(d.stats[k as 'produced']?.[r as Resource])),
      ) ||
      !resources.every(
        (r) =>
          Number.isSafeInteger(d.stats.destroyed[r]) &&
          (r === 'apparel' || d.stats.destroyed[r] === 0),
      ) ||
      !['stonecut', 'tailored', 'weaponsMade', 'treesPlanted', 'treesRegrown', 'treesDied'].every(
        (key) => Number.isSafeInteger(d.stats[key as 'stonecut']),
      ) ||
      !resources.every(
        (r) =>
          Number.isSafeInteger(d.stats.spoiled[r]) && (isPerishable(r) || d.stats.spoiled[r] === 0),
      )
    )
      throw new Error('统计数据无效');
    // Restore into empty state. Never rerun generation over an existing colony.
    const s = new VoxelSimulation(d.seed, d.settings, true);
    s.generator = d.generator;
    s.spawn = structuredClone(d.spawn);
    s.blocks = decode(d.blocks, sourceVersion <= 6 ? 6 : sourceVersion === 7 ? 7 : 10);
    s.ladders = decode(d.ladders, 1);
    Object.assign(
      s,
      structuredClone({
        tick: d.tick,
        combat: d.combat,
        nextId: d.nextId,
        pawns: d.pawns,
        items: d.items,
        trees: d.trees,
        treePlots: d.treePlots,
        jobs: d.jobs,
        stockpiles: d.stockpiles,
        farms: d.farms,
        crops: d.crops,
        stoves: d.stoves,
        stonecutters: d.stonecutters,
        tailors: d.tailors,
        weaponBenches: d.weaponBenches,
        beds: d.beds,
        doors: d.doors,
        devices: d.devices,
        wires: d.wires,
        stats: d.stats,
      }),
    );
    s.rebuildTrees();
    s.stoveCells = new Set(s.stoves.map(at));
    s.rebuildDevices();
    if (
      [
        ...s.beds.flatMap(bedCells),
        ...s.doors,
        ...s.devices.flatMap(deviceCells),
        ...s.stonecutters.flatMap(stonecutterCells),
        ...s.tailors.flatMap(tailorCells),
        ...s.weaponBenches.filter((b) => b.kind === 'smithy').flatMap(weaponBenchCells),
      ].some(
        (p) =>
          !s.blocks[at(p) - WIDTH * DEPTH] ||
          s.blocks[at(p)] ||
          s.blocks[at(p) + WIDTH * DEPTH] ||
          s.ladders[at(p)] ||
          s.treeCells.has(at(p)) ||
          s.treeCells.has(at(p) + WIDTH * DEPTH),
      )
    )
      throw new Error('床或门没有合法支撑或净空');
    if (
      [...s.stoves, ...s.weaponBenches.filter((b) => b.kind === 'craftingSpot')].some(
        (p) =>
          s.blocks[at(p)] ||
          s.blocks[at(p) + WIDTH * DEPTH] ||
          !s.blocks[at(p) - WIDTH * DEPTH] ||
          s.treeCells.has(at(p)),
      )
    )
      throw new Error('灶台没有合法支撑或净空');
    if (s.pawns.some((p) => !s.standable(p))) throw new Error('人物没有合法支撑或净空');
    if (migrateLogistics) {
      // All work happens on the isolated clone. Reachable bounded spill is stable
      // in original stack order and preserves age using the actual transferred amount.
      let items: Stack[] = [];
      for (const item of s.items) {
        const origin = s.dropPoint(item);
        if (!origin) throw new Error('旧存档物资无法安全迁移到附近地面');
        const plan = s.planPlacement([{ batch: item, origin }], items, MIGRATION_DISTANCE);
        if (!plan) throw new Error('旧存档附近容量不足，不能安全拆分物资');
        items = plan.items;
        s.nextId = plan.nextId;
      }
      s.items = items;
      for (const job of s.jobs)
        job.deliveredFood = job.deliveredFood.map((batch) => portion(batch, batch.amount));
      for (const pawn of s.pawns)
        if (pawn.cargo) pawn.cargo = portion(pawn.cargo, pawn.cargo.amount);
      for (const pawn of s.pawns)
        if (pawn.cargo && pawn.cargo.amount > carryLimit(pawn.cargo.resource)) {
          const keep = carryLimit(pawn.cargo.resource);
          const plan = s.planPlacement(
            [{ batch: portion(pawn.cargo, pawn.cargo.amount - keep), origin: pawn }],
            s.items,
            MIGRATION_DISTANCE,
          );
          if (!plan) throw new Error('旧存档超量随身物资无法安全卸下');
          s.commitPlacement(plan);
          pawn.cargo.amount = keep;
        }
    }
    if (s.items.some((i) => !s.groundAllowed(i))) throw new Error('物资没有合法地面支撑或净空');
    if (s.stockpiles.some((p) => !s.standable(p) || s.ladders[at(p)]))
      throw new Error('仓储没有合法支撑或净空');
    if (s.wires.some((w) => w.z < 1 || w.z >= HEIGHT - 1)) throw new Error('线路高度无效');
    s.updateRooms();
    s.thermal.restore(d.thermal, s.rooms, s.outdoorTemperature());
    s.updatePower();
    // Persist work progress, delivered and carried resources; rebuild transient paths and ownership.
    for (const j of s.jobs) {
      j.owner = null;
      j.reason = j.cancelled ? '已取消，保留原任务材料等待退回' : '回读后等待重新安排';
    }
    for (const p of s.pawns) {
      if (p.weaponTask !== null) {
        p.jobId = null;
        p.path = [];
        p.destination = null;
        p.workTarget = null;
        p.eating = null;
        p.moveTick = s.tick;
        p.phase = 'weapon';
        if (p.weaponTask.stage === 'fetch') {
          const item = s.items.find((i) => i.weapon?.id === p.weaponTask!.weaponId)!;
          const route = s.path(p, item);
          if (route === null) {
            s.release(p);
            p.reason = '回读后武器通路中断，保留物品';
          } else {
            p.path = route;
            p.destination = at(item);
          }
        }
        continue;
      }
      if (!p.dead && !p.downed && (p.drafted || p.faction === 'raider') && p.weaponTask === null) {
        const destination = p.destination;
        p.path = [];
        p.destination = null;
        p.jobId = null;
        p.phase = 'combat';
        if (p.attackTargetId !== null) {
          const target = s.pawns.find((q) => q.id === p.attackTargetId)!;
          s.search(p);
          const stand = s.careStand(target);
          if (stand >= 0) s.go(p, stand, 'combat');
        } else if (destination !== null) {
          const route = s.path(p, position(destination));
          if (route) {
            p.path = route;
            p.destination = destination;
          }
        }
        continue;
      }
      if (p.apparelTask !== null) {
        p.jobId = null;
        p.path = [];
        p.destination = null;
        p.workTarget = null;
        p.eating = null;
        p.moveTick = s.tick;
        if (p.apparelTask.stage === 'fetch') {
          const item = s.items.find((i) => i.apparel?.id === p.apparelTask!.apparelId)!;
          const route = s.path(p, item);
          if (route === null) {
            s.release(p);
            p.reason = '回读后衣物通路中断';
          } else {
            p.path = route;
            p.destination = at(item);
            p.phase = 'apparel';
          }
        } else p.phase = 'apparel';
        continue;
      }
      if (p.dead || p.downed || p.carePhase !== null) {
        p.jobId = null;
        p.path = [];
        p.destination = null;
        p.workTarget = null;
        p.eating = null;
        p.moveTick = s.tick;
        if (p.dead || p.downed) {
          p.phase = p.dead ? 'dead' : 'downed';
          p.sleepingSince = null;
          continue;
        }
        const patient = s.pawns.find((q) => q.id === p.patientId)!;
        s.search(p);
        const target =
          p.carePhase === 'rescueCarry'
            ? at(s.beds.find((b) => b.id === p.careBedId)!)
            : p.carePhase === 'feedFetch'
              ? at(s.items.find((i) => i.id === p.careFoodId)!)
              : s.careStand(patient);
        if (target < 0 || s.distance[target] < 0) {
          s.release(p);
          p.reason = '回读后护理通路中断，保留所有携带物';
        } else if (
          (p.carePhase === 'feed' || p.carePhase === 'tend') &&
          p.z === patient.z &&
          Math.abs(p.x - patient.x) + Math.abs(p.y - patient.y) === 1
        ) {
          p.phase = 'care';
        } else {
          if (p.carePhase === 'feed' || p.carePhase === 'tend') {
            p.carePhase = p.carePhase === 'feed' ? 'feedApproach' : 'tendApproach';
            p.careProgress = 0;
          }
          s.go(p, target, 'care');
        }
        continue;
      }
      const sleepTarget =
        p.phase === 'sleepTravel'
          ? s.beds.find((b) => b.id === p.sleepBedId && b.owner === p.id)
          : undefined;
      const sleeping =
        p.phase === 'rest' &&
        p.sleepingSince !== null &&
        (p.sleepBedId === null || s.beds.some((b) => b.id === p.sleepBedId && same(b, p)));
      p.jobId = null;
      p.path = [];
      p.destination = null;
      p.phase = sleeping ? 'rest' : 'idle';
      if (!sleeping) {
        p.sleepBedId = null;
        p.sleepingSince = null;
      }
      p.workTarget = null;
      p.moveTick = s.tick;
      p.eating = null;
      p.reason = sleeping
        ? p.sleepBedId === null
          ? '地面睡眠'
          : '在床上睡觉'
        : '存档已恢复，正在重新安排工作';
      if (sleepTarget) {
        const path = s.path(p, sleepTarget);
        if (path) {
          p.path = path;
          p.destination = at(sleepTarget);
          p.phase = 'sleepTravel';
          p.sleepBedId = sleepTarget.id;
          p.reason = '继续前往床位睡觉';
        }
      }
    }
    s.markAll();
    s.notice = '体素存档已恢复；路径与任务预定重新建立';
    return s;
  }
}
