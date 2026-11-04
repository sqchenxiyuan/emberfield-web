import { at, bedCells, DEPTH, WIDTH, type Bed, type CommandResult, type Pawn, type Pos } from './types';
import { healthSummary } from './survival';
import { learnSkill } from './skills';
import { restGain, restLoss } from './rest';
import { medicalNeedsRest } from './medicine';
import { initialPrisoner, interactionOutcome, prisonTalkSpeed, PRISON_POLICIES, PRISON_RULES,
  type PrisonerPolicy, type WardenTask } from './prisoners';

export interface PrisonHost {
  socialDepart(pawn: Pawn): void;
  tick: number;
  notice: string;
  pawns: Pawn[];
  beds: Bed[];
  prisonPath(from: Pos, to: Pos, allowed?: Set<number>): number[] | null;
  prisonApproach(pawn: Pawn, target: Pos): number[] | null;
  prisonRelease(pawn: Pawn): void;
  prisonDropCargo(pawn: Pawn): boolean;
  /** Atomically releases the target's prior activity and drops its physical gear
   * (or preserves a pending weapon drop); leaves faction/state to this module. */
  prisonBeginCapture(patient: Pawn, bed: Bed): boolean;
  prisonCells(prisoner: Pawn): Set<number> | null;
  /** Plan/recheck an in-cell food route or consume the actual reached stack.
   * Keep phase prisoner. Never mint food or consume a remote stack. */
  prisonTakeFood(prisoner: Pawn, allowed: Set<number>): boolean;
  /** Existing physical fetch/carry/feed care task, including healthy prisoners. */
  prisonFeed(warden: Pawn, prisoner: Pawn): boolean;
  prisonBecomeColonist(prisoner: Pawn): void;
  prisonExit(prisoner: Pawn): number[] | null;
}
const same = (a: Pos, b: Pos) => at(a) === at(b);
const adjacent = (a: Pos, b: Pos) => a.z === b.z && Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
const edge = (p: Pos) => p.x === 0 || p.y === 0 || p.x === WIDTH - 1 || p.y === DEPTH - 1;
function route(p: Pawn, path: number[], phase: 'warden' | 'prisoner') {
  p.path = [...path]; p.destination = path.at(-1) ?? null; p.phase = phase;
}
function stop(p: Pawn) { p.path = []; p.destination = null; }
export function canWarden(p: Pawn, tick: number): boolean {
  return p.faction === 'colony' && !p.dead && !p.downed && !p.drafted && p.carriedBy === null &&
    p.psyche.breakUntil <= tick && healthSummary(p).moving > .15;
}
function inmate(p: Pawn | undefined): p is Pawn & { prisoner: NonNullable<Pawn['prisoner']> } {
  return !!p && p.faction === 'prisoner' && !!p.prisoner && !p.dead;
}
function reserved(s: PrisonHost, patient: Pawn, wardenId?: number): boolean {
  return s.pawns.some(q => q.id !== wardenId && !q.dead &&
    (q.wardenTask?.prisonerId === patient.id || q.patientId === patient.id));
}
function bedAvailable(s: PrisonHost, b: Bed, patient: Pawn, wardenId: number): boolean {
  if (!b.prisoner || (b.owner !== null && b.owner !== patient.id)) return false;
  return !s.pawns.some(q => q.id !== patient.id && q.id !== wardenId && !q.dead &&
    (q.prisoner?.bedId === b.id || q.sleepBedId === b.id || q.careBedId === b.id ||
      q.wardenTask?.bedId === b.id || (q.carriedBy === null && bedCells(b).some(c => same(c, q)))));
}
function cellForBed(s: PrisonHost, patient: Pawn, bed: Bed): Set<number> | null {
  return s.prisonCells({ ...patient, faction: 'prisoner', prisoner: {
    ...(patient.prisoner ?? initialPrisoner(s.tick)), bedId: bed.id,
  } });
}
function captureBed(s: PrisonHost, p: Pawn, patient: Pawn, bedId?: number): Bed | undefined {
  return s.beds.filter(b => (bedId === undefined || b.id === bedId) && bedAvailable(s, b, patient, p.id))
    .map(b => ({ bed: b, cells: cellForBed(s, patient, b), path: s.prisonPath(p, b) }))
    .filter(v => v.cells?.has(at(v.bed)) && v.path !== null)
    .sort((a, b) => a.path!.length - b.path!.length || a.bed.id - b.bed.id)[0]?.bed;
}
function beginCarryTask(s: PrisonHost, p: Pawn, patient: Pawn, bedId?: number): CommandResult {
  if (!canWarden(p, s.tick) || healthSummary(p).manipulation <= 0 || p.carryingPawnId !== null)
    return { ok: false, message: '需要未征召且能够搬运的殖民者' };
  if (patient.dead || patient.carriedBy !== null || reserved(s, patient, p.id))
    return { ok: false, message: '目标已经有人照料或搬运' };
  const approach = s.prisonApproach(p, patient), bed = captureBed(s, p, patient, bedId);
  if (approach === null) return { ok: false, message: '没有靠近目标的通路' };
  if (!bed) return { ok: false, message: '需要可达、空闲且位于封闭牢房的囚犯床' };
  // Failed unload must preserve the existing job, route and reservations.
  if (!s.prisonDropCargo(p)) return { ok: false, message: '附近没有卸货空间，原任务与携带物资已保留' };
  s.prisonRelease(p);
  p.wardenTask = { prisonerId: patient.id, bedId: bed.id, stage: 'captureApproach', progress: 0 };
  route(p, approach, 'warden'); p.reason = '前往搬运' + patient.name;
  return { ok: true, message: `${p.name}正在前往${patient.name}身边` };
}
export function startCapture(s: PrisonHost, p: Pawn, patient: Pawn, bedId?: number): CommandResult {
  if (patient.faction !== 'raider' || !patient.downed || patient.dead)
    return { ok: false, message: '只能俘获仍活着的倒地袭击者' };
  return beginCarryTask(s, p, patient, bedId);
}

/** Called first by the general release method. No recursive host release. */
export function releaseWarden(s: PrisonHost, p: Pawn): void {
  const task = p.wardenTask;
  if (!task) return;
  const patient = s.pawns.find(q => q.id === task.prisonerId);
  if (patient?.carriedBy === p.id) {
    Object.assign(patient, { x: p.x, y: p.y, z: p.z }); patient.carriedBy = null;
    patient.phase = patient.dead ? 'dead' : patient.downed ? 'downed' : patient.faction === 'prisoner' ? 'prisoner' : 'combat';
    patient.reason = '搬运中断，等待照料或转移'; stop(patient);
  }
  if (p.carryingPawnId === task.prisonerId) p.carryingPawnId = null;
  p.wardenTask = null;
}
function cancel(s: PrisonHost, p: Pawn, message: string) {
  s.prisonRelease(p); p.reason = message;
}
function canTalk(p: Pawn, patient: Pawn): boolean {
  const w = healthSummary(p), q = healthSummary(patient);
  return !patient.downed && patient.carriedBy === null && patient.sleepingSince === null &&
    patient.food >= 12 && patient.rest > 1 && q.consciousness >= .3 &&
    Math.min(w.talking, w.hearing, q.talking, q.hearing) > 0;
}
function talkEligible(s: PrisonHost, p: Pawn, patient: Pawn): boolean {
  if (!inmate(patient) || patient.prisoner.releasing || !canTalk(p, patient) ||
      reserved(s, patient, p.id) || s.tick < patient.prisoner.nextInteractionTick) return false;
  const cells = s.prisonCells(patient);
  return !!cells?.has(at(patient)) && (patient.prisoner.policy === 'recruit' ||
    (patient.prisoner.policy === 'reduceResistance' && patient.prisoner.resistance > 0));
}
function beginVisit(s: PrisonHost, p: Pawn, patient: Pawn, stage: 'talkApproach' | 'releaseApproach'): boolean {
  const path = s.prisonApproach(p, patient);
  if (path === null || !s.prisonDropCargo(p)) return false;
  s.prisonRelease(p);
  p.wardenTask = { prisonerId: patient.id, bedId: null, stage, progress: 0 };
  route(p, path, 'warden'); p.reason = (stage === 'talkApproach' ? '前往交谈：' : '前往释放：') + patient.name;
  return true;
}
export function setPrisonerPolicy(s: PrisonHost, patient: Pawn, policy: PrisonerPolicy): CommandResult {
  if (!inmate(patient) || !PRISON_POLICIES.includes(policy)) return { ok: false, message: '俘虏或管理策略无效' };
  if (patient.prisoner.releasing) return { ok: false, message: '已经当面释放，正在离开地图' };
  if (patient.prisoner.policy !== policy) {
    patient.prisoner.policy = policy;
    for (const p of s.pawns) if (p.wardenTask?.prisonerId === patient.id &&
        !p.wardenTask.stage.startsWith('capture')) cancel(s, p, '俘虏管理策略已变更，重新安排');
  }
  return { ok: true, message: '已更新俘虏管理策略' };
}
/** Called only when the normal scheduler permits warden work. Captures remain
 * explicit player commands; no raid, prisoner or recruit is spawned here. */
export function tryWarden(s: PrisonHost, p: Pawn): boolean {
  if (!canWarden(p, s.tick) || p.priorities.warden <= 0 || p.wardenTask || p.carryingPawnId !== null ||
      p.food < 30 || p.rest < 20) return false;
  const patients = s.pawns.filter(inmate).filter(q => !q.prisoner.releasing && !reserved(s, q, p.id))
    .sort((a, b) => a.food - b.food || a.id - b.id);
  // Healthy hungry prisoners need the same physical meal delivery as patients.
  for (const q of patients) if (!q.downed && q.food <= 26 && s.prisonFeed(p, q)) return true;
  for (const q of patients) {
    if (q.prisoner.policy === 'release' && !q.downed && q.carriedBy === null &&
        beginVisit(s, p, q, 'releaseApproach')) return true;
    const cells = s.prisonCells(q);
    if ((!cells || !cells.has(at(q))) && q.carriedBy === null && beginCarryTask(s, p, q).ok) return true;
    if (talkEligible(s, p, q) && beginVisit(s, p, q, 'talkApproach')) return true;
  }
  return false;
}

/** Plan and advance once per world tick, BEFORE the common path movement. */
export function wardenTick(s: PrisonHost, p: Pawn): void {
  const task = p.wardenTask, q = s.pawns.find(pawn => pawn.id === task?.prisonerId);
  if (!task) return;
  if (!canWarden(p, s.tick) || p.phase !== 'warden' || !q || q.dead || p.cargo ||
      p.food < 12 || p.rest < 1 || reserved(s, q, p.id)) {
    cancel(s, p, '看守任务条件改变，重新安排'); return;
  }
  if (task.stage === 'captureApproach' || task.stage === 'captureCarry') {
    const bed = s.beds.find(b => b.id === task.bedId);
    if (!bed || !bedAvailable(s, bed, q, p.id) || !cellForBed(s, q, bed)?.has(at(bed)) ||
        healthSummary(p).manipulation <= 0 ||
        (task.stage === 'captureApproach' && (q.carriedBy !== null ||
          !((q.faction === 'raider' && q.downed) || inmate(q)))) ||
        (task.stage === 'captureCarry' && (!inmate(q) || q.carriedBy !== p.id || p.carryingPawnId !== q.id))) {
      cancel(s, p, '搬运目标、牢房或床位已改变'); return;
    }
    if (task.stage === 'captureApproach') {
      if (!adjacent(p, q)) {
        if (!p.path.length || (s.tick + p.id) % PRISON_RULES.replanTicks === 0) {
          const path = s.prisonApproach(p, q);
          if (path === null) { cancel(s, p, '无法靠近待俘获者'); return; }
          route(p, path, 'warden');
        }
        return;
      }
      const path = s.prisonPath(p, bed);
      if (path === null || !s.prisonBeginCapture(q, bed)) { cancel(s, p, '无法安全搬运目标'); return; }
      const oldBed = s.beds.find(b => b.id === q.prisoner?.bedId);
      if (oldBed?.owner === q.id) oldBed.owner = null;
      q.prisoner ??= initialPrisoner(s.tick, bed.id);
      q.prisoner.bedId = bed.id; q.faction = 'prisoner'; q.drafted = false; q.retreating = false;
      q.carriedBy = p.id; q.sleepBedId = null; q.sleepingSince = null; bed.owner = q.id;
      p.carryingPawnId = q.id; task.stage = 'captureCarry';
      Object.assign(q, { x: p.x, y: p.y, z: p.z }); stop(q);
      q.phase = q.downed ? 'downed' : 'prisoner'; q.reason = `由${p.name}搬往囚犯床`;
      route(p, path, 'warden'); p.reason = '送往囚犯床：' + q.name;
      return;
    }
    if (same(p, bed)) {
      q.carriedBy = null; p.carryingPawnId = null;
      Object.assign(q, { x: bed.x, y: bed.y, z: bed.z });
      q.phase = q.downed ? 'downed' : 'prisoner'; q.sleepBedId = bed.id;
      q.reason = '已送入牢房，等待照料';
      cancel(s, p, '已将' + q.name + '送到囚犯床'); return;
    }
    if (!p.path.length || (s.tick + p.id) % PRISON_RULES.replanTicks === 0) {
      const path = s.prisonPath(p, bed);
      if (path === null) { cancel(s, p, '囚犯床通路中断，原地放下俘虏'); return; }
      route(p, path, 'warden');
    }
    return;
  }
  if (!inmate(q) || q.prisoner.releasing || q.carriedBy !== null || q.downed ||
      (task.stage === 'releaseApproach' ? q.prisoner.policy !== 'release' : !talkEligible(s, p, q))) {
    cancel(s, p, '俘虏当前不能交谈或释放'); return;
  }
  if (!adjacent(p, q)) {
    if (task.stage === 'talk') { cancel(s, p, '交谈双方分开，稍后重新开始'); return; }
    if (!p.path.length || (s.tick + p.id) % PRISON_RULES.replanTicks === 0) {
      const path = s.prisonApproach(p, q);
      if (path === null) { cancel(s, p, '前往俘虏的通路中断'); return; }
      route(p, path, 'warden');
    }
    return;
  }
  stop(p); stop(q);
  if (task.stage === 'releaseApproach') {
    const bed = s.beds.find(b => b.id === q.prisoner!.bedId);
    if (bed?.owner === q.id) bed.owner = null;
    s.prisonRelease(q);
    q.prisoner.bedId = null; q.prisoner.releasing = true; q.prisoner.lastInteraction = `${p.name}已当面释放`;
    q.phase = 'prisoner'; q.reason = '已获释放，准备离开地图';
    cancel(s, p, '已释放' + q.name); s.notice = `${q.name}获释，正在步行离开地图`; return;
  }
  task.stage = 'talk';
  const wh = healthSummary(p), qh = healthSummary(q);
  task.progress += prisonTalkSpeed(wh.talking, wh.hearing);
  p.reason = '正在与' + q.name + '交谈'; q.reason = '正在与看守交谈';
  if (task.progress < PRISON_RULES.talkWork) return;
  const result = interactionOutcome(q.prisoner, { social: p.skills.social.level,
    talking: wh.talking, hearing: wh.hearing, inmateConsciousness: qh.consciousness,
    inmateHearing: qh.hearing, inmateTalking: qh.talking, inmatePain: qh.pain,
    food: q.food, rest: q.rest, mood: q.psyche.level });
  q.prisoner.resistance = result.resistance;
  q.prisoner.nextInteractionTick = s.tick + PRISON_RULES.interactionInterval;
  q.prisoner.lastInteraction = result.kind === 'reduce'
    ? `${p.name}交谈后抵抗降低${result.reduction.toFixed(1)}，剩余${result.resistance.toFixed(1)}`
    : result.kind === 'recruit' ? `接受${p.name}的招募` : '本次交谈未改变抵抗';
  if (result.kind !== 'none') learnSkill(p.skills.social, PRISON_RULES.socialXpPerTalk);
  if (result.kind === 'recruit') {
    const bed = s.beds.find(b => b.id === q.prisoner!.bedId);
    if (bed?.owner === q.id) bed.owner = null;
    s.prisonBecomeColonist(q); s.notice = `${q.name}接受招募，加入殖民地`;
  } else s.notice = q.prisoner.lastInteraction;
  cancel(s, p, '已完成交谈');
}

/** Prisoner needs remain physical and confined. World updates health/food once;
 * this function owns prisoner rest and path planning, never movement itself. */
export function prisonerTick(s: PrisonHost, p: Pawn): void {
  if (!inmate(p) || p.downed || p.carriedBy !== null) return;
  p.phase = 'prisoner';
  const state = p.prisoner;
  if (state.releasing) {
    p.rest = Math.max(0, p.rest - restLoss(p.rest));
    if (edge(p)) {
      for (const q of s.pawns) if (q.id !== p.id && (q.attackTargetId === p.id ||
          q.shooting?.targetId === p.id || q.wardenTask?.prisonerId === p.id || q.patientId === p.id))
        s.prisonRelease(q);
      s.socialDepart(p);
      s.pawns = s.pawns.filter(q => q.id !== p.id); s.notice = `${p.name}已离开地图`; return;
    }
    if (!p.path.length || (s.tick + p.id) % PRISON_RULES.replanTicks === 0) {
      const exit = s.prisonExit(p);
      route(p, exit ?? [], 'prisoner'); p.reason = exit?.length ? '获释后离开地图' : '离图通路受阻，等待通路';
    }
    return;
  }
  const cells = s.prisonCells(p), bed = s.beds.find(b => b.id === state.bedId && b.prisoner && b.owner === p.id);
  if (!cells?.has(at(p)) || !bed || !cells.has(at(bed))) {
    stop(p); p.sleepingSince = null; p.sleepBedId = null;
    p.rest = Math.max(0, p.rest - restLoss(p.rest)); p.reason = '没有有效的封闭牢房，等待看守转移'; return;
  }
  if (p.path.some(i => !cells.has(i))) stop(p);
  const carer = s.pawns.find(q => q.patientId === p.id);
  const visitor = s.pawns.find(q => q.wardenTask?.prisonerId === p.id);
  if (carer || visitor) {
    stop(p);
    if (p.sleepingSince !== null && same(p, bed)) p.rest = Math.min(100, p.rest + restGain(true));
    else p.rest = Math.max(0, p.rest - restLoss(p.rest));
    p.reason = carer ? '等待看守或医护照料' : visitor?.wardenTask?.stage === 'talk' ? `正在与${visitor.name}交谈` : '等待看守前来'; return;
  }
  const medicalRest = medicalNeedsRest(p);
  if (p.sleepingSince !== null && same(p, bed) && (p.rest < PRISON_RULES.wakeAt || medicalRest) && p.food >= 12) {
    stop(p); p.sleepBedId = bed.id; p.rest = Math.min(100, p.rest + restGain(true));
    p.reason = '在囚犯床休息'; return;
  }
  p.sleepingSince = null; p.sleepBedId = null;
  p.rest = Math.max(0, p.rest - restLoss(p.rest));
  if (p.food < PRISON_RULES.hungryAt && s.prisonTakeFood(p, cells)) return;
  if (p.rest < PRISON_RULES.sleepAt || medicalRest || p.food < PRISON_RULES.hungryAt) {
    if (same(p, bed)) {
      stop(p); p.sleepBedId = bed.id;
      p.sleepingSince = p.rest < PRISON_RULES.sleepAt || medicalRest ? s.tick : null;
      p.reason = p.sleepingSince !== null ? '在囚犯床休息' : '牢房内没有食物，在床边等待看守送餐'; return;
    }
    const path = s.prisonPath(p, bed, cells);
    route(p, path ?? [], 'prisoner'); p.reason = path
      ? medicalRest || p.rest < PRISON_RULES.sleepAt ? '前往囚犯床休息' : '回到囚犯床等待送餐'
      : '无法到达囚犯床'; return;
  }
  if (p.path.length) return;
  p.reason = p.food < PRISON_RULES.hungryAt ? '牢房内没有可达食物，等待看守送餐' : '在牢房内等待';
  // A bounded, deterministic in-room stroll; no autonomous jobs or combat.
  if ((s.tick + p.id) % 120 === 0) {
    const choices = [...cells].sort((a, b) => a - b);
    for (let n = 0; n < Math.min(8, choices.length); n++) {
      const cell = choices[(Math.floor(s.tick / 120) + p.id + n) % choices.length];
      const target = { x: cell % WIDTH, y: Math.floor(cell / WIDTH) % DEPTH, z: Math.floor(cell / (WIDTH * DEPTH)) };
      const path = s.prisonPath(p, target, cells);
      if (path?.length) { route(p, path, 'prisoner'); break; }
    }
  }
}
