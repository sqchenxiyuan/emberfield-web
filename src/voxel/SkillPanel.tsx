import type { Pawn, Work } from './types';
import {
  SKILL_KEYS,
  SKILL_NAMES,
  PASSION_NAMES,
  learningRate,
  miningYield,
  plantYield,
  meleeHitChance,
  meleeDodgeChance,
  workSpeed,
  xpToNextLevel,
  type SkillKey,
} from './skills';
import { healthSummary } from './survival';

const WORK_SKILLS: Record<Work, SkillKey | null> = {
  firefight: null,
  warden: 'social',
  hunt: 'shooting',
  care: 'medicine',
  dig: 'mining',
  cut: 'plants',
  build: 'construction',
  haul: null,
  clean: null,
  grow: 'plants',
  cook: 'cooking',
  craft: 'crafting',
  research: 'intellectual',
};
const SPEED_EXAMPLES: Partial<Record<SkillKey, { kind: string; label: string }>> = {
  mining: { kind: 'mine', label: '挖掘' },
  construction: { kind: 'wall', label: '施工' },
  plants: { kind: 'sow', label: '播种' },
  cooking: { kind: 'cook', label: '烹饪' },
  crafting: { kind: 'tailoring', label: '裁缝' },
  medicine: { kind: 'tend', label: '包扎' },
  intellectual: { kind: 'research', label: '研究' },
};
const number = (n: number) => n.toLocaleString('zh-CN', { maximumFractionDigits: 1 });

export function WorkSkill({ pawn, work }: { pawn: Pawn; work: Work }) {
  const key = WORK_SKILLS[work];
  if (!key) return <small className="voxel-work-skill">无需技能</small>;
  const skill = pawn.skills[key];
  return (
    <small
      className="voxel-work-skill"
      title={`${SKILL_NAMES[key]} ${skill.level}级 · ${PASSION_NAMES[skill.passion]}`}
    >
      {SKILL_NAMES[key]} {skill.level}
      {skill.passion > 0 && (
        <em aria-label={PASSION_NAMES[skill.passion]}>{skill.passion === 2 ? '◆◆' : '◆'}</em>
      )}
    </small>
  );
}

export function SkillPanel({ pawn }: { pawn: Pawn }) {
  const { manipulation, moving, sight } = healthSummary(pawn);
  const harvestYield = plantYield(pawn.skills, manipulation, sight);
  return (
    <details className="voxel-skills" open data-testid="pawn-skills">
      <summary>技能与学习</summary>
      <div className="voxel-skill-list">
        {SKILL_KEYS.map((key) => {
          const skill = pawn.skills[key],
            example = SPEED_EXAMPLES[key];
          const required = xpToNextLevel(skill.level);
          return (
            <div className="voxel-skill" key={key} data-skill={key}>
              <div className="voxel-skill-heading">
                <b>
                  {SKILL_NAMES[key]}{' '}
                  <strong>
                    {skill.level}
                    {skill.level === 20 ? ' · 满级' : ''}
                  </strong>
                </b>
                <span className={`passion-${skill.passion}`}>{PASSION_NAMES[skill.passion]}</span>
              </div>
              <progress
                aria-label={`${SKILL_NAMES[key]}升级经验`}
                value={Math.max(0, skill.xp)}
                max={required}
              />
              <div className="voxel-skill-meta">
                <span>
                  {number(skill.xp)} / {number(required)} XP
                </span>
                <span>学习 {Math.round(learningRate(skill) * 100)}%</span>
              </div>
              <small>
                今日 {number(skill.dailyXp)} XP
                {example && (
                  <>
                    {' '}
                    · {example.label}速度{' '}
                    {Math.round(workSpeed(pawn.skills, example.kind, manipulation, sight) * 100)}%
                  </>
                )}
              </small>
              {key === 'mining' && (
                <small>
                  矿物产量 {Math.round(miningYield(pawn.skills, manipulation, sight) * 100)}%
                </small>
              )}
              {key === 'plants' && (
                <small title="作物收获可能失败；砍树不会收获失败。成功时按产量倍率结算。">
                  作物成功率 {Math.round(Math.min(1, harvestYield) * 100)}% · 成功产量{' '}
                  {Math.round(Math.max(1, harvestYield) * 100)}%
                </small>
              )}
              {key === 'melee' && (
                <small>
                  基础命中 {Math.round(meleeHitChance(pawn.skills, manipulation, sight) * 100)}% ·
                  闪避 {Math.round(meleeDodgeChance(pawn.skills, moving, sight) * 100)}%
                </small>
              )}
            </div>
          );
        })}
      </div>
      <p>
        热情影响学习效率；今日经验超过 4000 后，后续学习降至 20%。10级以上会逐渐生疏，负经验降至
        −1000 才会降级。
      </p>
      <p>
        速度已计入当前健康，材料和设施另行影响工作；切石不提供工艺经验。分工优先级决定先做什么，研究需要已选项目与科研台。
      </p>
    </details>
  );
}
