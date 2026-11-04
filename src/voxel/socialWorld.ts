import { type Pawn, type Pos } from './types';
import { healthSummary } from './survival';
import { learnSkill } from './skills';
import { SOCIAL_RULES as R, SOCIAL_XP, appendSocialEvent, applySocialInteraction,
  interactionWeights, opinionOf, pruneSocial, pruneSocialHistory, selectInteraction, socialRandom,
  type SocialEvent, type SocialIdentity } from './social';

export interface SocialHost {
  seed: number; tick: number; pawns: Pawn[];
  socialHistory: SocialIdentity[]; socialLog: SocialEvent[];
  socialLineOfSight(from: Pos, to: Pos): boolean;
  socialRelaxing(pawn: Pawn): boolean;
}

/** Current Web job modes: hazardous/specialist tasks block casual interaction.
 * Ordinary walking, labor and idle are Quiet. Sustained recreation/dining are
 * Normal; only an arrived, valid table recreation job is SuperActive. The
 * loader rebuilding ordinary work as idle must not increase the event chance.
 * This does not replace any job. */
export function sociallyAvailable(p: Pawn, tick: number): boolean {
  if (p.faction !== 'colony' || p.dead || p.downed || p.drafted || p.retreating ||
      p.carriedBy !== null || p.carryingPawnId !== null || p.attackTargetId !== null ||
      p.sleepingSince !== null || p.psyche.breakUntil > tick || p.carePhase !== null ||
      ['combat', 'hunt', 'mental', 'rest', 'sleepTravel', 'downed', 'dead', 'care',
        'trade', 'warden', 'prisoner', 'handle', 'rope', 'firefight'].includes(p.phase)) return false;
  return true;
}

/** Native SocialImpact, using currently implemented skill/capacity inputs.
 * No traits/ideology factors or invented compatibility rolls are added. */
export function socialImpact(p: Pawn): number {
  const h = healthSummary(p);
  const capacity = (c: number) => c < 1 ? Math.max(0, Math.min(1, c / .95)) : 1;
  return Math.max(.2, (.82 + .0275 * p.skills.social.level) *
    (.1 + .9 * capacity(h.talking)) * (.7 + .3 * capacity(h.hearing)));
}

export function canSocialize(s: SocialHost, a: Pawn, b: Pawn): boolean {
  return a.id !== b.id && sociallyAvailable(a, s.tick) && sociallyAvailable(b, s.tick) &&
    healthSummary(a).talking > 0 &&
    (a.x-b.x)**2 + (a.y-b.y)**2 + (a.z-b.z)**2 <= R.radius**2 && s.socialLineOfSight(a,b);
}

/** Persisted scheduler and keyed draws retain the random state across saves.
 * Candidate shuffling avoids a permanent preference for the lowest pawn ID. */
export function updateSocial(s: SocialHost): void {
  for (const p of s.pawns) if (!p.dead) pruneSocial(p.social,s.tick);
  for (const p of s.pawns) {
    const state = p.social;
    if (p.dead || s.tick < state.nextAttemptTick) continue;
    state.nextAttemptTick = s.tick + R.checkInterval;
    if (!sociallyAvailable(p,s.tick) || healthSummary(p).talking <= 0) { state.wantsInteract = false; continue; }
    if (state.lastInteractionTick !== null && s.tick - state.lastInteractionTick < R.randomCooldown) {
      state.nextAttemptTick = state.lastInteractionTick + R.randomCooldown;
      continue;
    }
    const mtb = s.socialRelaxing(p) ? R.mtbSocial :
      p.phase === 'recreation' || p.phase === 'dine' ? R.mtbNormal : R.mtbQuiet;
    if (mtb === R.mtbQuiet) state.wantsInteract = false;
    if (!state.wantsInteract) {
      state.wantsInteract = socialRandom(s.seed,p.id,s.tick,0) < 1 - Math.exp(-R.checkInterval/mtb);
      if (!state.wantsInteract) continue;
    }
    const candidates = s.pawns.filter(q => canSocialize(s,p,q)).map(q => ({
      pawn:q, order:socialRandom(s.seed,p.id,s.tick,q.id+1),
    })).sort((a,b) => a.order-b.order || a.pawn.id-b.pawn.id);
    const recipient = candidates[0]?.pawn;
    if (!recipient) { state.nextAttemptTick = s.tick + R.retryInterval; continue; }
    const kind = selectInteraction(interactionWeights({opinion:opinionOf(state,recipient.id,s.tick)}),
      socialRandom(s.seed,p.id,s.tick,1));
    applySocialInteraction(p,recipient,kind,s.tick,
      {initiatorImpact:socialImpact(p),recipientImpact:socialImpact(recipient)});
    state.nextAttemptTick = s.tick + R.randomCooldown;
    // Initiator gains the interaction's XP. Receiving does not double it.
    learnSkill(p.skills.social,SOCIAL_XP[kind]);
    appendSocialEvent(s.socialLog,{tick:s.tick,kind,initiatorId:p.id,recipientId:recipient.id});
  }
  pruneSocialHistory(s.socialHistory,s.pawns,s.socialLog);
}
