import { initialSocial, SOCIAL_MEMORY_NAMES, SOCIAL_NAMES, SOCIAL_RULES, socialReferences,
  type SocialMemoryKind } from './social';

const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v: unknown): any[] => Array.isArray(v) ? v : [];
const integer = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
const finite = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const exact = (v: unknown, keys: string[]): v is Record<string, any> =>
  record(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const factions = ['colony', 'raider', 'trader', 'prisoner'];
function fail(reason: string): never { throw new Error('社交存档无效：' + reason); }

/** Run on untouched input, before earlier migrations add today's defaults. */
export function rejectLegacySocialFields(old: Record<string, any>, sourceVersion = old.version): void {
  if (sourceVersion >= 32) return;
  if (['socialHistory', 'socialLog'].some(key => Object.hasOwn(old, key)) ||
      list(old.pawns).some(p => record(p) && (Object.hasOwn(p, 'social') ||
        Object.hasOwn(p.psyche?.tolerance ?? {}, 'social') || p.psyche?.recreation?.kind === 'social')) ||
      list(old.tables).some(t => record(t) && Object.hasOwn(t, 'gathering')))
    fail('旧版本包含新版社交、聚会或休闲字段');
}

/** Must follow migrateLiving, which creates tables for pre-v31 sources. */
export function migrateSocial(old: Record<string, any>, sourceVersion: number): void {
  if (sourceVersion >= 32) return;
  if (!integer(old.tick, 0, Number.MAX_SAFE_INTEGER - SOCIAL_RULES.checkInterval) || !Array.isArray(old.pawns) || !Array.isArray(old.tables) ||
      old.pawns.some(p => !record(p) || !integer(p.id, 1) || !record(p.psyche) || !record(p.psyche.tolerance)) ||
      old.tables.some(t => !record(t))) fail('旧人物、时钟或家具无效');
  // Validate all inputs before adding defaults; active meals and old memories
  // are preserved, including a pawn carrying food to an existing table.
  for (const p of old.pawns) {
    p.social = initialSocial(old.tick, p.id);
    p.psyche.tolerance.social = 0;
  }
  for (const table of old.tables) table.gathering = true;
  old.socialHistory = []; old.socialLog = [];
}

/** Social references cannot claim an arbitrary low global ID as a person.
 * A departed ID needs an explicit retained identity and cannot collide with
 * any present object or nested equipment ID. */
export function validateSocial(d: Record<string, any>): void {
  if (!integer(d.tick) || !integer(d.nextId, 1) || !Array.isArray(d.pawns) || d.pawns.length > SOCIAL_RULES.maxPawns ||
      !Array.isArray(d.socialHistory) || d.socialHistory.length > SOCIAL_RULES.maxHistory ||
      !Array.isArray(d.socialLog) || d.socialLog.length > SOCIAL_RULES.maxLog || !Array.isArray(d.tables))
    fail('时钟、人物或社交列表无效');
  const identity = (id: unknown) => integer(id, 1, d.nextId - 1);
  const active = new Map<number, any>();
  for (const p of d.pawns) {
    if (!record(p) || !identity(p.id) || active.has(p.id)) fail('人物身份无效或重复');
    active.set(p.id, p);
  }
  const entityIds = new Set<number>();
  const scan = (value: unknown) => {
    if (Array.isArray(value)) { for (const item of value) scan(item); }
    else if (record(value)) {
      if (identity(value.id)) entityIds.add(value.id);
      for (const child of Object.values(value)) if (typeof child === 'object') scan(child);
    }
  };
  scan(d);
  const history = new Map<number, any>();
  for (const p of d.socialHistory) {
    if (!exact(p, ['pawnId', 'name', 'faction', 'departedTick', 'dead']) || !identity(p.pawnId) ||
        active.has(p.pawnId) || entityIds.has(p.pawnId) || history.has(p.pawnId) ||
        typeof p.name !== 'string' || !p.name.trim() || p.name.length > 80 || !factions.includes(p.faction) ||
        typeof p.dead !== 'boolean' || !integer(p.departedTick, 0, d.tick)) fail('离图身份、姓名或日期无效');
    history.set(p.pawnId, p);
  }
  const person = (id: unknown, tick: number) => identity(id) && (active.has(id) ||
    (history.has(id) && history.get(id).departedTick >= tick));
  for (const p of d.pawns) {
    const state = p.social;
    if (!exact(state, ['nextAttemptTick', 'lastInteractionTick', 'wantsInteract', 'memories']) ||
        !integer(state.nextAttemptTick, 0, d.tick + SOCIAL_RULES.randomCooldown + SOCIAL_RULES.retryInterval) ||
        (state.lastInteractionTick !== null && !integer(state.lastInteractionTick, 0, d.tick)) ||
        typeof state.wantsInteract !== 'boolean' || !Array.isArray(state.memories) ||
        state.memories.length > SOCIAL_RULES.maxMemories || !record(p.psyche?.tolerance) ||
        !finite(p.psyche.tolerance.social, 0, 1)) fail('人物社交时钟、记忆或耐受字段无效');
    const groups = new Map<string, number>(), memoryKeys = new Set<string>();
    for (const m of state.memories) {
      if (!exact(m, ['kind', 'otherId', 'createdTick', m?.kind === 'chitchat' ? 'nextDecayTick' : 'expires', 'amount']) ||
          !Object.hasOwn(SOCIAL_MEMORY_NAMES, m.kind) || !integer(m.createdTick, 0, d.tick) ||
          m.otherId === p.id || !person(m.otherId, m.createdTick) ||
          state.lastInteractionTick === null || state.lastInteractionTick < m.createdTick)
        fail('记忆类型、来源人物或时刻无效');
      const kind = m.kind as SocialMemoryKind;
      const positive = kind === 'chitchat' || kind === 'deepTalk';
      const bound = kind === 'chitchat' ? SOCIAL_RULES.maxCumulativeAmount : (kind === 'insultedMood' ? 5 : 15 * SOCIAL_RULES.maxImpact);
      if (!finite(m.amount, positive ? 0 : -bound, positive ? bound : 0) || m.amount === 0)
        fail('记忆事件幅度无效');
      if (kind === 'chitchat' ?
        !integer(m.nextDecayTick, m.createdTick + SOCIAL_RULES.chitchatDecayInterval, d.tick + SOCIAL_RULES.chitchatDecayInterval) ||
          (m.nextDecayTick - m.createdTick) % SOCIAL_RULES.chitchatDecayInterval !== 0 :
        !integer(m.expires) || m.expires !== m.createdTick + (kind === 'insultedMood' ? SOCIAL_RULES.insultMoodDuration : SOCIAL_RULES.opinionDuration))
        fail('记忆期限或累计衰减时钟无效');
      if (kind === 'insultedMood' && m.amount !== -5) fail('侮辱心情不得重复缩放');
      const eventKey = kind + ':' + m.otherId + ':' + m.createdTick;
      if (memoryKeys.has(eventKey)) fail('同次互动记忆重复');
      memoryKeys.add(eventKey);
      const key = kind === 'insultedMood' ? kind : kind + ':' + m.otherId, count = (groups.get(key) ?? 0) + 1;
      if (count > (kind === 'chitchat' ? 1 : SOCIAL_RULES.sameOtherStackLimit)) fail('同对象记忆数量超限');
      groups.set(key, count);
    }
  }
  let priorTick = -1;
  const eventKeys = new Set<string>();
  for (const e of d.socialLog) {
    if (!exact(e, ['tick', 'kind', 'initiatorId', 'recipientId']) || !integer(e.tick, 0, d.tick) ||
        e.tick < priorTick || !Object.hasOwn(SOCIAL_NAMES, e.kind) || e.initiatorId === e.recipientId ||
        !person(e.initiatorId, e.tick) || !person(e.recipientId, e.tick) || eventKeys.has(e.tick + ':' + e.initiatorId))
      fail('事件顺序、重复或来源身份无效');
    eventKeys.add(e.tick + ':' + e.initiatorId); priorTick = e.tick;
  }
  const refs = socialReferences(d.pawns, d.socialLog);
  if (d.socialHistory.some((p: any) => !refs.has(p.pawnId))) fail('离图身份没有保留引用');
  if (d.tables.some((t: any) => !record(t) || typeof t.gathering !== 'boolean')) fail('餐桌聚会开关无效');
}
