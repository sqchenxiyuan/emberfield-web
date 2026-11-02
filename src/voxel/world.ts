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
} from './types';
import { VoxelRooms } from './rooms';
import { VoxelPower, DEVICE_COSTS, DEVICE_WORK, isDeviceKind } from './power';
import { VoxelThermal } from './thermal';
import { defaultSchedule, assignmentAt, restLoss, restGain, wantsSleep } from './rest';
import {
  CROPS,
  SIMPLE_MEAL,
  NUTRITION,
  FOOD_FALL_PER_TICK,
  hourAt,
  temperatureAt,
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
  Work,
  Crop,
  CropKind,
  FarmPlot,
  Stove,
  Bed,
  Door,
  Axis,
  Device,
} from './types';

const same = (a: Pos, b: Pos) => a.x === b.x && a.y === b.y && a.z === b.z;
const horizontal = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const resources = Object.keys(emptyCounts()) as Resource[];
const costOf = (kind: JobKind): Partial<Counts> =>
  isDeviceKind(kind)
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
const workOf = (kind: JobKind) =>
  ({
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
  })[kind];
const workType = (kind: JobKind): Work =>
  kind === 'refuel'
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
function hash(seed: number, x: number, y: number, z = 0) {
  let a =
    Math.imul(x + 374761393, 668265263) ^
    Math.imul(y + seed, 1274126177) ^
    Math.imul(z + 1447, 1597334677);
  a = Math.imul(a ^ (a >>> 13), 1274126177);
  return ((a ^ (a >>> 16)) >>> 0) / 4294967296;
}
function noise(seed: number, x: number, y: number) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    tx = x - ix,
    ty = y - iy;
  const u = tx * tx * (3 - 2 * tx),
    v = ty * ty * (3 - 2 * ty);
  return (
    (hash(seed, ix, iy) * (1 - u) + hash(seed, ix + 1, iy) * u) * (1 - v) +
    (hash(seed, ix, iy + 1) * (1 - u) + hash(seed, ix + 1, iy + 1) * u) * v
  );
}
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
  stockpiles: Pos[] = [
    { x: 30, y: 32, z: SURFACE },
    { x: 30, y: 33, z: SURFACE },
  ];
  stats: VoxelStats = {
    mined: 0,
    cut: 0,
    built: 0,
    hauled: 0,
    sown: 0,
    harvested: 0,
    cooked: 0,
    eaten: 0,
    consumed: emptyCounts(),
    produced: emptyCounts(),
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
  constructor(public seed = 73129) {
    this.generate();
  }
  private id() {
    return this.nextId++;
  }
  private generate() {
    for (let y = 0; y < DEPTH; y++)
      for (let x = 0; x < WIDTH; x++) {
        const d = Math.hypot(x - 32, y - 32);
        const surface =
          d < 13
            ? SURFACE
            : Math.max(6, Math.min(11, 6 + Math.round(noise(this.seed, x / 12, y / 12) * 5)));
        for (let z = 0; z < surface; z++)
          this.blocks[index(x, y, z)] =
            z === 0 ? Block.Bedrock : z >= surface - 2 ? Block.Soil : Block.Stone;
        // Fertility-squared density is source-inspired; noise and scale are our design.
        const fertility = 0.3 + noise(this.seed + 1, x / 8, y / 8) * 0.7;
        if (
          d > 6 &&
          hash(this.seed + 2, x, y) < fertility * fertility * 0.16 &&
          surface + 2 < HEIGHT
        )
          this.trees.push({ id: this.id(), x, y, z: surface, wood: 27 });
      }
    // Finite 3D veins, not RimWorld's 2D attempts repeated for every depth layer.
    for (let v = 0; v < 44; v++) {
      let x = 4 + Math.floor(hash(this.seed, v, 1) * 56),
        y = 4 + Math.floor(hash(this.seed, v, 2) * 56),
        z = 2 + Math.floor(hash(this.seed, v, 3) * 4);
      for (let n = 0; n < 8; n++) {
        if (this.blocks[index(x, y, z)] === Block.Stone)
          this.blocks[index(x, y, z)] = v % 9 === 0 ? Block.Components : Block.Steel;
        const dir = Math.floor(hash(this.seed, v, n + 5) * 6);
        x = Math.max(2, Math.min(61, x + (dir === 0 ? 1 : dir === 1 ? -1 : 0)));
        y = Math.max(2, Math.min(61, y + (dir === 2 ? 1 : dir === 3 ? -1 : 0)));
        z = Math.max(2, Math.min(5, z + (dir === 4 ? 1 : dir === 5 ? -1 : 0)));
      }
    }
    // Guaranteed start resources are visible, finite, and saved like all other objects.
    for (const [x, y] of [
      [27, 29],
      [28, 27],
      [36, 28],
      [38, 31],
      [36, 37],
      [27, 36],
    ])
      if (!this.trees.some((t) => t.x === x && t.y === y))
        this.trees.push({ id: this.id(), x, y, z: 8, wood: 27 });
    for (const [x, y, z] of [
      [34, 32, 5],
      [35, 32, 5],
      [35, 33, 5],
      [34, 33, 4],
      [36, 32, 5],
      [35, 33, 4],
    ])
      this.blocks[index(x, y, z)] = Block.Steel;
    for (let i = 0; i < 3; i++)
      this.pawns.push({
        id: this.id(),
        name: ['林澈', '温岚', '阿砾'][i],
        color: [0xe7b66b, 0x91b7a1, 0x9faec8][i],
        x: 31 + i,
        y: 34,
        z: 8,
        food: 100,
        rest: 100,
        priorities: { dig: 1, build: 1, cut: 1, haul: 2, grow: 1, cook: 1 },
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
    this.addItem('wood', 90, { x: 30, y: 32, z: 8 });
    this.addItem('food', 60, { x: 30, y: 33, z: 8 });
    this.rebuildTrees();
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
    const device = j.kind === 'refuel' || j.kind === 'remove' ? this.deviceAt(j) : undefined;
    const cells = isDeviceKind(j.kind)
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
      .filter((p) => this.standable(p) && (!isDeviceKind(j.kind) || !cells.some((c) => same(c, p))))
      .map(at);
  }
  private reachableStand(j: Job) {
    let best = -1;
    for (const n of this.stands(j))
      if (this.distance[n] >= 0 && (best < 0 || this.distance[n] < this.distance[best])) best = n;
    return best;
  }
  private addItem(resource: Resource, amount: number, p: Pos) {
    if (amount <= 0) return;
    const old = this.items.find((i) => same(i, p) && i.resource === resource);
    if (old) old.amount += amount;
    else this.items.push({ id: this.id(), resource, amount, x: p.x, y: p.y, z: p.z });
  }
  private pileFor(p: Pawn, resource?: Resource) {
    let best: Stack | undefined;
    for (const item of this.items) {
      if (item.amount < 1 || (resource && item.resource !== resource)) continue;
      const d = this.distance[at(item)];
      if (d < 0) continue;
      if (!best || d < this.distance[at(best)]) best = item;
    }
    return best;
  }
  private go(p: Pawn, target: number, phase: Pawn['phase']) {
    p.destination = target;
    p.path = this.route(target);
    p.phase = phase;
  }
  private footprint(j: Pos & { kind: JobKind; axis?: Axis }): Pos[] {
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
      this.devices.flatMap((d) => deviceCells(d).flatMap((p) => [at(p), at({ ...p, z: p.z + 1 })])),
    );
    this.skyCache.clear();
  }
  private bedAt(p: Pos) {
    return this.beds.find((b) => bedCells(b).some((c) => same(c, p)));
  }
  private furnitureAt(p: Pos) {
    return (
      this.deviceAt(p) ||
      this.beds.find((b) =>
        bedCells(b).some((q) => q.x === p.x && q.y === p.y && (p.z === q.z || p.z === q.z + 1)),
      ) ||
      this.doors.find((d) => d.x === p.x && d.y === p.y && (p.z === d.z || p.z === d.z + 1))
    );
  }
  private farmable(p: Pos) {
    return (
      this.standable(p) &&
      this.blocks[at(p) - WIDTH * DEPTH] === Block.Soil &&
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
    const fertility = this.blocks[i - WIDTH * DEPTH] === Block.Soil ? 1 : 0;
    const hour = hourAt(this.tick),
      light = sky ? daylight(hour) : 0,
      temperature = this.temperature(p);
    const growthRate = fertility ? cropGrowth(kind, fertility, light, temperature, hour) : 0;
    const reason = !fertility
      ? '需要土壤'
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
        !['dig', 'build', 'cut', 'haul', 'grow', 'cook'].includes(c.work) ||
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
        message: stove.paused ? '烹饪已暂停，材料退回现场' : `简餐不足 ${stove.target} 份时制作`,
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
        return { ok: false, message: '种植区需要空闲土壤和两格净空，不能与仓储或施工重叠' };
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
        message: n ? `取消 ${n} 项规划，已送材料退回现场` : '这里没有规划',
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
                (['bed', 'door', 'stove'].includes(j.kind) || isDeviceKind(j.kind)) &&
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
        if (!this.stockpiles.some((s) => same(s, p))) this.stockpiles.push(p);
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
    if ((['bed', 'door'].includes(c.tool) || isDeviceKind(c.tool)) && positions.length !== 1)
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
            (b === Block.Stone || b === Block.Soil || b === Block.Steel || b === Block.Components)
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
        if (!plans.some((j) => same(j, target))) plans.push(this.makeJob(kind, target, c.axis));
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
            !(j.kind === 'remove' && ['cook', 'refuel'].includes(k.kind)),
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
      this.doors.length + [...this.jobs, ...plans].filter((j) => j.kind === 'door').length > 512
    )
      return { ok: false, message: '设施数量已达到上限' };
    for (const j of plans)
      if (j.kind === 'remove')
        for (const k of [...this.jobs])
          if (['cook', 'refuel'].includes(k.kind) && same(k, j)) this.cancel(k);
    this.jobs.push(...plans);
    this.notice = `安排 ${plans.length} 项工作，需求木材 ${plans.reduce((n, j) => n + (j.cost.wood ?? 0), 0)}；缺料和不可达任务会等待`;
    return { ok: true, message: this.notice, count: plans.length };
  }
  private makeJob(kind: JobKind, p: Pos, axis: Axis = 'x'): Job {
    return {
      id: this.id(),
      kind,
      x: p.x,
      y: p.y,
      z: p.z,
      work: workOf(kind),
      progress: 0,
      owner: null,
      delivered: {},
      cost: costOf(kind),
      reason: '等待可达工人',
      ...(['bed', 'door'].includes(kind) || isDeviceKind(kind) ? { axis } : {}),
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
    if (isDeviceKind(kind)) {
      return deviceCells({ ...p, kind, axis }).some(
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
      return [b, above].some((b) => b >= Block.Soil && b !== Block.Wood && b !== Block.Bedrock)
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
        this.ladders[at(p)] ||
        this.blocks[index(p.x, p.y, p.z - 1)] === Block.Wood
        ? ''
        : '只能拆除木墙、木楼板或梯子';
    return '未知的规划类型';
  }
  private release(p: Pawn) {
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
    for (const r of resources)
      if (j.delivered[r]) this.addItem(r, j.delivered[r]!, this.dropPoint(j));
    this.jobs = this.jobs.filter((k) => k.id !== j.id);
  }
  private dropPoint(p: Pos): Pos {
    if (this.standable(p)) return p;
    for (const [dx, dy] of horizontal) {
      const q = { x: p.x + dx, y: p.y + dy, z: p.z };
      if (this.standable(q)) return q;
    }
    return this.pawns[0];
  }
  private supported(j: Job) {
    if (isDeviceKind(j.kind)) return !this.placementReason(j.kind, j, j.axis);
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
      .filter((j) => j.owner === null && p.priorities[workType(j.kind)] > 0)
      .sort(
        (a, b) => p.priorities[workType(a.kind)] - p.priorities[workType(b.kind)] || a.id - b.id,
      );
    const loose =
      p.priorities.haul > 0 &&
      this.stockpiles.length > 0 &&
      this.items.some((i) => !this.stockpiles.some((s) => same(s, i)));
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
      p.reason = p.food < 30 ? '饥饿，暂无可用食物' : jobs.length ? '等待材料或支撑' : '暂无工作';
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
      for (const i of this.items)
        if (
          this.distance[at(i)] >= 0 &&
          !this.stockpiles.some((s) => same(s, i)) &&
          (!best || this.distance[at(i)] < this.distance[at(best)])
        )
          best = i;
      if (best && this.stockpiles.some((s) => this.distance[at(s)] >= 0)) {
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
    if (p.cargo) {
      this.addItem(p.cargo.resource, p.cargo.amount, p);
      p.cargo = null;
    }
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
      p.reason = '前往床位睡觉';
    } else {
      p.phase = 'rest';
      p.sleepingSince = this.tick;
      p.reason = '地面睡眠（无可达空床）';
    }
  }
  private continueJob(p: Pawn, j: Job) {
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
    let j = this.jobs.find((j) => j.id === p.jobId);
    // Loading deliberately clears reservations, but the carried physical input
    // can be rebound to a reachable job before requiring a stockpile detour.
    if (!j) {
      j = this.jobs.find(
        (k) =>
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
        this.go(p, stand, 'work');
        p.reason = '把材料送往工作面';
        return;
      }
    }
    let best = -1;
    for (const s of this.stockpiles) {
      const i = at(s);
      if (
        this.standable(s) &&
        this.distance[i] >= 0 &&
        (best < 0 || this.distance[i] < this.distance[best])
      )
        best = i;
    }
    if (best < 0) {
      p.reason = '携带物资，等待可达仓储';
      p.phase = 'idle';
      return;
    }
    this.go(p, best, 'haul');
    p.reason = '运往仓储';
  }
  private take(p: Pawn, resource: Resource | undefined, amount: number) {
    const item = this.items.find((i) => same(i, p) && (!resource || i.resource === resource));
    if (!item || amount <= 0 || p.cargo) return false;
    const n = Math.min(amount, item.amount);
    p.cargo = { resource: item.resource, amount: n };
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
    if (p.cargo) {
      this.addItem(p.cargo.resource, p.cargo.amount, p);
      p.cargo = null;
    }
    p.eating = food.resource;
    this.go(p, at(food), 'fetch');
    p.reason = `寻找${RESOURCE_NAMES[food.resource]}`;
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
        if (!this.stockpiles.some((s) => same(s, p))) {
          this.deliverCargo(p);
          return;
        }
        this.addItem(p.cargo.resource, p.cargo.amount, p);
        this.stats.hauled += p.cargo.amount;
        p.cargo = null;
        this.release(p);
      } else if (this.take(p, undefined, 30)) this.deliverCargo(p);
      else this.release(p);
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
        j.delivered[resource] = (j.delivered[resource] ?? 0) + n;
        p.cargo.amount -= n;
        if (p.cargo.amount === 0) p.cargo = null;
      }
      if (missing(j)) {
        this.continueJob(p, j);
        return;
      }
      p.reason = '正在' + JOB_NAMES[j.kind];
      j.progress++;
      if (j.progress >= j.work) this.finish(p, j);
    }
  }
  private finish(p: Pawn, j: Job) {
    const devicePlan = isDeviceKind(j.kind)
      ? deviceCells({ ...j, kind: j.kind, axis: j.axis ?? 'x' })
      : [];
    const changes: { pos: Pos; block?: number; ladder?: number }[] = [];
    const yields: Partial<Counts> = {};
    const reward = (b: number) => {
      const resource =
        b === Block.Steel
          ? 'steel'
          : b === Block.Components
            ? 'components'
            : b === Block.Stone
              ? 'stone'
              : null;
      if (resource)
        yields[resource] =
          (yields[resource] ?? 0) + (resource === 'steel' ? 40 : resource === 'components' ? 2 : 5);
    };
    if (j.kind === 'mine' || j.kind === 'digLadder') {
      for (const z of j.kind === 'mine' ? [j.z, j.z + 1] : [j.z]) {
        const q = { x: j.x, y: j.y, z },
          b = this.blocks[at(q)];
        if (b === Block.Bedrock || b === Block.Wood) continue;
        if (b) {
          reward(b);
          changes.push({ pos: q, block: 0 });
        }
      }
      if (j.kind === 'digLadder') changes.push({ pos: j, ladder: 1 });
    } else if (j.kind === 'floor') changes.push({ pos: { ...j, z: j.z - 1 }, block: Block.Wood });
    else if (j.kind === 'wall')
      for (const z of [j.z, j.z + 1]) changes.push({ pos: { ...j, z }, block: Block.Wood });
    else if (j.kind === 'ladder') changes.push({ pos: j, ladder: 1 });
    else if (j.kind === 'remove') {
      const device = this.deviceAt(j);
      if (device) {
        for (const [r, n] of Object.entries(DEVICE_COSTS[device.kind]))
          yields[r as Resource] = Math.floor(n / 2);
        if (device.kind === 'generator') yields.wood = Math.floor(device.fuel);
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
        const start = this.blocks[at(j)] === Block.Wood ? j.z : j.z - 1;
        for (const z of start === j.z ? [start, start + 1] : [start])
          if (this.blocks[index(j.x, j.y, z)] === Block.Wood)
            changes.push({ pos: { ...j, z }, block: 0 });
        yields.wood = changes.length;
      }
    }
    if (!this.supported(j)) {
      j.reason = '支撑已改变，等待恢复';
      this.release(p);
      return;
    }
    const previous = changes.map((c) => ({
      i: at(c.pos),
      block: this.blocks[at(c.pos)],
      ladder: this.ladders[at(c.pos)],
    }));
    const supportedItems =
      changes.length || j.kind === 'stove' || devicePlan.length
        ? this.items.filter((i) => this.standable(i))
        : [];
    // Demolition must not strand an otherwise supported upper platform. Preserve
    // existing access to the camp for people and loose goods, not just foot support.
    const exit = this.stockpiles.find((q) => this.standable(q)) ?? { x: 32, y: 34, z: SURFACE };
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
      this.stoves.some(
        (s) =>
          !this.blocks[at(s) - WIDTH * DEPTH] ||
          this.blocks[at(s)] ||
          this.blocks[at(s) + WIDTH * DEPTH],
      ) ||
      [...this.beds.flatMap(bedCells), ...this.doors, ...this.devices.flatMap(deviceCells)].some(
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
    const displaced: { item: Stack; target: Pos }[] = [];
    for (const item of supportedItems)
      if (!this.standable(item)) {
        const target = horizontal
          .map(([dx, dy]) => ({ x: item.x + dx, y: item.y + dy, z: item.z }))
          .find((q) => this.standable(q));
        if (!target) {
          rollback('散落物资无相邻空位，请先搬走再施工');
          return;
        }
        displaced.push({ item, target });
      }
    for (const { item, target } of displaced) {
      this.items = this.items.filter((i) => i.id !== item.id);
      this.addItem(item.resource, item.amount, target);
    }
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
    if (isDeviceKind(j.kind)) {
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
      this.addItem(resource as Resource, n, p);
      this.stats.produced[resource as Resource] += n;
    }
    for (const r of resources) this.stats.consumed[r] += j.delivered[r] ?? 0;
    if (
      (j.cost.wood && !['cook', 'refuel'].includes(j.kind)) ||
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
        temperatureAt(this.tick),
      );
      this.roomsDirty = false;
      this.roomRevision++;
    }
  }
  temperature(p: Pos) {
    this.updateRooms();
    return this.thermal.temperatureAt(p, temperatureAt(this.tick));
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
    this.thermal.step(1 / TPS, temperatureAt(this.tick), this.doors, this.tick);
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
      if (this.stockpiles.some((s) => same(s, i))) stored[i.resource] += i.amount;
    return structuredClone({
      seed: this.seed,
      tick: this.tick,
      revision: this.revision,
      speed,
      pawns: this.pawns,
      items: this.items,
      trees: this.trees,
      jobs: this.jobs,
      stockpiles: this.stockpiles,
      farms: this.farms,
      crops: this.crops,
      stoves: this.stoves,
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
      temperature: temperatureAt(this.tick),
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
      version: 4,
      generator: 1,
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
      ![1, 2, 3, 4].includes(old.version) ||
      old.generator !== 1
    )
      throw new Error('请使用体素版存档；二维存档仍在原营地入口读取');
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
    const d = old as VoxelSave;
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
      ...d.beds,
      ...d.doors,
      ...d.devices,
    ]) {
      if (!positive(e.id) || ids.has(e.id) || e.id >= d.nextId)
        throw new Error('重复或无效的对象编号');
      ids.add(e.id);
    }
    for (const i of d.items)
      if (!resources.includes(i.resource) || !positive(i.amount)) throw new Error('物资数据无效');
    for (const t of d.trees)
      if (!positive(t.wood) || t.z + 1 >= HEIGHT) throw new Error('树木数据无效');
    const uniqueCells = (a: Pos[]) => new Set(a.map(at)).size === a.length;
    if (![d.farms, d.crops, d.stoves, d.stockpiles, d.doors, d.wires].every(uniqueCells))
      throw new Error('区域或设施位置重复');
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
    for (const j of d.jobs)
      if (
        !Object.hasOwn(JOB_NAMES, j.kind) ||
        j.z < 1 ||
        j.z >= HEIGHT - 1 ||
        !zero(j.progress) ||
        !positive(j.work) ||
        j.work !== workOf(j.kind) ||
        ((['bed', 'door'].includes(j.kind) || isDeviceKind(j.kind)) &&
          (!['x', 'y'].includes(j.axis ?? '') ||
            (j.kind === 'bed' && bedCells({ ...j, axis: j.axis! }).some((p) => !inside(p))) ||
            (isDeviceKind(j.kind) &&
              deviceCells({ ...j, kind: j.kind, axis: j.axis! }).some((p) => !inside(p))))) ||
        !materialMap(j.cost) ||
        !materialMap(j.delivered) ||
        resources.some(
          (r) =>
            (j.cost[r] ?? 0) !==
              (j.kind === 'refuel' ? (r === 'wood' ? j.cost.wood : 0) : (costOf(j.kind)[r] ?? 0)) ||
            (j.delivered[r] ?? 0) > (j.cost[r] ?? 0),
        ) ||
        (j.kind === 'cook' && !d.stoves.some((s) => same(s, j))) ||
        (j.kind === 'refuel' &&
          (!positive(j.cost.wood!) ||
            !d.devices.some((v) => v.kind === 'generator' && same(v, j) && j.cost.wood! <= 75)))
      )
        throw new Error('任务数据无效');
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
        Object.values(p.priorities).length !== 6 ||
        (['dig', 'cut', 'build', 'haul', 'grow', 'cook'] as Work[]).some(
          (k) => !Number.isInteger(p.priorities[k]) || p.priorities[k] < 0 || p.priorities[k] > 4,
        ) ||
        (p.cargo && (!resources.includes(p.cargo.resource) || !positive(p.cargo.amount))) ||
        (p.eating !== null && !NUTRITION[p.eating])
      )
        throw new Error('人物数据无效');
    }
    if (
      !d.stats ||
      !['mined', 'cut', 'built', 'hauled', 'sown', 'harvested', 'cooked', 'eaten'].every((k) =>
        zero(d.stats[k as 'mined']),
      ) ||
      !['produced', 'consumed'].every((k) =>
        resources.every((r) => zero(d.stats[k as 'produced']?.[r as Resource])),
      )
    )
      throw new Error('统计数据无效');
    const s = new VoxelSimulation(d.seed);
    s.blocks = decode(d.blocks, 6);
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
      [...s.beds.flatMap(bedCells), ...s.doors, ...s.devices.flatMap(deviceCells)].some(
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
    if (s.wires.some((w) => w.z < 1 || w.z >= HEIGHT - 1)) throw new Error('线路高度无效');
    s.updateRooms();
    s.thermal.restore(d.thermal, s.rooms, temperatureAt(s.tick));
    s.updatePower();
    // Persist work progress, delivered and carried resources; rebuild transient paths and ownership.
    for (const j of s.jobs) {
      j.owner = null;
      j.reason = '回读后等待重新安排';
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
