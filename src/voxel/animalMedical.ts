import { DAY, type AnimalSpecies, type Pos, type WildAnimal } from './types';
import type { MedicalPolicy } from './medicine';
import { ANIMAL_DEFS } from './wildlife';

export type AnimalBodyPart = 'body' | 'head' | 'frontLeft' | 'frontRight' | 'hindLeft' | 'hindRight';
export interface AnimalWound {
  id: number; part: AnimalBodyPart; kind: 'cut' | 'bruise' | 'burn';
  severity: number; tended: number | null; ageTicks: number;
}
export interface AnimalMedicalState {
  policy: MedicalPolicy; wounds: AnimalWound[]; nextWoundId: number;
  bloodLoss: number; downed: boolean; bedId: number | null; carriedBy: number | null;
  /** Explicit rescue consent for wild/merchant animals; never changes ownership. */
  rescue: boolean;
}
/** A free, one-cell animal medical sleeping spot; no human-bed reassignment. */
export interface AnimalBed extends Pos { id: number }
export interface AnimalCareTask {
  animalId: number; action: 'rescue' | 'tend' | 'feed';
  stage: 'fetch' | 'approach' | 'carry' | 'work'; bedId: number | null;
  sourceId: number | null; amount: number; progress: number;
}
/** Deliberately provisional Web tuning. Species layouts distinguish birds from
 * quadrupeds, but do not claim the native complete organ/part damage model. */
export const ANIMAL_MEDICAL_RULES = Object.freeze({
  work: 200, feedWork: 120, healPerDay: .16, bedHealFactor: 1.7,
  bloodRecoveryPerDay: .25, bleedPerDay: 4, painShock: .8, downedHealth: .28,
  downedBlood: .6, downedMalnutrition: .8, maxWounds: 64, maxBeds: 128,
});
const QUADRUPED: readonly AnimalBodyPart[] = ['body','head','frontLeft','frontRight','hindLeft','hindRight'];
const BIRD: readonly AnimalBodyPart[] = ['body','head','hindLeft','hindRight'];
export function animalBodyParts(species: AnimalSpecies): readonly AnimalBodyPart[] { return species === 'chicken' ? BIRD : QUADRUPED; }
export const ANIMAL_PART_NAMES: Record<AnimalBodyPart,string> = {
  body:'躯干',head:'头部',frontLeft:'左前肢',frontRight:'右前肢',hindLeft:'左后肢',hindRight:'右后肢',
};
export function initialAnimalMedical(): AnimalMedicalState {
  return { policy:'herbal',wounds:[],nextWoundId:1,bloodLoss:0,downed:false,bedId:null,carriedBy:null,rescue:false };
}
export function animalMedicalSummary(a: WildAnimal) {
  const m=a.medical, maximum=ANIMAL_DEFS[a.species].health;
  if(m.wounds.length===0&&m.bloodLoss===0)return {pain:0,moving:1,bleeding:0,
    downed:!a.dead&&(a.health/maximum<=ANIMAL_MEDICAL_RULES.downedHealth||a.malnutrition>=ANIMAL_MEDICAL_RULES.downedMalnutrition),
    injured:a.health<maximum,needsTending:false};
  const damage=m.wounds.reduce((n,w)=>n+w.severity,0);
  const pain=Math.min(1,damage/maximum*1.5);
  const limbs=animalBodyParts(a.species).filter(p=>p!=='body'&&p!=='head');
  const moving=limbs.reduce((n,p)=>n+Math.max(0,1-m.wounds.filter(w=>w.part===p).reduce((sum,w)=>sum+w.severity,0)/(maximum*.3)),0)/limbs.length;
  const bleeding=m.wounds.reduce((n,w)=>n+(w.kind==='cut'&&w.tended===null?w.severity/maximum:0),0)*ANIMAL_MEDICAL_RULES.bleedPerDay;
  const downed=!a.dead&&(pain>=ANIMAL_MEDICAL_RULES.painShock||a.health/maximum<=ANIMAL_MEDICAL_RULES.downedHealth||
    m.bloodLoss>=ANIMAL_MEDICAL_RULES.downedBlood||a.malnutrition>=ANIMAL_MEDICAL_RULES.downedMalnutrition||moving<=.15);
  return {pain,moving:Math.max(.1,moving*(1-.5*m.bloodLoss)),bleeding,downed,
    injured:m.wounds.length>0||a.health<maximum||m.bloodLoss>0,
    needsTending:m.wounds.some(w=>w.tended===null)};
}
/** Uses the caller's deterministic sample; never consumes the world's RNG. */
export function injureAnimal(a:WildAnimal,amount:number,kind:AnimalWound['kind']='cut',roll=0):void {
  if(!Number.isFinite(amount)||amount<=0||!['cut','bruise','burn'].includes(kind)||!Number.isFinite(roll)||roll<0||roll>=1)
    throw new RangeError('动物伤害参数无效');
  if(a.dead)return;
  const parts=animalBodyParts(a.species),part=roll<.5?'body':parts[1+Math.min(parts.length-2,Math.floor((roll-.5)*2*(parts.length-1)))];
  const loss=Math.min(a.health,amount);a.health-=loss;
  const m=a.medical;
  if(m.wounds.length<ANIMAL_MEDICAL_RULES.maxWounds) m.wounds.push({id:m.nextWoundId++,part,kind,severity:loss,tended:null,ageTicks:0});
  else { // Bounded memory; preserve new untreated damage instead of dropping it.
    const w=m.wounds.find(w=>w.part===part&&w.kind===kind&&w.tended===null)??m.wounds[0];
    w.severity+=loss;w.kind=kind;w.tended=null;w.ageTicks=0;
  }
  m.downed=animalMedicalSummary(a).downed;
}
export function tendAnimal(a:WildAnimal,quality:number,medicine:boolean):boolean {
  if(a.dead||a.medical.policy==='none')return false;
  const wounds=a.medical.wounds.filter(w=>w.tended===null).sort((a,b)=>b.severity-a.severity);
  if(!wounds.length)return false;
  const q=Math.max(0,Math.min(medicine?.7:.4,quality*(medicine?1:.7)));
  // A treatment session handles one wound; one herb is consumed by the world.
  wounds[0].tended=q;return true;
}
/** Biological recovery is gradual. Tending stops bleeding; it does not refill
 * health. Legacy scalar damage is retained without inventing wound history. */
export function advanceAnimalMedical(a:WildAnimal,inBed:boolean):'bloodLoss'|null {
  if(a.dead)return null;
  const m=a.medical,s=animalMedicalSummary(a),maximum=ANIMAL_DEFS[a.species].health;
  m.bloodLoss=Math.max(0,Math.min(1,m.bloodLoss+(s.bleeding-(s.bleeding===0?ANIMAL_MEDICAL_RULES.bloodRecoveryPerDay:0))/DAY));
  if(m.bloodLoss>=1)return 'bloodLoss';
  if(m.wounds.length) {
    const budget=maximum*ANIMAL_MEDICAL_RULES.healPerDay*(inBed?ANIMAL_MEDICAL_RULES.bedHealFactor:1)*(a.hunger>0?1:.1)/DAY;
    const share=budget/m.wounds.length;
    for(const w of m.wounds) { w.ageTicks++; const healed=Math.min(w.severity,share*(1+(w.tended??0)));
      w.severity-=healed;a.health=Math.min(maximum,a.health+healed); }
    m.wounds=m.wounds.filter(w=>w.severity>1e-8);
  }
  // Old scalar injuries have no invented part/bleeding history. Bed rest can
  // recover that deficit without changing a legacy colony with no new beds.
  if(inBed) {
    const unexplained=Math.max(0,maximum-a.health-m.wounds.reduce((n,w)=>n+w.severity,0));
    a.health+=Math.min(unexplained,maximum*ANIMAL_MEDICAL_RULES.healPerDay/DAY);
  }
  m.downed=animalMedicalSummary(a).downed;
  return null;
}
export function animalNeedsHospital(a:WildAnimal):boolean {
  return !a.dead&&(animalMedicalSummary(a).injured||a.medical.downed||a.malnutrition>=.8);
}
