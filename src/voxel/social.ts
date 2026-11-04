import { DAY } from './types';

export type SocialInteractionKind = 'chitchat' | 'deepTalk' | 'insult';
export type SocialMemoryKind = 'chitchat' | 'deepTalk' | 'insulted' | 'insultedMood';
export type SocialFaction = 'colony' | 'raider' | 'trader' | 'prisoner';
interface SocialMemoryBase {
  otherId: number; createdTick: number;
  /** Actual offset at the event, after the other person's social impact. */
  amount: number;
}
export type SocialMemory = SocialMemoryBase & (
  { kind: 'chitchat'; nextDecayTick: number } |
  { kind: Exclude<SocialMemoryKind, 'chitchat'>; expires: number });
export interface SocialState {
  nextAttemptTick: number; lastInteractionTick: number | null; wantsInteract: boolean;
  memories: SocialMemory[];
}
export interface SocialIdentity {
  pawnId: number; name: string; faction: SocialFaction; departedTick: number; dead: boolean;
}
export interface SocialEvent {
  tick: number; kind: SocialInteractionKind; initiatorId: number; recipientId: number;
}
export interface SocialPerson {
  id: number; name: string; faction: SocialFaction; dead: boolean; social: SocialState;
}
export interface SocialMemoryView {
  kind: SocialMemoryKind; otherId: number; createdTick: number; amount: number; expires: number;
  label: string; effect: 'opinion' | 'mood'; value: number; remainingTicks: number;
}

/** Native intervals are converted with DAY/60000. Memory/log/identity bounds,
 * staggering, deterministic keyed draws and the visual receipt TTL are Web rules. */
export const SOCIAL_RULES = Object.freeze({
  checkInterval: DAY / 1000, retryInterval: Math.round(DAY * 91 / 60000),
  randomCooldown: DAY * 320 / 60000, absoluteCooldown: DAY * 120 / 60000,
  mtbQuiet: DAY * 22000 / 60000, mtbNormal: DAY * 6600 / 60000, mtbSocial: DAY * 550 / 60000,
  radius: 6, bubbleTicks: 40, maxPawns: 64, maxMemories: 64, maxLog: 64,
  maxHistory: 64 * 64 + 2 * 64, maxImpact: 4,
  chitchatCap: 10, sameOtherStackLimit: 10, stackMultiplier: .9,
  chitchatDecayInterval: DAY, maxCumulativeAmount: 1e9, opinionDuration: 20 * DAY, insultMoodDuration: 2 * DAY,
  opinionFadeStart: .7,
});
export const SOCIAL_NAMES: Readonly<Record<SocialInteractionKind, string>> = {
  chitchat: '闲聊', deepTalk: '深入交谈', insult: '侮辱',
};
export const SOCIAL_XP: Readonly<Record<SocialInteractionKind, number>> = {
  chitchat: 4, deepTalk: 10, insult: 0,
};
export const SOCIAL_MEMORY_NAMES: Readonly<Record<SocialMemoryKind, string>> = {
  chitchat: '闲聊', deepTalk: '深入交谈', insulted: '受到侮辱', insultedMood: '受到侮辱',
};
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const integer = (n: number, min = 0) => Number.isSafeInteger(n) && n >= min;
function validTick(tick: number): void {
  if (!integer(tick)) throw new RangeError('社交时刻必须是非负安全整数');
}

export function initialSocial(tick = 0, pawnId = 0): SocialState {
  validTick(tick);
  if (!integer(pawnId) || !integer(tick + SOCIAL_RULES.checkInterval)) throw new RangeError('社交初始身份或时刻无效');
  return { nextAttemptTick: tick + 1 + pawnId % SOCIAL_RULES.checkInterval,
    lastInteractionTick: null, wantsInteract: false, memories: [] };
}

/** Stable stream keyed by simulation time and identity; no hidden PRNG cursor. */
export function socialRandom(seed: number, pawnId: number, tick: number, stream = 0): number {
  validTick(tick);
  if (!Number.isSafeInteger(seed) || !integer(pawnId) || !integer(stream)) throw new RangeError('社交随机参数无效');
  let h = (seed ^ Math.imul(pawnId, 0x9e3779b9) ^ Math.imul(tick, 0x85ebca6b) ^ Math.imul(stream + 1, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ h >>> 16, 0x7feb352d); h = Math.imul(h ^ h >>> 15, 0x846ca68b);
  return ((h ^ h >>> 16) >>> 0) / 0x100000000;
}

/** Histories contain departed people only. On-map identities always win. */
export function resolveSocialIdentity(pawnId: number, pawns: readonly SocialPerson[], history: readonly SocialIdentity[]):
  { pawnId: number; name: string; faction: SocialFaction; dead: boolean; departed: boolean } | null {
  const active = pawns.find(p => p.id === pawnId);
  if (active) return { pawnId, name: active.name, faction: active.faction, dead: active.dead, departed: false };
  const old = history.find(p => p.pawnId === pawnId);
  return old ? { pawnId, name: old.name, faction: old.faction, dead: old.dead, departed: true } : null;
}

export function socialReferences(pawns: readonly Pick<SocialPerson, 'social'>[], events: readonly SocialEvent[]): Set<number> {
  const refs = new Set<number>();
  for (const p of pawns) for (const memory of p.social.memories) refs.add(memory.otherId);
  for (const event of events) { refs.add(event.initiatorId); refs.add(event.recipientId); }
  return refs;
}

/** Call immediately before removing this pawn. Its own memories disappear with
 * it; references owned by surviving pawns or retained events keep the identity. */
export function rememberDeparture(history: SocialIdentity[], pawn: SocialPerson, tick: number,
  pawns: readonly SocialPerson[], events: readonly SocialEvent[]): void {
  validTick(tick);
  const remaining = pawns.filter(p => p.id !== pawn.id);
  if (socialReferences(remaining, events).has(pawn.id)) {
    const entry: SocialIdentity = { pawnId: pawn.id, name: pawn.name, faction: pawn.faction, departedTick: tick, dead: pawn.dead };
    const old = history.findIndex(p => p.pawnId === pawn.id);
    if (old >= 0) history[old] = entry;
    else history.push(entry);
  }
  // Even an unreferenced departing pawn may own the final reference to an
  // earlier departure. Reconcile now so a save in this same tick is loadable.
  pruneSocialHistory(history, remaining, events);
}

/** Never evict a referenced identity to make space. The bound follows from the
 * maximum owners, their memory capacities and the bounded interaction log. */
export function pruneSocialHistory(history: SocialIdentity[], pawns: readonly SocialPerson[], events: readonly SocialEvent[]): void {
  const refs = socialReferences(pawns, events), active = new Set(pawns.map(p => p.id));
  const kept = history.filter(p => refs.has(p.pawnId) && !active.has(p.pawnId));
  if (kept.length > SOCIAL_RULES.maxHistory) throw new RangeError('社交历史超过引用上界');
  history.splice(0, history.length, ...kept);
}

export function appendSocialEvent(events: SocialEvent[], event: SocialEvent): void {
  validTick(event.tick);
  if (!Object.hasOwn(SOCIAL_NAMES, event.kind) || !integer(event.initiatorId, 1) || !integer(event.recipientId, 1) ||
      event.initiatorId === event.recipientId || (events.length && events[events.length - 1].tick > event.tick) ||
      events.some(e => e.tick === event.tick && e.initiatorId === event.initiatorId)) throw new RangeError('社交事件身份或时序无效');
  events.push({ ...event });
  if (events.length > SOCIAL_RULES.maxLog) events.splice(0, events.length - SOCIAL_RULES.maxLog);
}

/** Cumulative chitchat does not refresh its age when another event is added.
 * Its raw total may exceed the displayed +10; every game day removes one point. */
function currentChitchat(memory: Extract<SocialMemory, { kind: 'chitchat' }>, tick: number) {
  const decays = tick < memory.nextDecayTick ? 0 : 1 + Math.floor((tick - memory.nextDecayTick) / SOCIAL_RULES.chitchatDecayInterval);
  return { amount: Math.max(0, memory.amount - decays), nextDecayTick: memory.nextDecayTick + decays * SOCIAL_RULES.chitchatDecayInterval };
}
export function pruneSocial(state: SocialState, tick: number): void {
  validTick(tick);
  state.memories = state.memories.filter(memory => {
    if (memory.kind !== 'chitchat') return memory.expires > tick;
    const current = currentChitchat(memory, tick);
    memory.amount = current.amount; memory.nextDecayTick = current.nextDecayTick;
    return memory.amount > 0;
  });
}

/** Read-only, current contributions. Native social groups round only after
 * summation; use opinionOf/opinionBreakdown for the authoritative integer total. */
export function socialMemoryView(state: SocialState, tick: number, otherId?: number): SocialMemoryView[] {
  validTick(tick);
  const views: SocialMemoryView[] = [];
  for (const memory of state.memories) {
    let value: number, expires: number;
    if (memory.kind === 'chitchat') {
      const current = currentChitchat(memory, tick);
      if (current.amount <= 0) continue;
      value = Math.min(current.amount, SOCIAL_RULES.chitchatCap);
      expires = current.nextDecayTick + (Math.ceil(current.amount) - 1) * SOCIAL_RULES.chitchatDecayInterval;
    } else {
      expires = memory.expires;
      if (expires <= tick) continue;
      const age = (tick - memory.createdTick) / (expires - memory.createdTick);
      value = memory.amount * (memory.kind === 'insultedMood' ? 1 : clamp((1 - age) / (1 - SOCIAL_RULES.opinionFadeStart), 0, 1));
    }
    if (!value) continue;
    views.push({ kind: memory.kind, otherId: memory.otherId, createdTick: memory.createdTick, amount: memory.amount,
      expires, label: SOCIAL_MEMORY_NAMES[memory.kind], effect: memory.kind === 'insultedMood' ? 'mood' : 'opinion',
      value, remainingTicks: Math.max(0, expires - tick) });
  }
  views.sort((a, b) => b.createdTick - a.createdTick);
  const groups = new Map<string, number>();
  for (const view of views) {
    // InsultedMood has a fixed label, so all perpetrators share one mood group.
    const key = view.kind === 'insultedMood' ? view.kind : view.kind + ':' + view.otherId;
    const count = groups.get(key) ?? 0;
    view.value *= view.kind === 'chitchat' ? 1 : SOCIAL_RULES.stackMultiplier ** count;
    groups.set(key, count + 1);
  }
  return views.filter(view => otherId === undefined || view.otherId === otherId);
}

/** Mathf.RoundToInt uses nearest even at an exact half, unlike Math.round. */
function roundEven(n: number): number {
  const floor = Math.floor(n), part = n - floor;
  return part === .5 ? (floor % 2 ? floor + 1 : floor) : Math.round(n);
}
export function opinionBreakdown(state: SocialState, otherId: number, tick: number):
  { kind: Exclude<SocialMemoryKind, 'insultedMood'>; label: string; value: number; count: number }[] {
  const groups = new Map<Exclude<SocialMemoryKind, 'insultedMood'>, { value: number; count: number }>();
  for (const m of socialMemoryView(state, tick, otherId)) if (m.kind !== 'insultedMood') {
    const old = groups.get(m.kind) ?? { value: 0, count: 0 };
    old.value += m.value; old.count++; groups.set(m.kind, old);
  }
  return [...groups].map(([kind, group]) => ({ kind, label: SOCIAL_MEMORY_NAMES[kind], count: group.count,
    value: group.value > 0 ? Math.max(1, roundEven(group.value)) : Math.min(-1, roundEven(group.value)) }));
}
export function opinionOf(state: SocialState, otherId: number, tick: number): number {
  return clamp(opinionBreakdown(state, otherId, tick).reduce((sum, g) => sum + g.value, 0), -100, 100);
}
export function socialThoughts(state: SocialState, tick: number): { otherId: number; label: string; value: number }[] {
  return socialMemoryView(state, tick).filter(m => m.effect === 'mood').map(m => ({ otherId: m.otherId, label: m.label, value: m.value }));
}

function removeOldest(state: SocialState, predicate: (m: SocialMemory) => boolean): void {
  let oldest = -1;
  for (let i = 0; i < state.memories.length; i++) if (predicate(state.memories[i]) &&
      (oldest < 0 || state.memories[i].createdTick < state.memories[oldest].createdTick)) oldest = i;
  if (oldest >= 0) state.memories.splice(oldest, 1);
}
function gainMemory(state: SocialState, kind: SocialMemoryKind, otherId: number, tick: number, amount: number): void {
  if (!amount) return;
  if (kind === 'chitchat') {
    const old = state.memories.find((m): m is Extract<SocialMemory, { kind: 'chitchat' }> => m.kind === kind && m.otherId === otherId);
    if (old) { old.amount = Math.min(SOCIAL_RULES.maxCumulativeAmount, old.amount + amount); return; }
    state.memories.push({ kind, otherId, createdTick: tick, nextDecayTick: tick + SOCIAL_RULES.chitchatDecayInterval, amount });
  } else {
    const sameGroup = (m: SocialMemory) => m.kind === kind && (kind === 'insultedMood' || m.otherId === otherId);
    if (state.memories.filter(sameGroup).length >= SOCIAL_RULES.sameOtherStackLimit) removeOldest(state, sameGroup);
    state.memories.push({ kind, otherId, createdTick: tick,
      expires: tick + (kind === 'insultedMood' ? SOCIAL_RULES.insultMoodDuration : SOCIAL_RULES.opinionDuration), amount });
  }
  while (state.memories.length > SOCIAL_RULES.maxMemories) removeOldest(state, () => true);
}

/** Eligibility/LOS, scheduling and SocialImpact calculation belong to world.
 * Positive talk adds opinions only. Native chained insult mood does not inherit
 * the initiator's impact. At the Web mood cap we retain the actual latest source
 * instead of renewing an older memory that names a different perpetrator. */
export function applySocialInteraction(initiator: Pick<SocialPerson, 'id' | 'social'>,
  recipient: Pick<SocialPerson, 'id' | 'social'>, kind: SocialInteractionKind, tick: number,
  impact: { initiatorImpact: number; recipientImpact: number } = { initiatorImpact: 1, recipientImpact: 1 }): void {
  validTick(tick);
  if (!Object.hasOwn(SOCIAL_NAMES, kind) || !integer(initiator.id, 1) || !integer(recipient.id, 1) || initiator.id === recipient.id ||
      !integer(tick + SOCIAL_RULES.opinionDuration) ||
      [impact.initiatorImpact, impact.recipientImpact].some(value => !Number.isFinite(value) || value < 0 || value > SOCIAL_RULES.maxImpact))
    throw new RangeError('互动身份、种类或影响幅度无效');
  for (const p of [initiator, recipient]) {
    if (p.social.lastInteractionTick !== null && p.social.lastInteractionTick > tick) throw new RangeError('社交时钟不能倒退');
  }
  pruneSocial(initiator.social, tick); pruneSocial(recipient.social, tick);
  if (kind === 'insult') {
    gainMemory(recipient.social, 'insulted', initiator.id, tick, -15 * impact.initiatorImpact);
    gainMemory(recipient.social, 'insultedMood', initiator.id, tick, -5);
  } else {
    const amount = kind === 'chitchat' ? .66 : 15;
    gainMemory(initiator.social, kind, recipient.id, tick, amount * impact.recipientImpact);
    gainMemory(recipient.social, kind, initiator.id, tick, amount * impact.initiatorImpact);
  }
  for (const p of [initiator, recipient]) { p.social.lastInteractionTick = tick; p.social.wantsInteract = false; }
}

export type SocialWeights = Record<SocialInteractionKind, number>;
function curve(points: readonly (readonly [number, number])[], value: number): number {
  if (value <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) if (value <= points[i][0]) {
    const [x0, y0] = points[i - 1], [x1, y1] = points[i];
    return y0 + (y1 - y0) * (value - x0) / (x1 - x0);
  }
  return points[points.length - 1][1];
}
/** Native base-game weights. Mood is not a direct input. Traits/slavery are not
 * in this slice; caller supplies the pair compatibility (neutral 0 by default). */
export function interactionWeights({ opinion, compatibility = 0 }: { opinion: number; compatibility?: number }): SocialWeights {
  if (!Number.isFinite(opinion) || !Number.isFinite(compatibility)) throw new RangeError('社交意见或相容性无效');
  const deep = curve([[-1.5, 0], [-.5, .1], [.5, 1], [1, 1.8], [2, 3]], compatibility);
  const dislike = curve([[-100, 6], [-50, 4], [-25, 2], [0, 1], [50, .1], [100, 0]], opinion);
  const friction = curve([[-2.5, 4], [-1.5, 3], [-.5, 2], [.5, 1], [1, .75], [2, .5], [3, .4]], compatibility);
  return { chitchat: 1, deepTalk: .075 * deep, insult: .007 * dislike * friction };
}
export function selectInteraction(weights: SocialWeights, draw: number): SocialInteractionKind {
  const kinds: SocialInteractionKind[] = ['chitchat', 'deepTalk', 'insult'];
  if (!Number.isFinite(draw) || draw < 0 || draw >= 1 || kinds.some(k => !Number.isFinite(weights[k]) || weights[k] < 0))
    throw new RangeError('社交抽取权重无效');
  const sum = kinds.reduce((total, kind) => total + weights[kind], 0);
  if (!Number.isFinite(sum) || sum <= 0) throw new RangeError('社交抽取总权重无效');
  let cursor = draw * sum;
  for (const kind of kinds) { cursor -= weights[kind]; if (cursor < 0) return kind; }
  return kinds[kinds.length - 1];
}
