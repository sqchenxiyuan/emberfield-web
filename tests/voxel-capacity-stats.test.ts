import { describe, expect, it } from 'vitest';
import {
  initialSkills,
  workSpeed,
  tendSpeed,
  tendQuality,
  researchSpeed,
  miningYield,
  plantYield,
  meleeHitChance,
  meleeDodgeChance,
} from '../src/voxel/skills';
import { researchPointsPerTick } from '../src/voxel/research';

describe('actual sight in work, medical and combat stats', () => {
  it('applies each native sight weight before its postprocessing curve', () => {
    const skills = initialSkills(0);
    for (const key of ['mining', 'plants', 'construction', 'intellectual'] as const)
      skills[key].level = 8;
    skills.medicine.level = 10;
    skills.cooking.level = 10;
    // Independent XML arithmetic: Manipulation 80%, Sight 75%.
    expect(workSpeed(skills, 'mine', 0.8, 0.75)).toBeCloseTo(0.7);
    expect(workSpeed(skills, 'cut', 0.8, 0.75)).toBeCloseTo(0.74);
    expect(workSpeed(skills, 'wall', 0.8, 0.75)).toBeCloseTo(1.292);
    expect(workSpeed(skills, 'cook', 0.8, 0.75)).toBeCloseTo(0.748);
    expect(tendSpeed(skills, 0.8, 0.75)).toBeCloseTo(0.64);
    expect(tendQuality(skills, 0.8, 0.75)).toBeCloseTo(0.792);
    expect(researchSpeed(skills, 0.8, 0.75)).toBeCloseTo(0.7875);
    expect(researchPointsPerTick(skills, 0.8, 0.75, 0.75)).toBeCloseTo(0.01461796875);
  });

  it('caps sight bonuses independently and retains native speed floors', () => {
    const skills = initialSkills(0);
    expect(workSpeed(skills, 'mine', 1, 2)).toBe(workSpeed(skills, 'mine', 1, 1));
    expect(workSpeed(skills, 'wall', 1, 2)).toBe(workSpeed(skills, 'wall', 1, 1));
    expect(tendSpeed(skills, 1, 2)).toBe(tendSpeed(skills, 1, 1.3));
    expect(tendQuality(skills, 1, 2)).toBe(tendQuality(skills, 1, 1.4));
    expect(researchSpeed(skills, 1, 2)).toBe(researchSpeed(skills, 1, 1.1));
    expect(workSpeed(skills, 'mine', 0, 0)).toBe(0.1);
    expect(workSpeed(skills, 'wall', 0, 0)).toBe(0.17);
    for (const sight of [-1, NaN, Infinity]) {
      expect(() => workSpeed(skills, 'mine', 1, sight)).toThrow();
      expect(() => tendSpeed(skills, 1, sight)).toThrow();
      expect(() => tendQuality(skills, 1, sight)).toThrow();
    }
  });

  it('changes output and hit odds as well as the displayed work rate', () => {
    const skills = initialSkills(0);
    skills.melee.level = 10;
    expect(miningYield(skills, 1, 0.75) / miningYield(skills, 1, 1)).toBeCloseTo(0.95);
    expect(plantYield(skills, 1, 0.75) / plantYield(skills, 1, 1)).toBeCloseTo(0.95);
    expect(meleeHitChance(skills, 1, 0.75)).toBeCloseTo(0.71);
    expect(meleeDodgeChance(skills, 1, 0.75)).toBeCloseTo(0.06);
  });
});
