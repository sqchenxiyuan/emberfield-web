import type { EnvironmentItemView } from './environment';
import type { Cargo } from './types';
import { batchHitPoints, batchMaxHitPoints } from './deterioration';

/** Carried and delivered batches retain their HP, but do not have a ground
 * environment entry. Show only their canonical condition, without inventing a
 * location-specific deterioration rate or protection state. */
export function BatchDurability({ batch, name }: { batch: Cargo; name: string }) {
  const hitPoints = batchHitPoints(batch), maxHitPoints = batchMaxHitPoints(batch);
  if (hitPoints === null || maxHitPoints === null) return null;
  return <section className="voxel-food-condition" data-testid="batch-durability"
    data-hit-points={hitPoints} data-max-hit-points={maxHitPoints}>
    <span>物资耐久 {hitPoints} / {maxHitPoints}</span>
    <progress aria-label={`${name}物资耐久`} value={hitPoints} max={maxHitPoints} />
  </section>;
}

export function ItemCondition({ condition, name }: { condition: EnvironmentItemView | undefined; name: string }) {
  if (!condition) return null;
  const { environment: env, hitPoints, maxHitPoints, rate } = condition;
  const place = env.protected ? '受到保护' : !env.exposed && !env.outdoors ? '室内有顶'
    : !env.exposed ? '棚下 · 与室外连通' : env.outdoors ? '露天室外' : '上方开口';
  const reason = rate > 0 ? env.exposed && env.rainRate > 0 ? '暴露在降水中，环境劣化加快。'
    : env.exposed ? '缺少屋顶，地面存放会发生环境劣化。' : '屋顶挡住降水，但室外环境仍会使物资劣化。'
    : env.protected || (!env.exposed && !env.outdoors) ? '当前受到环境保护，环境劣化暂停。'
    : '这种物资不会因当前环境损失耐久。';
  return <section className="voxel-food-condition" data-testid="item-condition" data-item-id={condition.id}
    data-entity={condition.entity} data-hit-points={hitPoints ?? 'none'} data-max-hit-points={maxHitPoints ?? 'none'}
    data-deterioration-rate={rate} data-exposed={env.exposed} data-outdoors={env.outdoors}>
    <div className="voxel-info-row"><b>物资状态</b><span>{place}</span></div>
    {hitPoints !== null && maxHitPoints !== null ? <>
      <span>耐久 {hitPoints} / {maxHitPoints}</span>
      <progress aria-label={`${name}物资耐久`} value={hitPoints} max={maxHitPoints} />
    </> : <small>这种物资没有耐久损耗。</small>}
    <small>环境劣化：{rate.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} HP / 日{rate > 0 ? '（当前环境下的平均值）' : ''}</small>
    <small>{reason}</small>
    <small>仓储区域负责收纳，不能代替屋顶和室内保护。食物腐坏另外按温度计算。</small>
  </section>;
}
