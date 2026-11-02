import { healthSummary } from './survival';
import type { Pawn } from './types';

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
      {pawn.dead ? (
        <p>{pawn.deathReason ?? '死亡'}。遗体与随身物资保留在地图中。</p>
      ) : (
        <>
          <div className="voxel-capacities">
            <span>意识 {Math.round(summary.consciousness * 100)}%</span>
            <span>移动 {Math.round(summary.moving * 100)}%</span>
            <span>操作 {Math.round(summary.manipulation * 100)}%</span>
          </div>
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
