import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { makeFurniturePiece } from '../src/voxel/relocation';
import { colonyWealthDetails, furnitureMarketValue } from '../src/voxel/wealth';
import { furnitureStats, type FurnitureKind } from '../src/voxel/furniture';
import { relocationV33 } from './relocation-fixtures';
import type { Cargo, Job } from '../src/voxel/types';

describe('furniture wealth follows its unique physical container', () => {
  it.each(['bed', 'table', 'chair'] as FurnitureKind[])('counts %s once through installed, ground, carried and delivered states', kind => {
    // Controlled container transitions test accounting, not player-input gameplay.
    const s = VoxelSimulation.load(relocationV33()), key = kind === 'bed' ? 'beds' : kind === 'table' ? 'tables' : 'chairs';
    const item = s[key][0], before = colonyWealthDetails(s), hp = furnitureStats(kind, item.quality).maxHitPoints * .5;
    const piece = makeFurniturePiece(kind, item, hp), cargo: Cargo = { resource: 'furniture', amount: 1, furniture: piece };
    const full = furnitureMarketValue(kind, item.quality), conditioned = furnitureMarketValue(kind, item.quality, .5);
    s[key].splice(0, 1); const empty = colonyWealthDetails(s);
    expect(before.buildings - empty.buildings).toBeCloseTo(full);
    const stack = { ...cargo, id: s.nextId++, x: item.x, y: item.y, z: item.z }; s.items.push(stack);
    const ground = colonyWealthDetails(s);
    expect(ground.items - empty.items).toBeCloseTo(conditioned); expect(ground.buildings).toBe(empty.buildings);
    expect(ground.storyteller - before.storyteller).toBeCloseTo(conditioned - full * .5);
    s.items = s.items.filter(i => i !== stack); s.pawns[0].cargo = cargo;
    const carried = colonyWealthDetails(s);
    expect(carried.total).toBeCloseTo(ground.total); expect(carried.storyteller).toBeCloseTo(ground.storyteller);
    s.pawns[0].cargo = null;
    s.jobs.push({ kind: 'install', furnitureId: piece.id, furnitureKind: kind, delivered: { furniture: 1 },
      deliveredBatches: [cargo] } as Job);
    const delivered = colonyWealthDetails(s);
    expect(delivered.total).toBeCloseTo(ground.total); expect(delivered.storyteller).toBeCloseTo(ground.storyteller);
    expect(delivered.itemSources.delivered - empty.itemSources.delivered).toBeCloseTo(conditioned);
    // The install designation itself has no additional value.
    s.jobs[s.jobs.length - 1].cancelled = true;
    expect(colonyWealthDetails(s)).toEqual(delivered);
  });
});
