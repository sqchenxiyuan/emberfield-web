import { at, position, WIDTH, DEPTH, HEIGHT, type Pos, type WildAnimal } from './types';
import { advanceAnimalEnvironment, animalThermalDanger, animalTemperatureAllowsRecovery } from './animalEnvironment';
import { injureAnimal } from './animalMedical';
import { animalMedicalTick, cancelAnimalMedical, type AnimalMedicalHost } from './animalMedicalWorld';
import { releaseAnimalHandlers } from './husbandryWorld';
import { animalAllowed } from './pensWorld';
import { HUSBANDRY_RULES } from './husbandry';
import { plantRandom } from './plants';
import type { Fire } from './fire';

export const ANIMAL_ENVIRONMENT_WORLD_RULES = Object.freeze({
  contactInterval: 30, burnDamagePerSize: 3, seekInterval: 80, searchCells: 768,
  seekInjury: .35,
});
type Host = Omit<AnimalMedicalHost, 'fires'> & { fires: Fire[] };
const same = (a: Pos, b: Pos) => at(a) === at(b);
const edge = (p: Pos) => p.x === 0 || p.x === WIDTH - 1 || p.y === 0 || p.y === DEPTH - 1;
const environmentalGoal = (a: WildAnimal) => a.goal?.kind === 'shelter' || a.goal?.kind === 'climateExit';
const burning = (s: Host, p: Pos) => s.fires.some(f => same(f, p));
const free = (s: Host, a: WildAnimal, p: Pos) => s.animalCanStop(p) &&
  !s.animals.some(other => other !== a && !other.dead && same(other, p)) &&
  !s.pawns.some(pawn => !pawn.dead && same(pawn, p));

function clear(s: Host, a: WildAnimal) {
  cancelAnimalMedical(s, a); releaseAnimalHandlers(s, a);
  for (const other of s.animals) if (other.mateId === a.id) {
    other.mateId = null; other.mateProgress = 0; other.path = []; other.goal = null; other.phase = 'roam';
  }
  a.path = []; a.goal = null; a.eatProgress = 0; a.mateId = null; a.mateProgress = 0; a.layProgress = 0;
  a.phase = a.medical.downed ? 'downed' : 'roam';
}

/** Bounded search over actual animal edges. No ladders, closed-gate crossing,
 * teleportation, or temperature inferred from biome names. */
function shelterPath(s: Host, a: WildAnimal, escapeFire: boolean): number[] | null {
  const start = at(a), queue = [start], previous = new Map<number, number>([[start, start]]);
  for (let cursor = 0; cursor < queue.length && cursor < ANIMAL_ENVIRONMENT_WORLD_RULES.searchCells; cursor++) {
    const cell = queue[cursor], p = position(cell);
    if (cell !== start && !burning(s, p) && free(s, a, p) && animalAllowed(s, a, p) &&
        (escapeFire || animalTemperatureAllowsRecovery(a, s.temperature(p)))) {
      const path = [cell];
      while (previous.get(path[0]) !== start) path.unshift(previous.get(path[0])!);
      return path;
    }
    for (const next of s.animalNeighbors(a, p)) if (!previous.has(next)) {
      if (queue.length >= ANIMAL_ENVIRONMENT_WORLD_RULES.searchCells) break;
      previous.set(next, cell); queue.push(next);
    }
  }
  return null;
}
function exitPath(s: Host, a: WildAnimal): number[] | null {
  const targets = new Set<number>();
  for (let z = 1; z < HEIGHT - 1; z++) {
    for (let x = 0; x < WIDTH; x++) for (const y of [0, DEPTH - 1]) {
      const p = { x, y, z }; if (s.standable(p) && free(s, a, p) && !burning(s, p)) targets.add(at(p));
    }
    for (let y = 1; y < DEPTH - 1; y++) for (const x of [0, WIDTH - 1]) {
      const p = { x, y, z }; if (s.standable(p) && free(s, a, p) && !burning(s, p)) targets.add(at(p));
    }
  }
  return s.animalRoute(a, targets);
}
function depart(s: Host, a: WildAnimal) {
  clear(s, a);
  if(a.cargo&&!s.animalDropCargo?.(a))return;
  for (const p of s.pawns) if (p.attackTargetId === a.id || p.shooting?.targetId === a.id) s.prisonRelease(p);
  s.animals = s.animals.filter(other => other !== a);
  const message = `${a.name}沿地图边缘离开了不适温地区`;
  s.husbandryLog.push({ tick: s.tick, kind: 'escaped', animalId: a.id, otherId: null, message });
  s.husbandryLog = s.husbandryLog.slice(-HUSBANDRY_RULES.maxLog); s.notice = message;
}

function environmentTravel(s: Host, a: WildAnimal, medicallyControlled: boolean, decisionReady: boolean): boolean {
  if (a.dead || a.medical.downed || a.medical.carriedBy !== null) return medicallyControlled;
  const inFire = burning(s, a), temperature = s.temperature(a);
  // An actual attacker interrupts a thermal refuge route. Keep the ordinary
  // flee state machine authoritative, except when escaping the current flame.
  if (!inFire && a.fleeUntil > s.tick && s.pawns.some(p => p.id === a.threatId && !p.dead)) {
    if (environmentalGoal(a)) clear(s, a);
    return false;
  }
  const wildExit = a.faction === 'wild' && !a.medical.rescue && animalThermalDanger(a, temperature) > 0;
  const seek = a.faction === 'colony' && Math.max(a.environment.hypothermia, a.environment.heatstroke) >= ANIMAL_ENVIRONMENT_WORLD_RULES.seekInjury &&
    !animalTemperatureAllowsRecovery(a, temperature);
  if (!inFire && !wildExit && (!seek || medicallyControlled)) {
    if (environmentalGoal(a)) { a.path = []; a.goal = null; a.phase = 'roam'; a.decisionTick = s.tick; }
    return medicallyControlled;
  }
  if (wildExit && edge(a)) { depart(s, a); return true; }
  const kind = wildExit && !inFire ? 'climateExit' : 'shelter';
  if (a.goal?.kind !== kind || !a.path.length || !s.animalNeighbors(a, a).includes(a.path[0]) ||
      (kind === 'shelter' && (!animalAllowed(s, a, position(a.goal.id)) ||
        !inFire && !animalTemperatureAllowsRecovery(a, s.temperature(position(a.goal.id)))))) {
    if (!inFire && !decisionReady && !environmentalGoal(a)) return medicallyControlled;
    const path = kind === 'climateExit' ? exitPath(s, a) : shelterPath(s, a, inFire);
    clear(s, a); a.decisionTick = s.tick + ANIMAL_ENVIRONMENT_WORLD_RULES.seekInterval;
    if (!path?.length) {
      a.reason = inFire ? '被火焰困住，等待灭火或救助' : '没有可达的安全温区，请改善温控或救助';
      return true;
    }
    a.path = path; a.goal = { kind, id: path.at(-1)! }; a.phase = 'shelter';
  }
  a.phase = 'shelter';
  // A route can become occupied after selection. Wait or replan without
  // stepping onto another animal, losing identity, or consuming extra time.
  if (s.tick >= a.moveTick && a.path.length) {
    const next = position(a.path[0]);
    if (free(s, a, next)) {
      const from = { x: a.x, y: a.y, z: a.z }; Object.assign(a, next); a.path.shift();
      a.moveTick = s.tick + s.animalMoveTicks(a, from);
    }
  }
  a.reason = kind === 'climateExit' ? '沿实际通路离开不适温地区' : inFire ? '逃离火焰' : '前往适温位置';
  if (!a.path.length) {
    if (kind === 'climateExit' && edge(a)) depart(s, a);
    else { a.goal = null; a.phase = 'roam'; a.decisionTick = s.tick; }
  }
  return true;
}

/** Existing nutrition and biology run before this hook. Both temperature
 * disease and medical recovery continue while rescued/carried or immobilized. */
export function animalEnvironmentAndMedicalTick(s: Host, a: WildAnimal): boolean {
  const lethal = advanceAnimalEnvironment(a, s.temperature(a), s.tick);
  if (lethal) { s.killAnimal(a, lethal === 'hypothermia' ? '严重失温' : '严重中暑'); return true; }
  if (s.tick % ANIMAL_ENVIRONMENT_WORLD_RULES.contactInterval === 0) {
    const fire = s.fires.find(f => same(f, a));
    if (fire) {
      injureAnimal(a, fire.size * ANIMAL_ENVIRONMENT_WORLD_RULES.burnDamagePerSize, 'burn', plantRandom(s.seed, a.id, s.tick, 1550));
      if (a.health <= 0) { s.killAnimal(a, '火焰烧伤'); return true; }
    }
  }
  const decisionReady = s.tick >= a.decisionTick;
  const controlled = animalMedicalTick(s, a);
  return environmentTravel(s, a, controlled, decisionReady);
}
