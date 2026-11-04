import { tableCells, LIVING_BUILDINGS } from './living';
import { isShelfKind } from './shelves';
import { Block, HEIGHT, WIDTH, DEPTH, TPS, at, inside, position, type Pawn, type Pos, type VoxelSave } from './types';
import { VoxelRooms } from './rooms';
import { VoxelPower } from './power';
import { VoxelThermal } from './thermal';
import { healthSummary } from './survival';
import { learnSkill } from './skills';
import { weatherEffects, WEATHER_RULES, type WeatherState } from './weather';
import { FIRE_RULES, FIRE_MAX_HP, FIRE_TARGET_NAMES, fireRandom, fireDamageKey, fireDamageCells,
  fireDamageHomeCells, fireDamageBurning, makeFire, nextFireIncident,
  type Fire, type FireDamage, type FireHazards, type FireLogEntry, type BurnTargetKind, type FireSource } from './fire';

export interface FireHost extends Pick<VoxelSave, 'shelves' | 'jobs' | 'tables' | 'chairs' | 'pawns' | 'items' | 'trees' | 'crops' | 'beds' | 'doors' | 'stoves' |
  'stonecutters' | 'tailors' | 'weaponBenches' | 'researchBenches' | 'horseshoePins' | 'butcherSpots' | 'devices' | 'wires' | 'fences' | 'fenceGates' | 'penMarkers'> {
  seed: number; tick: number; nextId: number; revision: number; notice: string;
  blocks: Uint8Array; ladders: Uint8Array; homeArea: Set<number>;
  weather: WeatherState;
  weatherExposed(p: Pos): boolean;
  fires: Fire[]; fireDamage: FireDamage[]; fireHazards: FireHazards; fireLog: FireLogEntry[];
  rooms: VoxelRooms; power: VoxelPower; thermal: VoxelThermal;
  updateRooms(): void;
  fireRelease(p: Pawn): void;
  fireDropCargo(p: Pawn): boolean;
  fireRoute(p: Pawn, targets: Pos[]): number[] | null;
  fireDestroy(target: FireDamage, reason: string): boolean;
  fireBurnGround(id: number, amount: number): void;
  fireBurnFurniture(id: number, damage: number): void;
  fireBurnTree(id: number, damage: number): void;
  fireBurnCrop(id: number): void;
}
const same = (a: Pos, b: Pos) => at(a) === at(b);
const distance = (a: Pos, b: Pos) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
export const FIRE_DIRECTIONS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;
export const touchesFire = (a: Pos, b: Pos) => distance(a, b) <= 1;
export function fireLog(s: FireHost, type: FireLogEntry['type'], p: Pos, message: string) {
  s.fireLog.push({ tick: s.tick, type, position: { x: p.x, y: p.y, z: p.z }, message });
  if (s.fireLog.length > FIRE_RULES.maxLog) s.fireLog.splice(0, s.fireLog.length - FIRE_RULES.maxLog);
  s.notice = message;
}
export function removeFire(s: FireHost, fire: Fire, reason: string) {
  // Structural destruction can reconcile fuel and remove this fire during the
  // same update. Record the transition only once when the outer loop resumes.
  if (!s.fires.some(f => f.id === fire.id)) return;
  s.fires = s.fires.filter(f => f.id !== fire.id);
  for (const p of s.pawns) if (p.firefightTask?.fireId === fire.id) s.fireRelease(p);
  fireLog(s, 'extinguished', fire, reason); s.revision++;
}
function damageTarget(kind: BurnTargetKind, p: Pos, id: number | null): FireDamage {
  return { kind, targetId: id, x: p.x, y: p.y, z: p.z, key: fireDamageKey(kind, id, p),
    hitPoints: FIRE_MAX_HP[kind], maxHitPoints: FIRE_MAX_HP[kind] };
}
export function findFireDamageTarget(s: FireHost, d: FireDamage): FireDamage | undefined {
  if (!inside(d)) return;
  if (isShelfKind(d.kind)) {
    const shelf = s.shelves.find(s => s.id === d.targetId && s.kind === d.kind);
    return shelf ? damageTarget(shelf.kind,shelf,shelf.id) : undefined;
  }
  if (d.kind === 'block') return s.blocks[at(d)] === Block.Wood ? damageTarget('block', d, null) : undefined;
  if (d.kind === 'ladder') return s.ladders[at(d)] ? damageTarget('ladder', d, null) : undefined;
  if (d.kind === 'wire') return s.wires.some(p => same(p, d)) ? damageTarget('wire', d, null) : undefined;
  const property = { table: 'tables', chair: 'chairs', bed: 'beds', door: 'doors', stove: 'stoves', stonecutter: 'stonecutters', tailor: 'tailors',
    weaponBench: 'weaponBenches', researchBench: 'researchBenches', horseshoePin: 'horseshoePins',
    butcherSpot: 'butcherSpots', device: 'devices', fence:'fences', fenceGate:'fenceGates', penMarker:'penMarkers' } as const;
  const object = s[property[d.kind]].find(q => q.id === d.targetId);
  return object ? damageTarget(d.kind, object, object.id) : undefined;
}
interface FuelTarget { kind: 'structure' | 'tree' | 'crop' | 'stack' | 'furniture'; id: number; flammability: number; damage?: FireDamage }
/** A flame consumes physical fuel at its cell. Air immediately above a wooden
 * support can burn that support, so a floor flame is shown at the walking layer. */
export function fireFuelAt(s: FireHost, p: Pos): FuelTarget[] {
  if (!inside(p)) return [];
  const out: FuelTarget[] = [], cell = at(p);
  if (s.blocks[cell] === Block.Wood) out.push({ kind: 'structure', id: cell, flammability: 1, damage: damageTarget('block', p, null) });
  else if (s.blocks[cell] === Block.Air && p.z > 0 && s.blocks[cell - WIDTH * DEPTH] === Block.Wood) {
    const floor = { x: p.x, y: p.y, z: p.z - 1 };
    out.push({ kind: 'structure', id: at(floor), flammability: 1, damage: damageTarget('block', floor, null) });
  }
  if (s.ladders[cell]) out.push({ kind: 'structure', id: cell, flammability: 1, damage: damageTarget('ladder', p, null) });
  const entries = [
    ['shelf',s.shelves.filter(s => s.kind === 'shelf')], ['smallShelf',s.shelves.filter(s => s.kind === 'smallShelf')],
    ['table', s.tables], ['chair', s.chairs],
    ['fence',s.fences], ['fenceGate',s.fenceGates], ['penMarker',s.penMarkers], ['bed', s.beds], ['door', s.doors], ['stove', s.stoves], ['stonecutter', s.stonecutters],
    ['tailor', s.tailors], ['weaponBench', s.weaponBenches], ['researchBench', s.researchBenches],
    ['horseshoePin', s.horseshoePins], ['butcherSpot', s.butcherSpots], ['device', s.devices],
  ] as const;
  for (const [kind, objects] of entries) for (const object of objects) {
    const damage = damageTarget(kind, object, object.id);
    if (fireDamageCells(damage, s).some(q => same(p, q)))
      out.push({ kind: 'structure', id: object.id, flammability: kind === 'device' ? .3 : .8, damage });
  }
  if (s.wires.some(q => same(p, q))) out.push({ kind: 'structure', id: cell, flammability: .2, damage: damageTarget('wire', p, null) });
  for (const tree of s.trees) if (same(tree, p)) out.push({ kind: 'tree', id: tree.id, flammability: 1 });
  for (const crop of s.crops) if (same(crop, p)) out.push({ kind: 'crop', id: crop.id, flammability: .7 });
  for (const item of s.items) if (same(item, p)) {
    if (item.furniture) { out.push({kind:'furniture',id:item.furniture.id,flammability:.8}); continue; }
    const flammability = ['wood', 'cloth', 'grain', 'herb', 'food', 'meal', 'meat', 'carcass', 'apparel', 'components'].includes(item.resource)
      ? 1 : item.resource === 'weapon' && item.weapon && ['woodClub', 'shortBow'].includes(item.weapon.kind) ? 1 : 0;
    if (flammability) out.push({ kind: 'stack', id: item.id, flammability });
  }
  for (const job of s.jobs) if (same(job,p)) for (const batch of job.deliveredBatches)
    if (batch.furniture) out.push({kind:'furniture',id:batch.furniture.id,flammability:.8});
  return out;
}
export function igniteFire(s: FireHost, p: Pos, source: FireSource): Fire | null {
  if (!inside(p) || s.fires.length >= FIRE_RULES.maxFires || s.fires.some(f => same(f, p)) || !fireFuelAt(s, p).length) return null;
  const fire = makeFire(s.nextId++, p, s.tick, source);
  s.fires.push(fire); s.revision++;
  fireLog(s, 'ignited', p, source === 'spread' ? '火焰蔓延到新的可燃物' : source === 'shortCircuit' ? '通电设施附近发生电气火灾' : '落雷引燃了室外可燃物');
  return fire;
}
function openSky(s: FireHost, p: Pos): boolean {
  for (let z = p.z + 1; z < HEIGHT; z++) if (s.blocks[at({ x: p.x, y: p.y, z })] !== Block.Air) return false;
  return true;
}
function incident(s: FireHost) {
  const state = s.fireHazards, cycle = state.cycle;
  state.cycle++; state.nextIncidentTick = nextFireIncident(s.seed, state.epoch, state.cycle);
  let source: FireEventSource = 'lightning', candidates: Pos[] = [];
  const candidateNetworks = new Map<number, number>();
  if (state.enabled) {
    const powered = new Set(s.devices.filter(d => d.on && d.networkId !== null &&
      ((d.kind === 'generator' || d.kind === 'solar') ? d.watts > 0 : d.kind === 'battery' && d.energy > 0)).map(d => d.networkId));
    const nodes = [...s.wires.filter(w => powered.has(s.power.networkIds[at(w)])).map(p => ({ p, network: s.power.networkIds[at(p)] })),
      ...s.devices.filter(d => powered.has(d.networkId)).map(p => ({ p, network: p.networkId! }))];
    const electrical = new Map<number, Pos>();
    for (const { p, network } of nodes) for (const [dx, dy, dz] of [[0, 0, 0], ...FIRE_DIRECTIONS]) {
      const q = { x: p.x + dx, y: p.y + dy, z: p.z + dz };
      if (inside(q) && fireFuelAt(s, q).length && !s.fires.some(f => same(f, q))) {
        electrical.set(at(q), q); if (!candidateNetworks.has(at(q))) candidateNetworks.set(at(q), network);
      }
    }
    if (electrical.size) { source = 'shortCircuit'; candidates = [...electrical.values()]; }
    else if (s.weather.kind === 'thunderstorm') {
      candidates = [...s.trees, ...s.crops].filter(p => openSky(s, p) && !s.fires.some(f => same(f, p)));
      if (!candidates.length) for (let i = WIDTH * DEPTH; i < s.blocks.length; i++) if (s.blocks[i] === Block.Wood) {
        const q = position(i), above = { ...q, z: q.z + 1 };
        const p = inside(above) && s.blocks[at(above)] === Block.Air ? above : q;
        if (openSky(s, p) && !s.fires.some(f => same(f, p))) candidates.push(p);
      }
    }
  }
  candidates.sort((a, b) => at(a) - at(b));
  const target = candidates.length ? candidates[Math.floor(fireRandom(s.seed, cycle, state.epoch, 2) * candidates.length)] : null;
  const fire = target ? igniteFire(s, target, source) : null;
  const networkId = fire && source === 'shortCircuit' ? candidateNetworks.get(at(fire)) ?? null : null;
  const reason = !state.enabled ? '玩家已关闭后续火灾事件' : fire ? source === 'shortCircuit'
    ? '通电网络发生故障并引燃附近实物；相连电池放电，既有发电继续' : '雷击引燃室外植物或木结构'
    : source === 'lightning' && s.weather.kind !== 'thunderstorm' ? '没有通电故障目标且当前不是雷暴，未发生落雷' : '本次没有适合点燃的实物位置';
  if (fire && networkId !== null) for (const d of s.devices)
    if (d.kind === 'battery' && d.on && d.networkId === networkId) d.energy = 0;
  state.events.push({ tick: s.tick, source, outcome: fire ? 'ignited' : 'skipped',
    position: fire ? { x: fire.x, y: fire.y, z: fire.z } : null, networkId, reason });
  if (state.events.length > FIRE_RULES.maxEvents) state.events.splice(0, state.events.length - FIRE_RULES.maxEvents);
}
type FireEventSource = 'lightning' | 'shortCircuit';
export function updateFires(s: FireHost) {
  if (s.tick >= s.fireHazards.nextIncidentTick) incident(s);
  s.updateRooms();
  for (const fire of [...s.fires]) {
    if (s.weatherExposed(fire)) {
      fire.size -= weatherEffects(s.weather, s.tick).rainRate * WEATHER_RULES.rainExtinguishPerSecond / TPS;
      if (fire.size < FIRE_RULES.minSize) { removeFire(s, fire, '露天火焰被降水扑灭'); continue; }
    }
    let fuel = fireFuelAt(s, fire);
    if (!fuel.length) { removeFire(s, fire, '可燃物已耗尽，火焰熄灭'); continue; }
    const rooms = new Map<number, Pos>();
    for (const [dx, dy, dz] of [[0, 0, 0], ...FIRE_DIRECTIONS]) {
      const q = { x: fire.x + dx, y: fire.y + dy, z: fire.z + dz };
      if (!inside(q)) continue;
      const room = s.rooms.roomAt(q);
      if (room && !room.outdoor) rooms.set(room.id, q);
    }
    for (const p of rooms.values()) s.thermal.pushHeat(p, fire.size * FIRE_RULES.heatPerSecond / TPS / rooms.size);
    if (s.tick >= fire.nextDamageTick) {
      fire.nextDamageTick += FIRE_RULES.damageInterval;
      fire.size = Math.min(FIRE_RULES.maxSize, fire.size + FIRE_RULES.growth * Math.max(...fuel.map(f => f.flammability)));
      const target = fuel[Math.floor(fireRandom(s.seed, fire.id, s.tick, 3) * fuel.length)], amount = fire.size * FIRE_RULES.damagePerSize;
      if (target.kind === 'tree') s.fireBurnTree(target.id, amount);
      else if (target.kind === 'crop') s.fireBurnCrop(target.id);
      else if (target.kind === 'stack') s.fireBurnGround(target.id, 1);
      else if (target.kind === 'furniture') s.fireBurnFurniture(target.id,amount);
      else {
        let damage = s.fireDamage.find(d => d.key === target.damage!.key);
        if (!damage && s.fireDamage.length >= FIRE_RULES.maxDamage) {
          removeFire(s, fire, '持续损伤记录已达容量上限，停止此处燃烧'); continue;
        }
        if (!damage) { damage = { ...target.damage! }; s.fireDamage.push(damage); }
        damage.hitPoints = Math.max(0, damage.hitPoints - amount);
        if (damage.hitPoints === 0) {
          if (s.fireDestroy(damage, `${FIRE_TARGET_NAMES[damage.kind]}被烧毁`)) {
            s.fireDamage = s.fireDamage.filter(d => d.key !== damage.key);
            fireLog(s, 'destroyed', damage, `${FIRE_TARGET_NAMES[damage.kind]}被烧毁；已投入建筑的材料不返还`);
          } else {
            damage.hitPoints = 1; removeFire(s, fire, '当前异常地形没有合法落点，已终止此处燃烧');
            fireLog(s, 'failed', damage, '销毁会让人物或动物落入无底世界；未执行破坏'); continue;
          }
        }
      }
      fuel = fireFuelAt(s, fire);
      if (!fuel.length) { removeFire(s, fire, '可燃物已耗尽，火焰熄灭'); continue; }
    }
    if (s.tick >= fire.nextSpreadTick) {
      fire.nextSpreadTick += FIRE_RULES.spreadInterval;
      if (fire.size > FIRE_RULES.spreadSize && fireRandom(s.seed, fire.id, s.tick, 4) < FIRE_RULES.spreadChance) {
        const candidates = FIRE_DIRECTIONS.map(([dx, dy, dz]) => ({ x: fire.x + dx, y: fire.y + dy, z: fire.z + dz }))
          .filter(p => inside(p) && !s.fires.some(f => same(f, p)) && fireFuelAt(s, p).length);
        if (candidates.length) igniteFire(s, candidates[Math.floor(fireRandom(s.seed, fire.id, s.tick, 5) * candidates.length)], 'spread');
      }
    }
  }
  s.fireDamage = s.fireDamage.filter(d => !!findFireDamageTarget(s, d));
  for (const p of s.pawns) if ((p.firefightTask && !validFirefight(s, p)) || (p.repairTask && !validRepair(s, p))) s.fireRelease(p);
}
function capable(s: FireHost, p: Pawn) {
  return p.faction === 'colony' && !p.dead && !p.downed && !p.drafted && p.carriedBy === null &&
    p.carryingPawnId === null && p.psyche.breakUntil <= s.tick && healthSummary(p).manipulation > 0;
}
export function validFirefight(s: FireHost, p: Pawn): boolean {
  const f = s.fires.find(f => f.id === p.firefightTask?.fireId);
  return !!f && capable(s, p) && p.phase === 'firefight' && p.cargo === null && p.jobId === null &&
    p.carePhase === null && p.wardenTask === null && p.cleanTask === null && p.repairTask === null &&
    s.homeArea.has(at(f)) && !s.pawns.some(q => q !== p && q.firefightTask?.fireId === f.id);
}
export function startFirefight(s: FireHost, p: Pawn, f: Fire): boolean {
  if (!capable(s, p) || !s.homeArea.has(at(f)) || s.pawns.some(q => q !== p && q.firefightTask?.fireId === f.id)) return false;
  const route = s.fireRoute(p, [f]);
  if (route === null || !s.fireDropCargo(p)) return false;
  s.fireRelease(p); p.phase = 'firefight'; p.firefightTask = { fireId: f.id, progress: 0 };
  p.path = route; p.destination = route.at(-1) ?? null; p.reason = '前往拍打灭火'; return true;
}
export function tryFirefight(s: FireHost, p: Pawn): boolean {
  if (!p.priorities.firefight || p.cargo) return false;
  const fires = s.fires.filter(f => s.homeArea.has(at(f)) && !s.pawns.some(q => q.firefightTask?.fireId === f.id))
    .sort((a, b) => distance(p, a) - distance(p, b) || a.id - b.id);
  for (const fire of fires) if (startFirefight(s, p, fire)) return true;
  return false;
}
export function firefightTick(s: FireHost, p: Pawn) {
  if (!validFirefight(s, p)) { s.fireRelease(p); return; }
  const fire = s.fires.find(f => f.id === p.firefightTask!.fireId)!;
  if (!touchesFire(p, fire)) { s.fireRelease(p); return; }
  p.destination = null; p.reason = '正在拍打灭火'; p.firefightTask!.progress += healthSummary(p).manipulation;
  if (p.firefightTask!.progress < FIRE_RULES.beatWork) return;
  p.firefightTask!.progress = 0; fire.size = Math.max(0, fire.size - FIRE_RULES.beatReduction);
  if (fire.size < FIRE_RULES.minSize) removeFire(s, fire, `${p.name}扑灭了火焰`);
}
export function validRepair(s: FireHost, p: Pawn): boolean {
  const d = s.fireDamage.find(d => d.key === p.repairTask?.damageKey);
  return !!d && capable(s, p) && p.phase === 'repair' && p.cargo === null && p.jobId === null &&
    p.carePhase === null && p.wardenTask === null && p.cleanTask === null && p.firefightTask === null &&
    d.hitPoints > 0 && d.hitPoints < d.maxHitPoints && !!findFireDamageTarget(s, d) &&
    fireDamageHomeCells(d, s).some(q => s.homeArea.has(at(q))) && !fireDamageBurning(d, s.fires, s) &&
    !s.pawns.some(q => q !== p && q.repairTask?.damageKey === d.key);
}
export function startRepair(s: FireHost, p: Pawn, d: FireDamage): boolean {
  if (!capable(s, p) || !findFireDamageTarget(s, d) || d.hitPoints <= 0 || d.hitPoints >= d.maxHitPoints ||
      fireDamageBurning(d, s.fires, s) || !fireDamageHomeCells(d, s).some(q => s.homeArea.has(at(q))) ||
      s.pawns.some(q => q !== p && q.repairTask?.damageKey === d.key)) return false;
  const route = s.fireRoute(p, fireDamageCells(d, s));
  if (route === null || !s.fireDropCargo(p)) return false;
  s.fireRelease(p); p.phase = 'repair'; p.repairTask = { damageKey: d.key, progress: 0 };
  p.path = route; p.destination = route.at(-1) ?? null; p.reason = `前往修理${FIRE_TARGET_NAMES[d.kind]}`; return true;
}
export function tryRepair(s: FireHost, p: Pawn): boolean {
  if (!p.priorities.build || p.cargo || !s.fireDamage.length) return false;
  const targets = s.fireDamage.filter(d => fireDamageHomeCells(d, s).some(q => s.homeArea.has(at(q))) && !fireDamageBurning(d, s.fires, s))
    .sort((a, b) => distance(p, a) - distance(p, b) || a.key.localeCompare(b.key));
  for (const d of targets) if (startRepair(s, p, d)) return true;
  return false;
}
export function repairTick(s: FireHost, p: Pawn) {
  if (!validRepair(s, p)) { s.fireRelease(p); return; }
  const d = s.fireDamage.find(d => d.key === p.repairTask!.damageKey)!;
  if (!fireDamageCells(d, s).some(q => touchesFire(p, q))) { s.fireRelease(p); return; }
  p.destination = null; p.reason = `正在修理${FIRE_TARGET_NAMES[d.kind]}`;
  p.repairTask!.progress += healthSummary(p).manipulation;
  learnSkill(p.skills.construction, .05);
  if (p.repairTask!.progress < FIRE_RULES.repairPointWork) return;
  p.repairTask!.progress = 0; d.hitPoints = Math.min(d.maxHitPoints, d.hitPoints + 1); s.revision++;
  if (d.hitPoints === d.maxHitPoints) { s.fireDamage = s.fireDamage.filter(q => q.key !== d.key); s.fireRelease(p); p.reason = '修理完成'; }
}
