import { describe, expect, it } from 'vitest';
import { DAY } from '../src/voxel/types';
import { LIVING_RULES, advanceLiving, impressivenessScore, impressivenessStage, initialLiving,
  livingThoughts, rememberMeal, rememberSleep, roomLivingSummary, tableCells, type RoomLivingInput } from '../src/voxel/living';

const base: RoomLivingInput = { id: 3, outdoor: false, floorCells: 40, wealth: 1500, beautyTotal: 120,
  cleanliness: 0, ordinaryBeds: 0, medicalBeds: 0, prisonerBeds: 0, tables: 1 };
const room = (changes: Partial<RoomLivingInput> = {}) => roomLivingSummary({ ...base, ...changes });

describe('living room mechanism', () => {
  it('counts actual floor usability, deduplicated beauty totals and physical table footprints', () => {
    const r = room(); expect(r.space).toBe(56); expect(r.beauty).toBe(3);
    expect(room({ passThroughCells: 2 }).space).toBeCloseTo(54.2);
    expect(room({ floorCells: 10, beautyTotal: 50 }).beauty).toBe(2);
    expect(room({ floorCells: 400 }).space).toBe(350);
    expect(tableCells({ x: 4, y: 5, z: 8, axis: 'x' })).toEqual([{ x: 4, y: 5, z: 8 }, { x: 5, y: 5, z: 8 }]);
    expect(tableCells({ x: 4, y: 5, z: 8, axis: 'y' })).toEqual([{ x: 4, y: 5, z: 8 }, { x: 4, y: 6, z: 8 }]);
  });
  it('balances all four stats, limits tiny luxury rooms and keeps cleanliness above zero neutral', () => {
    expect(impressivenessScore(1500, 3, 125, 0)).toBe(100);
    expect(impressivenessScore(1500, 3, 125, 2)).toBe(100);
    expect(impressivenessScore(0, 0, 1.4, 0)).toBeCloseTo(8.308);
    expect(impressivenessScore(1500, 3, 125, -2.5)).toBeLessThan(100);
    expect(impressivenessScore(1500, 3, 125, -10)).toBeLessThan(0);
    expect(impressivenessStage(19.999)).toBe(0); expect(impressivenessStage(20)).toBe(1);
    expect(impressivenessStage(85)).toBe(6); expect(impressivenessStage(240)).toBe(9);
  });
  it('bed uses outrank dining and outdoor air never becomes a furnished room', () => {
    expect(room().role).toBe('diningRoom'); expect(room({ ordinaryBeds: 1 }).role).toBe('bedroom');
    expect(room({ ordinaryBeds: 2 }).role).toBe('barracks'); expect(room({ medicalBeds: 1 }).role).toBe('hospital');
    expect(room({ prisonerBeds: 2 }).role).toBe('prisonBarracks');
    expect(room({ outdoor: true, ordinaryBeds: 1 })).toMatchObject({ role: 'outdoor', impressiveness: 0, stage: 0 });
    expect(() => room({ floorCells: 1, standableCells: 2 })).toThrow();
  });
});

describe('actual furniture use and persistent event thoughts', () => {
  it('comfort reaches the furniture cap then slowly falls, including while resting', () => {
    const state = initialLiving(); state.comfort = 0;
    advanceLiving(state, 500, LIVING_RULES.bedComfort, 500); expect(state.comfort).toBeCloseTo(60);
    advanceLiving(state, 1000, LIVING_RULES.bedComfort, 500); expect(state.comfort).toBe(75);
    advanceLiving(state, 1500, null, 500); expect(state.comfort).toBeCloseTo(71);
    advanceLiving(state, DAY * 2, null, DAY * 2); expect(state.comfort).toBe(0);
    expect(livingThoughts(state, DAY * 2)).toContainEqual({ label: '不太舒服', value: -3 });
    state.comfort = 60; expect(livingThoughts(state, 0)[0].value).toBe(4);
    state.comfort = 70; expect(livingThoughts(state, 0)[0].value).toBe(6);
  });
  it('remembers completed meals in any impressive room without duplicating penalties', () => {
    const state = initialLiving(), bedroom = { ...room({ ordinaryBeds: 1 }), stage: 6 };
    rememberMeal(state, bedroom, 100, false); rememberMeal(state, bedroom, 200, false);
    expect(state.memories).toHaveLength(2);
    expect(livingThoughts(state, 200).map(t => t.value)).toEqual([-3, 5]);
    rememberMeal(state, bedroom, 300, true);
    expect(state.memories.find(m => m.kind === 'ateWithoutTable')?.expires).toBe(200 + DAY);
    expect(livingThoughts(state, 200 + DAY).map(t => t.value)).toEqual([5]);
    expect(livingThoughts(state, 300 + DAY)).toEqual([]);
  });
  it('standing at a table avoids the penalty and outdoors yields no dining benefit', () => {
    const state = initialLiving(); rememberMeal(state, room({ outdoor: true }), 20, true);
    expect(state.memories).toEqual([]);
    rememberMeal(state, null, 30, false, false); expect(state.memories).toEqual([]);
  });
  it('qualified sleep replaces bedroom and barracks memories and schedules the next day', () => {
    const state = initialLiving(); rememberSleep(state, { ...room({ ordinaryBeds: 1 }), stage: 6 }, 100);
    expect(livingThoughts(state, 100)[0].value).toBe(5);
    rememberSleep(state, { ...room({ ordinaryBeds: 2 }), stage: 1 }, 200);
    expect(state.memories).toEqual([{ kind: 'barracks', stage: 1, expires: DAY + 200 }]);
    expect(state.sleepThoughtAt).toBe(DAY + 200);
    rememberSleep(state, { ...room({ ordinaryBeds: 1 }), stage: 1 }, 300);
    expect(state.memories).toEqual([]);
  });
});
