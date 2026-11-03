import { BODY_PARTS } from './anatomy';
import {
  MEDICAL_POLICIES,
  MEDICAL_POLICY_NAMES,
  MEDICAL_CARE_WORK,
  infectionCanTend,
  infectionStage,
  medicalNeedsRest,
  type MedicalPolicy,
} from './medicine';
import { DAY, type Bed, type Pawn, type VoxelCommand } from './types';

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const tending = (pawn: Pawn) =>
  pawn.carePhase === 'tendFetch' || pawn.carePhase === 'tendApproach' || pawn.carePhase === 'tend';

export function MedicinePanel({
  pawn,
  pawns,
  beds,
  tick,
  command,
}: {
  pawn: Pawn;
  pawns: Pawn[];
  beds: Bed[];
  tick: number;
  command: (command: VoxelCommand) => void;
}) {
  const medical = pawn.medical;
  const doctor = tending(pawn)
    ? pawn
    : pawns.find((candidate) => candidate.patientId === pawn.id && tending(candidate));
  const patient = doctor ? pawns.find((candidate) => candidate.id === doctor.patientId) : null;
  const treatment = medical.lastTend;
  const restingBed = beds.find((bed) => bed.id === pawn.sleepBedId);
  const qualityRange = treatment?.qualities.length
    ? [Math.min(...treatment.qualities), Math.max(...treatment.qualities)]
    : null;
  return (
    <div className="voxel-medicine" data-testid="medical-detail">
      {['colony', 'prisoner'].includes(pawn.faction) && !pawn.dead && (
        <div className="voxel-medical-policy" data-testid="medical-policy">
          <label>
            医疗政策
            <select
              aria-label="医疗政策"
              value={medical.policy}
              onChange={(event) =>
                command({
                  type: 'medicalPolicy',
                  pawnId: pawn.id,
                  policy: event.target.value as MedicalPolicy,
                })
              }
            >
              {MEDICAL_POLICIES.map((policy) => (
                <option key={policy} value={policy}>
                  {MEDICAL_POLICY_NAMES[policy]}
                </option>
              ))}
            </select>
          </label>
          <label className="voxel-check">
            <input
              type="checkbox"
              aria-label="医疗卧床休养"
              checked={medical.bedRest}
              onChange={(event) =>
                command({ type: 'medicalRest', pawnId: pawn.id, enabled: event.target.checked })
              }
            />
            感染时卧床休养
          </label>
          <small>
            {medical.policy === 'none'
              ? '当前政策不接受包扎或感染护理。'
              : medical.policy === 'noMedicine'
                ? '接受护理，不使用草药。'
                : '允许医生取用草药；实际用药情况会记录在护理结果中。'}
          </small>
          {medicalNeedsRest(pawn) && (
            <small data-testid="medical-rest-status">
              {restingBed && pawn.phase === 'rest'
                ? restingBed.medical
                  ? `正在医疗床休养 · 高度 ${restingBed.z}。`
                  : `正在普通床休养 · 高度 ${restingBed.z}。`
                : restingBed && pawn.phase === 'sleepTravel'
                  ? `正在前往${restingBed.medical ? '医疗床' : '普通床'}休养 · 高度 ${restingBed.z}。`
                  : '已允许感染时前往医疗床休养；需要可达床位。'}
            </small>
          )}
        </div>
      )}
      {(medical.infections.length > 0 || medical.immunity > 0) && (
        <div className="voxel-infections" data-testid="infection-list">
          <div className="voxel-info-row">
            <b>
              {medical.infections.length
                ? `伤口感染 · ${medical.infections.length} 处`
                : '伤口感染已消退'}
            </b>
            <strong>
              {!medical.infections.length
                ? '保留免疫'
                : medical.immunity >= 1
                  ? '已获得免疫'
                  : '免疫形成中'}
            </strong>
          </div>
          <label className="voxel-immunity">
            共享免疫 {percent(medical.immunity)}
            <progress aria-label="伤口感染免疫" value={medical.immunity} max={1} />
          </label>
          <small>
            {medical.infections.length
              ? '这些感染共用同一免疫进度。护理、进食和休息状态会影响恢复过程。'
              : '目前没有活动的伤口感染，保留的免疫会随时间减弱。'}
          </small>
          {medical.infections.map((infection) => (
            <div
              className="voxel-condition"
              data-testid="infection-detail"
              data-infection-id={infection.id}
              key={infection.id}
            >
              <div>
                <span>
                  {BODY_PARTS[infection.part].name} · {infectionStage(infection.severity)}
                </span>
                <b>{percent(infection.severity)}</b>
              </div>
              <progress
                aria-label={`${BODY_PARTS[infection.part].name}感染程度`}
                value={infection.severity}
                max={1}
              />
              <small>
                {infection.tendQuality === null
                  ? '尚未护理'
                  : `护理品质 ${percent(infection.tendQuality)}`}
                {infection.tendUntil > tick
                  ? ` · 本次护理仍有效 ${((infection.tendUntil - tick) / DAY).toFixed(2)} 日`
                  : infection.tendQuality !== null
                    ? ' · 本次护理已到期'
                    : ''}
              </small>
              {!pawn.dead && (
                <small>
                  {medical.immunity >= 1
                    ? '免疫已形成；感染消退仍需要时间。'
                    : infectionCanTend(infection, medical.immunity, tick)
                      ? infection.tendUntil > tick
                        ? '已可提前再次护理。'
                        : '需要安排护理。'
                      : '尚未到再次护理的时间。'}
                </small>
              )}
            </div>
          ))}
        </div>
      )}
      {doctor && patient && (
        <div className="voxel-aim-status" data-testid="medical-process">
          <b>
            {doctor.name} → {patient.name}
          </b>
          <span>
            {doctor.carePhase === 'tendFetch'
              ? `正在取用草药${doctor.careAmount > 0 ? ` × ${doctor.careAmount}` : ''}`
              : doctor.carePhase === 'tendApproach'
                ? '正在前往患者'
                : '正在护理'}
          </span>
          {doctor.cargo?.resource === 'herb' && <small>实际携带草药 × {doctor.cargo.amount}</small>}
          {doctor.carePhase === 'tend' && (
            <progress aria-label="护理进度" value={doctor.careProgress} max={MEDICAL_CARE_WORK} />
          )}
          <small>{doctor.reason}</small>
        </div>
      )}
      {treatment && qualityRange && (
        <details data-testid="last-medical-treatment">
          <summary>最近护理 · {treatment.medicine === 'herb' ? '使用草药' : '未用药'}</summary>
          <small>
            {pawns.find((candidate) => candidate.id === treatment.doctorId)?.name ?? '医护人员'} ·{' '}
            {Math.max(0, (tick - treatment.tick) / DAY).toFixed(2)} 日前 · 处理{' '}
            {treatment.recordIds.length} 项伤病
          </small>
          <small>
            护理品质 {percent(qualityRange[0])}
            {qualityRange[1] !== qualityRange[0] ? `～${percent(qualityRange[1])}` : ''}
          </small>
        </details>
      )}
    </div>
  );
}
