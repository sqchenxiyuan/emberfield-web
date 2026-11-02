import {
  Block,
  CELLS,
  CHUNK,
  DEPTH,
  HEIGHT,
  SURFACE,
  WIDTH,
  at,
  emptyCounts,
  index,
  inside,
  position,
} from './types';
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
} from './types';

const same = (a: Pos, b: Pos) => a.x === b.x && a.y === b.y && a.z === b.z;
const horizontal = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const costOf = (kind: JobKind) =>
  ({ mine: 0, cut: 0, floor: 3, wall: 6, ladder: 2, digLadder: 2, remove: 0 })[kind];
const workOf = (kind: JobKind) =>
  ({ mine: 70, cut: 60, floor: 45, wall: 80, ladder: 40, digLadder: 90, remove: 40 })[kind];
const workType = (kind: JobKind): Work =>
  kind === 'mine' || kind === 'digLadder' ? 'dig' : kind === 'cut' ? 'cut' : 'build';
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
  stockpiles: Pos[] = [
    { x: 30, y: 32, z: SURFACE },
    { x: 30, y: 33, z: SURFACE },
  ];
  stats: VoxelStats = {
    mined: 0,
    cut: 0,
    built: 0,
    hauled: 0,
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
        priorities: { dig: 1, build: 1, cut: 1, haul: 2 },
        jobId: null,
        path: [],
        destination: null,
        phase: 'idle',
        cargo: null,
        reason: '等待安排',
        moveTick: 0,
        workTarget: null,
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
    const candidates: Pos[] = horizontal.map(([dx, dy]) => ({ x: j.x + dx, y: j.y + dy, z: j.z }));
    if (j.kind === 'floor') candidates.push({ ...j });
    if (j.kind === 'ladder' || j.kind === 'digLadder')
      candidates.push({ ...j, z: j.z + 1 }, { ...j, z: j.z - 1 });
    if (j.kind === 'remove' && this.ladders[at(j)])
      candidates.push({ ...j, z: j.z - 1 }, { ...j, z: j.z + 1 });
    return candidates.filter((p) => this.standable(p)).map(at);
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
  private jobCellConflict(
    j: Pick<Job, 'x' | 'y' | 'z' | 'kind'>,
    k: Pick<Job, 'x' | 'y' | 'z' | 'kind'>,
  ) {
    if (j.x !== k.x || j.y !== k.y) return false;
    const cells = (v: typeof j) =>
      v.kind === 'floor'
        ? [v.z - 1]
        : v.kind === 'wall' || v.kind === 'mine'
          ? [v.z, v.z + 1]
          : [v.z];
    return cells(j).some((z) => cells(k).includes(z));
  }
  command(c: VoxelCommand): CommandResult {
    if (!c || typeof c !== 'object') return { ok: false, message: '命令格式无效' };
    const nextId = this.nextId;
    const result = this.applyCommand(c);
    if (!result.ok) this.nextId = nextId;
    return result;
  }
  private applyCommand(c: VoxelCommand): CommandResult {
    if (c.type === 'priority') {
      const p = this.pawns.find((p) => p.id === c.pawnId);
      if (
        !p ||
        !['dig', 'build', 'cut', 'haul'].includes(c.work) ||
        !Number.isInteger(c.value) ||
        c.value < 0 ||
        c.value > 4
      )
        return { ok: false, message: '工作优先级无效' };
      p.priorities[c.work] = c.value;
      this.release(p);
      return { ok: true, message: '工作优先级已更新；0 为禁用' };
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
    if (c.tool === 'cancel') {
      let n = 0;
      for (const p of positions)
        for (const j of [...this.jobs])
          if (same(j, p)) {
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
      if (positions.some((p) => !this.standable(p) || this.ladders[at(p)]))
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
        const reason = this.placementReason(kind, p);
        if (reason) {
          errors.push(reason);
          continue;
        }
        plans.push(this.makeJob(kind, p));
      }
    }
    // Natural-resource drags skip empty cells; construction rejects the whole invalid stroke.
    if (errors.length && c.tool !== 'mine' && c.tool !== 'cut')
      return { ok: false, message: errors[0] };
    if (plans.some((j) => this.jobs.some((k) => this.jobCellConflict(j, k))))
      return { ok: false, message: '规划与已有任务重叠，请先取消原规划' };
    if (!plans.length) return { ok: false, message: errors[0] ?? '没有可安排的目标' };
    if (this.jobs.length + plans.length > 512)
      return { ok: false, message: '规划上限为 512 项，请等部分任务完成' };
    this.jobs.push(...plans);
    this.notice = `安排 ${plans.length} 项工作，需求木材 ${plans.reduce((n, j) => n + j.cost, 0)}；缺料和不可达任务会等待`;
    return { ok: true, message: this.notice, count: plans.length };
  }
  private makeJob(kind: JobKind, p: Pos): Job {
    return {
      id: this.id(),
      kind,
      ...p,
      work: workOf(kind),
      progress: 0,
      owner: null,
      delivered: 0,
      cost: costOf(kind),
      reason: '等待可达工人',
    };
  }
  private placementReason(kind: JobKind, p: Pos) {
    const b = this.blocks[at(p)],
      above = this.blocks[index(p.x, p.y, p.z + 1)];
    if (kind === 'mine')
      return [b, above].some((b) => b >= Block.Soil && b !== Block.Wood && b !== Block.Bedrock)
        ? ''
        : '此处没有可开挖的自然方块';
    if (kind === 'cut') return this.trees.some((t) => same(t, p)) ? '' : '此处没有成熟树木';
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
      return b === Block.Wood ||
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
  }
  private cancel(j: Job) {
    for (const p of this.pawns) if (p.jobId === j.id) this.release(p);
    if (j.delivered) this.addItem('wood', j.delivered, this.dropPoint(j));
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
    if (j.kind === 'wall') return this.blocks[index(j.x, j.y, j.z - 1)] !== 0;
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
    if (p.cargo) {
      this.deliverCargo(p);
      return;
    }
    if (p.rest < 10) {
      p.phase = 'rest';
      p.reason = '原地休息';
      return;
    }
    this.search(p);
    if (p.food < 40) {
      const food = this.pileFor(p, 'food');
      if (food) {
        this.go(p, at(food), 'fetch');
        p.reason = '取用口粮';
        p.workTarget = null;
        return;
      }
    }
    const jobs = this.jobs
      .filter((j) => j.owner === null && p.priorities[workType(j.kind)] > 0)
      .sort(
        (a, b) => p.priorities[workType(a.kind)] - p.priorities[workType(b.kind)] || a.id - b.id,
      );
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
      if (j.cost > j.delivered && !this.pileFor(p, 'wood')) {
        j.reason = '缺少可达木材；先伐木或接通通路';
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
    p.reason = jobs.length ? '等待材料或可达通路' : '暂无工作，休息恢复';
  }
  private continueJob(p: Pawn, j: Job) {
    this.search(p);
    if (j.delivered < j.cost) {
      const stack = this.pileFor(p, 'wood');
      if (!stack) {
        j.reason = '等待可达木材';
        this.release(p);
        return;
      }
      this.go(p, at(stack), 'fetch');
      p.reason = '搬运建材';
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
    j.reason = '施工中';
  }
  private deliverCargo(p: Pawn) {
    if (!p.cargo) return;
    this.search(p);
    const j = this.jobs.find((j) => j.id === p.jobId);
    if (j && p.cargo.resource === 'wood' && j.delivered < j.cost) {
      const stand = this.reachableStand(j);
      if (stand >= 0) {
        this.go(p, stand, 'work');
        p.reason = '把建材送往工作面';
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
    if (!item) return false;
    const n = Math.min(amount, item.amount);
    p.cargo = { resource: item.resource, amount: n };
    item.amount -= n;
    this.items = this.items.filter((i) => i.amount > 0);
    return true;
  }
  private arrive(p: Pawn) {
    const j = this.jobs.find((j) => j.id === p.jobId);
    if (p.phase === 'fetch') {
      if (!j) {
        if (this.take(p, 'food', 1)) {
          p.food = Math.min(100, p.food + 65);
          this.stats.consumed.food++;
          p.cargo = null;
        }
        this.release(p);
        return;
      }
      if (this.take(p, 'wood', j.cost - j.delivered)) this.deliverCargo(p);
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
        if (p.cargo.resource !== 'wood') {
          this.deliverCargo(p);
          return;
        }
        const n = Math.min(p.cargo.amount, j.cost - j.delivered);
        j.delivered += n;
        p.cargo.amount -= n;
        if (p.cargo.amount === 0) p.cargo = null;
      }
      if (j.delivered < j.cost) {
        this.continueJob(p, j);
        return;
      }
      p.reason =
        '正在' +
        {
          mine: '挖掘',
          cut: '伐木',
          floor: '铺设楼板',
          wall: '建造墙壁',
          ladder: '搭建梯子',
          digLadder: '开凿梯井',
          remove: '拆除',
        }[j.kind];
      j.progress++;
      if (j.progress >= j.work) this.finish(p, j);
    }
  }
  private finish(p: Pawn, j: Job) {
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
      if (this.ladders[at(j)]) {
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
    for (const c of changes) {
      if (c.block !== undefined) this.blocks[at(c.pos)] = c.block;
      if (c.ladder !== undefined) this.ladders[at(c.pos)] = c.ladder;
    }
    if (this.pawns.some((p) => !this.standable(p))) {
      for (let i = previous.length - 1; i >= 0; i--) {
        const c = previous[i];
        this.blocks[c.i] = c.block;
        this.ladders[c.i] = c.ladder;
      }
      j.reason = '有人占用或依赖这处支撑，请先移开人物';
      this.release(p);
      return;
    }
    if (j.kind === 'cut') {
      const tree = this.trees.find((t) => same(t, j));
      if (tree) {
        yields.wood = tree.wood;
        this.trees = this.trees.filter((t) => t.id !== tree.id);
        this.rebuildTrees();
        this.revision++;
        this.stats.cut++;
      }
    }
    for (const c of changes) this.changed(c.pos);
    for (const [resource, n] of Object.entries(yields)) {
      this.addItem(resource as Resource, n, p);
      this.stats.produced[resource as Resource] += n;
    }
    if (j.cost) {
      this.stats.consumed.wood += j.delivered;
      this.stats.built++;
    }
    if (j.kind === 'mine' || j.kind === 'digLadder')
      this.stats.mined += changes.filter((c) => c.block === 0).length;
    this.jobs = this.jobs.filter((k) => k.id !== j.id);
    this.release(p);
  }
  step(count = 1) {
    for (let n = 0; n < count; n++) {
      this.tick++;
      for (const p of this.pawns) {
        p.food = Math.max(0, p.food - 0.002);
        p.rest = Math.max(0, p.rest - (p.phase === 'work' ? 0.004 : 0.001));
        if (p.phase === 'idle' || p.phase === 'rest') p.rest = Math.min(100, p.rest + 0.03);
        if (p.phase === 'rest') {
          if (p.rest > 65) p.phase = 'idle';
          else continue;
        }
        if (p.path.length) {
          if (this.tick < p.moveTick) continue;
          const next = p.path[0];
          if (!this.neighbors(p).includes(next)) {
            this.release(p);
            p.reason = '通路改变，等待重新规划';
            continue;
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
    }
  }
  counts(): Counts {
    const out = emptyCounts();
    for (const i of this.items) out[i.resource] += i.amount;
    for (const p of this.pawns) if (p.cargo) out[p.cargo.resource] += p.cargo.amount;
    for (const j of this.jobs) out.wood += j.delivered;
    return out;
  }
  snapshot(speed = 0, tickMs = 0): VoxelSnapshot {
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
    return structuredClone({
      format: 'emberfield-voxel',
      version: 1,
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
      stats: this.stats,
    });
  }
  static load(raw: unknown) {
    if (!raw || typeof raw !== 'object') throw new Error('存档无效');
    const d = raw as VoxelSave;
    if (d.format !== 'emberfield-voxel' || d.version !== 1 || d.generator !== 1)
      throw new Error('请使用体素版存档；二维存档仍在原营地入口读取');
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
    ];
    for (const [a, max] of arrays)
      if (!Array.isArray(a) || a.length > max || (a as Pos[]).some((p) => !p || !inside(p)))
        throw new Error('存档对象数量或坐标无效');
    if (d.pawns.length !== 3) throw new Error('试玩存档需要三名殖民者');
    const resources = ['wood', 'stone', 'steel', 'components', 'food'];
    const positive = (n: number) => Number.isSafeInteger(n) && n > 0 && n <= 10000000;
    const zero = (n: number) => Number.isFinite(n) && n >= 0 && n <= 10000000;
    const ids = new Set<number>();
    for (const e of [...d.pawns, ...d.items, ...d.trees, ...d.jobs]) {
      if (!positive(e.id) || ids.has(e.id) || e.id >= d.nextId)
        throw new Error('重复或无效的对象编号');
      ids.add(e.id);
    }
    for (const i of d.items)
      if (!resources.includes(i.resource) || !positive(i.amount)) throw new Error('物资数据无效');
    for (const t of d.trees)
      if (!positive(t.wood) || t.z + 1 >= HEIGHT) throw new Error('树木数据无效');
    for (const j of d.jobs)
      if (
        !['mine', 'cut', 'floor', 'wall', 'ladder', 'digLadder', 'remove'].includes(j.kind) ||
        j.z < 1 ||
        j.z >= HEIGHT - 1 ||
        !zero(j.progress) ||
        !positive(j.work) ||
        j.work !== workOf(j.kind) ||
        j.cost !== costOf(j.kind) ||
        !Number.isSafeInteger(j.delivered) ||
        j.delivered < 0 ||
        j.delivered > j.cost
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
        !p.priorities ||
        Object.values(p.priorities).length !== 4 ||
        (['dig', 'cut', 'build', 'haul'] as Work[]).some(
          (k) => !Number.isInteger(p.priorities[k]) || p.priorities[k] < 0 || p.priorities[k] > 4,
        ) ||
        (p.cargo && (!resources.includes(p.cargo.resource) || !positive(p.cargo.amount)))
      )
        throw new Error('人物数据无效');
    }
    if (
      !d.stats ||
      !['mined', 'cut', 'built', 'hauled'].every((k) => zero(d.stats[k as 'mined'])) ||
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
        stats: d.stats,
      }),
    );
    s.rebuildTrees();
    if (s.pawns.some((p) => !s.standable(p))) throw new Error('人物没有合法支撑或净空');
    // Persist work progress, delivered and carried resources; rebuild transient paths and ownership.
    for (const j of s.jobs) {
      j.owner = null;
      j.reason = '回读后等待重新安排';
    }
    for (const p of s.pawns) {
      p.jobId = null;
      p.path = [];
      p.destination = null;
      p.phase = 'idle';
      p.workTarget = null;
      p.moveTick = s.tick;
      p.reason = '存档已恢复，正在重新安排工作';
    }
    s.markAll();
    s.notice = '体素存档已恢复；路径与任务预定重新建立';
    return s;
  }
}
