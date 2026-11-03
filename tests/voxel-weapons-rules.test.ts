import { describe, expect, it } from 'vitest';
import { applyInjury, initialTrauma } from '../src/voxel/injuries';
import {
  makeWeapon,
  validWeapon,
  weaponStats,
  weaponName,
  weaponWork,
  weaponAttacks,
  meleeOptions,
  selectMeleeAttack,
  meleeBodyFromTrauma,
  WEAPON_DEFS,
  WEAPON_DROP_TICKS,
  type WeaponKind,
  type WeaponQuality,
} from '../src/voxel/weapons';

const distribution = (kind: WeaponKind | null, quality: WeaponQuality = 2) =>
  Object.fromEntries(
    meleeOptions(kind ? makeWeapon(7, kind, quality) : null).map((o) => [o.id, o.probability]),
  );

describe('physical melee weapon rules from the bounded native evidence', () => {
  it('keeps three materially distinct recipes, bench speed and original longsword requirements', () => {
    expect(WEAPON_DEFS.woodClub.cost).toEqual({ wood: 40 });
    expect(WEAPON_DEFS.steelKnife.cost).toEqual({ steel: 30 });
    expect(WEAPON_DEFS.steelLongsword.cost).toEqual({ steel: 100 });
    // 1200 native work * wood .7 / crafting spot .5 / 60 = 28 real seconds.
    expect(weaponWork('woodClub', 'craftingSpot')).toBe(560);
    expect(weaponWork('woodClub', 'smithy')).toBe(280);
    expect(weaponWork('steelKnife', 'craftingSpot')).toBe(1200);
    expect(weaponWork('steelKnife', 'smithy')).toBe(600);
    expect(weaponWork('steelLongsword', 'smithy')).toBe(6000);
    expect(WEAPON_DEFS.steelLongsword.sourceWork).toBe(18000);
    expect(WEAPON_DEFS.steelLongsword.sourceResearch).toBe('LongBlades');
    expect(WEAPON_DEFS.steelLongsword.sourceCraftingLevel).toBe(5);
    expect(() => weaponWork('steelLongsword', 'craftingSpot')).toThrow();
    expect(WEAPON_DROP_TICKS).toBe(10);
  });

  it('preserves identity and material HP; club has no rolled quality, weapons have no wear clock', () => {
    const club = makeWeapon(10, 'woodClub');
    expect(club).toEqual({ id: 10, kind: 'woodClub', quality: 2, hitPoints: 65 });
    expect(weaponName(club)).toBe('木棒');
    expect(weaponStats(club).qualityName).toBeNull();
    expect(() => makeWeapon(11, 'woodClub', 6)).toThrow();
    for (const quality of [0, 1, 2, 3, 4, 5, 6] as const) {
      const knife = makeWeapon(11, 'steelKnife', quality);
      expect(knife.hitPoints).toBe(100);
      expect(weaponStats(knife).maxHitPoints).toBe(100);
      expect(validWeapon(knife)).toBe(true);
      expect(Object.keys(knife)).toEqual(['id', 'kind', 'quality', 'hitPoints']);
    }
    expect(weaponName(makeWeapon(12, 'steelLongsword', 6))).toBe('钢长剑（传奇）');
    const first = makeWeapon(13, 'steelKnife'),
      second = makeWeapon(14, 'steelKnife');
    first.hitPoints = 1;
    expect(second.hitPoints).toBe(100);
    expect(weaponAttacks(first)).toEqual(weaponAttacks(second));
  });

  it('applies wood blunt material power and preserves the Poke source damage definition', () => {
    const attacks = weaponAttacks(makeWeapon(1, 'woodClub'));
    expect(attacks.map((a) => a.damage)).toEqual([8.1, 12.6]);
    expect(attacks.map((a) => a.cooldown)).toEqual([40, 40]);
    expect(attacks[0].damageDef).toBe('Poke');
    expect(attacks[0].kind).toBe('bruise'); // Coarse external skin mapping, not internal Stab propagation.
    expect(attacks[0].armorPenetration).toBeCloseTo(0.1215);
    expect(attacks[1].armorPenetration).toBeCloseTo(0.189);
  });

  it('uses weapon-specific quality factors and derives AP before hit damage randomization', () => {
    const normal = weaponAttacks(makeWeapon(1, 'steelKnife'));
    expect(normal.map((a) => [a.damage, a.cooldown])).toEqual([
      [9, 40],
      [12, 30],
      [13, 40],
    ]);
    expect(normal.map((a) => a.kind)).toEqual(['bruise', 'cut', 'stab']);
    expect(normal[1].armorPenetration).toBeCloseTo(0.18);
    const master = weaponAttacks(makeWeapon(1, 'steelKnife', 5));
    expect(master[1].damage).toBeCloseTo(17.4); // 12 * 1.45, not apparel's 1.5.
    expect(master[1].armorPenetration).toBeCloseTo(0.261);
    const legendary = weaponAttacks(makeWeapon(2, 'steelLongsword', 6));
    expect(legendary[1].damage).toBeCloseTo(37.95); // 23 * 1.65, not apparel's 1.8.
    expect(legendary[1].cooldown).toBe(52);
    expect(legendary[2].damage).toBeCloseTo(37.95);
  });

  it('normalizes the healthy bare-handed Best group to two equal fists, not a 7% bite chance', () => {
    expect(distribution(null)).toEqual({ leftFist: 0.5, rightFist: 0.5, teeth: 0, head: 0 });
    expect(meleeOptions(null).map((a) => a.category)).toEqual(['Best', 'Best', 'Worst', 'Worst']);
    expect(meleeOptions(null)[0].initialWeight).toBeCloseTo(4.6043);
  });

  it('selects club head as Best and shares Mid across its handle and both natural fists', () => {
    const p = distribution('woodClub');
    expect(p['woodClub.head']).toBe(0.75);
    for (const id of ['leftFist', 'rightFist', 'woodClub.handle'])
      expect(p[id]).toBeCloseTo(1 / 12);
    expect(p.teeth).toBe(0);
    expect(p.head).toBe(0);
  });

  it('reconstructs normal knife distribution including the two natural fists', () => {
    expect(distribution('steelKnife')).toEqual({
      leftFist: 0.0625,
      rightFist: 0.0625,
      teeth: 0,
      head: 0,
      'steelKnife.handle': 0.0625,
      'steelKnife.blade': 0.75,
      'steelKnife.point': 0.0625,
    });
  });

  it('shares longsword Best across stab and slash, and quality can remove fists from Mid', () => {
    const normal = distribution('steelLongsword');
    expect(normal['steelLongsword.point']).toBeCloseTo(0.375);
    expect(normal['steelLongsword.edge']).toBeCloseTo(0.375);
    for (const id of ['leftFist', 'rightFist', 'steelLongsword.handle'])
      expect(normal[id]).toBeCloseTo(1 / 12);
    const legendary = distribution('steelLongsword', 6);
    expect(legendary.leftFist).toBe(0);
    expect(legendary.rightFist).toBe(0);
    expect(legendary['steelLongsword.handle']).toBe(0.25);
    expect(legendary['steelLongsword.point']).toBe(0.375);
    expect(legendary['steelLongsword.edge']).toBe(0.375);
  });

  it('recomputes the bounded candidate groups for injured or missing natural tools', () => {
    const oneHand = meleeOptions(null, { leftHand: 0 });
    expect(oneHand.some((a) => a.id === 'leftFist')).toBe(false);
    expect(oneHand.find((a) => a.id === 'rightFist')?.probability).toBe(1);
    const hurt = meleeOptions(null, { leftHand: 0.5 });
    expect(hurt.find((a) => a.id === 'leftFist')?.damage).toBeCloseTo(4.1);
    expect(hurt.find((a) => a.id === 'leftFist')?.armorPenetration).toBeCloseTo(0.0615);
    expect(hurt.find((a) => a.id === 'leftFist')?.probability).toBe(0.25);
    expect(hurt.find((a) => a.id === 'rightFist')?.probability).toBe(0.75);
    const neither = meleeOptions(null, { leftHand: 0, rightHand: 0 });
    expect(neither.map((a) => [a.id, a.probability])).toEqual([
      ['teeth', 0.25],
      ['head', 0.75],
    ]);
    const fallback = meleeOptions(null, { leftHand: 0, rightHand: 0, teeth: 0, head: 0 });
    expect(fallback).toHaveLength(1);
    expect(fallback[0].id).toBe('head');
    expect(fallback[0].damage).toBe(2);
    expect(fallback[0].probability).toBe(1);
  });

  it('keeps body group damage, global attack factors and weapon eligibility separate', () => {
    const knife = makeWeapon(1, 'steelKnife');
    const attacks = weaponAttacks(knife, {
      leftHand: 0,
      rightHand: 0,
      damageFactor: 2,
      cooldownFactor: 0.5,
    });
    expect(attacks[1].damage).toBe(24);
    expect(attacks[1].cooldown).toBe(15);
    expect(attacks[1].armorPenetration).toBeCloseTo(0.36);
    // The caller drops an item when equipment capacity is lost; a still-equipped
    // weapon's native tool does not have a linked natural hand efficiency group.
    expect(
      meleeOptions(knife, { leftHand: 0, rightHand: 0 }).find((a) => a.id === 'steelKnife.blade')
        ?.damage,
    ).toBe(12);
    expect(meleeOptions(knife, { active: false })).toEqual([]);
    expect(selectMeleeAttack(null, 0.5, { damageFactor: 0 })).toBeNull();
  });

  it('labels seven-region injury mapping explicitly and preserves permanent limb disability', () => {
    const trauma = initialTrauma();
    applyInjury(trauma, 1, 'leftArm', 'bruise', 15);
    expect(meleeBodyFromTrauma(trauma).leftHand).toBe(0.5);
    applyInjury(trauma, 2, 'rightArm', 'bruise', 30);
    trauma.wounds = trauma.wounds.filter((w) => w.part !== 'rightArm');
    expect(meleeBodyFromTrauma(trauma).rightHand).toBe(0);
    applyInjury(trauma, 3, 'head', 'bruise', 5);
    expect(meleeBodyFromTrauma(trauma).teeth).toBe(0.8);
    expect(meleeBodyFromTrauma(trauma).head).toBe(0.8);
    applyInjury(trauma, 4, 'torso', 'cut', 40);
    expect(selectMeleeAttack(null, 0, meleeBodyFromTrauma(trauma))).toBeNull();
  });

  it('uses caller-supplied sampling deterministically across JSON persistence and boundaries', () => {
    expect(selectMeleeAttack(null, 0)?.id).toBe('leftFist');
    expect(selectMeleeAttack(null, 0.499999)?.id).toBe('leftFist');
    expect(selectMeleeAttack(null, 0.5)?.id).toBe('rightFist');
    expect(selectMeleeAttack(null, 1 - Number.EPSILON)?.id).toBe('rightFist');
    const weapon = makeWeapon(9, 'steelLongsword', 6),
      saved = JSON.parse(JSON.stringify(weapon));
    const seen: Record<string, number> = {};
    for (let i = 0; i < 1600; i++) {
      const roll = (i + 0.5) / 1600,
        a = selectMeleeAttack(weapon, roll)!;
      expect(selectMeleeAttack(saved, roll)).toEqual(a);
      seen[a.id] = (seen[a.id] ?? 0) + 1;
    }
    expect(seen).toEqual({
      'steelLongsword.handle': 400,
      'steelLongsword.point': 600,
      'steelLongsword.edge': 600,
    });
  });

  it('strictly rejects malformed persisted items, invented club quality and invalid numerical inputs', () => {
    const item = makeWeapon(1, 'steelKnife');
    for (const invalid of [
      null,
      [],
      {},
      { ...item, extra: 0 },
      { ...item, id: 0 },
      { ...item, id: 1.5 },
      { ...item, kind: 'fists' },
      { ...item, kind: '__proto__' },
      { ...item, kind: { toString: null } },
      { ...item, quality: NaN },
      { ...item, quality: 1.5 },
      { ...item, quality: 7 },
      { ...item, hitPoints: 0 },
      { ...item, hitPoints: 101 },
      { ...item, hitPoints: 0.5 },
      { ...item, hitPoints: Infinity },
      { ...makeWeapon(2, 'woodClub'), quality: 6 },
    ])
      expect(validWeapon(invalid)).toBe(false);
    const inherited = Object.assign(Object.create({ hitPoints: 100 }), {
      id: 1,
      kind: 'steelKnife',
      quality: 2,
      extra: true,
    });
    expect(validWeapon(inherited)).toBe(false);
    for (const roll of [-0.1, 1, NaN, Infinity])
      expect(() => selectMeleeAttack(null, roll)).toThrow();
    expect(() => meleeOptions(null, { leftHand: -1 })).toThrow();
    expect(() => meleeOptions(null, { rightHand: NaN })).toThrow();
    expect(() => meleeOptions(null, { cooldownFactor: 0 })).toThrow();
    expect(() => makeWeapon(-1, 'steelKnife')).toThrow();
    expect(() => weaponAttacks({ ...item, hitPoints: 0 })).toThrow();
  });
});
