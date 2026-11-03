/** Bounded human skills: no traits, genes, inspiration, learning aids or sight injuries.
 * Native learning and quality arithmetic is retained. Per-work-tick XP uses ×3,
 * matching this project's native-work /3 conversion; decay uses the game-day clock.
 */
export const SKILL_KEYS = [
  'mining',
  'construction',
  'plants',
  'cooking',
  'crafting',
  'medicine',
  'melee',
] as const;
export type SkillKey = (typeof SKILL_KEYS)[number];
export type Passion = 0 | 1 | 2;
export interface SkillState {
  level: number;
  xp: number;
  passion: Passion;
  dailyXp: number;
}
export type SkillSet = Record<SkillKey, SkillState>;
export const SKILL_NAMES: Record<SkillKey, string> = {
  mining: '采矿',
  construction: '建造',
  plants: '植物',
  cooking: '烹饪',
  crafting: '工艺',
  medicine: '医疗',
  melee: '格斗',
};
export const PASSION_NAMES = ['无热情', '有热情', '强烈热情'] as const;
export const PASSION_LEARNING = [0.35, 1, 1.5] as const;
export const DAILY_LEARNING_LIMIT = 4000;
export const DAILY_SATURATED_FACTOR = 0.2;
export const SKILL_DECAY_INTERVAL = 40;
const DECAY = [0.1, 0.2, 0.4, 0.6, 1, 1.8, 2.8, 4, 6, 8, 12] as const;
const QUALITY_CENTERS = [
  0.7, 1.1, 1.5, 1.8, 2, 2.2, 2.4, 2.6, 2.8, 2.95, 3.1, 3.25, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 4, 4.1,
  4.2,
] as const;
const MINING_YIELD = [
  0.6, 0.7, 0.8, 0.85, 0.9, 0.925, 0.95, 0.975, 1, 1.01, 1.02, 1.03, 1.04, 1.05, 1.06, 1.07, 1.08,
  1.09, 1.1, 1.12, 1.13,
] as const;
const PLANT_YIELD = [
  0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 0.975, 1, 1.01, 1.02, 1.03, 1.04, 1.05, 1.06, 1.07, 1.08,
  1.09, 1.1, 1.12, 1.13,
] as const;
const BUILDING_JOBS = new Set([
  'floor',
  'wall',
  'ladder',
  'remove',
  'stove',
  'bed',
  'door',
  'stonecutter',
  'tailor',
  'smithy',
  'generator',
  'solar',
  'battery',
  'heater',
  'cooler',
  'wire',
]);
const PLANT_JOBS = new Set(['sow', 'harvest', 'cut', 'plantTree']);

export function initialSkills(profile: number, raider = false): SkillSet {
  if (!Number.isSafeInteger(profile)) throw new RangeError('技能配置编号无效');
  const i = ((profile % 3) + 3) % 3;
  const levels = raider
    ? [4, 4, 4, 4, 4, 3, 6]
    : [
        [8, 6, 3, 4, 5, 3, 6],
        [3, 3, 8, 6, 4, 8, 4],
        [5, 7, 4, 3, 8, 4, 5],
      ][i];
  const passions = raider
    ? [0, 0, 0, 0, 0, 0, 0]
    : [
        [2, 1, 0, 0, 0, 0, 1],
        [0, 0, 2, 1, 0, 1, 0],
        [0, 1, 0, 0, 2, 0, 0],
      ][i];
  return Object.fromEntries(
    SKILL_KEYS.map((key, n) => [
      key,
      { level: levels[n], xp: 0, passion: passions[n] as Passion, dailyXp: 0 },
    ]),
  ) as SkillSet;
}

export function xpToNextLevel(level: number): number {
  if (!Number.isInteger(level) || level < 0 || level > 20) throw new RangeError('技能等级无效');
  return level <= 9 ? (level + 1) * 1000 : Math.min(30000, 10000 + (level - 9) * 2000);
}
export function learningRate(state: SkillState): number {
  return (
    PASSION_LEARNING[state.passion] *
    (state.dailyXp > DAILY_LEARNING_LIMIT ? DAILY_SATURATED_FACTOR : 1)
  );
}

/** Mutates one record and returns effective XP before a level-20 overflow is discarded.
 * Saturation is evaluated at event start. Negative XP is neither passion-scaled nor
 * clamped to zero; native decay subtracts it from daily XP as well.
 */
export function learnSkill(state: SkillState, rawXP: number): number {
  if (!Number.isFinite(rawXP)) throw new RangeError('经验值无效');
  if (rawXP < 0 && state.level === 0) return 0;
  const amount = rawXP > 0 ? rawXP * learningRate(state) : rawXP;
  if (![amount, state.xp + amount, state.dailyXp + amount].every(Number.isFinite))
    throw new RangeError('经验值溢出');
  state.xp += amount;
  state.dailyXp += amount;
  while (state.xp >= xpToNextLevel(state.level) && state.level < 20) {
    state.xp -= xpToNextLevel(state.level);
    state.level++;
  }
  while (state.xp <= -1000) {
    state.level--;
    if (state.level <= 0) {
      state.level = 0;
      state.xp = 0;
      break;
    }
    state.xp += xpToNextLevel(state.level);
  }
  if (state.level === 20) state.xp = Math.min(state.xp, 29999);
  return amount;
}

/** Called once per simulation tick, including while idle; never from rendering or load. */
export function tickSkills(set: SkillSet, tick: number, dayTicks: number): void {
  if (!Number.isSafeInteger(tick) || tick < 0 || !Number.isSafeInteger(dayTicks) || dayTicks <= 0)
    throw new RangeError('技能时钟无效');
  if (tick === 0) return;
  for (const key of SKILL_KEYS) {
    const state = set[key];
    if (tick % dayTicks === 0) state.dailyXp = 0;
    if (tick % SKILL_DECAY_INTERVAL === 0 && state.level >= 10)
      learnSkill(state, -DECAY[state.level - 10]);
  }
}

export function validSkills(value: unknown): value is SkillSet {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const set = value as SkillSet;
  if (
    Object.keys(set).length !== SKILL_KEYS.length ||
    !SKILL_KEYS.every((key) => Object.hasOwn(set, key))
  )
    return false;
  return SKILL_KEYS.every((key) => {
    const s = set[key];
    return (
      !!s &&
      typeof s === 'object' &&
      !Array.isArray(s) &&
      Object.keys(s).length === 4 &&
      ['level', 'xp', 'passion', 'dailyXp'].every((k) => Object.hasOwn(s, k)) &&
      Number.isInteger(s.level) &&
      s.level >= 0 &&
      s.level <= 20 &&
      Number.isInteger(s.passion) &&
      s.passion >= 0 &&
      s.passion <= 2 &&
      Number.isFinite(s.xp) &&
      s.xp > -1000 &&
      (s.level !== 0 || s.xp >= 0) &&
      s.xp < xpToNextLevel(s.level) &&
      (s.level !== 20 || s.xp <= 29999) &&
      Number.isFinite(s.dailyXp)
    );
  });
}

export function jobSkill(kind: string): SkillKey | null {
  if (kind === 'mine' || kind === 'digLadder') return 'mining';
  if (PLANT_JOBS.has(kind)) return 'plants';
  if (BUILDING_JOBS.has(kind)) return 'construction';
  if (kind === 'cook') return 'cooking';
  if (kind === 'smith' || kind === 'tailoring' || kind === 'stonecut') return 'crafting';
  if (kind === 'tend') return 'medicine';
  return null;
}
/** Raw XP per actual project work tick. Cooking is settled on successful output;
 * unfinished smithing/tailoring learn each tick. Caller handles work eligibility.
 * Cut XP additionally requires a currently yieldable plant; stonecut's native
 * workSkillLearnFactor is zero despite its Crafting workSkill.
 */
export function jobXP(kind: string): number {
  if (kind === 'stonecut' || kind === 'refuel' || kind === 'tend') return 0;
  const skill = jobSkill(kind);
  return skill === 'mining'
    ? 0.21
    : skill === 'plants'
      ? 0.255
      : skill === 'construction'
        ? 0.75
        : skill === 'cooking' || skill === 'crafting'
          ? 0.3
          : 0;
}

function curve(x: number, points: readonly (readonly [number, number])[]): number {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i - 1],
      [x2, y2] = points[i];
    if (x <= x2) return y1 + ((y2 - y1) * (x - x1)) / (x2 - x1);
  }
  return points[points.length - 1][1];
}
function capacity(manipulation: number): number {
  if (!Number.isFinite(manipulation) || manipulation < 0) throw new RangeError('操作能力无效');
  return manipulation;
}
/** Native yield stat; caller weights wasteable mineral yield by actual work done. */
export function miningYield(set: SkillSet, manipulation = 1, sight = 1): number {
  return Math.max(
    0,
    Math.min(
      1.25,
      MINING_YIELD[set.mining.level] *
        (0.7 + 0.3 * Math.min(capacity(manipulation), 1)) *
        (0.8 + 0.2 * Math.min(capacity(sight), 1)),
    ),
  );
}
/** Below one, this is a harvest-success probability for failable crops, not a
 * quantity discount. Trees do not fail. Above one, both kinds multiply yield.
 */
export function plantYield(set: SkillSet, manipulation = 1, sight = 1): number {
  return Math.max(
    0,
    Math.min(
      1.5,
      PLANT_YIELD[set.plants.level] *
        (0.7 + 0.3 * capacity(manipulation)) *
        (0.8 + 0.2 * Math.min(capacity(sight), 1)),
    ),
  );
}
export function tendSpeed(set: SkillSet, manipulation = 1): number {
  return Math.max(0.1, (0.4 + 0.06 * set.medicine.level) * capacity(manipulation));
}
/** Doctor stat before medicine potency and the tending model's random variation. */
export function tendQuality(set: SkillSet, manipulation = 1): number {
  return curve((0.2 + 0.1 * set.medicine.level) * Math.min(1.4, capacity(manipulation)), [
    [0, 0],
    [1, 1],
    [2, 1.5],
    [4, 2],
  ]);
}
/** Native human touch accuracy before opponent dodge; caller handles sleeping,
 * downed, surprise and non-pawn targets separately. */
export function meleeHitChance(set: SkillSet, manipulation = 1, sight = 1): number {
  const input =
    set.melee.level +
    12 * (Math.min(capacity(manipulation), 1.5) - 1) +
    12 * (Math.min(capacity(sight), 1.5) - 1);
  return curve(input, [
    [-20, 0.05],
    [-10, 0.1],
    [0, 0.5],
    [10, 0.8],
    [20, 0.9],
    [40, 0.96],
    [60, 0.98],
  ]);
}
export function meleeDodgeChance(set: SkillSet, moving = 1, sight = 1): number {
  const input =
    set.melee.level + 18 * (capacity(moving) - 1) + 8 * (Math.min(capacity(sight), 1.4) - 1);
  return curve(input, [
    [5, 0],
    [20, 0.3],
    [60, 0.5],
  ]);
}
/** Sight and global work speed are fixed at 1 in this model. Construction includes
 * the original job's 1.7 multiplier, after the stat's .1 floor.
 */
export function workSpeed(set: SkillSet, kind: string, manipulation = 1): number {
  const m = capacity(manipulation),
    skill = jobSkill(kind);
  if (skill === 'mining') return Math.max(0.1, (0.04 + 0.12 * set.mining.level) * m);
  if (skill === 'plants') return Math.max(0.1, (0.08 + 0.115 * set.plants.level) * m);
  if (skill === 'construction')
    return Math.max(0.1, (0.3 + 0.0875 * set.construction.level) * m) * 1.7;
  if (skill === 'cooking')
    return Math.max(
      0.1,
      curve(set.cooking.level + 16 * (Math.min(m, 1.5) - 1), [
        [-20, 0.01],
        [0, 0.4],
        [20, 1.6],
      ]),
    );
  if (kind === 'tend') return tendSpeed(set, m);
  return Math.max(0.1, m);
}

/** Native non-inspired worker quality: asymmetric Gaussian, integer truncation,
 * clamp to Awful..Masterwork, with one conditional second draw at Masterwork.
 */
export function craftedQuality(level: number, random: () => number): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  xpToNextLevel(level);
  const draw = () => {
    const n = random();
    if (!Number.isFinite(n) || n < 0 || n >= 1) throw new RangeError('品质随机值无效');
    return n;
  };
  const gaussian = (upper: number) => {
    const z =
      Math.sqrt(-2 * Math.log(Math.max(Number.MIN_VALUE, draw()))) * Math.sin(2 * Math.PI * draw());
    return Math.max(
      0,
      Math.min(5, Math.trunc(QUALITY_CENTERS[level] + z * (z <= 0 ? 0.6 : upper))),
    );
  };
  const first = gaussian(0.8);
  return (first === 5 && draw() < 0.5 ? gaussian(0.95) : first) as 0 | 1 | 2 | 3 | 4 | 5;
}
