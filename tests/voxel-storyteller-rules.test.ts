import { describe, expect, it } from 'vitest';
import { adaptationAfterLoss, evaluateCurve, generateIncidentCycle, growAdaptation, relaxIncidentSpacing, threatPoints, WEALTH_POINTS } from '../src/voxel/storytellerRules';

const tuning = { threatScale: 1, adaptationEffect: .9, adaptationGrowth: 1, minimumCeiling: 70 };
describe('source storyteller arithmetic and calendar boundaries', () => {
  it('separates recorded wealth, half-weight buildings and population points in the independent chapter 04 example', () => {
    const r = threatPoints({ items: 20000, buildings: 20000, pawns: 6000 }, [{ id: 1, health: 1 }, { id: 2, health: 1 }, { id: 3, health: 1 }], 0, 10, tuning, 0);
    expect(r.totalWealth).toBe(46000);
    expect(r.storytellerWealth).toBe(36000);
    expect(r.wealthPoints).toBeCloseTo(136.7875647668, 8);
    expect(r.populationPoints).toBeCloseTo(70, 8);
    expect(r.points).toBeCloseTo(118.6960621762, 8);
    const movedToBuildings = threatPoints({ items: 10000, buildings: 30000, pawns: 6000 }, [{ id: 1, health: 1 }, { id: 2, health: 1 }, { id: 3, health: 1 }], 0, 10, tuning, 0);
    expect(movedToBuildings.totalWealth).toBe(r.totalWealth);
    expect(movedToBuildings.points).toBeLessThan(r.points);
  });
  it('caps curve endpoints and retains 67.5 percent of a half-healthy colonist contribution', () => {
    expect(evaluateCurve(WEALTH_POINTS, -1)).toBe(0);
    expect(evaluateCurve(WEALTH_POINTS, 2e6)).toBe(4200);
    const r = threatPoints({ items: 0, buildings: 0, pawns: 0 }, [{ id: 9, health: .5 }], 0, 0, tuning, .8);
    expect(r.populationPoints).toBeCloseTo(10.125);
    expect(r.points).toBe(35);
    expect(threatPoints({ items: 0, buildings: 0, pawns: 0 }, [], 0, 35, tuning, 1).points).toBe(70);
  });
  it('distinguishes zero grace, negative recovery, positive difficulty growth and the actual adaptation cap', () => {
    expect(growAdaptation(0, 29.99, .5)).toBe(0);
    expect(growAdaptation(0, 30, .5)).toBe(.5);
    expect(growAdaptation(1, 30, .5)).toBe(1.25);
    expect(growAdaptation(-30, 5, .5)).toBe(-28.5);
    expect(growAdaptation(-31, 5, .5)).toBe(-28);
    expect(growAdaptation(100, 200, 1)).toBe(100);
    expect(adaptationAfterLoss(30, 'downed', 3)).toBe(24);
    expect(adaptationAfterLoss(24, 'lost', 2)).toBe(-6);
    expect(adaptationAfterLoss(-50, 'lost', 2)).toBe(-60);
  });
  it('allows a relaxed boundary hit but rejects a hit beyond the active window', () => {
    const boundary = [0, 1];
    expect(relaxIncidentSpacing(boundary, 5, -100, 5)).toBe(true);
    expect(boundary).toEqual([0, 5]);
    expect(relaxIncidentSpacing([0, 1], 6, -100, 5)).toBe(false);
  });
  it('generates bounded separated cycle hits from a supplied random stream, including an impossible-window failure', () => {
    const timing = { onDays: 4.6, offDays: 6, minimumSpacingDays: 1.9, minIncidents: 2, maxIncidents: 2 };
    expect(generateIncidentCycle(timing, 0, -9999999, () => 0)).toEqual([0, 114]);
    expect(generateIncidentCycle({ ...timing, onDays: 1 }, 0, -9999999, () => 0)).toEqual([]);
    expect(generateIncidentCycle(timing, 636, 276, () => 0)).toEqual([636, 750]);
  });
});
