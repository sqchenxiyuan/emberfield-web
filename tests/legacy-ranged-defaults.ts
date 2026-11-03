import { expect } from 'vitest';
import { stripMedicineDefaults } from './legacy-medicine-defaults';
/** Older synthetic schema tests start from a current empty test world. Remove
 * only v18 defaults before applying that test's historical schema conversion.
 * Authentic historical fixture bytes never pass through this helper. */
export function stripRangedDefaults(raw: Record<string, any>) {
  stripMedicineDefaults(raw);
  for (const key of ['projectiles', 'combatEvents', 'sandbags']) {
    expect(raw[key]).toEqual([]);
    delete raw[key];
  }
  for (const key of ['Machining', 'Gunsmithing', 'BlowbackOperation']) {
    expect(raw.research.progress[key]).toBe(0);
    delete raw.research.progress[key];
  }
  for (const p of raw.pawns) {
    expect(p.shooting).toBeNull();
    expect(p.staggerUntil).toBe(0);
    expect(p.skills.shooting.xp).toBe(0);
    delete p.shooting;
    delete p.staggerUntil;
    delete p.skills.shooting;
  }
  for (const b of raw.weaponBenches) {
    expect(b.kind).not.toBe('machining');
    expect(b.power).toBeUndefined();
    expect(b.bills.find((bill: any) => bill.kind === 'shortBow')).toEqual({
      kind: 'shortBow',
      target: 0,
      paused: false,
    });
    b.bills = b.bills.filter((bill: any) => bill.kind !== 'shortBow');
  }
}
