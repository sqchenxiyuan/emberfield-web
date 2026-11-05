import { CELLS, position, type AnimalSpecies, type Pos, type WildAnimal } from './types';
import { ANIMAL_DEFS } from './wildlife';
import { HUSBANDRY_RULES, initialAnimalState } from './husbandry';
import { initialAnimalPenState, isPenMapEdge } from './pens';
import type { TraderCaravan, TraderKind } from './tradeTypes';
import type { HusbandryHost } from './husbandryWorld';

/** Concentrated provisional prices and supply. Mechanisms precede calibration;
 * these are not a reproduction of the native pawn valuation stat chain. */
export const LIVE_ANIMAL_TRADE = Object.freeze({
  value: Object.freeze({ hare: 50, deer: 150, alpaca: 250, dromedary: 300, chicken: 50, labrador: 250 }),
  regroupDistance: 4, retryTicks: 80, minimumSaleHealth: .15,
  minimumTemperature: -20, maximumTemperature: 45,
});
export const emptyAnimalTradeCounts = (): Record<AnimalSpecies, number> =>
  ({ hare: 0, deer: 0, alpaca: 0, dromedary: 0, chicken: 0, labrador: 0 });
export const traderAcceptsAnimal = (kind: TraderKind, a: Pick<WildAnimal,'species'>): boolean =>
  kind === 'bulk' && ['alpaca','dromedary','chicken','labrador'].includes(a.species);
export function animalMarketValue(a: WildAnimal): number {
  if (a.dead) return 0;
  return LIVE_ANIMAL_TRADE.value[a.species] * (.25 + .75 * a.growth) *
    Math.max(.1, a.health / ANIMAL_DEFS[a.species].health) * (1 - .5 * a.malnutrition);
}
export function animalCanTrade(a: WildAnimal, temperature: number): boolean {
  return !a.dead && !a.cargo && !(a.work?.kind==='rescue'&&a.work.stage==='carry') && !a.medical.downed && a.medical.carriedBy===null && a.health / ANIMAL_DEFS[a.species].health > LIVE_ANIMAL_TRADE.minimumSaleHealth &&
    a.malnutrition < .8 && a.phase !== 'flee' && a.phase !== 'shelter' &&
    temperature >= LIVE_ANIMAL_TRADE.minimumTemperature && temperature <= LIVE_ANIMAL_TRADE.maximumTemperature;
}
export function newTraderAnimal(id: number, species: AnimalSpecies, sex: WildAnimal['sex'], tick: number, pos: Pos): WildAnimal {
  return { ...pos, ...initialAnimalState(id, species, tick), id, species, sex,
    name: ANIMAL_DEFS[species].name, faction: 'trader', tameness: HUSBANDRY_RULES.tamenessMax,
    health: ANIMAL_DEFS[species].health, hunger: 90, dead: false, phase: 'roam', hunt: false,
    moveTick: tick, decisionTick: tick, fleeUntil: 0, threatId: null, retryTick: 0, rotProgress: 0,
    reason: '跟随商队入场' };
}
type AnimalTradeHost = HusbandryHost & { trade: { caravans: TraderCaravan[] }; revision: number };
/** Transfer the same actor, release work/ropes and reset ownership assignments,
 * but never regenerate its age, health, hunger or biological progress. */
export function transferAnimal(s: AnimalTradeHost, a: WildAnimal, faction: 'colony'|'trader', caravan: TraderCaravan) {
  s.animalCancelWork?.(a);
  a.training.masterId=null;a.training.followDrafted=false;a.training.followFieldwork=false;
  for (const p of s.pawns) if (p.handleTask?.animalId === a.id || p.ropeTask?.animalId === a.id ||
      p.animalCareTask?.animalId===a.id || p.animalTrainTask?.animalId===a.id ||
      p.attackTargetId === a.id || p.shooting?.targetId === a.id) s.prisonRelease(p);
  for (const b of s.animals) if (b.mateId === a.id) {
    b.mateId = null; b.mateProgress = 0; b.goal = null; b.path = []; b.phase = 'roam';
  }
  for (const c of s.trade.caravans) c.animalIds = c.animalIds.filter(id => id !== a.id);
  if (faction === 'trader') caravan.animalIds.push(a.id);
  a.medical.bedId=null;a.medical.carriedBy=null;a.medical.rescue=false;
  Object.assign(a, initialAnimalPenState(s.tick), { faction, tameness: HUSBANDRY_RULES.tamenessMax,
    tame: false, hunt: false, slaughter: false, releaseMarked: false, mateId: null, mateProgress: 0,
    path: [], goal: null, eatProgress: 0, layProgress: 0, phase: 'roam', threatId: null, fleeUntil: 0,
    retryTick: 0, decisionTick: s.tick, nextTamenessDecayTick: s.tick + HUSBANDRY_RULES.tamenessDecayTicks,
    reason: faction === 'colony' ? '已买入，等待安排圈养或允许区域' : '已交给商队，跟随商队离开' });
  s.revision++;
}
const distance = (a: Pos,b: Pos) => Math.abs(a.x-b.x)+Math.abs(a.y-b.y)+Math.abs(a.z-b.z);
/** Called after biological needs and danger, before normal roaming. Animals use
 * their own ground graph: fences, closed gates, fire and ladders remain real. */
export function caravanAnimalTick(s: AnimalTradeHost, a: WildAnimal): boolean {
  if (a.faction !== 'trader') return false;
  const caravan = s.trade.caravans.find(c => c.animalIds.includes(a.id));
  if (!caravan) return true; // Invalid ownership is rejected when loading.
  const leader = s.pawns.find(p => p.id === caravan.traderId && !p.dead && !p.downed);
  const leaving = caravan.stage === 'leaving' || !leader;
  if (leaving && isPenMapEdge(a)) {
    if(a.cargo&&!s.animalDropCargo?.(a))return true;
    caravan.animalIds = caravan.animalIds.filter(id => id !== a.id);
    s.animals = s.animals.filter(b => b !== a); s.revision++; return true;
  }
  // A visiting animal may forage and rest. During travel only urgent hunger
  // interrupts the escort; its real intake uses the ordinary bounded food loop.
  const feeding = a.goal && ['grass','crop','food'].includes(a.goal.kind);
  if ((feeding && a.hunger < 90) || a.hunger < (leaving ? 18 : caravan.stage === 'visiting' ? 65 : 18)) {
    if (a.goal?.kind === 'caravan') { a.path=[]; a.goal=null; a.decisionTick=s.tick; }
    return false;
  }
  const target = leader ?? caravan.meeting;
  if (!leaving && distance(a,target) <= LIVE_ANIMAL_TRADE.regroupDistance) {
    if (a.goal?.kind === 'caravan') { a.path=[]; a.goal=null; }
    return false;
  }
  if (a.goal?.kind !== 'caravan') {
    a.path=[]; a.goal={kind:'caravan',id:caravan.id}; a.eatProgress=0; a.layProgress=0;
    a.decisionTick=s.tick;
  }
  a.phase='roam';
  if (!a.path.length && s.tick >= a.decisionTick) {
    const targets=new Set<number>();
    if (leaving) {
      for(let n=0;n<CELLS;n++) { const p=position(n); if(isPenMapEdge(p)&&s.animalCanStop(p))targets.add(n); }
    } else {
      // An adjacent stopping cell is enough; no overlap/teleport to a human.
      for(const n of s.animalNeighbors(a,target))if(s.animalCanStop(position(n)))targets.add(n);
    }
    a.path=s.animalRoute(a,targets)??[]; a.decisionTick=s.tick+LIVE_ANIMAL_TRADE.retryTicks;
  }
  a.reason=a.path.length?(leaving?'跟随商队离开地图':'跟随商队前往营地'):'商队动物通路受阻，等待通路或开启围栏门';
  if(a.path.length&&s.tick>=a.moveTick) {
    const next=a.path[0];
    if(!s.animalNeighbors(a,a).includes(next)){a.path=[];a.decisionTick=s.tick+LIVE_ANIMAL_TRADE.retryTicks;return true;}
    const from={x:a.x,y:a.y,z:a.z};Object.assign(a,position(a.path.shift()!));
    a.moveTick=s.tick+s.animalMoveTicks(a,from);
  }
  return true;
}
