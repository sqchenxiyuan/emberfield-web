import { DAY } from './types';
import {
  BODY_PARTS,
  BODY_PART_LIST,
  bodyFunctions,
  DAMAGE_DEFS,
  isDescendantOrSelf,
  isPartMissing,
  partHealth,
  validBodyPart,
  roundedCapacity,
  damageHitWeight,
  type BodyPartId,
  type DamageDef,
} from './anatomy';

export type BodyRegion = BodyPartId;
export type InjuryKind = 'bruise' | 'bite' | 'cut' | 'stab' | 'crush' | 'crack';
export interface Injury {
  id: number;
  part: BodyPartId;
  kind: InjuryKind;
  severity: number;
  ageTicks: number;
  tendQuality: number | null;
}
export interface MissingPart {
  id: number;
  part: BodyPartId;
  ageTicks: number;
  isFresh: boolean;
  lastInjuryKind: InjuryKind | null;
  tendQuality: number | null;
  /** V15 irreversible losses retain their original wound records without simulated effects. */
  legacyWounds: Injury[];
}
export interface Trauma {
  wounds: Injury[];
  bloodLoss: number;
  missingParts: MissingPart[];
}
export type TraumaRecord = Injury | MissingPart;
/** Compatibility name now exposes the actual 64-part tree, not seven synthetic weights. */
export const BODY_REGIONS = BODY_PARTS;
export const INJURY_NAMES: Record<InjuryKind, string> = {
  bruise: '瘀伤',
  bite: '咬伤',
  cut: '割伤',
  stab: '刺伤',
  crush: '挤压伤',
  crack: '骨裂',
};
export const BLOOD_INTERVAL = DAY / 1000,
  HEAL_INTERVAL = DAY / 100;
export const STUMP_FRESH_TICKS = (90000 * DAY) / 60000;
const kinds: readonly InjuryKind[] = ['bruise', 'bite', 'cut', 'stab', 'crush', 'crack'];
const MAX_RECORDS = 1024,
  MAX_SEVERITY = 1000;
const clamp = (n: number, min = 0, max = 1) => Math.max(min, Math.min(max, n));
const exactKeys = (value: object, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const validId = (id: number) => Number.isSafeInteger(id) && id > 0;
const validQuality = (q: unknown) =>
  q === null || (typeof q === 'number' && Number.isFinite(q) && q >= 0 && q <= 0.7);
const validAge = (age: number, tick: number) =>
  Number.isSafeInteger(age) && age >= 0 && age <= tick;
const damageAt = (t: Pick<Trauma, 'wounds'>, part: BodyPartId) =>
  t.wounds.reduce((sum, w) => sum + (w.part === part ? w.severity : 0), 0);

/** Pure keyed sampling replaces the native RNG; no mutable hidden state to lose on save. */
function sample(seed: number, pawnId: number, tick: number, stream: number, injuryId = 0): number {
  let h = Math.imul(seed ^ pawnId, 0x45d9f3b) ^ Math.imul(tick, 0x27d4eb2d);
  h ^= Math.imul(stream ^ injuryId, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function initialTrauma(): Trauma {
  return { wounds: [], bloodLoss: 0, missingParts: [] };
}
const healthyBody = bodyFunctions(initialTrauma());
export function traumaRecords(trauma: Trauma): TraumaRecord[] {
  return [
    ...trauma.wounds,
    ...trauma.missingParts,
    ...trauma.missingParts.flatMap((m) => m.legacyWounds),
  ];
}
export function traumaIds(trauma: Trauma): number[] {
  return traumaRecords(trauma).map((r) => r.id);
}
export function injuryKindForDamagePart(damageDef: DamageDef, part: BodyPartId): InjuryKind {
  if (!DAMAGE_DEFS.includes(damageDef) || !validBodyPart(part))
    throw new RangeError('伤害类型或部位无效');
  const p = BODY_PARTS[part];
  if (p.solid) return 'crack';
  if (damageDef === 'Blunt' || damageDef === 'Poke') return p.skinCovered ? 'bruise' : 'crush';
  return damageDef === 'Cut' ? 'cut' : damageDef === 'Stab' ? 'stab' : 'bite';
}
/** Original 90000..180000 ticks mapped onto game days, based on current severity. */
export function bleedingStopsAt(wound: Pick<Injury, 'severity'>): number {
  return ((90000 + Math.round(90000 * clamp((wound.severity - 1) / 29))) * DAY) / 60000;
}
export function isFreshStump(record: MissingPart): boolean {
  const part = BODY_PARTS[record.part];
  return (
    record.isFresh && record.ageTicks < STUMP_FRESH_TICKS && part.depth === 'Outside' && !part.solid
  );
}
export function injuryBleedRate(record: TraumaRecord): number {
  if ('isFresh' in record)
    return isFreshStump(record)
      ? BODY_PARTS[record.part].hitPoints * 0.12 * BODY_PARTS[record.part].bleedRate
      : 0;
  if (record.tendQuality !== null || record.ageTicks >= bleedingStopsAt(record)) return 0;
  const rate =
    record.kind === 'bruise' || record.kind === 'crack' ? 0 : record.kind === 'crush' ? 0.01 : 0.06;
  return record.severity * rate * BODY_PARTS[record.part].bleedRate;
}
export function traumaSummary(trauma: Trauma) {
  const body =
    trauma.wounds.length || trauma.missingParts.length ? bodyFunctions(trauma) : healthyBody;
  const pain = clamp(
    trauma.wounds.reduce((n, w) => n + w.severity * (w.kind === 'crack' ? 0.01 : 0.0125), 0) +
      trauma.missingParts.reduce(
        (n, m) => n + (isFreshStump(m) ? BODY_PARTS[m.part].hitPoints * 0.0125 : 0),
        0,
      ),
  );
  const stage =
    trauma.bloodLoss >= 0.6
      ? 4
      : trauma.bloodLoss >= 0.45
        ? 3
        : trauma.bloodLoss >= 0.3
          ? 2
          : trauma.bloodLoss >= 0.15
            ? 1
            : 0;
  const consciousnessOffset = [0, -0.1, -0.2, -0.4, -0.4][stage],
    consciousnessMax = stage === 4 ? 0.1 : 1;
  let deathReason: string | null =
    partHealth(trauma, 'torso') === 0
      ? '躯干损毁致死'
      : body.consciousnessSource === 0
        ? '大脑功能丧失致死'
        : body.bloodPumping === 0
          ? '血液循环停止致死'
          : body.breathing === 0
            ? '呼吸停止致死'
            : body.bloodFiltration === 0
              ? '血液过滤功能丧失致死'
              : body.metabolism === 0
                ? '代谢功能丧失致死'
                : trauma.bloodLoss >= 1
                  ? '失血致死'
                  : trauma.wounds.reduce((n, w) => n + w.severity, 0) >= 150
                    ? '累积创伤致死'
                    : null;
  const penalty = clamp(((pain - 0.1) / 0.9) * 0.4, 0, 0.4);
  const rawConsciousness =
    (body.consciousnessSource - (penalty >= 0.01 ? penalty : 0)) *
    (0.8 + 0.2 * Math.min(1, body.bloodPumping)) *
    (0.8 + 0.2 * Math.min(1, body.breathing)) *
    (0.9 + 0.1 * Math.min(1, body.bloodFiltration));
  if (
    !deathReason &&
    roundedCapacity(
      rawConsciousness > 0
        ? Math.min(consciousnessMax, rawConsciousness + consciousnessOffset)
        : rawConsciousness,
    ) === 0
  )
    deathReason = '意识功能丧失致死';
  return {
    ...body,
    pain: deathReason ? 0 : pain,
    bleedRate: deathReason
      ? 0
      : [...trauma.wounds, ...trauma.missingParts].reduce((sum, w) => sum + injuryBleedRate(w), 0),
    consciousnessOffset,
    consciousnessMax: deathReason ? 0 : consciousnessMax,
    deathReason,
  };
}

/** Low-level precise injury insertion; caller handles damage workers/armor before this step. */
export function applyInjury(
  trauma: Trauma,
  id: number,
  part: BodyPartId,
  kind: InjuryKind,
  amount: number,
): Injury | null {
  if (
    !validId(id) ||
    traumaIds(trauma).includes(id) ||
    !validBodyPart(part) ||
    !kinds.includes(kind) ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    amount > MAX_SEVERITY ||
    traumaRecords(trauma).length >= MAX_RECORDS
  )
    throw new RangeError('伤口参数无效');
  if (traumaSummary(trauma).deathReason || isPartMissing(trauma, part)) return null;
  const wound: Injury = { id, part, kind, severity: amount, ageTicks: 0, tendQuality: null };
  trauma.wounds.push(wound);
  if (part !== 'torso' && partHealth(trauma, part) === 0) {
    const absorbed = trauma.missingParts.filter((m) => isDescendantOrSelf(m.part, part));
    const missing: MissingPart = {
      id,
      part,
      ageTicks: 0,
      isFresh: true,
      lastInjuryKind: kind,
      tendQuality: null,
      legacyWounds: absorbed.flatMap((m) => m.legacyWounds),
    };
    trauma.wounds = trauma.wounds.filter((w) => !isDescendantOrSelf(w.part, part));
    trauma.missingParts = trauma.missingParts.filter((m) => !isDescendantOrSelf(m.part, part));
    trauma.missingParts.push(missing);
  }
  return wound;
}
export interface BodyDamageContext {
  random: () => number;
  allocId: () => number;
}
export interface BodyDamageResult {
  hits: Injury[];
  totalDamage: number;
  deathReason: string | null;
}
/**
 * Adult Human ordinary melee damage workers after armor. Native structural rules,
 * project-provided random stream; no implants, instant-kill protection, scars,
 * social-fight suppression, stun or float-bit emulation. Failed random/ID input
 * cannot partly mutate trauma; allocated IDs are committed only after planning.
 */
export function applyBodyDamage(
  trauma: Trauma,
  damageDef: DamageDef,
  initialPart: BodyPartId,
  amount: number,
  context: BodyDamageContext,
): BodyDamageResult {
  if (
    !DAMAGE_DEFS.includes(damageDef) ||
    !validBodyPart(initialPart) ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    amount > MAX_SEVERITY ||
    !context ||
    typeof context.random !== 'function' ||
    typeof context.allocId !== 'function'
  )
    throw new RangeError('身体伤害参数无效');
  const empty: BodyDamageResult = {
    hits: [],
    totalDamage: 0,
    deathReason: traumaSummary(trauma).deathReason,
  };
  if (empty.deathReason || isPartMissing(trauma, initialPart)) return empty;
  const draft = structuredClone(trauma),
    hits: Injury[] = [];
  let temporaryId = Math.max(0, ...traumaIds(trauma)) + 1,
    totalDamage = 0;
  const random = () => {
    const roll = context.random();
    if (!Number.isFinite(roll) || roll < 0 || roll >= 1) throw new RangeError('伤害随机值无效');
    return roll;
  };
  const add = (part: BodyPartId, damage: number) => {
    if (damage <= 0 || isPartMissing(draft, part) || traumaSummary(draft).deathReason) return 0;
    const hp = partHealth(draft, part);
    const wound = applyInjury(
      draft,
      temporaryId++,
      part,
      injuryKindForDamagePart(damageDef, part),
      damage,
    );
    if (!wound) return 0;
    hits.push(wound);
    const dealt = Math.min(hp, damage);
    totalDamage += dealt;
    return dealt;
  };
  const weighted = (parts: BodyPartId[], useDamageFactor = true): BodyPartId | null => {
    const candidates = parts.filter((p) => !isPartMissing(draft, p) && BODY_PARTS[p].weight > 0);
    if (!candidates.length) return null;
    const factors = useDamageFactor && candidates.some((p) => damageHitWeight(p, damageDef) > 0);
    const weight = (p: BodyPartId) =>
      factors ? damageHitWeight(p, damageDef) : BODY_PARTS[p].weight;
    let value = random() * candidates.reduce((sum, p) => sum + weight(p), 0);
    for (const p of candidates) {
      value -= weight(p);
      if (value < 0) return p;
    }
    return candidates.at(-1)!;
  };
  const protectOutside = (part: BodyPartId, damage: number) => {
    if (part === 'torso' || BODY_PARTS[part].depth !== 'Outside') return damage;
    const hp = partHealth(draft, part);
    if (damage < hp) return damage;
    const overkill = (damage - hp) / BODY_PARTS[part].hitPoints;
    const probability =
      damageDef === 'Cut' || damageDef === 'Bite'
        ? clamp(overkill / 0.1)
        : clamp((overkill - 0.4) / 0.6);
    return random() < probability ? damage : Math.max(0, hp - 1);
  };
  const chainToOutside = (part: BodyPartId): BodyPartId[] => {
    const chain: BodyPartId[] = [];
    for (let p: BodyPartId | null = part; p; p = BODY_PARTS[p].parent) {
      chain.push(p);
      if (BODY_PARTS[p].depth === 'Outside') break;
    }
    return chain;
  };
  if (damageDef === 'Stab' || damageDef === 'Poke') {
    let part = initialPart;
    if (BODY_PARTS[part].depth !== 'Inside' && random() < (damageDef === 'Stab' ? 0.6 : 0.4))
      part =
        weighted(BODY_PARTS[part].children.filter((p) => BODY_PARTS[p].depth === 'Inside')) ?? part;
    const damage = protectOutside(part, amount),
      chain = chainToOutside(part);
    for (const p of chain)
      add(
        p,
        chain.length === 1 ? damage : damage * (BODY_PARTS[p].depth === 'Outside' ? 0.75 : 0.4),
      );
  } else if (damageDef === 'Blunt') {
    const innerEvent = random() < 0.4,
      converted = innerEvent ? 0.1 + random() * 0.1 : 0;
    let remaining = amount * (1 - converted),
      part = initialPart;
    while (remaining > 0) {
      remaining -= add(part, remaining);
      if (
        !isPartMissing(draft, part) ||
        remaining <= 1 ||
        !BODY_PARTS[part].parent ||
        traumaSummary(draft).deathReason
      )
        break;
      part = BODY_PARTS[part].parent!;
    }
    if (
      innerEvent &&
      !BODY_PARTS[part].solid &&
      BODY_PARTS[part].depth === 'Outside' &&
      !traumaSummary(draft).deathReason
    ) {
      const internal = weighted(
        BODY_PARTS[part].children.filter(
          (p) => BODY_PARTS[p].depth === 'Inside' && BODY_PARTS[p].solid,
        ),
        false,
      );
      if (internal) add(internal, amount * converted + amount * (0.2 + random() * 0.15));
    }
  } else if (damageDef === 'Cut') {
    if (BODY_PARTS[initialPart].depth === 'Inside') {
      const chain = chainToOutside(initialPart),
        divisor = chain.length - 1 + 0.5;
      chain.forEach((p, i) => add(p, (amount / divisor) * (i === 0 ? 0.5 : 1)));
    } else {
      const roll = random(),
        curve =
          roll < 0.6 ? roll / 0.6 : roll < 0.9 ? 1 + (roll - 0.6) / 0.3 : 2 + (roll - 0.9) / 0.1;
      const extraCount = Math.floor(curve) + (random() < curve % 1 ? 1 : 0);
      const parent = BODY_PARTS[initialPart].parent;
      const neighborhood = [
        ...new Set<BodyPartId>([
          ...BODY_PARTS[initialPart].children,
          ...(parent ? [parent] : []),
          ...(parent && BODY_PARTS[parent].parent ? BODY_PARTS[parent].children : []),
        ]),
      ].filter((p) => p !== initialPart);
      // Native samples before filtering conceptual/zero-coverage entries. Missing
      // candidates also consume a slot and are skipped by injury finalization.
      const shuffled = extraCount
        ? neighborhood.map((p) => ({ part: p, order: random() })).sort((a, b) => a.order - b.order)
        : [];
      const targets = shuffled
        .slice(0, extraCount)
        .map((p) => p.part)
        .filter((p) => !BODY_PARTS[p].conceptual && BODY_PARTS[p].weight > 0);
      targets.push(initialPart);
      let damage = (amount * 2.4) / (targets.length + 1.4);
      if (extraCount === 0) damage = protectOutside(initialPart, damage);
      targets.forEach((p) => add(p, damage));
    }
  } else {
    const damage = protectOutside(initialPart, amount);
    for (const part of chainToOutside(initialPart)) add(part, damage);
  }
  if (!hits.length) return empty;
  const taken = new Set(traumaIds(trauma)),
    replacements = new Map<number, number>();
  for (const hit of hits) {
    const id = context.allocId();
    if (!validId(id) || taken.has(id)) throw new RangeError('身体伤害ID分配无效');
    taken.add(id);
    replacements.set(hit.id, id);
  }
  // Records and returned hits may share references. Remap each object once.
  for (const record of new Set<TraumaRecord>([...traumaRecords(draft), ...hits]))
    record.id = replacements.get(record.id) ?? record.id;
  trauma.wounds = draft.wounds;
  trauma.missingParts = draft.missingParts;
  trauma.bloodLoss = draft.bloodLoss;
  return { hits, totalDamage, deathReason: traumaSummary(trauma).deathReason };
}
export interface TraumaContext {
  seed: number;
  pawnId: number;
  starving: boolean;
  resting: boolean;
  inBed: boolean;
}
/** Global intervals and keyed RNG are project scheduling choices; native daily budgets are retained. */
export function advanceTrauma(trauma: Trauma, tick: number, context: TraumaContext): void {
  if (
    (!trauma.wounds.length && !trauma.missingParts.length && trauma.bloodLoss === 0) ||
    traumaSummary(trauma).deathReason
  )
    return;
  for (const wound of trauma.wounds) wound.ageTicks++;
  for (const missing of trauma.missingParts) {
    missing.ageTicks++;
    if (missing.ageTicks >= STUMP_FRESH_TICKS) missing.isFresh = false;
  }
  if (tick % BLOOD_INTERVAL === 0) {
    const bleeding = traumaSummary(trauma).bleedRate;
    trauma.bloodLoss = clamp(trauma.bloodLoss + (bleeding >= 0.1 ? bleeding * 0.001 : -1 / 3000));
  }
  if (traumaSummary(trauma).deathReason || context.starving || tick % HEAL_INTERVAL !== 0) return;
  const natural = trauma.wounds.filter((w) => w.severity > 0).sort((a, b) => a.id - b.id);
  if (natural.length) {
    const chosen =
      natural[Math.floor(sample(context.seed, context.pawnId, tick, 1) * natural.length)];
    chosen.severity = Math.max(
      0,
      chosen.severity - (8 + (context.resting ? 4 + (context.inBed ? 4 : 0) : 0)) * 0.01,
    );
  }
  const tended = trauma.wounds
    .filter((w) => w.severity > 0 && w.tendQuality !== null)
    .sort((a, b) => a.id - b.id);
  if (tended.length) {
    const chosen =
      tended[Math.floor(sample(context.seed, context.pawnId, tick, 2) * tended.length)];
    chosen.severity = Math.max(0, chosen.severity - 8 * (0.5 + clamp(chosen.tendQuality!)) * 0.01);
  }
  trauma.wounds = trauma.wounds.filter((w) => w.severity > 1e-9);
}
export function tendableInjuries(trauma: Trauma): TraumaRecord[] {
  if (traumaSummary(trauma).deathReason) return [];
  return [
    ...trauma.wounds.filter((w) => w.tendQuality === null && w.severity > 0),
    ...trauma.missingParts.filter(isFreshStump),
  ];
}
export function needsTending(trauma: Trauma): boolean {
  return tendableInjuries(trauma).length > 0;
}
/** No medicine: one injury/stump, bleed priority then severity, no instant wound healing. */
export function tendOne(
  trauma: Trauma,
  seed: number,
  pawnId: number,
  tick: number,
  doctorQuality = 0.75,
): TraumaRecord | null {
  if (!Number.isFinite(doctorQuality) || doctorQuality < 0) throw new RangeError('护理质量无效');
  const severity = (r: TraumaRecord) =>
    'severity' in r ? r.severity : BODY_PARTS[r.part].hitPoints;
  const priority = (r: TraumaRecord) =>
    Math.max(injuryBleedRate(r) * 1.5, 'severity' in r ? 0.025 : 0);
  const record = tendableInjuries(trauma).sort(
    (a, b) => priority(b) - priority(a) || severity(b) - severity(a) || a.id - b.id,
  )[0];
  if (!record) return null;
  record.tendQuality = clamp(
    clamp(doctorQuality * 0.3, 0, 0.7) + sample(seed, pawnId, tick, 3, record.id) * 0.5 - 0.25,
    0,
    0.7,
  );
  if ('isFresh' in record) record.isFresh = false;
  return record;
}
function validWound(value: unknown, tick: number): value is Injury {
  if (
    !object(value) ||
    !exactKeys(value, ['id', 'part', 'kind', 'severity', 'ageTicks', 'tendQuality'])
  )
    return false;
  const w = value as unknown as Injury;
  return (
    validId(w.id) &&
    validBodyPart(w.part) &&
    kinds.includes(w.kind) &&
    Number.isFinite(w.severity) &&
    w.severity > 0 &&
    w.severity <= MAX_SEVERITY &&
    validAge(w.ageTicks, tick) &&
    validQuality(w.tendQuality)
  );
}
/** Strict v16 save/input boundary, including compressed missing roots and archived v15 records. */
export function validTrauma(value: unknown, tick: number): value is Trauma {
  if (
    !Number.isSafeInteger(tick) ||
    tick < 0 ||
    !object(value) ||
    !exactKeys(value, ['wounds', 'bloodLoss', 'missingParts'])
  )
    return false;
  const t = value as unknown as Trauma;
  if (
    !Number.isFinite(t.bloodLoss) ||
    t.bloodLoss < 0 ||
    t.bloodLoss > 1 ||
    !Array.isArray(t.wounds) ||
    !Array.isArray(t.missingParts) ||
    t.wounds.length > MAX_RECORDS ||
    t.missingParts.length > BODY_PART_LIST.length ||
    !t.wounds.every((w) => validWound(w, tick))
  )
    return false;
  for (const m of t.missingParts) {
    if (
      !object(m) ||
      !exactKeys(m, [
        'id',
        'part',
        'ageTicks',
        'isFresh',
        'lastInjuryKind',
        'tendQuality',
        'legacyWounds',
      ]) ||
      !validId(m.id) ||
      !validBodyPart(m.part) ||
      !BODY_PARTS[m.part].destroyableByDamage ||
      !validAge(m.ageTicks, tick) ||
      typeof m.isFresh !== 'boolean' ||
      (m.lastInjuryKind !== null && !kinds.includes(m.lastInjuryKind)) ||
      !validQuality(m.tendQuality) ||
      (m.isFresh &&
        (m.tendQuality !== null || m.ageTicks >= STUMP_FRESH_TICKS || m.lastInjuryKind === null)) ||
      (m.part === 'torso' && (m.isFresh || m.lastInjuryKind !== null || m.tendQuality !== null)) ||
      !Array.isArray(m.legacyWounds) ||
      m.legacyWounds.length > MAX_RECORDS ||
      !m.legacyWounds.every(
        (w) =>
          validWound(w, tick) &&
          legacyParts.includes(w.part as LegacyBodyRegion) &&
          legacyKinds.includes(w.kind as LegacyInjuryKind) &&
          isDescendantOrSelf(w.part, m.part),
      )
    )
      return false;
  }
  const records = traumaRecords(t),
    ids = records.map((r) => r.id);
  if (
    t.wounds.length + t.missingParts.reduce((n, m) => n + m.legacyWounds.length, 0) > MAX_RECORDS ||
    new Set(ids).size !== ids.length ||
    t.wounds.some((w) => isPartMissing(t, w.part)) ||
    t.missingParts.some((m, i) =>
      t.missingParts.some((other, j) => i !== j && isDescendantOrSelf(m.part, other.part)),
    )
  )
    return false;
  // A migrated v15 wound just below maxHP can round to zero HP without being a
  // historical loss. Preserve that reversible wound; never amputate during load.
  return BODY_PART_LIST.every(
    (p) =>
      p.id === 'torso' ||
      !p.destroyableByDamage ||
      isPartMissing(t, p.id) ||
      damageAt(t, p.id) < p.hitPoints,
  );
}

export const legacyParts = [
  'torso',
  'head',
  'neck',
  'leftArm',
  'rightArm',
  'leftLeg',
  'rightLeg',
] as const;
export type LegacyBodyRegion = (typeof legacyParts)[number];
type LegacyInjuryKind = 'bruise' | 'bite' | 'cut' | 'stab';
const legacyKinds: readonly LegacyInjuryKind[] = ['bruise', 'bite', 'cut', 'stab'];
export interface LegacyTrauma {
  wounds: Injury[];
  bloodLoss: number;
  brokenParts: LegacyBodyRegion[];
}
export function validLegacyTrauma(value: unknown, tick: number): value is LegacyTrauma {
  if (
    !Number.isSafeInteger(tick) ||
    tick < 0 ||
    !object(value) ||
    !exactKeys(value, ['wounds', 'bloodLoss', 'brokenParts'])
  )
    return false;
  const t = value as unknown as LegacyTrauma;
  if (
    !Number.isFinite(t.bloodLoss) ||
    t.bloodLoss < 0 ||
    t.bloodLoss > 1 ||
    !Array.isArray(t.wounds) ||
    t.wounds.length > MAX_RECORDS ||
    !Array.isArray(t.brokenParts) ||
    t.brokenParts.length > 7 ||
    new Set(t.brokenParts).size !== t.brokenParts.length ||
    t.brokenParts.some((p) => !legacyParts.includes(p)) ||
    !t.wounds.every(
      (w) =>
        validWound(w, tick) &&
        legacyParts.includes(w.part as LegacyBodyRegion) &&
        legacyKinds.includes(w.kind as LegacyInjuryKind),
    ) ||
    new Set(t.wounds.map((w) => w.id)).size !== t.wounds.length
  )
    return false;
  return legacyParts.every(
    (part) => damageAt(t, part) < BODY_PARTS[part].hitPoints || t.brokenParts.includes(part),
  );
}
export function migrateLegacyTrauma(value: unknown, tick: number, allocId: () => number): Trauma {
  if (!validLegacyTrauma(value, tick) || typeof allocId !== 'function')
    throw new RangeError('旧版伤病数据无效');
  const result: Trauma = {
    wounds: value.wounds.map((w) => ({ ...w })),
    bloodLoss: value.bloodLoss,
    missingParts: [],
  };
  const losses: BodyPartId[] = [...value.brokenParts];
  const roots = losses.filter(
    (part) => !losses.some((other) => other !== part && isDescendantOrSelf(part, other)),
  );
  const ids = new Set(result.wounds.map((w) => w.id));
  for (const part of roots) {
    const id = allocId();
    if (!validId(id) || ids.has(id)) throw new RangeError('旧版缺失部位ID分配无效');
    ids.add(id);
    const archived = result.wounds.filter((w) => isDescendantOrSelf(w.part, part));
    result.wounds = result.wounds.filter((w) => !isDescendantOrSelf(w.part, part));
    result.missingParts.push({
      id,
      part,
      ageTicks: 0,
      isFresh: false,
      lastInjuryKind: null,
      tendQuality: null,
      legacyWounds: archived,
    });
  }
  if (!validTrauma(result, tick)) throw new RangeError('旧版伤病迁移结果无效');
  return result;
}
