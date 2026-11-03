import { describe, expect, it } from 'vitest';
import { at, DAY, position, type Pos } from '../src/voxel/types';
import { PEN_RULES, buildPenTopology, initialAnimalPenState, initialPenFilter, penAcceptsAnimal,
  planAreaReturnPath, planRopePath, type PenMarker } from '../src/voxel/pens';

const p = (x: number, y = 10, z = 8): Pos => ({ x, y, z });
const marker = (id: number, point: Pos): PenMarker => ({ id, ...point, name: `圈地${id}`, filter: initialPenFilter() });
function linked(links: [Pos, Pos][]) {
  const graph = new Map<number, number[]>();
  for (const [a, b] of links) {
    graph.set(at(a), [...(graph.get(at(a)) ?? []), at(b)]);
    graph.set(at(b), [...(graph.get(at(b)) ?? []), at(a)]);
  }
  return (pos: Pos) => graph.get(at(pos)) ?? [];
}
const chain = (points: Pos[]) => linked(points.slice(1).map((v, i) => [points[i], v]));

describe('three dimensional physical pen connectivity', () => {
  it('finds map-edge leakage through a real slope instead of trusting the two dimensional outline', () => {
    const links: [Pos, Pos][] = [[p(3), p(2)], [p(2), p(1, 10, 9)], [p(1, 10, 9), p(0, 10, 9)]];
    const closed = buildPenTopology([marker(1, p(3))], linked(links.slice(0, 1)))[0];
    const open = buildPenTopology([marker(1, p(3))], linked(links))[0];
    expect(closed.closed).toBe(true); expect(open.closed).toBe(false);
    expect(open.cells).toContain(at(p(0, 10, 9)));
  });
  it('never uses a vertical ladder edge or a jump as an enclosure escape', () => {
    const graph = linked([[p(2), p(2, 10, 9)], [p(2, 10, 9), p(1, 10, 9)], [p(1, 10, 9), p(0, 10, 9)], [p(2), p(0)]]);
    const topology = buildPenTopology([marker(1, p(2))], graph)[0];
    expect(topology.closed).toBe(true); expect(topology.cells).toEqual([at(p(2))]);
  });
  it('reuses one component and one cells array for shared markers without repeated graph expansion', () => {
    const base = chain([p(4), p(5), p(6)]), calls = new Map<number, number>();
    const graph = (point: Pos) => { calls.set(at(point), (calls.get(at(point)) ?? 0) + 1); return base(point); };
    const result = buildPenTopology([marker(2, p(4)), marker(1, p(6)), marker(3, p(20))], graph);
    expect(result[0].cells).toBe(result[1].cells);
    expect(result[0].sharedWith).toEqual([1]); expect(result[1].sharedWith).toEqual([2]);
    expect(result[2].sharedWith).toEqual([]);
    expect([...calls.values()].every(count => count === 1)).toBe(true);
  });
  it('distinguishes a blocked marker from a small closed outdoor pen without requiring a roof', () => {
    const result = buildPenTopology([marker(1, p(4)), marker(2, p(5))], () => [], point => point.x !== 5);
    expect(result[0]).toMatchObject({ closed: true, cells: [at(p(4))] });
    expect(result[1]).toMatchObject({ closed: false, cells: [] });
    expect(buildPenTopology([marker(3, p(0))], () => [])[0].closed).toBe(false);
  });
});

describe('bounded physical pair planning', () => {
  it('pulls the animal itself into the pen instead of stopping when the handler enters', () => {
    const graph = chain([p(4), p(5), p(6), p(7), p(8)]);
    const result = planRopePath(p(4), p(5), new Set([at(p(7))]), graph);
    expect(result).toEqual([at(p(6)), at(p(7)), at(p(8))]);
    let animal = p(4), handler = p(5);
    for (const step of result!) {
      const next = position(step);
      expect(at(next)).not.toBe(at(animal)); expect(graph(handler)).toContain(step);
      expect(graph(animal)).toContain(at(handler));
      animal = handler; handler = next;
    }
    expect(at(animal)).toBe(at(p(7))); expect(at(handler)).toBe(at(p(8)));
  });
  it('cannot exchange places in a narrow corridor or cross a missing fence/gate edge', () => {
    const graph = chain([p(3), p(4), p(5), p(6)]);
    expect(planRopePath(p(4), p(5), [at(p(3))], graph)).toBeNull();
    expect(planRopePath(p(4), p(5), [at(p(6))], linked([[p(5), p(6)]]))).toBeNull();
    expect(planRopePath(p(4), p(5), [at(p(6))], linked([[p(4), p(5)]]))).toBeNull();
  });
  it('uses a physical ground slope and rejects a ladder-only route', () => {
    const graph = chain([p(4), p(5), p(6, 10, 9), p(7, 10, 9)]);
    expect(planRopePath(p(4), p(5), [at(p(6, 10, 9))], graph)).toEqual([at(p(6, 10, 9)), at(p(7, 10, 9))]);
    const ladder = chain([p(4), p(5), p(5, 10, 9), p(6, 10, 9), p(7, 10, 9)]);
    expect(planRopePath(p(4), p(5), [at(p(6, 10, 9))], ladder)).toBeNull();
  });
  it('returns no movement when the animal is already inside and never mutates endpoints', () => {
    const animal = p(4), handler = p(20), before = structuredClone({ animal, handler });
    expect(planRopePath(animal, handler, [at(animal)], () => { throw new Error('unnecessary search'); })).toEqual([]);
    expect({ animal, handler }).toEqual(before);
  });
});

describe('animal policy is distinct from physical barriers', () => {
  it('lets an outside rabbit walk through outside cells to reach its assigned area', () => {
    const area = { id: 1, name: '兔区', color: 0x44aa88, cells: [at(p(7)), at(p(8))] };
    const graph = chain([p(4), p(5), p(6), p(7), p(8)]);
    expect(planAreaReturnPath(p(4), area, graph)).toEqual([at(p(5)), at(p(6)), at(p(7))]);
    expect(planAreaReturnPath(p(7), area, graph)).toEqual([]);
    expect(planAreaReturnPath(p(4), { ...area, cells: [] }, graph)).toBeNull();
    expect(planAreaReturnPath(p(4), area, linked([[p(4), p(5)]]))).toBeNull();
  });
  it('accepts only owned deer of the allowed sex and does not impose an invented age filter', () => {
    const m = marker(1, p(4)), deer = { species: 'deer', sex: 'male', faction: 'colony', dead: false } as const;
    expect(penAcceptsAnimal(m, deer)).toBe(true);
    m.filter.male = false; expect(penAcceptsAnimal(m, deer)).toBe(false);
    expect(penAcceptsAnimal(m, { ...deer, sex: 'female' })).toBe(true);
    expect(penAcceptsAnimal(m, { ...deer, sex: 'female', faction: 'wild' })).toBe(false);
    expect(penAcceptsAnimal(m, { ...deer, sex: 'female', species: 'hare' })).toBe(false);
    expect(penAcceptsAnimal(m, { ...deer, sex: 'female', dead: true })).toBe(false);
    expect(Object.keys(m.filter).sort()).toEqual(['deer', 'female', 'male']);
  });
  it('uses an independent initial roaming clock and rejects unsafe time arithmetic', () => {
    expect(initialAnimalPenState(100)).toEqual({ allowedAreaId: null, requestedPenId: null, ropePaused: false, nextRoamTick: 100 + DAY });
    expect(PEN_RULES.roamGraceTicks).toBe(5 * DAY);
    for (const value of [-1, NaN, .5, Number.MAX_SAFE_INTEGER]) expect(() => initialAnimalPenState(value)).toThrow();
    const a = initialPenFilter(), b = initialPenFilter(); a.male = false; expect(b.male).toBe(true);
  });
});
