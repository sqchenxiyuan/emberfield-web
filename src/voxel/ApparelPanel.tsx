import { useState } from 'react';
import { APPAREL_DEFS, apparelStats, apparelHasPartsToWear, apparelMoveFactor } from './apparel';
import { healthSummary } from './survival';
import { TPS, type ApparelPiece, type Pawn } from './types';

export function ApparelDetails({ piece }: { piece: ApparelPiece }) {
  const stats = apparelStats(piece);
  return (
    <div className="voxel-apparel-detail" data-testid="apparel-detail">
      <b>
        {stats.name} · {piece.material === 'steel' ? '钢制' : '布制'}
      </b>
      <span>
        {stats.qualityName} · 耐久 {piece.hitPoints} / {stats.maxHitPoints}
      </span>
      <small>
        隔冷 {stats.cold.toFixed(1)}°C · 隔热 {stats.heat.toFixed(1)}°C
      </small>
      <small data-testid="apparel-armor">
        锐器防护 {(stats.armorSharp * 100).toFixed(1)}% · 钝器防护{' '}
        {(stats.armorBlunt * 100).toFixed(1)}% · 热伤防护 {(stats.armorHeat * 100).toFixed(1)}%
      </small>
      <small>
        覆盖：
        {APPAREL_DEFS[piece.kind].bodyParts
          .map(
            (p) =>
              ({
                UpperHead: '头顶',
                Torso: '躯干',
                Neck: '颈部',
                Shoulders: '肩部',
                Arms: '手臂',
                Legs: '腿部',
              })[p] ?? p,
          )
          .join('、')}
      </small>
      {stats.moveSpeedOffset !== 0 && (
        <small>
          移动速度修正 {stats.moveSpeedOffset.toFixed(1)}（基础属性 4.6，先于身体能力计算）
        </small>
      )}
    </div>
  );
}

export function ApparelPanel({ pawn, remove }: { pawn: Pawn; remove: (id: number) => void }) {
  return (
    <details className="voxel-apparel-panel" open data-testid="pawn-apparel">
      <summary>衣着 · {pawn.worn.length} 件</summary>
      {!pawn.worn.length && <small>未穿衣物。需要先取到衣物，再花时间穿上。</small>}
      <small>
        当前步行系数 {(apparelMoveFactor(pawn.worn, healthSummary(pawn).moving) * 100).toFixed(0)}%
        {' · '}当前步进{' '}
        {(
          TPS /
          Math.ceil(
            (pawn.cargo || pawn.carryingPawnId !== null ? 6 : 4) /
              apparelMoveFactor(pawn.worn, healthSummary(pawn).moving),
          )
        ).toFixed(2)}{' '}
        格/秒
      </small>
      {pawn.worn.map((piece) => (
        <div className="voxel-worn-piece" key={piece.id} data-apparel-id={piece.id}>
          <ApparelDetails piece={piece} />
          <button
            aria-label={`${pawn.name} 脱下 ${apparelStats(piece).name}`}
            disabled={pawn.dead || pawn.downed}
            onClick={() => remove(piece.id)}
          >
            脱下
          </button>
        </div>
      ))}
      {pawn.apparelTask && (
        <small>
          正在{pawn.apparelTask.action === 'wear' ? '取用或穿上衣物' : '脱下衣物'}，完成后更新装备。
        </small>
      )}
      <small>
        同一部位的同层衣物会替换；旧衣服需要有合法落点。防护会扣除攻击穿透，再逐层判定挡下或减半，并非固定减伤百分比。耐久损耗不降低防护值，损毁后失效。
      </small>
    </details>
  );
}

export function WearApparel({
  piece,
  pawns,
  preferredPawnId,
  wear,
}: {
  piece: ApparelPiece;
  pawns: Pawn[];
  preferredPawnId?: number | null;
  wear: (pawnId: number, apparelId: number) => void;
}) {
  const [chosen, choose] = useState<number | null>(preferredPawnId ?? null);
  const eligible = pawns.filter(
    (p) => !p.dead && !p.downed && apparelHasPartsToWear(piece, p.trauma),
  );
  const selected = eligible.find((p) => p.id === chosen) ?? eligible[0];
  return (
    <div className="voxel-wear-actions">
      <ApparelDetails piece={piece} />
      <label>
        穿戴者
        <select
          aria-label="穿戴者"
          value={selected?.id ?? ''}
          disabled={!selected}
          onChange={(e) => choose(Number(e.target.value))}
        >
          {!selected && <option value="">暂无可行动同伴</option>}
          {eligible.map((p) => (
            <option value={p.id} key={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <button disabled={!selected} onClick={() => selected && wear(selected.id, piece.id)}>
        前往穿上
      </button>
      <small>同伴会实际取衣并换装；冲突旧衣不会凭空消失。</small>
    </div>
  );
}
