import { describe, expect, it } from 'vitest';
import { VoxelSimulation } from '../src/voxel/world';
import { FIRE_MAX_HP, type FireDamage } from '../src/voxel/fire';
import { fireFuelAt } from '../src/voxel/fireWorld';
import { furnitureStats, type FurnitureKind } from '../src/voxel/furniture';
import { colonyWealthDetails, furnitureMarketValue } from '../src/voxel/wealth';
import type { ApparelQuality } from '../src/voxel/types';
import { furnitureV32 } from './furniture-fixtures';

function fixture() { return VoxelSimulation.load(furnitureV32()); }
function damageTarget(s: VoxelSimulation, kind: FurnitureKind, item: { id: number; x: number; y: number; z: number }): FireDamage {
  return fireFuelAt(s, item).find(target => target.damage?.kind === kind && target.id === item.id)!.damage!;
}

describe('quality, actual fire condition and shared furniture wealth', () => {
  it('uses actual furnishing identities and keeps fire HP independent of every quality level', () => {
    const s = fixture();
    for (const [kind, item] of [['bed', s.beds[0]], ['table', s.tables[0]], ['chair', s.chairs[0]]] as const)
      for (const quality of [0, 1, 2, 3, 4, 5, 6] as ApparelQuality[]) {
        item.quality = quality;
        const actual = damageTarget(s, kind, item);
        expect(actual.maxHitPoints).toBe(FIRE_MAX_HP[kind]); expect(actual.hitPoints).toBe(actual.maxHitPoints);
        expect(actual.maxHitPoints).toBe(furnitureStats(kind, quality).maxHitPoints);
      }
  });
  it.each(['bed', 'table', 'chair'] as const)('counts %s quality once but ignores damage for colony and storyteller wealth', kind => {
    const s = fixture(), item = (kind === 'bed' ? s.beds : kind === 'table' ? s.tables : s.chairs)[0];
    const before = colonyWealthDetails(s), normal = furnitureMarketValue(kind, item.quality);
    item.quality = 6;
    const legendary = colonyWealthDetails(s), fullValue = furnitureMarketValue(kind, 6);
    expect(legendary.buildingSources.facilities - before.buildingSources.facilities).toBeCloseTo(fullValue - normal);
    expect(legendary.storyteller - before.storyteller).toBeCloseTo((fullValue - normal) * .5);
    expect(legendary.items).toBe(before.items); expect(legendary.pawns).toBe(before.pawns);
    // Isolated damage condition fixture, not a claim about a naturally selected
    // incident. Native fire lifecycle already supplies this exact damage shape.
    const damage = damageTarget(s, kind, item); damage.hitPoints = damage.maxHitPoints * .5; s.fireDamage.push(damage);
    const damaged = colonyWealthDetails(s);
    expect(damaged).toEqual(legendary);
    // The market-value helper still supports condition for rooms and inspection.
    expect(furnitureMarketValue(kind, 6, .5)).toBeLessThan(fullValue);
  });
  it('roundtrips damage and quality independently and rejects invented quality-based maximum HP', () => {
    const s = fixture(), bed = s.beds[0]; bed.quality = 6;
    const damage = damageTarget(s, 'bed', bed); damage.hitPoints = 60; s.fireDamage.push(damage);
    const loaded = VoxelSimulation.load(s.save());
    expect(loaded.beds.find(b => b.id === bed.id)!.quality).toBe(6); expect(loaded.fireDamage).toEqual(s.fireDamage);
    const bad = s.save(); bad.fireDamage[0].maxHitPoints *= 1.6;
    expect(() => VoxelSimulation.load(bad)).toThrow(/火灾存档/);
  });
  it('repairs existing HP through the normal repair job without rerolling furniture or consuming new wood', () => {
    const s = fixture(), bed = s.beds[0], worker = s.pawns[0]; bed.quality = 6;
    const damage = damageTarget(s, 'bed', bed); damage.hitPoints -= 2; s.fireDamage.push(damage);
    for (const pawn of s.pawns) {
      for (let hour = 0; hour < 24; hour++) expect(s.command({ type: 'schedule', pawnId: pawn.id, hour, assignment: 'work' }).ok).toBe(true);
      if (pawn !== worker) expect(s.command({ type: 'priority', pawnId: pawn.id, work: 'build', value: 0 }).ok).toBe(true);
    }
    expect(s.command({ type: 'homeArea', from: bed, enabled: true }).ok).toBe(true);
    const beforeWood = s.stats.consumed.wood, quality = bed.quality;
    expect(s.command({ type: 'repair', pawnId: worker.id, damageKey: damage.key }).ok).toBe(true);
    const start = s.tick;
    while (s.fireDamage.some(d => d.key === damage.key) && s.tick - start < 1500) s.step();
    expect(s.fireDamage.some(d => d.key === damage.key)).toBe(false);
    expect(bed.quality).toBe(quality); expect(s.stats.consumed.wood).toBe(beforeWood);
    expect(VoxelSimulation.load(s.save()).beds.find(b => b.id === bed.id)!.quality).toBe(quality);
  });
});
