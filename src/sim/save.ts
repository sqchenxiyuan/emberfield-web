import { BUILDINGS, JOB_NAMES, RESOURCES, TECHS, WORKS } from './defs';
import { SIZE, type SaveData } from './types';
// Validate before replacing the live world. Import errors must never half-load a game.
export function validateSave(value: unknown): asserts value is SaveData {
  const fail = () => {
    throw new Error('存档字段不完整、数值越界或版本不兼容');
  };
  const obj = (v: any) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const num = (v: any, min = -1e12, max = 1e12) =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  const int = (v: any, min = 0, max = 1e12) => num(v, min, max) && Number.isInteger(v);
  const bool = (v: any) => typeof v === 'boolean';
  const text = (v: any) => typeof v === 'string' && v.length <= 2000;
  const array = (v: any, max: number) => Array.isArray(v) && v.length <= max;
  const xy = (v: any) => obj(v) && num(v.x, 0, SIZE - 1) && num(v.y, 0, SIZE - 1);
  const resources = (v: any) =>
    obj(v) && Object.entries(v).every(([k, n]) => RESOURCES.includes(k as any) && num(n, 0, 1e8));
  if (!obj(value)) fail();
  const s = value as any;
  if (
    s.version !== 1 ||
    !int(s.seed, 0, 4294967295) ||
    !int(s.rng, 0, 4294967295) ||
    !int(s.tick) ||
    !int(s.nextId, 1) ||
    !int(s.revision)
  )
    fail();
  for (const [key, max] of [
    ['terrain', 2],
    ['zones', 3],
    ['fertility', 255],
  ] as const)
    if (
      !Array.isArray(s[key]) ||
      s[key].length !== SIZE * SIZE ||
      !s[key].every((n: unknown) => int(n, 0, max))
    )
      fail();
  for (const [key, max] of [
    ['pawns', 2000],
    ['items', 100000],
    ['buildings', SIZE * SIZE * 2],
    ['nature', SIZE * SIZE],
    ['crops', SIZE * SIZE],
    ['logs', 100],
  ] as const)
    if (!array(s[key], max)) fail();
  for (const key of [
    'nextRaid',
    'nextWeather',
    'weatherUntil',
    'beaconTicks',
    'finalWaves',
    'mealTarget',
    'difficulty',
  ])
    if (!num(s[key], 0)) fail();
  if (
    !num(s.lastHurt) ||
    !['clear', 'rain', 'cold'].includes(s.weather) ||
    !['playing', 'won', 'lost'].includes(s.outcome)
  )
    fail();
  for (const key of ['beaconActive', 'continueAfterWin', 'autoPause', 'tutorialHidden'])
    if (!bool(s[key])) fail();
  if (!obj(s.power) || !['generated', 'demand', 'stored'].every((k) => num(s.power[k], 0))) fail();
  if (
    !obj(s.stats) ||
    !['harvested', 'cooked', 'built', 'hauled', 'tended', 'kills', 'raids', 'mealsEaten'].every(
      (k) => num(s.stats[k], 0),
    )
  )
    fail();
  if (
    !obj(s.research) ||
    !Object.entries(s.research).every(([k, v]) => !!TECHS[k] && num(v, 0, TECHS[k].cost)) ||
    !TECHS[s.researchTarget]
  )
    fail();
  const ids = new Set<number>();
  const id = (v: any) => {
    if (!int(v.id, 1, s.nextId - 1) || ids.has(v.id)) fail();
    ids.add(v.id);
  };
  for (const i of s.items) {
    if (
      !xy(i) ||
      !RESOURCES.includes(i.kind) ||
      !num(i.count, 0, 1e8) ||
      !num(i.reserved, 0, i.count + 1e-5) ||
      !num(i.age, 0)
    )
      fail();
    id(i);
  }
  for (const b of s.buildings) {
    if (
      !xy(b) ||
      !BUILDINGS[b.kind as keyof typeof BUILDINGS] ||
      !int(b.x, 0, 95) ||
      !int(b.y, 0, 95) ||
      !num(b.progress, 0) ||
      !resources(b.delivered) ||
      !bool(b.paid) ||
      !bool(b.powered) ||
      !bool(b.enabled) ||
      !bool(b.demolish) ||
      !num(b.hp, 0, 100) ||
      !num(b.energy, 0)
    )
      fail();
    id(b);
    const d = BUILDINGS[b.kind as keyof typeof BUILDINGS];
    if (b.x + d.w > SIZE || b.y + d.h > SIZE || b.progress > d.work * 500 + 1e-5) fail();
  }
  for (const n of s.nature) {
    if (
      !xy(n) ||
      !['tree', 'ore', 'berry', 'rock'].includes(n.kind) ||
      !num(n.amount, 0) ||
      !bool(n.marked)
    )
      fail();
    id(n);
  }
  const crops = new Set<number>();
  for (const c of s.crops) {
    if (
      !xy(c) ||
      !int(c.x, 0, 95) ||
      !int(c.y, 0, 95) ||
      !num(c.growth, 0, 1) ||
      !num(c.reserved, 0) ||
      !['grain', 'herb'].includes(c.crop) ||
      crops.has(c.y * SIZE + c.x)
    )
      fail();
    crops.add(c.y * SIZE + c.x);
  }
  const reservations = new Map<number, number>();
  const reserve = (id: number, amount: number) =>
    reservations.set(id, (reservations.get(id) ?? 0) + amount);
  for (const p of s.pawns) {
    if (
      !xy(p) ||
      !text(p.name) ||
      !text(p.role) ||
      !text(p.reason) ||
      !int(p.color, 0, 0xffffff) ||
      !['gun', 'knife'].includes(p.weapon) ||
      !['balanced', 'night', 'work'].includes(p.schedule)
    )
      fail();
    id(p);
    for (const key of ['enemy', 'animal', 'dead', 'downed', 'drafted']) if (!bool(p[key])) fail();
    for (const key of ['rest', 'joy', 'mood', 'blood']) if (!num(p[key], 0, 100)) fail();
    if (!num(p.food, 0, 1)) fail();
    for (const key of ['cooldown', 'lowMood', 'breakUntil', 'protectionUntil', 'waitUntil'])
      if (!num(p[key], 0)) fail();
    if (
      !obj(p.skills) ||
      !obj(p.priorities) ||
      !WORKS.every((k) => num(p.skills[k], 0, 10) && int(p.priorities[k], 0, 4))
    )
      fail();
    if (
      !array(p.wounds, 10000) ||
      !p.wounds.every((w: any) => obj(w) && int(w.part, 0, 5) && num(w.damage, 0) && bool(w.tended))
    )
      fail();
    if (
      !array(p.thoughts, 1000) ||
      !p.thoughts.every(
        (t: any) => obj(t) && text(t.text) && num(t.value, -100, 100) && num(t.expires, 0),
      )
    )
      fail();
    if (
      p.carry !== null &&
      (!obj(p.carry) || !RESOURCES.includes(p.carry.kind) || !num(p.carry.count, 0, 1e8))
    )
      fail();
    const j = p.job;
    if (j !== null) {
      if (
        !xy(j) ||
        !JOB_NAMES[j.kind] ||
        !int(j.target) ||
        !num(j.progress, 0) ||
        !num(j.total, 0) ||
        !array(j.path, SIZE * SIZE) ||
        !j.path.every((v: any) => int(v, 0, SIZE * SIZE - 1))
      )
        fail();
      if (
        (j.stage !== undefined && !int(j.stage, 0, 4)) ||
        (j.item !== undefined && !int(j.item, 1)) ||
        (j.amount !== undefined && !num(j.amount, 0)) ||
        (j.resource !== undefined && !RESOURCES.includes(j.resource)) ||
        (j.stationary !== undefined && !bool(j.stationary))
      )
        fail();
      if (
        j.pickups !== undefined &&
        (!array(j.pickups, 1000) ||
          !j.pickups.every((v: any) => obj(v) && int(v.id, 1) && num(v.amount, 0)))
      )
        fail();
      if (j.stage === 0 && j.item && j.amount) reserve(j.item, j.amount);
      for (const pickup of j.pickups ?? []) reserve(pickup.id, pickup.amount);
    }
  }
  for (const i of s.items) if (Math.abs(i.reserved - (reservations.get(i.id) ?? 0)) > 1e-4) fail();
  for (const id of reservations.keys()) if (!s.items.some((i: any) => i.id === id)) fail();
  for (const l of s.logs) {
    if (
      !obj(l) ||
      !int(l.tick) ||
      !text(l.text) ||
      !['info', 'good', 'danger'].includes(l.type) ||
      (l.x !== undefined && !num(l.x, 0, 95)) ||
      (l.y !== undefined && !num(l.y, 0, 95))
    )
      fail();
    id(l);
  }
}
