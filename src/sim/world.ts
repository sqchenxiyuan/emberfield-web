import { BUILDINGS, PART_HP, RESOURCES, TECHS, WORKS } from './defs';
import {
  DAY,
  HOUR,
  SIZE,
  type World,
  type Pawn,
  type Resource,
  type Building,
  type Item,
  type Command,
  type Result,
  type Job,
  type Summary,
  type SaveData,
  type Work,
  type BuildingKind,
  type Inspection,
} from './types';
import { Pathfinder } from './path';
import { validateSave } from './save';
import { planBuild } from './placement';
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const cell = (x: number, y: number) => Math.round(y) * SIZE + Math.round(x);
export class Simulation {
  world: World;
  nav = new Pathfinder();
  pauseRequested = false;
  constructor(seed = 73129) {
    seed = seed >>> 0 || 73129;
    this.world = {
      version: 1,
      seed,
      rng: seed >>> 0,
      tick: 0,
      nextId: 1,
      revision: 0,
      terrain: new Uint8Array(SIZE * SIZE),
      zones: new Uint8Array(SIZE * SIZE),
      fertility: new Uint8Array(SIZE * SIZE),
      nature: [],
      items: [],
      buildings: [],
      crops: [],
      pawns: [],
      logs: [],
      stats: {
        harvested: 0,
        cooked: 0,
        built: 0,
        hauled: 0,
        tended: 0,
        kills: 0,
        raids: 0,
        mealsEaten: 0,
      },
      research: {},
      researchTarget: 'electricity',
      mealTarget: 14,
      nextRaid: DAY * 3 + 3000,
      nextWeather: DAY,
      weather: 'clear',
      weatherUntil: 0,
      beaconTicks: 0,
      beaconActive: false,
      finalWaves: 0,
      outcome: 'playing',
      continueAfterWin: false,
      lastHurt: -DAY * 10,
      autoPause: true,
      tutorialHidden: false,
      difficulty: 1,
      power: { generated: 0, demand: 0, stored: 0 },
    };
    this.generate();
  }
  random() {
    let n = this.world.rng;
    n ^= n << 13;
    n ^= n >>> 17;
    n ^= n << 5;
    this.world.rng = n >>> 0;
    return this.world.rng / 4294967296;
  }
  private id() {
    return this.world.nextId++;
  }
  log(text: string, type: 'info' | 'good' | 'danger' = 'info', x?: number, y?: number) {
    const w = this.world;
    w.logs.push({ id: this.id(), tick: w.tick, text, type, x, y });
    if (w.logs.length > 100) w.logs.shift();
  }
  private generate() {
    const w = this.world;
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const i = y * SIZE + x,
          river = 70 + Math.sin(y * 0.09) * 5;
        const clearing = Math.hypot(x - 45, y - 47) < 12;
        const v = this.random();
        w.terrain[i] = Math.abs(x - river) < 2.6 && !(y >= 45 && y <= 48) ? 2 : v < 0.16 ? 0 : 1;
        if (x < 3 || y < 3 || x > 92 || y > 92) w.terrain[i] = 1;
        w.fertility[i] = 85 + Math.floor(this.random() * 35);
        if (w.terrain[i] === 2) continue;
        if (!clearing && this.random() < 0.13)
          w.nature.push({ id: this.id(), x, y, kind: 'tree', amount: 25, marked: false });
        else if (
          !clearing &&
          (Math.hypot(x - 29, y - 28) < 9 || Math.hypot(x - 54, y - 67) < 7) &&
          this.random() < 0.4
        )
          w.nature.push({ id: this.id(), x, y, kind: 'ore', amount: 35, marked: false });
        else if (!clearing && this.random() < 0.014)
          w.nature.push({ id: this.id(), x, y, kind: 'berry', amount: 12, marked: false });
      }
    const roles = ['工程师 · 坚韧', '农艺师 · 乐观', '医师 · 好奇'];
    ['林野', '苏禾', '温岚'].forEach((name, i) => {
      const p = this.makePawn(name, 43 + i * 2, 47 + (i % 2), false, false, i);
      p.role = roles[i];
      const preferred: Work[] =
        i === 0 ? ['build', 'mine', 'cut'] : i === 1 ? ['grow', 'cook'] : ['doctor', 'research'];
      for (const k of preferred) {
        p.skills[k] = 8;
        p.priorities[k] = 1;
      }
      p.weapon = i === 1 ? 'knife' : 'gun';
      w.pawns.push(p);
    });
    const supplies: Partial<Record<Resource, number>> = {
      wood: 180,
      steel: 100,
      components: 10,
      ration: 36,
      raw: 90,
      medicine: 12,
      silver: 80,
    };
    Object.entries(supplies).forEach(([kind, count], i) =>
      this.addItem(kind as Resource, count, 42 + (i % 4), 50 + Math.floor(i / 4)),
    );
    for (let i = 0; i < 12; i++) {
      const x = 20 + Math.floor(this.random() * 38),
        y = 20 + Math.floor(this.random() * 40);
      if (w.terrain[y * SIZE + x] !== 2)
        w.pawns.push(this.makePawn('原野鹿', x, y, false, true, i));
    }
    this.rebuildNav();
    this.log('逃生舱已着陆。三名幸存者，五日口粮。先建立一个可以生活的地方。', 'good', 45, 48);
  }
  private makePawn(
    name: string,
    x: number,
    y: number,
    enemy = false,
    animal = false,
    index = 0,
  ): Pawn {
    return {
      id: this.id(),
      name,
      role: enemy ? '掠夺者' : animal ? '野生动物' : '幸存者',
      color: [0xc9a66e, 0x8daf9c, 0xb79ab2][index % 3],
      x,
      y,
      enemy,
      animal,
      food: 0.85,
      rest: 90,
      joy: 75,
      mood: 65,
      blood: 100,
      wounds: [],
      dead: false,
      downed: false,
      drafted: false,
      weapon: enemy ? 'knife' : 'gun',
      cooldown: 0,
      job: null,
      carry: null,
      skills: Object.fromEntries(WORKS.map((k) => [k, 4])) as Pawn['skills'],
      priorities: Object.fromEntries(WORKS.map((k) => [k, 3])) as Pawn['priorities'],
      schedule: 'balanced',
      thoughts: [],
      lowMood: 0,
      breakUntil: 0,
      protectionUntil: 0,
      waitUntil: 0,
      reason: '观察周围环境',
    };
  }
  addItem(kind: Resource, count: number, x: number, y: number) {
    if (count <= 0) return;
    const existing = this.world.items.find(
      (i) => i.kind === kind && i.x === Math.round(x) && i.y === Math.round(y) && !i.reserved,
    );
    if (existing) {
      existing.count += count;
      return existing;
    }
    const item = {
      id: this.id(),
      x: Math.round(x),
      y: Math.round(y),
      kind,
      count,
      age: 0,
      reserved: 0,
    };
    this.world.items.push(item);
    return item;
  }
  inventory(available = false): Record<Resource, number> {
    const out = Object.fromEntries(RESOURCES.map((r) => [r, 0])) as Record<Resource, number>;
    for (const i of this.world.items)
      out[i.kind] += Math.max(0, i.count - (available ? i.reserved : 0));
    if (!available)
      for (const p of this.world.pawns) if (p.carry) out[p.carry.kind] += p.carry.count;
    return out;
  }
  private consume(kind: Resource, amount: number) {
    const items = this.world.items.filter((i) => i.kind === kind);
    if (items.reduce((s, i) => s + i.count - i.reserved, 0) + 1e-6 < amount) return false;
    for (const i of items) {
      const n = Math.min(amount, i.count - i.reserved);
      i.count -= n;
      amount -= n;
      if (amount < 1e-6) break;
    }
    return true;
  }
  complete(b: Building) {
    return b.progress >= BUILDINGS[b.kind].work * HOUR;
  }
  private unlocked(kind: BuildingKind) {
    const tech = BUILDINGS[kind].tech;
    return !tech || (this.world.research[tech] ?? 0) >= TECHS[tech].cost;
  }
  rebuildNav() {
    const w = this.world;
    this.nav.blocked.fill(0);
    w.terrain.forEach((t, i) => {
      if (t === 2) this.nav.blocked[i] = 1;
    });
    for (const b of w.buildings) {
      const def = BUILDINGS[b.kind];
      if (this.complete(b) && def.solid)
        for (let y = b.y; y < b.y + def.h; y++)
          for (let x = b.x; x < b.x + def.w; x++) this.nav.blocked[y * SIZE + x] = 1;
    }
  }
  command(c: Command): Result {
    const w = this.world;
    const fail = (reason: string) => ({ ok: false, reason });
    if (w.outcome === 'lost') return fail('所有幸存者已失去生命，请读取存档或重新开始。');
    switch (c.type) {
      case 'build': {
        const plan = planBuild(w, c.kind, c.x, c.y, c.x2, c.y2);
        if (!plan.ok) return fail(plan.reason + ' · 整段未放置');
        const d = BUILDINGS[c.kind];
        for (const pos of plan.cells) {
          w.buildings.push({ id: this.id(), x: pos.x, y: pos.y, kind: c.kind,
            progress: 0, paid: false, delivered: {}, hp: 100, powered: false,
            enabled: true, energy: 0, demolish: false });
          w.nature.forEach((n) => {
            if (n.x >= pos.x && n.x < pos.x + d.w && n.y >= pos.y && n.y < pos.y + d.h) n.marked = true;
          });
        }
        break;
      }
      case 'zone': {
        if (![0, 1, 2, 3].includes(c.zone)) return fail('未知区域');
        const xs = [c.x, c.x2].sort((a, b) => a - b),
          ys = [c.y, c.y2].sort((a, b) => a - b);
        for (
          let y = clamp(Math.floor(ys[0]), 0, SIZE - 1);
          y <= clamp(Math.floor(ys[1]), 0, SIZE - 1);
          y++
        )
          for (
            let x = clamp(Math.floor(xs[0]), 0, SIZE - 1);
            x <= clamp(Math.floor(xs[1]), 0, SIZE - 1);
            x++
          )
            if (
              w.terrain[y * SIZE + x] !== 2 &&
              !(
                c.zone >= 2 &&
                w.buildings.some((b) => {
                  const d = BUILDINGS[b.kind];
                  return (
                    b.kind !== 'wire' && x >= b.x && x < b.x + d.w && y >= b.y && y < b.y + d.h
                  );
                })
              )
            )
              w.zones[y * SIZE + x] = c.zone;
        if (c.zone === 2 || c.zone === 3)
          for (const n of w.nature) if (w.zones[cell(n.x, n.y)] === c.zone) n.marked = true;
        break;
      }
      case 'mark': {
        const inside = (a: { x: number; y: number }) =>
          a.x >= Math.min(c.x, c.x2) &&
          a.x <= Math.max(c.x, c.x2) &&
          a.y >= Math.min(c.y, c.y2) &&
          a.y <= Math.max(c.y, c.y2);
        for (const n of w.nature)
          if (
            inside(n) &&
            (c.mode === 'cancel' ||
              (c.mode === 'cut' && n.kind === 'tree') ||
              (c.mode === 'mine' && (n.kind === 'ore' || n.kind === 'rock')) ||
              (c.mode === 'harvest' && n.kind === 'berry'))
          )
            n.marked = c.mode !== 'cancel';
        for (const b of [...w.buildings])
          if (inside(b)) {
            if (c.mode === 'demolish') {
              b.demolish = true;
            }
            if (c.mode === 'cancel') {
              if (!this.complete(b)) {
                for (const p of w.pawns)
                  if (p.job?.target === b.id && p.job.kind === 'build') this.cancel(p);
                for (const r of RESOURCES) this.addItem(r, b.delivered[r] ?? 0, b.x, b.y);
                w.buildings = w.buildings.filter((v) => v !== b);
              } else b.demolish = false;
            }
          }
        break;
      }
      case 'draft':
        for (const p of w.pawns)
          if (c.ids.includes(p.id) && !p.enemy && !p.animal && !p.dead) {
            this.cancel(p);
            p.drafted = c.value;
            p.reason = c.value ? '已征召 · 右键移动/攻击' : '返回日常工作';
          }
        break;
      case 'move': {
        let count = 0;
        for (const p of w.pawns)
          if (c.ids.includes(p.id) && !p.dead && !p.downed && !p.enemy && !p.animal) {
            const target = w.pawns.find((e) => e.enemy && !e.dead && distance(e, c) < 1.5);
            this.cancel(p);
            if (target) {
              p.drafted = true;
              p.job = this.makeJob(
                p,
                'attack',
                target.id,
                target.x,
                target.y,
                p.weapon === 'gun' ? 15 : 1,
              );
            } else p.job = this.makeJob(p, 'move', 0, c.x, c.y, 0, 0);
            if (p.job) count++;
            else p.reason = '目的地不可达';
          }
        if (!count) return fail('没有可到达该位置的殖民者');
        break;
      }
      case 'priority': {
        const p = w.pawns.find((p) => p.id === c.id && !p.enemy && !p.animal);
        if (!p || !WORKS.includes(c.work)) return fail('未知人物或岗位');
        p.priorities[c.work] = clamp(Math.round(c.value), 0, 4);
        if (p.job?.kind === c.work) this.cancel(p);
        break;
      }
      case 'schedule': {
        const p = w.pawns.find((p) => p.id === c.id);
        if (p && ['balanced', 'night', 'work'].includes(c.value)) p.schedule = c.value;
        break;
      }
      case 'research': {
        const t = TECHS[c.target];
        if (!t) return fail('未知研究');
        if (t.prereq && (w.research[t.prereq] ?? 0) < TECHS[t.prereq].cost)
          return fail('前置研究未完成');
        w.researchTarget = c.target;
        break;
      }
      case 'mealTarget':
        w.mealTarget = clamp(Math.round(c.value), 0, 100);
        break;
      case 'autoPause':
        w.autoPause = !!c.value;
        break;
      case 'toggle': {
        const b = w.buildings.find((b) => b.id === c.id);
        if (b) b.enabled = !b.enabled;
        break;
      }
      case 'beacon':
        if (w.outcome !== 'playing') return fail('这次救援故事已经结束');
        if (w.beaconActive) return fail('信标已经启动');
        if (
          !w.buildings.some(
            (b) => b.kind === 'beacon' && this.complete(b) && b.powered && b.enabled,
          )
        )
          return fail('需要已建成且供电正常的救援信标');
        w.beaconActive = true;
        this.log('救援信号已发出。保持供电两日；掠夺者将在半日和一日半后到达。', 'danger');
        break;
      case 'continue':
        if (w.outcome !== 'won' || w.continueAfterWin) return fail('当前无法继续救援后的生活');
        w.continueAfterWin = true;
        w.beaconActive = false;
        w.nextRaid = w.tick + DAY * 4;
        this.log('你们选择留在山谷。营地恢复日常生活，四日后可能再次遇到袭击。', 'good');
        break;
      case 'tutorial':
        w.tutorialHidden = true;
        break;
    }
    w.revision++;
    return { ok: true, reason: '已安排' };
  }
  private busy(kind: string, target: number) {
    return this.world.pawns.some((p) => p.job?.kind === kind && p.job.target === target && !p.dead);
  }
  private approach(p: Pawn, x: number, y: number, radius = 1) {
    return this.nav.find(p.x, p.y, x, y, radius);
  }
  private makeJob(
    p: Pawn,
    kind: Job['kind'],
    target: number,
    x: number,
    y: number,
    radius = 1,
    total = 60,
  ): Job | null {
    const path = this.approach(p, x, y, radius);
    return path ? { kind, target, x, y, path, progress: 0, total, stage: 0 } : null;
  }
  private nearest<T extends { x: number; y: number }>(p: Pawn, list: T[]) {
    return [...list].sort((a, b) => distance(p, a) - distance(p, b));
  }
  private reserveItem(p: Pawn, kind: Resource, count: number) {
    const chosen: { item: Item; amount: number; path: number[] }[] = [];
    let remaining = count;
    for (const i of this.nearest(
      p,
      this.world.items.filter((i) => i.kind === kind && i.count - i.reserved > 0.001),
    )) {
      const path = this.approach(p, i.x, i.y, 0);
      if (path) {
        const amount = Math.min(remaining, i.count - i.reserved);
        chosen.push({ item: i, amount, path });
        remaining -= amount;
        if (remaining < 1e-6) break;
      }
    }
    if (remaining > 1e-6 || !chosen.length) return null;
    for (const c of chosen) c.item.reserved += c.amount;
    return {
      ...chosen[0],
      pickups: chosen.slice(1).map((c) => ({ id: c.item.id, amount: c.amount })),
    };
  }
  cancel(p: Pawn) {
    const j = p.job;
    if (j?.item && j.stage === 0) {
      const i = this.world.items.find((i) => i.id === j.item);
      if (i) i.reserved = Math.max(0, i.reserved - (j.amount ?? 0));
    }
    for (const pickup of j?.pickups ?? []) {
      const i = this.world.items.find((i) => i.id === pickup.id);
      if (i) i.reserved = Math.max(0, i.reserved - pickup.amount);
    }
    if (p.carry) {
      this.addItem(p.carry.kind, p.carry.count, p.x, p.y);
      p.carry = null;
    }
    p.job = null;
    p.waitUntil = 0;
  }
  private take(p: Pawn, j: Job) {
    const i = this.world.items.find((i) => i.id === j.item);
    if (!i || i.count + 1e-6 < (j.amount ?? 0)) {
      this.cancel(p);
      return false;
    }
    i.count = Math.max(0, i.count - j.amount!);
    i.reserved = Math.max(0, i.reserved - j.amount!);
    p.carry = { kind: i.kind, count: (p.carry?.count ?? 0) + j.amount! };
    j.stage = 1;
    return true;
  }
  private foodJob(p: Pawn) {
    for (const r of ['meal', 'ration', 'raw'] as Resource[]) {
      const amount = r === 'raw' ? 10 : 1;
      const found = this.reserveItem(p, r, amount);
      if (found)
        return {
          kind: 'eat',
          target: found.item.id,
          x: found.item.x,
          y: found.item.y,
          path: found.path,
          progress: 0,
          total: 40,
          item: found.item.id,
          resource: r,
          amount: found.amount,
          pickups: found.pickups,
          stage: 0,
        } as Job;
    }
    return null;
  }
  private sleepJob(p: Pawn) {
    const beds = this.nearest(
      p,
      this.world.buildings.filter(
        (b) =>
          (b.kind === 'bed' || b.kind === 'medical') &&
          this.complete(b) &&
          !this.busy('sleep', b.id) &&
          !this.world.pawns.some((o) => o.downed && distance(o, b) < 0.6),
      ),
    );
    for (const b of beds) {
      const j = this.makeJob(p, 'sleep', b.id, b.x, b.y, 0, 1);
      if (j) return j;
    }
    return this.makeJob(p, 'sleep', 0, Math.round(p.x), Math.round(p.y), 0, 1);
  }
  private chooseJob(p: Pawn) {
    const w = this.world,
      hour = (w.tick / HOUR + 8) % 24;
    if (p.food < 0.25) {
      const food = this.foodJob(p);
      if (food) return food;
    }
    if (p.drafted) return null;
    const night = p.schedule === 'night' ? hour >= 8 && hour < 15 : hour >= 22 || hour < 6;
    if (p.rest < 20 || (night && p.rest < 95 && p.schedule !== 'work')) return this.sleepJob(p);
    if (p.breakUntil > w.tick) {
      p.reason = '精神疲惫 · 暂时无法工作';
      return this.makeJob(p, 'relax', 0, Math.round(p.x), Math.round(p.y), 0, HOUR);
    }
    if (p.joy < 25) {
      const fire = w.buildings.find((b) => b.kind === 'campfire' && this.complete(b));
      return this.makeJob(
        p,
        'relax',
        0,
        fire?.x ?? Math.round(p.x),
        fire?.y ?? Math.round(p.y),
        1,
        HOUR,
      );
    }
    const priority = WORKS.filter((k) => p.priorities[k] > 0).sort(
      (a, b) => p.priorities[a] - p.priorities[b],
    );
    for (const k of priority) {
      const job = this.workJob(p, k);
      if (job) return job;
    }
    p.reason =
      p.food < 0.25
        ? '没有可达的食物'
        : w.buildings.some((b) => !this.complete(b))
          ? '等待材料、清障或可达入口'
          : '暂无可做工作 · 可划定农田或安排采集';
    return null;
  }
  private workJob(p: Pawn, kind: Work): Job | null {
    const w = this.world;
    if (kind === 'doctor') {
      for (const o of this.nearest(
        p,
        w.pawns.filter(
          (o) =>
            !o.dead &&
            !o.enemy &&
            !o.animal &&
            !o.drafted &&
            o.wounds.some((v) => !v.tended) &&
            !this.busy('doctor', o.id) &&
            !this.busy('rescue', o.id),
        ),
      )) {
        if (o.downed && o.id !== p.id) {
          const bed = w.buildings.find(
            (b) =>
              (b.kind === 'medical' || b.kind === 'bed') &&
              this.complete(b) &&
              !w.pawns.some((q) => q.id !== o.id && q.downed && distance(q, b) < 1),
          );
          if (bed && distance(o, bed) > 1) {
            const j = this.makeJob(p, 'rescue', o.id, o.x, o.y, 1, 30);
            if (j) {
              j.item = bed.id;
              return j;
            }
          }
        }
        if (this.approach(p, o.x, o.y, 1)) {
          const found = this.reserveItem(p, 'medicine', 1);
          if (found)
            return {
              kind: 'doctor',
              target: o.id,
              x: found.item.x,
              y: found.item.y,
              path: found.path,
              progress: 0,
              total: 0.1 * HOUR,
              item: found.item.id,
              resource: 'medicine',
              amount: found.amount,
              pickups: found.pickups,
              stage: 0,
            };
        }
      }
    }
    if (kind === 'grow') {
      const candidates: { x: number; y: number; growth: number }[] = [];
      for (let i = 0; i < w.zones.length; i++)
        if (w.zones[i] === 2 || w.zones[i] === 3) {
          if (this.nav.blocked[i]) continue;
          const c = w.crops.find((c) => c.x === i % SIZE && c.y === Math.floor(i / SIZE));
          if (!c || c.growth >= 1)
            candidates.push({ x: i % SIZE, y: Math.floor(i / SIZE), growth: c?.growth ?? -1 });
        }
      for (const c of this.nearest(p, candidates)) {
        const id = cell(c.x, c.y);
        if (
          this.busy('grow', id) ||
          w.nature.some((n) => n.x === c.x && n.y === c.y && n.amount > 0)
        )
          continue;
        const j = this.makeJob(p, 'grow', id, c.x, c.y, 0, (c.growth < 0 ? 0.05 : 0.08) * HOUR);
        if (j) {
          j.stage = c.growth < 0 ? 0 : 1;
          return j;
        }
      }
    }
    if (kind === 'build') {
      for (const b of this.nearest(
        p,
        w.buildings.filter((b) => (!this.complete(b) || b.demolish) && !this.busy('build', b.id)),
      )) {
        const d = BUILDINGS[b.kind];
        if (
          w.nature.some(
            (n) => n.amount > 0 && n.x >= b.x && n.x < b.x + d.w && n.y >= b.y && n.y < b.y + d.h,
          )
        )
          continue;
        if (!this.approach(p, b.x, b.y, 1)) continue;
        if (b.demolish) {
          const j = this.makeJob(p, 'build', b.id, b.x, b.y, 1, 50);
          if (j) {
            j.stage = 3;
            return j;
          }
        }
        for (const r of RESOURCES) {
          const missing = (d.cost[r] ?? 0) - (b.delivered[r] ?? 0);
          if (missing <= 1e-6) continue;
          const amount = Math.min(missing, 30);
          const found = this.reserveItem(p, r, amount);
          if (found)
            return {
              kind: 'build',
              target: b.id,
              x: found.item.x,
              y: found.item.y,
              path: found.path,
              progress: 0,
              total: 0,
              item: found.item.id,
              resource: r,
              amount: found.amount,
              pickups: found.pickups,
              stage: 0,
            };
        }
        b.paid = RESOURCES.every((r) => (b.delivered[r] ?? 0) + 1e-6 >= (d.cost[r] ?? 0));
        if (b.paid) {
          const j = this.makeJob(p, 'build', b.id, b.x, b.y, 1, d.work * HOUR);
          if (j) {
            j.stage = 2;
            return j;
          }
        }
      }
    }
    if (kind === 'cut' || kind === 'mine') {
      for (const n of this.nearest(
        p,
        w.nature.filter(
          (n) =>
            n.amount > 0 &&
            n.marked &&
            (kind === 'cut'
              ? n.kind === 'tree' || n.kind === 'berry'
              : n.kind === 'ore' || n.kind === 'rock') &&
            !this.busy('cut', n.id) &&
            !this.busy('mine', n.id),
        ),
      )) {
        const j = this.makeJob(
          p,
          kind,
          n.id,
          n.x,
          n.y,
          1,
          n.kind === 'tree' ? 100 : n.kind === 'berry' ? 60 : 180,
        );
        if (j) return j;
      }
    }
    if (kind === 'cook' || kind === 'craft') {
      const cooking = kind === 'cook';
      if (
        cooking
          ? this.inventory().meal >= w.mealTarget
          : this.inventory().components >= 20 || (w.research.machining ?? 0) < TECHS.machining.cost
      )
        return null;
      for (const b of this.nearest(
        p,
        w.buildings.filter(
          (b) =>
            b.kind === (cooking ? 'stove' : 'workbench') &&
            this.complete(b) &&
            b.enabled &&
            !this.busy(kind, b.id),
        ),
      )) {
        if (!this.approach(p, b.x, b.y, 1) || (cooking && this.inventory(true).wood < 0.4))
          continue;
        const found = this.reserveItem(p, cooking ? 'raw' : 'steel', 10);
        if (found)
          return {
            kind,
            target: b.id,
            x: found.item.x,
            y: found.item.y,
            path: found.path,
            progress: 0,
            total: (cooking ? 0.08 : 0.4) * HOUR,
            item: found.item.id,
            resource: cooking ? 'raw' : 'steel',
            amount: found.amount,
            pickups: found.pickups,
            stage: 0,
          };
      }
    }
    if (kind === 'haul') {
      const storage: number[] = [];
      w.zones.forEach((z, i) => {
        if (z === 1 && !this.nav.blocked[i]) storage.push(i);
      });
      if (!storage.length) return null;
      for (const i of this.nearest(
        p,
        w.items.filter((i) => i.count - i.reserved >= 1 && w.zones[cell(i.x, i.y)] !== 1),
      )) {
        const found = this.reserveSpecific(p, i, Math.min(30, Math.floor(i.count - i.reserved)));
        if (!found) continue;
        const dest = storage
          .sort(
            (a, b) =>
              Math.abs((a % SIZE) - i.x) +
              Math.abs(Math.floor(a / SIZE) - i.y) -
              Math.abs((b % SIZE) - i.x) -
              Math.abs(Math.floor(b / SIZE) - i.y),
          )
          .find((t) => this.approach(p, t % SIZE, Math.floor(t / SIZE), 0) !== null);
        if (dest === undefined) {
          i.reserved -= found.amount;
          continue;
        }
        return {
          kind: 'haul',
          target: dest,
          x: i.x,
          y: i.y,
          path: found.path,
          progress: 0,
          total: 5,
          item: i.id,
          resource: i.kind,
          amount: found.amount,
          stage: 0,
        };
      }
    }
    if (kind === 'research') {
      const t = TECHS[w.researchTarget];
      if (!t || (w.research[w.researchTarget] ?? 0) >= t.cost) return null;
      for (const b of this.nearest(
        p,
        w.buildings.filter(
          (b) =>
            b.kind === 'research' && this.complete(b) && b.enabled && !this.busy('research', b.id),
        ),
      )) {
        const j = this.makeJob(p, 'research', b.id, b.x, b.y, 1, HOUR);
        if (j) return j;
      }
    }
    return null;
  }
  private reserveSpecific(p: Pawn, i: Item, amount: number) {
    const path = this.approach(p, i.x, i.y, 0);
    if (!path) return null;
    i.reserved += amount;
    return { path, amount };
  }
  private speed(p: Pawn, k: string) {
    const skill = p.skills[k as Work] ?? 5;
    const damage = p.wounds.reduce((s, v) => s + v.damage, 0);
    return clamp(1 + 0.08 * (skill - 5), 0.4, 1.4) * clamp(1 - damage / 150, 0.3, 1);
  }
  private walk(p: Pawn, j: Job) {
    if (!j.path.length) return true;
    const index = j.path[0];
    if (this.nav.blocked[index]) {
      if (p.animal) {
        this.cancel(p);
        p.waitUntil = this.world.tick + 10;
        p.reason = '前路被挡 · 正在寻找邻近通路';
        return false;
      }
      const path = this.approach(
        p,
        j.x,
        j.y,
        ['move', 'haul', 'eat', 'sleep', 'grow'].includes(j.kind) ? 0 : 1,
      );
      if (!path) {
        p.reason = '路径被阻断，已释放任务';
        this.cancel(p);
        return false;
      }
      j.path = path;
      return false;
    }
    const x = index % SIZE,
      y = Math.floor(index / SIZE),
      dx = x - p.x,
      dy = y - p.y,
      d = Math.hypot(dx, dy),
      speed =
        (p.animal ? 0.06 : 0.13) *
        clamp(1 - p.wounds.reduce((s, v) => s + v.damage, 0) / 200, 0.35, 1);
    if (d <= speed) {
      p.x = x;
      p.y = y;
      j.path.shift();
    } else {
      p.x += (dx / d) * speed;
      p.y += (dy / d) * speed;
    }
    if (j.kind === 'rescue' && j.stage === 1) {
      const o = this.world.pawns.find((o) => o.id === j.target);
      if (o) {
        o.x = p.x;
        o.y = p.y;
      }
    }
    return !j.path.length;
  }
  private finish(p: Pawn) {
    p.job = null;
    p.waitUntil = this.world.tick + (p.animal ? 30 + Math.floor(this.random() * 51) : 5);
    if (p.animal) p.reason = '休息片刻';
  }
  private act(p: Pawn) {
    const w = this.world,
      j = p.job;
    if (!j) return;
    if (j.kind === 'attack') {
      this.attackJob(p, j);
      return;
    }
    if (!this.walk(p, j)) return;
    if (
      ['build', 'cook', 'craft', 'doctor', 'haul', 'eat'].includes(j.kind) &&
      j.stage === 0 &&
      j.item
    ) {
      if (!this.take(p, j)) return;
      if (j.pickups?.length) {
        const next = j.pickups.shift()!;
        j.item = next.id;
        j.amount = next.amount;
        j.stage = 0;
        const item = w.items.find((i) => i.id === next.id);
        const path = item ? this.approach(p, item.x, item.y, 0) : null;
        if (!item || !path) {
          this.cancel(p);
          return;
        }
        j.x = item.x;
        j.y = item.y;
        j.path = path;
        return;
      }
      if (j.kind === 'build' || j.kind === 'cook' || j.kind === 'craft' || j.kind === 'doctor') {
        const b =
          j.kind === 'doctor'
            ? w.pawns.find((p) => p.id === j.target && !p.dead)
            : w.buildings.find((b) => b.id === j.target);
        if (!b) {
          this.cancel(p);
          return;
        }
        j.x = b.x;
        j.y = b.y;
        const path = this.approach(p, j.x, j.y, 1);
        if (!path) {
          this.cancel(p);
          return;
        }
        j.path = path;
      }
      if (j.kind === 'haul') {
        j.x = j.target % SIZE;
        j.y = Math.floor(j.target / SIZE);
        const path = this.approach(p, j.x, j.y, 0);
        if (!path) {
          this.cancel(p);
          return;
        }
        j.path = path;
      }
      return;
    }
    if (j.kind === 'build') {
      const b = w.buildings.find((b) => b.id === j.target);
      if (!b) {
        this.cancel(p);
        return;
      }
      if (j.stage === 1) {
        if (p.carry) {
          b.delivered[p.carry.kind] = (b.delivered[p.carry.kind] ?? 0) + p.carry.count;
          p.carry = null;
        }
        this.finish(p);
        return;
      }
      if (j.stage === 3) {
        if (++j.progress >= j.total) {
          for (const r of RESOURCES)
            this.addItem(r, Math.floor((BUILDINGS[b.kind].cost[r] ?? 0) * 0.5), b.x, b.y);
          w.buildings = w.buildings.filter((o) => o !== b);
          this.rebuildNav();
          this.finish(p);
        }
        return;
      }
      b.progress += this.speed(p, 'build');
      if (this.complete(b)) {
        b.progress = BUILDINGS[b.kind].work * HOUR;
        if (b.kind !== 'wire') {
          const d = BUILDINGS[b.kind];
          const inside = (c: { x: number; y: number }) =>
            c.x >= b.x && c.x < b.x + d.w && c.y >= b.y && c.y < b.y + d.h;
          w.crops = w.crops.filter((c) => !inside(c));
          for (let y = b.y; y < b.y + d.h; y++)
            for (let x = b.x; x < b.x + d.w; x++)
              if (w.zones[y * SIZE + x] >= 2) w.zones[y * SIZE + x] = 0;
        }
        w.stats.built++;
        this.rebuildNav();
        this.log(`${BUILDINGS[b.kind].name}建成了。`, 'good', b.x, b.y);
        this.finish(p);
      }
      return;
    }
    if (j.kind === 'sleep') {
      p.rest = clamp(p.rest + (j.target ? 8 : 4) / HOUR, 0, 100);
      if (p.rest >= 99) {
        this.thought(p, j.target ? '睡得安稳' : '席地而眠', j.target ? 4 : -4, DAY);
        this.finish(p);
      }
      return;
    }
    if (j.kind === 'relax') {
      p.joy = clamp(p.joy + 30 / HOUR, 0, 100);
      if (++j.progress >= j.total || p.joy >= 95) this.finish(p);
      return;
    }
    if (j.kind === 'research') {
      const t = TECHS[w.researchTarget];
      if (!t) {
        this.finish(p);
        return;
      }
      w.research[w.researchTarget] = Math.min(
        t.cost,
        (w.research[w.researchTarget] ?? 0) + (50 / HOUR) * this.speed(p, 'research'),
      );
      if (w.research[w.researchTarget] >= t.cost) {
        this.log(`研究完成：${t.name}。`, 'good');
        this.finish(p);
      } else if (++j.progress >= j.total) this.finish(p);
      return;
    }
    j.progress += this.speed(p, j.kind);
    if (j.progress < j.total) return;
    if (j.kind === 'move') {
      this.finish(p);
      if (!p.animal) p.reason = '已到达目的地';
      return;
    }
    if (j.kind === 'eat') {
      p.food = clamp(p.food + (j.resource === 'raw' ? 0.5 : 0.9), 0, 1);
      p.carry = null;
      w.stats.mealsEaten++;
      if (j.resource === 'raw') this.thought(p, '生吃食材', -7, DAY);
      const table = w.buildings.some(
        (b) =>
          b.kind === 'table' &&
          this.complete(b) &&
          distance(p, b) < 7 &&
          w.buildings.some((ch) => ch.kind === 'chair' && this.complete(ch) && distance(ch, b) < 3),
      );
      this.thought(p, table ? '有桌可用' : '无桌吃饭', table ? 2 : -3, DAY);
    }
    if (j.kind === 'haul') {
      if (p.carry) {
        this.addItem(p.carry.kind, p.carry.count, j.x, j.y);
        w.stats.hauled += p.carry.count;
        p.carry = null;
      }
    }
    if (j.kind === 'cut' || j.kind === 'mine') {
      const n = w.nature.find((n) => n.id === j.target);
      if (n && n.amount > 0) {
        this.addItem(
          n.kind === 'tree'
            ? 'wood'
            : n.kind === 'berry'
              ? 'raw'
              : n.kind === 'ore'
                ? 'steel'
                : 'stone',
          n.amount,
          n.x,
          n.y,
        );
        n.amount = 0;
        w.stats.harvested++;
      }
    }
    if (j.kind === 'grow') {
      const crop = w.crops.find((c) => cell(c.x, c.y) === j.target);
      if (crop && crop.growth >= 1) {
        this.addItem(
          crop.crop === 'herb' ? 'medicine' : 'raw',
          crop.crop === 'herb' ? 2 : 8,
          crop.x,
          crop.y,
        );
        w.crops = w.crops.filter((c) => c !== crop);
        w.stats.harvested++;
      } else if (!crop && (w.zones[j.target] === 2 || w.zones[j.target] === 3))
        w.crops.push({
          x: j.x,
          y: j.y,
          growth: 0,
          crop: w.zones[j.target] === 3 ? 'herb' : 'grain',
          reserved: 0,
        });
    }
    if (j.kind === 'cook') {
      const b = w.buildings.find((b) => b.id === j.target);
      if (!b || !b.enabled || !this.consume('wood', 0.4)) {
        this.cancel(p);
        return;
      }
      p.carry = null;
      this.addItem('meal', 1, Math.round(p.x), Math.round(p.y));
      w.stats.cooked++;
    }
    if (j.kind === 'craft') {
      const b = w.buildings.find((b) => b.id === j.target);
      if (!b || !b.enabled) {
        this.cancel(p);
        return;
      }
      p.carry = null;
      this.addItem('components', 1, Math.round(p.x), Math.round(p.y));
    }
    if (j.kind === 'rescue') {
      const o = w.pawns.find((o) => o.id === j.target),
        bed = w.buildings.find((b) => b.id === j.item);
      if (!o || !bed || o.dead) {
        this.finish(p);
        return;
      }
      if (j.stage === 0) {
        const path = this.approach(p, bed.x, bed.y, 0);
        if (!path) {
          this.finish(p);
          return;
        }
        j.path = path;
        j.x = bed.x;
        j.y = bed.y;
        j.stage = 1;
        j.progress = 0;
        return;
      }
      o.x = bed.x;
      o.y = bed.y;
      this.thought(o, '获救', 8, DAY * 2);
      this.log(`${p.name}将${o.name}救回床位。`, 'good', bed.x, bed.y);
    }
    if (j.kind === 'doctor') {
      const o = w.pawns.find((o) => o.id === j.target);
      if (o && !o.dead && distance(p, o) < 2 && p.carry?.kind === 'medicine') {
        p.carry = null;
        o.wounds.forEach((v) => (v.tended = true));
        w.stats.tended++;
        this.log(`${p.name}为${o.name}包扎了伤口，出血已止住。`, 'good', o.x, o.y);
      } else {
        p.reason = '患者已移动或药品不足';
        this.cancel(p);
        return;
      }
    }
    this.finish(p);
  }
  private thought(p: Pawn, text: string, value: number, duration: number) {
    p.thoughts = p.thoughts.filter((t) => t.text !== text);
    p.thoughts.push({ text, value, expires: this.world.tick + duration });
  }
  damage(p: Pawn, amount: number, part?: number) {
    if (p.dead) return;
    const r = this.random();
    part = part ?? (r < 0.15 ? 0 : r < 0.5 ? 1 : 2 + Math.floor((r - 0.5) * 8));
    p.wounds.push({ part, damage: amount, tended: false });
    this.world.lastHurt = this.world.tick;
    if (
      p.wounds.filter((w) => w.part === part).reduce((s, w) => s + w.damage, 0) >= PART_HP[part] &&
      part < 2
    )
      this.die(p);
  }
  private die(p: Pawn) {
    this.cancel(p);
    p.dead = true;
    p.downed = true;
    if (p.enemy) {
      this.world.stats.kills++;
      this.addItem('steel', 8, p.x, p.y);
      this.log('一名掠夺者倒下了。', 'good', p.x, p.y);
    } else if (p.animal) this.addItem('raw', 20, p.x, p.y);
    else {
      this.log(`${p.name}去世了。营地失去了一位伙伴。`, 'danger', p.x, p.y);
      for (const q of this.world.pawns.filter((q) => !q.enemy && !q.animal && !q.dead))
        this.thought(q, '朋友死亡', -16, DAY * 5);
      if (this.world.autoPause) this.pauseRequested = true;
    }
  }
  private lineOfSight(a: Pawn, b: Pawn) {
    const steps = Math.ceil(Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) * 2);
    for (let n = 1; n < steps; n++) {
      const x = Math.round(a.x + ((b.x - a.x) * n) / steps),
        y = Math.round(a.y + ((b.y - a.y) * n) / steps);
      if (this.nav.blocked[y * SIZE + x]) return false;
    }
    return true;
  }
  private attackJob(p: Pawn, j: Job) {
    const target = this.world.pawns.find((o) => o.id === j.target && !o.dead);
    if (!target || target.downed) {
      this.finish(p);
      return;
    }
    const range = p.weapon === 'gun' ? 18 : 1.6,
      d = Math.hypot(p.x - target.x, p.y - target.y);
    if (d <= range && this.lineOfSight(p, target)) {
      j.path = [];
      if (p.cooldown > 0) return;
      const cover = this.world.buildings.some(
        (b) => b.kind === 'sandbag' && this.complete(b) && distance(target, b) < 2,
      );
      const hit =
        p.weapon === 'knife' ? 0.85 : 0.75 * (d > 9 ? 1 - (d - 9) / 30 : 1) * (cover ? 0.65 : 1);
      p.cooldown = p.weapon === 'gun' ? 36 : 30;
      if (this.random() < hit) this.damage(target, p.enemy ? 5 : p.weapon === 'gun' ? 10 : 12);
      return;
    }
    if (j.stationary) {
      this.finish(p);
      return;
    }
    if (this.world.tick % 20 === 0 || !j.path.length) {
      const path = this.approach(p, target.x, target.y, 1);
      if (!path) {
        this.cancel(p);
        p.reason = '目标不可达';
        return;
      }
      j.x = target.x;
      j.y = target.y;
      j.path = path;
    }
    this.walk(p, j);
  }
  spawnRaid(budget = 40) {
    const w = this.world;
    const count = Math.max(1, Math.floor(budget / 30));
    for (let i = 0; i < count; i++) {
      const p = this.makePawn('掠夺者', 22 + i * 2, 44 + i, true);
      p.weapon = i > 0 ? 'gun' : 'knife';
      w.pawns.push(p);
    }
    w.stats.raids++;
    this.log(`警报：${count}名掠夺者从西侧接近！征召幸存者，在掩体后防御。`, 'danger', 22, 44);
    if (w.autoPause) this.pauseRequested = true;
  }
  temperature() {
    return this.world.weather === 'cold'
      ? 2
      : this.world.weather === 'rain'
        ? 16
        : 22 + Math.sin((this.world.tick / DAY) * Math.PI * 2) * 4;
  }
  step(count = 1) {
    for (let n = 0; n < count; n++) {
      const w = this.world;
      if (w.outcome === 'lost' || (w.outcome === 'won' && !w.continueAfterWin)) return;
      w.tick++;
      for (const p of w.pawns) {
        if (p.dead) continue;
        if (p.cooldown > 0) p.cooldown--;
        if (p.downed) continue;
        if (p.animal) {
          if (!p.job && w.tick >= p.waitUntil) {
            const path = this.nav.wander(p.x, p.y, this.random());
            if (path?.length) {
              const target = path[path.length - 1];
              p.job = { kind: 'move', target: 0, x: target % SIZE, y: Math.floor(target / SIZE), path, progress: 0, total: 0 };
              p.reason = '在附近漫游';
            } else {
              p.waitUntil = w.tick + 80;
              p.reason = '周围没有可通行格 · 等待通路恢复';
            }
          }
          if (p.job) this.act(p);
          continue;
        }
        if (p.enemy || p.drafted) {
          if (!p.job) {
            const target = this.nearest(
              p,
              w.pawns.filter((q) => !q.dead && !q.downed && !q.animal && q.enemy !== p.enemy),
            )[0];
            if (target && p.enemy)
              p.job = this.makeJob(
                p,
                'attack',
                target.id,
                target.x,
                target.y,
                Math.floor(p.weapon === 'gun' ? 16 : 1),
              );
            else if (
              target &&
              Math.hypot(p.x - target.x, p.y - target.y) <= (p.weapon === 'gun' ? 18 : 1.6) &&
              this.lineOfSight(p, target)
            )
              p.job = {
                kind: 'attack',
                target: target.id,
                x: target.x,
                y: target.y,
                path: [],
                progress: 0,
                total: 0,
                stationary: true,
              };
          }
          if (p.job) this.act(p);
          continue;
        }
        if (
          w.pawns.some((q) => q.id !== p.id && q.job?.kind === 'doctor' && q.job.target === p.id)
        ) {
          if (p.job) this.cancel(p);
          p.reason = '等待医师包扎';
          continue;
        }
        if (
          p.job &&
          p.food < 0.1 &&
          p.job.kind !== 'eat' &&
          this.inventory(true).ration + this.inventory(true).meal + this.inventory(true).raw > 0
        )
          this.cancel(p);
        if (!p.job && w.tick >= p.waitUntil) {
          p.job = this.chooseJob(p);
          if (!p.job) p.waitUntil = w.tick + 40;
        }
        if (p.job) this.act(p);
      }
      if (w.tick % 20 === 0) this.needs(20);
      if (w.tick % 100 === 0) {
        this.environment(100);
        this.power(100);
      }
      this.events();
      if (w.tick % 200 === 0) {
        w.items = w.items.filter((i) => i.count > 1e-6 || i.reserved > 0);
        w.nature = w.nature.filter((n) => n.amount > 0);
      }
      if (!w.pawns.some((p) => !p.enemy && !p.animal && !p.dead)) {
        w.outcome = 'lost';
        this.log('营地归于寂静。你可以读取先前的存档。', 'danger');
        this.pauseRequested = true;
      }
      w.revision++;
    }
  }
  private needs(dt: number) {
    const w = this.world;
    for (const p of w.pawns) {
      if (p.dead || p.animal) continue;
      const hours = dt / HOUR;
      p.food = clamp(p.food - (1.6 * dt) / DAY, 0, 1);
      if (p.job?.kind !== 'sleep') p.rest = clamp(p.rest - 4 * hours, 0, 100);
      if (p.job?.kind !== 'relax') p.joy = clamp(p.joy - 3 * hours, 0, 100);
      const bleeding = p.wounds.filter((v) => !v.tended).reduce((s, v) => s + v.damage * 0.3, 0);
      p.blood = clamp(p.blood - bleeding * hours + (bleeding === 0 ? (10 * dt) / DAY : 0), 0, 100);
      for (const wound of p.wounds)
        if (wound.tended) wound.damage = Math.max(0, wound.damage - (5 * dt) / DAY);
      p.wounds = p.wounds.filter((v) => v.damage > 0.01);
      if (p.food === 0 && w.tick % HOUR === 0) this.damage(p, 1, 1);
      if (p.blood <= 0) {
        this.die(p);
        continue;
      }
      const down = p.blood < 40 || p.wounds.reduce((s, v) => s + v.damage, 0) > 70;
      if (down && !p.downed) {
        this.cancel(p);
        p.downed = true;
        p.reason = '倒地，需要救援和包扎';
        if (!p.enemy) {
          this.log(`${p.name}倒地了！安排医疗岗位并准备药品。`, 'danger', p.x, p.y);
          if (w.autoPause) this.pauseRequested = true;
        }
      }
      if (p.downed && !down && p.blood > 45) p.downed = false;
      p.thoughts = p.thoughts.filter((v) => v.expires > w.tick);
      const target = clamp(
        50 +
          p.thoughts.reduce((s, v) => s + v.value, 0) +
          (p.food < 0.25 ? -12 : 0) +
          (p.wounds.length ? -8 : 0) +
          (p.rest < 20 ? -8 : 0) +
          (p.joy < 25 ? -6 : 0) +
          (this.temperature() < 10 &&
          !w.buildings.some((b) => b.kind === 'campfire' && b.powered && distance(p, b) < 5)
            ? -5
            : 0),
        0,
        100,
      );
      p.mood += clamp(target - p.mood, -6 * hours, 8 * hours);
      if (p.mood < 30) p.lowMood += dt;
      else p.lowMood = 0;
      if (
        !p.enemy &&
        p.lowMood >= HOUR &&
        w.tick > p.protectionUntil &&
        w.tick > p.breakUntil &&
        this.random() < 1 - Math.exp(-(p.mood < 15 ? 0.35 : 0.1) * hours)
      ) {
        this.cancel(p);
        p.breakUntil = w.tick + HOUR * 3;
        p.protectionUntil = p.breakUntil + HOUR * 6;
        this.log(`${p.name}精神疲惫，暂时放下了工作。`, 'danger', p.x, p.y);
      }
    }
  }
  private environment(dt: number) {
    const w = this.world,
      hour = (w.tick / HOUR + 8) % 24,
      daylight = hour >= 6 && hour < 18;
    const temp = this.temperature();
    for (const c of w.crops)
      if (daylight)
        c.growth = Math.min(
          1,
          c.growth +
            (dt / (DAY * (c.crop === 'herb' ? 6 : 3) * 0.5)) *
              (w.fertility[cell(c.x, c.y)] / 100) *
              clamp(temp / 10, 0, 1),
        );
    for (const i of w.items) {
      if (i.kind !== 'raw' && i.kind !== 'meal') continue;
      const cool = w.buildings.some(
        (b) =>
          b.kind === 'cooler' && this.complete(b) && b.powered && b.enabled && distance(i, b) <= 4,
      );
      i.age += dt * (cool ? 0.25 : 1);
      if (i.age > DAY * (i.kind === 'meal' ? 4 : 12) && i.reserved === 0) {
        i.count = 0;
      }
    }
    for (const b of w.buildings)
      if (this.complete(b) && b.enabled) {
        if (b.kind === 'campfire') b.powered = this.consume('wood', (15 * dt) / DAY);
      }
  }
  private power(dt: number) {
    const w = this.world;
    const nodes = w.buildings.filter(
      (b) =>
        this.complete(b) &&
        (BUILDINGS[b.kind].power !== undefined || b.kind === 'wire' || b.kind === 'battery'),
    );
    nodes.forEach((b) => (b.powered = false));
    const remaining = new Set(nodes);
    let generated = 0,
      demand = 0,
      stored = 0;
    while (remaining.size) {
      const first = remaining.values().next().value!;
      remaining.delete(first);
      const network = [first];
      for (let n = 0; n < network.length; n++) {
        const a = network[n],
          ad = BUILDINGS[a.kind];
        for (const b of remaining) {
          const bd = BUILDINGS[b.kind];
          const dx = Math.max(0, a.x - (b.x + bd.w - 1), b.x - (a.x + ad.w - 1)),
            dy = Math.max(0, a.y - (b.y + bd.h - 1), b.y - (a.y + ad.h - 1));
          if (dx + dy <= 1) {
            remaining.delete(b);
            network.push(b);
          }
        }
      }
      let gen = 0,
        load = 0;
      const hour = (w.tick / HOUR + 8) % 24;
      for (const b of network)
        if (b.enabled) {
          if (b.kind === 'generator' && this.consume('wood', (20 * dt) / DAY)) gen += 800;
          if (b.kind === 'solar' && hour >= 6 && hour < 18)
            gen += w.weather === 'rain' ? 600 : 1200;
          const power = BUILDINGS[b.kind].power ?? 0;
          if (power > 0) load += power;
        }
      const batteries = network.filter((b) => b.kind === 'battery' && b.enabled);
      const energyNeed = (Math.max(0, load - gen) * dt) / HOUR / 1000;
      const total = batteries.reduce((s, b) => s + b.energy, 0);
      const powered = gen >= load || (total >= energyNeed && energyNeed > 0);
      let delta = ((gen - load) * dt) / HOUR / 1000;
      for (const b of batteries) {
        if (delta >= 0) {
          const add = Math.min(4 - b.energy, delta * 0.8);
          b.energy += add;
          delta -= add / 0.8;
        } else {
          const take = Math.min(b.energy, -delta);
          b.energy -= take;
          delta += take;
        }
        stored += b.energy;
      }
      for (const b of network) b.powered = b.enabled && powered && (gen > 0 || total > 0);
      generated += gen;
      demand += load;
    }
    w.power = { generated, demand, stored };
  }
  private events() {
    const w = this.world;
    if (w.tick >= w.nextWeather) {
      w.weather = this.random() < 0.2 ? 'cold' : this.random() < 0.45 ? 'rain' : 'clear';
      w.weatherUntil = w.tick + DAY;
      w.nextWeather = w.tick + DAY * (1 + this.random());
      this.log(
        w.weather === 'rain'
          ? '雨云越过山谷，营地迎来一场细雨。'
          : w.weather === 'cold'
            ? '冷空气抵达，作物生长放缓。'
            : '云层散开，天气转晴。',
      );
    }
    if (w.beaconActive) {
      const on = w.buildings.some(
        (b) => b.kind === 'beacon' && this.complete(b) && b.powered && b.enabled,
      );
      if (on) w.beaconTicks++;
      if (w.beaconTicks >= DAY * 0.5 && w.finalWaves === 0) {
        w.finalWaves = 1;
        this.spawnRaid(80 * w.difficulty);
      }
      if (w.beaconTicks >= DAY * 1.5 && w.finalWaves === 1) {
        w.finalWaves = 2;
        this.spawnRaid(110 * w.difficulty);
      }
      if (w.beaconTicks >= DAY * 2 && w.outcome === 'playing') {
        w.outcome = 'won';
        this.log('救援飞船已抵达。你们在余烬中建立了一个家。', 'good');
        this.pauseRequested = true;
      }
    } else if (w.tick >= w.nextRaid) {
      if (w.tick - w.lastHurt < DAY * 2 && w.stats.raids > 0) w.nextRaid = w.tick + DAY;
      else {
        this.spawnRaid(w.stats.raids === 0 ? 40 : Math.min(120, 45 + w.stats.raids * 15));
        w.nextRaid = w.tick + DAY * (4 + this.random() * 2);
      }
    }
  }
  inspect(id: number): Inspection {
    const w = this.world;
    const pawn = w.pawns.find((p) => p.id === id);
    if (pawn) return { kind: 'pawn', id, value: structuredClone(pawn) };
    const item = w.items.find((i) => i.id === id && i.count > 0.001);
    if (item) return { kind: 'item', id, value: { ...item } };
    const nature = w.nature.find((n) => n.id === id && n.amount > 0);
    if (nature) return { kind: 'nature', id, value: { ...nature } };
    const building = w.buildings.find((b) => b.id === id);
    if (building) return { kind: 'building', id, value: structuredClone(building) };
    const crop = id < 0 ? w.crops.find((c) => -1 - c.y * SIZE - c.x === id) : undefined;
    if (crop) return { kind: 'crop', id, value: { ...crop } };
    return { kind: 'missing', id };
  }
  summary(): Summary {
    const w = this.world;
    return {
      tick: w.tick,
      revision: w.revision,
      pawns: structuredClone(w.pawns.filter((p) => !p.animal)),
      inventory: this.inventory(),
      available: this.inventory(true),
      logs: w.logs.slice(-30),
      stats: { ...w.stats },
      research: { ...w.research },
      researchTarget: w.researchTarget,
      mealTarget: w.mealTarget,
      buildings: structuredClone(w.buildings),
      weather: w.weather,
      temperature: this.temperature(),
      beaconTicks: w.beaconTicks,
      beaconActive: w.beaconActive,
      outcome: w.outcome,
      continueAfterWin: w.continueAfterWin,
      autoPause: w.autoPause,
      tutorialHidden: w.tutorialHidden,
      nextRaid: w.nextRaid,
      gridBytes: w.terrain.byteLength + w.zones.byteLength + w.fertility.byteLength,
      entityCount:
        w.pawns.length + w.items.length + w.nature.length + w.buildings.length + w.crops.length,
      cropCount: w.crops.length,
      power: { ...w.power },
    };
  }
  save(): SaveData {
    const w = this.world;
    return structuredClone({
      ...w,
      terrain: Array.from(w.terrain),
      zones: Array.from(w.zones),
      fertility: Array.from(w.fertility),
    });
  }
  load(input: unknown) {
    validateSave(input);
    const s = input;
    this.world = {
      ...structuredClone(s),
      terrain: Uint8Array.from(s.terrain),
      zones: Uint8Array.from(s.zones),
      fertility: Uint8Array.from(s.fertility),
    };
    this.rebuildNav();
    this.pauseRequested = false;
  }
}
