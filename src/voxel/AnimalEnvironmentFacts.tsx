import { animalEnvironmentEffects, animalTemperatureAllowsRecovery, animalTemperatureRange } from './animalEnvironment';
import type { WildAnimal } from './types';

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

/** The optional reading must come from the animal's actual cell. An outdoor
 * snapshot temperature is not a substitute for an unknown indoor reading. */
export function AnimalEnvironmentFacts({ animal: a, localTemperature }: {
  animal: WildAnimal; localTemperature?: number;
}) {
  const range = animalTemperatureRange(a), effects = animalEnvironmentEffects(a);
  const known = localTemperature !== undefined && Number.isFinite(localTemperature);
  const unsafe = known && (localTemperature < range.safeMin || localTemperature > range.safeMax);
  const uncomfortable = known && (localTemperature < range.comfortableMin || localTemperature > range.comfortableMax);
  return <div className="voxel-animal-environment-facts" data-testid="animal-environment-facts" data-ill={effects.ill}>
    <b>环境与体温</b>
    <small>舒适温度 {range.comfortableMin}～{range.comfortableMax}°C · 耐受温度 {range.safeMin}～{range.safeMax}°C</small>
    {known && <small data-testid="animal-local-temperature" className={unsafe ? 'voxel-animal-environment-warning' : undefined}>
      当前位置 {localTemperature.toFixed(1)}°C · {unsafe ? '超出耐受范围' : uncomfortable ? '超出舒适范围' : '温度舒适'}
    </small>}
    {known && effects.ill && !animalTemperatureAllowsRecovery(a, localTemperature) && !a.dead &&
      <small className="voxel-animal-environment-warning">当前温度不适合病情恢复，需要调整温度或转移位置。</small>}
    <small>失温 {percent(a.environment.hypothermia)} · 中暑 {percent(a.environment.heatstroke)}</small>
    {a.phase === 'shelter' && !a.dead && <small>{a.goal?.kind === 'climateExit' ? '正在离开不适温地区' : '正在前往适温或避火的位置'}；活动范围和通路会限制可到达的位置。</small>}
    {effects.ill && !a.dead ? <small className="voxel-animal-environment-warning">
      需要改善环境；倒地时安排搬运到适温的动物医疗睡眠点。失温与中暑需在合适环境中逐渐恢复，不靠草药治疗；烧伤仍需护理伤口。
    </small> : !a.dead && <small>尚无失温或中暑；圈地与休养位置也需要适宜温度。</small>}
  </div>;
}
