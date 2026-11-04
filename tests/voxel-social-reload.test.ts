import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { socialRandom, SOCIAL_RULES } from '../src/voxel/social';
import { canSocialize } from '../src/voxel/socialWorld';

describe('social scheduling across ordinary loader work reconstruction', () => {
  it('keeps the same next interaction result when a real working pawn is temporarily restored as idle', () => {
    // Natural reproduction: public work schedules and tree-cutting designations
    // only. No pawn positions, needs, clocks, RNG or social state are injected.
    const source = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 });
    for (const pawn of source.pawns) for (let hour = 0; hour < 24; hour++)
      expect(source.command({ type: 'schedule', pawnId: pawn.id, hour, assignment: 'work' }).ok).toBe(true);
    for (const tree of source.trees.filter(t => Math.abs(t.x - source.spawn.x) + Math.abs(t.y - source.spawn.y) <= 14))
      expect(source.command({ type: 'designate', tool: 'cut', from: tree }).ok).toBe(true);
    source.step(138);
    const worker = source.pawns.find(p => p.id === 366)!;
    expect(worker.phase).toBe('work'); expect(worker.jobId).not.toBeNull();
    expect(worker.social.nextAttemptTick).toBe(139);
    expect(source.pawns.some(p => canSocialize(source, worker, p))).toBe(true);
    const draw = socialRandom(source.seed, worker.id, 139, 0);
    // This exact draw rejects Ambient Quiet but used to pass idle's Normal
    // threshold. The old loader therefore created an extra chitchat at tick139.
    expect(draw).toBeGreaterThan(1 - Math.exp(-SOCIAL_RULES.checkInterval / SOCIAL_RULES.mtbQuiet));
    expect(draw).toBeLessThan(1 - Math.exp(-SOCIAL_RULES.checkInterval / SOCIAL_RULES.mtbNormal));
    const loaded = VoxelSimulation.load(source.save());
    expect(loaded.pawns.find(p => p.id === worker.id)!.phase).toBe('idle');
    source.step(); loaded.step();
    expect(source.tick).toBe(139); expect(loaded.socialLog).toEqual(source.socialLog);
    expect(source.socialLog.some(e => e.tick === 139 && e.initiatorId === worker.id)).toBe(false);
    expect(loaded.pawns.map(p => ({ id: p.id, social: p.social }))).toEqual(source.pawns.map(p => ({ id: p.id, social: p.social })));
  });
  it('releases a publicly cancelled automatic recreation before using the next social opportunity', () => {
    const source = new VoxelSimulation(73129, { hilliness: 'flat', meanTemperature: 24, latitude: 0 });
    for (const pawn of source.pawns) for (let hour = 0; hour < 24; hour++)
      expect(source.command({ type: 'schedule', pawnId: pawn.id, hour, assignment: 'recreation' }).ok).toBe(true);
    source.step(138);
    const pawn = source.pawns.find(p => p.id === 366)!;
    expect(pawn.phase).toBe('recreation'); expect(pawn.psyche.recreation?.forced).toBe(false);
    expect(pawn.path).toEqual([]); expect(pawn.social.nextAttemptTick).toBe(139);
    expect(source.pawns.some(p => canSocialize(source, pawn, p))).toBe(true);
    const draw = socialRandom(source.seed, pawn.id, 139, 0);
    expect(draw).toBeGreaterThan(1 - Math.exp(-SOCIAL_RULES.checkInterval / SOCIAL_RULES.mtbQuiet));
    expect(draw).toBeLessThan(1 - Math.exp(-SOCIAL_RULES.checkInterval / SOCIAL_RULES.mtbNormal));
    // Schedule changes are a public command. The original activity remains
    // present until the next pawn update, while load reconciles it immediately.
    for (let hour = 0; hour < 24; hour++)
      expect(source.command({ type: 'schedule', pawnId: pawn.id, hour, assignment: 'work' }).ok).toBe(true);
    expect(pawn.phase).toBe('recreation');
    const loaded = VoxelSimulation.load(source.save());
    expect(loaded.pawns.find(p => p.id === pawn.id)!.phase).toBe('idle');
    source.step(); loaded.step();
    expect(pawn.psyche.recreation).toBeNull(); expect(loaded.socialLog).toEqual(source.socialLog);
    expect(source.socialLog.some(e => e.tick === 139 && e.initiatorId === pawn.id)).toBe(false);
    expect(loaded.pawns.map(p => ({ id: p.id, social: p.social }))).toEqual(source.pawns.map(p => ({ id: p.id, social: p.social })));
  });
});
