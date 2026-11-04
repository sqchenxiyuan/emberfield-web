import { APPAREL_KINDS, apparelStats, compatibleApparel } from './apparel';
import type { ApparelKind, ApparelPiece, ApparelQuality } from './types';

export interface ApparelPolicy {
  id: number;
  name: string;
  allowedKinds: ApparelKind[];
  minQuality: ApparelQuality;
  maxQuality: ApparelQuality;
  minCondition: number;
  maxCondition: number;
}
export interface ApparelPoliciesState { nextId: number; policies: ApparelPolicy[] }
export interface ApparelControl { policyId: number | null; forcedIds: number[]; nextCheckTick: number }
export const APPAREL_POLICY_LIMIT = 16;
export const APPAREL_POLICY_NAME_LIMIT = 40;
export const APPAREL_POLICY_MIN_GAIN = .05;
export type ApparelNeededWarmth = 'warm' | 'any' | 'cool';

export function createDefaultApparelPolicies(): ApparelPoliciesState {
  return { nextId: 2, policies: [{ id: 1, name: '自由穿戴', allowedKinds: [...APPAREL_KINDS],
    minQuality: 0, maxQuality: 6, minCondition: 0, maxCondition: 1 }] };
}
export function initialApparelControl(tick: number, policyId: number | null = null): ApparelControl {
  return { policyId, forcedIds: [], nextCheckTick: tick };
}
export function policyAllowsApparel(policy: ApparelPolicy, piece: ApparelPiece): boolean {
  // ThingFilter rounds the float HP ratio to hundredths with ties to even,
  // clamps it, then compares FloatRange with a 1e-5 epsilon.
  const scaled = Math.fround(Math.fround(piece.hitPoints / apparelStats(piece).maxHitPoints) * 100);
  const floor = Math.floor(scaled), fraction = scaled - floor;
  const rounded = fraction === .5 ? floor + (floor % 2) : Math.round(scaled);
  const condition = Math.min(1, Math.max(0, Math.fround(rounded / 100)));
  return policy.allowedKinds.includes(piece.kind) && piece.quality >= policy.minQuality &&
    piece.quality <= policy.maxQuality && condition >= policy.minCondition - 1e-5 && condition <= policy.maxCondition + 1e-5;
}

/** Native Human abstract minimum is 16 C. Caller supplies the seasonal
 * outdoor mean; this is not the pawn's instantaneous room temperature. */
export function neededApparelWarmth(seasonalMean: number): ApparelNeededWarmth {
  return seasonalMean < 12 ? 'warm' : seasonalMean > 20 ? 'cool' : 'any';
}
const hpScorePoints = [[0, 0], [.2, .2], [.22, .3], [.5, .3], [.52, 1]] as const;
function hpScoreFactor(condition: number): number {
  if (condition <= 0) return 0;
  for (let i = 1; i < hpScorePoints.length; i++) {
    const [x1, y1] = hpScorePoints[i - 1], [x2, y2] = hpScorePoints[i];
    if (condition <= x2) return y1 + (condition - x1) / (x2 - x1) * (y2 - y1);
  }
  return 1;
}
/** Bounded native subset for the seven implemented garments. Quality and
 * material already affect armor/insulation. Cool has no insulation-heat
 * bonus in OptimizeApparel. Ideology, DLC and personal apparel offsets are
 * deliberately absent from the current pawn model. */
export function apparelPolicyRawScore(piece: ApparelPiece, warmth: ApparelNeededWarmth): number {
  const stats = apparelStats(piece);
  const base = (.1 + stats.armorSharp + stats.armorBlunt) * hpScoreFactor(piece.hitPoints / stats.maxHitPoints);
  return warmth === 'warm' ? base * (1 + Math.min(30, Math.max(0, stats.cold)) / 30 * 7) : base;
}
export function apparelPolicyGain(piece: ApparelPiece, worn: readonly ApparelPiece[],
  forcedIds: readonly number[], warmth: ApparelNeededWarmth): number {
  const conflicting = worn.filter(old => !compatibleApparel(old, piece));
  if (conflicting.some(old => forcedIds.includes(old.id))) return -1000;
  const raw = apparelPolicyRawScore(piece, warmth);
  return conflicting.length ? raw - conflicting.reduce((sum, old) => sum + apparelPolicyRawScore(old, warmth), 0) : raw * 10;
}

/** Availability, actual reachability and body-part checks remain the world's
 * responsibility. Equal scores preserve native last-eligible-candidate order. */
export function selectApparelPolicyCandidate(policy: ApparelPolicy, worn: readonly ApparelPiece[],
  forcedIds: readonly number[], candidates: readonly ApparelPiece[], warmth: ApparelNeededWarmth): ApparelPiece | null {
  let best: ApparelPiece | null = null, bestGain = APPAREL_POLICY_MIN_GAIN;
  for (const piece of candidates) {
    if (!policyAllowsApparel(policy, piece)) continue;
    const gain = apparelPolicyGain(piece, worn, forcedIds, warmth);
    if (gain >= bestGain) { best = piece; bestGain = gain; }
  }
  return best;
}

/** Command normalization is separate from strict persisted-state validation.
 * It returns a fresh canonical list and never repairs a malformed range. */
export function normalizeApparelPolicy(raw: unknown): ApparelPolicy | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const p = raw as ApparelPolicy;
  const keys = ['id', 'name', 'allowedKinds', 'minQuality', 'maxQuality', 'minCondition', 'maxCondition'];
  if (Object.keys(p).length !== keys.length || !keys.every(k => Object.hasOwn(p, k)) ||
    !Number.isSafeInteger(p.id) || p.id <= 0 || typeof p.name !== 'string' ||
    !p.name.trim() || p.name.trim().length > APPAREL_POLICY_NAME_LIMIT || /[\u0000-\u001f\u007f]/.test(p.name) ||
    !Array.isArray(p.allowedKinds) || p.allowedKinds.some(k => !APPAREL_KINDS.includes(k)) ||
    !Number.isInteger(p.minQuality) || !Number.isInteger(p.maxQuality) || p.minQuality < 0 ||
    p.maxQuality > 6 || p.minQuality > p.maxQuality || !Number.isFinite(p.minCondition) ||
    !Number.isFinite(p.maxCondition) || p.minCondition < 0 || p.maxCondition > 1 || p.minCondition > p.maxCondition)
    return null;
  return { ...p, name: p.name.trim(), allowedKinds: APPAREL_KINDS.filter(k => p.allowedKinds.includes(k)) };
}
