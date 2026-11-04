import type { AnimalSpecies, WildAnimal } from './types';

/** Provisional Emberfield values. Mechanics first; these are not native calibration. */
export const WILDLIFE = Object.freeze({ population: 8, cap: 24, butcherWork: 100,
  meatRotDays: 2, carcassRotDays: 2, huntRetryTicks: 200 });
export const ANIMAL_DEFS: Readonly<Record<AnimalSpecies, {
  name: string; health: number; meat: number; color: number; moveTicks: number;
}>> = {
  hare: { name: '野兔', health: 28, meat: 18, color: 0xb19b85, moveTicks: 9 },
  deer: { name: '鹿', health: 65, meat: 50, color: 0x936341, moveTicks: 12 },
  alpaca: { name: '羊驼', health: 75, meat: 55, color: 0xd8ccb3, moveTicks: 12 },
  dromedary: { name: '单峰驼', health: 100, meat: 90, color: 0xc8a36c, moveTicks: 13 },
  chicken: { name: '鸡', health: 20, meat: 12, color: 0xe7ddc0, moveTicks: 10 },
};
export const ANIMAL_PHASE_NAMES: Record<WildAnimal['phase'], string> = {
  downed: '倒地', medicalRest: '医疗休养', carried: '救助搬运中',
  layEgg: '产蛋',
  rope: '牵引中',
  eat: '进食', mate: '求偶', interact: '接受照料',
  roam: '游荡', graze: '觅食', rest: '休息', flee: '逃离威胁', dead: '尸体等待落地空间',
};
export const isAnimal = (target: unknown): target is WildAnimal =>
  !!target && typeof target === 'object' && 'species' in target && 'hunt' in target;
