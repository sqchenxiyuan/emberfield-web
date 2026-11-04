import { describe, expect, it } from 'vitest';
import { cellSpaceAfterReservations, planCellInsertion, simulateCellInsert } from '../src/voxel/logistics';
import { freshBatch } from '../src/voxel/preservation';
import { makeWeapon } from '../src/voxel/weapons';
import type { Cargo } from '../src/voxel/types';

describe('physical cell slots and speculative reservations', () => {
  it('keeps three mixed stacks distinct; a full cell can only top up a compatible batch', () => {
    const existing = [freshBatch('grain', 70, 'rice'), freshBatch('wood', 75), freshBatch('grain', 3, 'corn')];
    const before = structuredClone(existing);
    expect(planCellInsertion(existing, freshBatch('steel', 1), 3).accepted).toBe(0);
    expect(planCellInsertion(existing, freshBatch('grain', 80, 'rice'), 3)).toEqual({
      accepted: 5, merges: [{ index: 0, amount: 5 }], additions: [],
    });
    expect(planCellInsertion(existing, freshBatch('grain', 80, 'corn'), 3).accepted).toBe(72);
    expect(existing).toEqual(before);
  });

  it('splits across slots without enlarging stacks and weights only the transferred food', () => {
    const existing = [{ ...freshBatch('meal', 8), id: 12, rotProgress: 100, poisonChance: .2 }];
    const incoming = { ...freshBatch('meal', 25), rotProgress: 500, poisonChance: .8 };
    const before = structuredClone({ existing, incoming });
    const result = simulateCellInsert(existing, incoming, 3);
    expect(result.accepted).toBe(22);
    expect(result.stacks).toEqual([{ resource: 'meal', amount: 10, id: 12, rotProgress: 180, poisonChance: .32 }]);
    expect(result.additions).toEqual([10, 10].map(amount => ({ ...incoming, amount })));
    expect({ existing, incoming }).toEqual(before);
    expect(simulateCellInsert(existing, incoming, 1).accepted).toBe(2);
  });

  it('replays shared partial stacks and mixed reservations before admitting another type', () => {
    const existing = [freshBatch('grain', 70, 'rice')];
    const reserved = [freshBatch('grain', 70, 'rice'), freshBatch('grain', 75, 'corn')];
    expect(cellSpaceAfterReservations(existing, reserved, { resource: 'grain', crop: 'rice' }, 3)).toBe(10);
    expect(cellSpaceAfterReservations(existing, reserved, { resource: 'steel' }, 3)).toBe(0);
    expect(cellSpaceAfterReservations([], [freshBatch('steel', 40), freshBatch('steel', 40)], { resource: 'wood' }, 3)).toBe(75);
    expect(cellSpaceAfterReservations([], [freshBatch('steel', 40), freshBatch('steel', 40)], { resource: 'steel' }, 3)).toBe(145);
    expect(cellSpaceAfterReservations([], reserved, { resource: 'steel' }, 1)).toBe(0);
  });

  it('places individual equipment in separate slots, preserves identity, and never merges it', () => {
    const first: Cargo = { resource: 'weapon', amount: 1, weapon: makeWeapon(51, 'steelKnife'), forbidden: true };
    const second: Cargo = { resource: 'weapon', amount: 1, weapon: makeWeapon(52, 'steelKnife') };
    const result = simulateCellInsert([first], second, 3);
    expect(result.stacks).toEqual([first]);
    expect(result.additions).toEqual([second]);
    expect(result.additions[0].weapon).not.toBe(second.weapon);
    expect(cellSpaceAfterReservations([first], [second], { resource: 'weapon' }, 3)).toBe(1);
    expect(simulateCellInsert([first], second, 1).accepted).toBe(0);
  });

  it('counts unsupported existing cargo as occupied and permits no new slots during overflow', () => {
    const existing = [freshBatch('chunk', 1), freshBatch('wood', 70), freshBatch('steel', 75)];
    expect(planCellInsertion(existing, freshBatch('meal', 1), 1).accepted).toBe(0);
    expect(planCellInsertion(existing, freshBatch('wood', 20), 1).accepted).toBe(5);
    expect(existing.map(x => x.amount)).toEqual([1, 70, 75]);
  });
});
