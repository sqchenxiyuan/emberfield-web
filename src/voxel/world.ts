import {
  Block,
  CELLS,
  CHUNK,
  DEPTH,
  HEIGHT,
  TPS,
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
} from './types';
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
import { defaultSchedule, assignmentAt, restLoss, restGain, wantsSleep } from './rest';
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
} from './types';

const same = (a: Pos, b: Pos) => a.x === b.x && a.y === b.y && a.z === b.z;
const horizontal = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const resources = Object.keys(emptyCounts()) as Resource[];
const costOf = (kind: JobKind, material: ConstructionMaterial = 'wood'): Partial<Counts> =>
  kind === 'stonecutter'
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
const workOf = (kind: JobKind, material: ConstructionMaterial = 'wood') =>
  material === 'stone' && (kind === 'wall' || kind === 'floor')
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
  kind === 'stonecut'
    ? 'craft'
    : kind === 'refuel'
      ? 'haul'
      : kind === 'sow' || kind === 'harvest'
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
  blocks = new Uint8Array(CELLS);
  ladders = new Uint8Array(CELLS);
  pawns: Pawn[] = [];
  items: Stack[] = [];
  trees: Tree[] = [];
  jobs: Job[] = [];
  farms: FarmPlot[] = [];
  crops: Crop[] = [];
  stoves: Stove[] = [];
  stonecutters: Stonecutter[] = [];
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
        priorities: { dig: 1, build: 1, cut: 1, haul: 2, grow: 1, cook: 1, craft: 1 },
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
    if (j.kind === 'stonecut') {
      const bench = this.stonecutters.find((b) => same(b, j));
      if (!bench) return [];
      const point = stonecutterInteraction(bench);
      return this.standable(point) ? [at(point)] : [];
    }
    const device = j.kind === 'refuel' || j.kind === 'remove' ? this.deviceAt(j) : undefined;
    const bench = j.kind === 'remove' ? this.stonecutterAt(j) : undefined;
    const cells =
      j.kind === 'stonecutter'
        ? stonecutterCells({ ...j, axis: j.axis ?? 'x' })
        : bench
          ? stonecutterCells(bench)
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
          (!(isDeviceKind(j.kind) || j.kind === 'stonecutter') || !cells.some((c) => same(c, p))),
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
        item.amount < 1 ||
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
    if (j.kind === 'stonecutter')
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
  private furnitureAt(p: Pos) {
    return (
      this.deviceAt(p) ||
      this.stonecutterAt(p) ||
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
      if (j.kind === 'cook' && !this.stoves.some((v) => same(v, j) && !v.paused)) this.cancel(j);
      if (j.kind === 'stonecut' && !this.stonecutters.some((b) => same(b, j) && !b.paused))
        this.cancel(j);
      if (j.kind === 'refuel' && !this.devices.some((d) => d.kind === 'generator' && same(d, j)))
        this.cancel(j);
    }
    for (const f of this.farms) {
      if (this.jobs.length >= 512 || this.jobs.some((j) => same(j, f)) || !this.farmable(f))
        continue;
      const c = this.crops.find((c) => same(c, f));
      if (!c) this.jobs.push(this.makeJob('sow', f));
      else if (c.growth >= 1) this.jobs.push(this.makeJob('harvest', f));
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
    return result;
  }
  private applyCommand(c: VoxelCommand): CommandResult {
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
    if (c.type === 'bedOwner') {
      const b = this.beds.find((b) => b.id === c.bedId);
      if (!b || (c.pawnId !== null && !this.pawns.some((p) => p.id === c.pawnId)))
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
      if (!p || p.rest >= 75) return { ok: false, message: '精力低于 75% 时可安排入睡' };
      this.startSleep(p);
      return { ok: true, message: p.reason };
    }
    if (c.type === 'priority') {
      const p = this.pawns.find((p) => p.id === c.pawnId);
      if (
        !p ||
        !['dig', 'build', 'cut', 'haul', 'grow', 'cook', 'craft'].includes(c.work) ||
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
      if (!p || !inside(c.target) || !this.standable(c.target))
        return { ok: false, message: '目标没有支撑或两格净空' };
      const path = this.path(p, c.target);
      if (!path) return { ok: false, message: '没有可达通路；检查梯子和楼板' };
      this.release(p);
      p.path = path;
      p.destination = at(c.target);
      p.phase = 'travel';
      p.reason = '前往指定位置';
      return { ok: true, message: '已安排移动' };
    }
    if (c.type !== 'designate' || !inside(c.from) || c.from.z < 1 || c.from.z > HEIGHT - 2)
      return { ok: false, message: '请选择世界内的有效工作层' };
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
        this.stockpiles = this.stockpiles.filter((f) => !same(f, pos));
        this.crops = this.crops.filter((f) => !same(f, pos));
        for (const j of [...this.jobs])
          if ((j.kind === 'sow' || j.kind === 'harvest') && same(j, pos)) this.cancel(j);
      }
      this.revision++;
      return { ok: true, message: '区域已擦除；作物清理，不返还收成', count: positions.length };
    }
    if (c.tool === 'farm') {
      const kind = c.crop ?? 'rice';
      if (!Object.hasOwn(CROPS, kind)) return { ok: false, message: '未知作物' };
      if (
        positions.some(
          (p) =>
            !this.farmable(p) ||
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
            this.furnitureAt(p) ||
            this.jobs.some(
              (j) =>
                (['bed', 'door', 'stove', 'stonecutter'].includes(j.kind) ||
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
    const plans: Job[] = [];
    const errors: string[] = [];
    if (c.axis !== undefined && c.axis !== 'x' && c.axis !== 'y')
      return { ok: false, message: '朝向无效' };
    if (
      (['bed', 'door', 'stonecutter'].includes(c.tool) || isDeviceKind(c.tool)) &&
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
            !(j.kind === 'remove' && ['cook', 'refuel', 'stonecut'].includes(k.kind)),
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
        128
    )
      return { ok: false, message: '设施数量已达到上限' };
    for (const j of plans)
      if (j.kind === 'remove')
        for (const k of [...this.jobs])
          if (['cook', 'refuel', 'stonecut'].includes(k.kind) && same(k, j)) this.cancel(k);
    this.jobs.push(...plans);
    this.notice = `安排 ${plans.length} 项工作，需求木材 ${plans.reduce((n, j) => n + (j.cost.wood ?? 0), 0)}；缺料和不可达任务会等待`;
    return { ok: true, message: this.notice, count: plans.length };
  }
  private makeJob(
    kind: JobKind,
    p: Pos,
    axis: Axis = 'x',
    material: ConstructionMaterial = 'wood',
  ): Job {
    return {
      id: this.id(),
      kind,
      x: p.x,
      y: p.y,
      z: p.z,
      work: workOf(kind, material),
      progress: 0,
      owner: null,
      delivered: {},
      deliveredFood: [],
      cancelled: false,
      cost: costOf(kind, material),
      reason: '等待可达工人',
      ...(['bed', 'door', 'stonecutter'].includes(kind) || isDeviceKind(kind) ? { axis } : {}),
      ...(['wall', 'floor'].includes(kind) ? { material } : {}),
    };
  }
  private placementReason(kind: JobKind, p: Pos, axis: Axis = 'x') {
    if (kind === 'wire')
      return this.wires.some((q) => same(q, p))
        ? '这里已有电线'
        : !this.standable(p) && !this.solid(p) && !this.deviceAt(p) && !this.furnitureAt(p)
          ? '电线需要地面、墙体或梯井支撑'
          : '';
    if (kind !== 'remove' && this.footprint({ ...p, kind, axis }).some((q) => this.furnitureAt(q)))
      return '这里已有床或门，请先拆除';
    if (isDeviceKind(kind) || kind === 'stonecutter') {
      const cells =
        kind === 'stonecutter'
          ? stonecutterCells({ ...p, axis })
          : deviceCells({ ...p, kind, axis });
      if (kind === 'stonecutter' && !this.standable(stonecutterInteraction({ ...p, axis })))
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
    if (kind === 'cut') return this.trees.some((t) => same(t, p)) ? '' : '此处没有成熟树木';
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
  private release(p: Pawn) {
    this.craftSources.delete(p.id);
    this.storageReservations.delete(p.id);
    const j = this.jobs.find((j) => j.id === p.jobId);
    if (j?.owner === p.id) j.owner = null;
    p.jobId = null;
    p.path = [];
    p.destination = null;
    p.phase = 'idle';
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
    if (isDeviceKind(j.kind) || j.kind === 'stonecutter')
      return !this.placementReason(j.kind, j, j.axis);
    if (j.kind === 'stonecut') return this.stonecutters.some((b) => same(b, j) && !b.paused);
    if (j.kind === 'refuel')
      return this.devices.some(
        (d) => d.kind === 'generator' && same(d, j) && (j.cost.wood ?? 0) <= 75,
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
          (b.owner === null || b.owner === p.id) &&
          this.distance[at(b)] >= 0 &&
          !this.pawns.some((other) => other.id !== p.id && other.sleepBedId === b.id),
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
    const n = Math.min(amount, item.amount, carryLimit(item.resource));
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
    const j = this.jobs.find((j) => j.id === p.jobId);
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
        if (food) food.amount -= this.consume(p, food.resource, food.amount);
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
      p.reason = '正在' + JOB_NAMES[j.kind];
      j.progress = Math.min(j.work, j.progress + 1);
      if (j.progress >= j.work) this.finish(p, j);
    }
  }
  private finish(p: Pawn, j: Job) {
    if (j.cancelled) {
      this.release(p);
      return;
    }
    const devicePlan =
      j.kind === 'stonecutter'
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
    if (j.kind === 'cut') yields.wood = this.trees.find((t) => same(t, j))?.wood ?? 0;
    if (j.kind === 'harvest') {
      harvestedCrop = this.crops.find((c) => same(c, j))!.kind;
      yields.grain = CROPS[harvestedCrop].yield;
    }
    if (j.kind === 'cook') yields.meal = SIMPLE_MEAL.output;
    if (j.kind === 'stonecut') yields.stone = STONECUTTING.output;
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
      this.stoves.some(
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
        batch: freshBatch(
          resource as Resource,
          n,
          resource === 'grain' ? harvestedCrop : undefined,
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
        yields.wood = tree.wood;
        this.trees = this.trees.filter((t) => t.id !== tree.id);
        this.rebuildTrees();
        this.skyCache.clear();
        this.revision++;
        this.stats.cut++;
      }
    }
    if (j.kind === 'stonecutter') {
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
      const device = this.deviceAt(j)!;
      device.fuel = Math.min(75, device.fuel + (j.delivered.wood ?? 0));
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
      yields.grain = CROPS[crop.kind].yield;
      this.crops = this.crops.filter((c) => c.id !== crop.id);
      this.stats.harvested++;
      this.revision++;
    } else if (j.kind === 'stove') {
      this.stoves.push({ id: this.id(), x: j.x, y: j.y, z: j.z, target: 10, paused: false });
      this.skyCache.clear();
      this.revision++;
    } else if (j.kind === 'bed') {
      this.beds.push({ id: this.id(), x: j.x, y: j.y, z: j.z, axis: j.axis ?? 'x', owner: null });
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
      for (const p of this.pawns) if (p.sleepBedId === bed.id) this.release(p);
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
      (j.cost.wood && !['cook', 'refuel'].includes(j.kind)) ||
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
      this.refreshReservations();
      // Only temperature/daylight change each tick; occlusion is cached until terrain changes.
      for (const c of this.crops)
        if (c.growth < 1)
          c.growth = Math.min(1, c.growth + this.cropCondition(c, c.kind).growthRate);
      if (this.tick % 20 === 0) this.syncProduction();
      for (const p of this.pawns) {
        const hungerFactor = p.food <= 0 ? 0 : p.food < 12 ? 0.25 : p.food < 24 ? 0.5 : 1;
        p.food = Math.max(0, p.food - FOOD_FALL_PER_TICK * hungerFactor);
        if (
          p.food < 30 &&
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
          !['rest', 'sleepTravel', 'travel'].includes(p.phase) &&
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
          p.moveTick = this.tick + (p.cargo ? 6 : 4);
          continue;
        }
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
    for (const p of this.pawns) if (p.cargo) out[p.cargo.resource] += p.cargo.amount;
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
      jobs: this.jobs,
      stockpiles: this.stockpiles,
      storageCapacity: this.storageCapacity(),
      farms: this.farms,
      crops: this.crops,
      stoves: this.stoves,
      stonecutters: this.stonecutters,
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
      navigationBytes: this.distance.byteLength + this.parents.byteLength + this.queue.byteLength,
      tickMs,
    });
  }
  save(): VoxelSave {
    this.updateRooms();
    return structuredClone({
      format: 'emberfield-voxel',
      version: 8,
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
      jobs: this.jobs,
      stockpiles: this.stockpiles,
      farms: this.farms,
      crops: this.crops,
      stoves: this.stoves,
      stonecutters: this.stonecutters,
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
      ![1, 2, 3, 4, 5, 6, 7, 8].includes(old.version) ||
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
        accepts: resources.filter((r) => r !== 'chunk'),
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
      [d.pawns, 12],
      [d.items, 10000],
      [d.trees, 4096],
      [d.jobs, 512],
      [d.stockpiles, 4096],
      [d.farms, 512],
      [d.crops, 512],
      [d.stoves, 512],
      [d.stonecutters, 128],
      [d.beds, 128],
      [d.doors, 512],
      [d.devices, 256],
      [d.wires, 4096],
    ];
    for (const [a, max] of arrays)
      if (!Array.isArray(a) || a.length > max || (a as Pos[]).some((p) => !p || !inside(p)))
        throw new Error('存档对象数量或坐标无效');
    if (d.pawns.length !== 3) throw new Error('试玩存档需要三名殖民者');
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
              !['id', 'resource', 'amount', 'crop', 'rotProgress', 'x', 'y', 'z'].includes(key),
          ),
      ) ||
        new Set(d.items.map(at)).size !== d.items.length)
    )
      throw new Error('地面每格仅允许一堆且不能超过堆叠上限');
    for (const t of d.trees)
      if (!positive(t.wood) || t.z + 1 >= HEIGHT || !Object.hasOwn(TREE_DATA, t.species))
        throw new Error('树木数据无效');
    const uniqueCells = (a: Pos[]) => new Set(a.map(at)).size === a.length;
    if (
      ![d.farms, d.crops, d.stoves, d.stonecutters, d.stockpiles, d.doors, d.wires].every(
        uniqueCells,
      )
    )
      throw new Error('区域或设施位置重复');
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
        !['x', 'y'].includes(b.axis) ||
        bedCells(b).some((p) => !inside(p) || p.z < 1 || p.z >= HEIGHT - 1) ||
        (b.owner !== null && !d.pawns.some((p) => p.id === b.owner))
      )
        throw new Error('床位数据无效');
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
      ...d.devices.flatMap(deviceCells),
    ];
    if (
      !uniqueCells(furniture.flatMap((p) => [p, { ...p, z: p.z + 1 }])) ||
      furniture.some((v) => d.farms.some((f) => same(f, v)) || d.stockpiles.some((s) => same(s, v)))
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
        ['resource', 'amount', 'crop', 'rotProgress'].includes(key),
      );
    for (const j of d.jobs) {
      if (
        !Object.hasOwn(JOB_NAMES, j.kind) ||
        j.z < 1 ||
        j.z >= HEIGHT - 1 ||
        !zero(j.progress) ||
        !positive(j.work) ||
        typeof j.cancelled !== 'boolean' ||
        j.work !== workOf(j.kind, j.material) ||
        (['wall', 'floor'].includes(j.kind)
          ? !['wood', 'stone'].includes(j.material ?? '')
          : j.material !== undefined) ||
        ((['bed', 'door', 'stonecutter'].includes(j.kind) || isDeviceKind(j.kind)) &&
          (!['x', 'y'].includes(j.axis ?? '') ||
            (j.kind === 'bed' && bedCells({ ...j, axis: j.axis! }).some((p) => !inside(p))) ||
            (j.kind === 'stonecutter' &&
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
                : (costOf(j.kind, j.material)[r] ?? 0)) || (j.delivered[r] ?? 0) > (j.cost[r] ?? 0),
        ) ||
        (!j.cancelled && j.kind === 'cook' && !d.stoves.some((s) => same(s, j))) ||
        (!j.cancelled && j.kind === 'stonecut' && !d.stonecutters.some((b) => same(b, j))) ||
        (j.kind === 'refuel' &&
          (!positive(j.cost.wood!) ||
            j.cost.wood! > 75 ||
            (!j.cancelled && !d.devices.some((v) => v.kind === 'generator' && same(v, j)))))
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
        (p.sleepBedId !== null && !d.beds.some((b) => b.id === p.sleepBedId && b.owner === p.id)) ||
        (p.sleepingSince !== null &&
          (!Number.isSafeInteger(p.sleepingSince) ||
            p.sleepingSince < 0 ||
            p.sleepingSince > d.tick)) ||
        !p.priorities ||
        Object.values(p.priorities).length !== 7 ||
        (['dig', 'cut', 'build', 'haul', 'grow', 'cook', 'craft'] as Work[]).some(
          (k) => !Number.isInteger(p.priorities[k]) || p.priorities[k] < 0 || p.priorities[k] > 4,
        ) ||
        (p.cargo !== null && !(migrateLogistics ? validBatch(p.cargo) : plainCargo(p.cargo))) ||
        (!migrateLogistics && p.cargo !== null && p.cargo.amount > carryLimit(p.cargo.resource)) ||
        (p.eating !== null && !NUTRITION[p.eating])
      )
        throw new Error('人物数据无效');
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
        'eaten',
      ].every((k) => zero(d.stats[k as 'mined'])) ||
      !['produced', 'consumed', 'spoiled'].every((k) =>
        resources.every((r) => zero(d.stats[k as 'produced']?.[r as Resource])),
      ) ||
      !Number.isSafeInteger(d.stats.stonecut) ||
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
        nextId: d.nextId,
        pawns: d.pawns,
        items: d.items,
        trees: d.trees,
        jobs: d.jobs,
        stockpiles: d.stockpiles,
        farms: d.farms,
        crops: d.crops,
        stoves: d.stoves,
        stonecutters: d.stonecutters,
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
      s.stoves.some(
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
