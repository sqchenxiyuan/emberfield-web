import { healthSummary } from './survival';
import type { Pawn } from './types';
import { BODY_REGIONS, INJURY_NAMES, isFreshStump } from './injuries';
import {
  BODY_PART_LIST,
  BODY_PARTS,
  isPartMissing,
  partHealth,
  partEfficiency,
  type BodyPartId,
  type CapacityKey,
} from './anatomy';

const capacityLabels: Record<CapacityKey, string> = {
  consciousness: '意识',
  moving: '移动',
  manipulation: '操作',
  sight: '视力',
  breathing: '呼吸',
  bloodPumping: '血液循环',
  bloodFiltration: '血液过滤',
  metabolism: '代谢',
  hearing: '听力',
  talking: '说话',
  eating: '进食',
};
function partDepth(part: BodyPartId): number {
  const parent = BODY_PARTS[part].parent;
  return parent ? partDepth(parent) + 1 : 0;
}

export function SurvivalPanel({ pawn, temperature }: { pawn: Pawn; temperature: number }) {
  const summary = healthSummary(pawn);
  const conditions = [
    {
      key: 'malnutrition' as const,
      name: '营养不良',
      cause: pawn.food <= 0 ? '断粮中，持续加重' : '已有营养，逐渐恢复',
    },
    {
      key: 'hypothermia' as const,
      name: '失温',
      cause:
        temperature < summary.safeMin
          ? '环境过冷，持续加重'
          : temperature > summary.comfortableMin
            ? '温度适合，逐渐恢复'
            : '温度仍偏低，暂不恢复',
    },
    {
      key: 'heatstroke' as const,
      name: '中暑',
      cause:
        temperature > summary.safeMax
          ? '环境过热，持续加重'
          : temperature < summary.comfortableMax
            ? '温度适合，逐渐恢复'
            : '温度仍偏高，暂不恢复',
    },
  ];
  return (
    <section className="voxel-health" data-testid="pawn-health">
      <div className="voxel-info-row">
        <b>健康</b>
        <strong className={pawn.dead || pawn.downed ? 'danger' : ''}>
          {pawn.dead ? '已死亡' : pawn.downed ? '倒地 · 需要援助' : summary.reason}
        </strong>
      </div>
      {(pawn.trauma.wounds.length > 0 ||
        pawn.trauma.bloodLoss > 0 ||
        pawn.trauma.missingParts.length > 0) && (
        <div data-testid="injury-detail">
          <div className="voxel-info-row">
            <span>疼痛 {Math.round(summary.pain * 100)}%</span>
            <b>失血 {(pawn.trauma.bloodLoss * 100).toFixed(1)}%</b>
          </div>
          <small>
            {pawn.dead
              ? '遗体保留受伤与缺失部位的记录。'
              : summary.bleedRate > 0
                ? `出血 ${Math.round(summary.bleedRate * 100)}% / 天，尽快安排包扎。`
                : '没有持续出血；血液与伤口恢复需要时间。'}
          </small>
          {pawn.trauma.missingParts.map((missing) => (
            <div
              className="voxel-condition"
              key={missing.id}
              data-testid={`missing-${missing.part}`}
            >
              <div>
                <span className="danger">{BODY_REGIONS[missing.part].name}缺失</span>
                <b>无法自然恢复</b>
              </div>
              <small>
                {pawn.dead
                  ? '遗体保留此缺失记录。'
                  : isFreshStump(missing)
                    ? '新鲜断端，需护理止血。'
                    : '断端已稳定；缺失部位及其下属部位不再发挥功能。'}
              </small>
              {missing.legacyWounds.length > 0 && (
                <details>
                  <summary>查看保留的旧伤记录（{missing.legacyWounds.length}）</summary>
                  {missing.legacyWounds.map((w) => (
                    <small key={w.id}>
                      {BODY_REGIONS[w.part].name} · {INJURY_NAMES[w.kind]} {w.severity.toFixed(1)} ·
                      {w.tendQuality === null
                        ? '原未包扎'
                        : `原包扎品质 ${Math.round(w.tendQuality * 100)}%`}
                    </small>
                  ))}
                </details>
              )}
            </div>
          ))}
          {pawn.trauma.wounds.map((w) => (
            <div className="voxel-condition" key={w.id}>
              <div>
                <span>
                  {BODY_REGIONS[w.part].name} · {INJURY_NAMES[w.kind]}
                </span>
                <b>{w.severity.toFixed(1)}</b>
              </div>
              <small>
                部位健康 {partHealth(pawn.trauma, w.part)}/{BODY_REGIONS[w.part].hitPoints} · 功能{' '}
                {Math.round(partEfficiency(pawn.trauma, w.part) * 100)}% ·{' '}
                {w.tendQuality === null
                  ? '尚未包扎'
                  : `已包扎 · 品质 ${Math.round(w.tendQuality * 100)}%`}
              </small>
            </div>
          ))}
        </div>
      )}
      {pawn.dead ? (
        <p>{pawn.deathReason ?? '死亡'}。遗体与随身物资保留在地图中。</p>
      ) : (
        <>
          <div className="voxel-capacities">
            <span>意识 {Math.round(summary.consciousness * 100)}%</span>
            <span>移动 {Math.round(summary.moving * 100)}%</span>
            <span>操作 {Math.round(summary.manipulation * 100)}%</span>
            <span>视力 {Math.round(summary.sight * 100)}%</span>
          </div>
          <details data-testid="capacity-details">
            <summary>查看身体能力与影响原因</summary>
            {(Object.keys(capacityLabels) as CapacityKey[]).map((key) => (
              <div className="voxel-condition" key={key} data-testid={`capacity-${key}`}>
                <div>
                  <span>{capacityLabels[key]}</span>
                  <b>{Math.round(summary[key] * 100)}%</b>
                </div>
                <small>
                  {summary.capacityReasons[key].length
                    ? summary.capacityReasons[key].join('；')
                    : '相关部位与身体状态正常'}
                </small>
              </div>
            ))}
          </details>
          <details data-testid="anatomy-details">
            <summary>查看身体部位</summary>
            {BODY_PART_LIST.map((part) => (
              <div
                className="voxel-info-row"
                key={part.id}
                style={{ paddingLeft: partDepth(part.id) * 8 }}
                data-testid={`body-part-${part.id}`}
              >
                <span>
                  {part.name}
                  {part.depth === 'Inside' ? ' · 内部' : ''}
                </span>
                <b className={isPartMissing(pawn.trauma, part.id) ? 'danger' : ''}>
                  {isPartMissing(pawn.trauma, part.id)
                    ? '缺失'
                    : `${partHealth(pawn.trauma, part.id)}/${part.hitPoints}`}
                </b>
              </div>
            ))}
          </details>
          <details>
            <summary>环境 {temperature.toFixed(1)}°C · 查看温度耐受</summary>
            <small>
              舒适范围 {summary.comfortableMin.toFixed(1)}～{summary.comfortableMax.toFixed(1)}°C
            </small>
            <small>
              安全范围 {summary.safeMin.toFixed(1)}～{summary.safeMax.toFixed(1)}°C
            </small>
            <small>
              {pawn.worn.length
                ? `按当前穿着的 ${pawn.worn.length} 件衣物计算耐受；脱换后重新计算。`
                : '当前未穿衣物，按裸身耐受计算。'}
            </small>
          </details>
        </>
      )}
      {conditions
        .filter(({ key }) => pawn.health[key] > 0)
        .map(({ key, name, cause }) => (
          <div className="voxel-condition" key={key} data-testid={`condition-${key}`}>
            <div>
              <span>
                {name} · {summary.stages[key]}
              </span>
              <b>{(pawn.health[key] * 100).toFixed(1)}%</b>
            </div>
            <progress aria-label={`${name}严重度`} value={pawn.health[key]} max={1} />
            {!pawn.dead && pawn.health[key] > 0 && <small>{cause}</small>}
          </div>
        ))}
      {conditions.every(({ key }) => pawn.health[key] === 0) && (
        <small>未发现营养或温度异常。</small>
      )}
      {!pawn.dead && pawn.downed && (
        <p>
          倒地者无法自行走路和进食。留出可达医疗床、开启同伴的医护分工，并准备食物；恢复需要时间。
        </p>
      )}
    </section>
  );
}
