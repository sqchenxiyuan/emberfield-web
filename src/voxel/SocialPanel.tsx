import { DAY, type Pawn, type VoxelSnapshot } from './types';
import { opinionOf, resolveSocialIdentity, socialMemoryView, SOCIAL_NAMES } from './social';

const signed = (value: number) => `${value > 0 ? '+' : ''}${Number(value.toFixed(1))}`;
const duration = (ticks: number) => ticks >= DAY ? `${Number((ticks / DAY).toFixed(1))} 游戏天`
  : `${Math.max(0, Math.ceil(ticks / DAY * 1440))} 游戏分钟`;

export function SocialPanel({ pawn, snapshot, focus }: {
  pawn: Pawn; snapshot: VoxelSnapshot; focus: (pawn: Pawn) => void;
}) {
  const identity = (id: number) => resolveSocialIdentity(id, snapshot.pawns, snapshot.socialHistory);
  const name = (id: number) => identity(id)?.name ?? `未知人物 #${id}`;
  const recent = snapshot.socialLog.filter(event => event.initiatorId === pawn.id || event.recipientId === pawn.id).slice(-6).reverse();
  const others = [...new Set([
    ...snapshot.pawns.filter(p => p.faction === 'colony' && p.id !== pawn.id).map(p => p.id),
    ...pawn.social.memories.map(m => m.otherId),
    ...recent.map(e => e.initiatorId === pawn.id ? e.recipientId : e.initiatorId),
  ])].sort((a, b) => a - b);
  return <section className="voxel-social-panel" data-testid="social-panel" data-pawn-id={pawn.id}>
    <div className="voxel-info-row"><b>人际关系</b><span>{others.length} 人</span></div>
    <small>好感有方向：你对对方的看法，可能与对方对你的看法不同。</small>
    {!others.length && <small>目前没有其他同伴或人际记忆。</small>}
    <div className="voxel-social-relations">
      {others.map(id => {
        const other = snapshot.pawns.find(p => p.id === id), info = identity(id);
        const outgoing = opinionOf(pawn.social, id, snapshot.tick);
        const incoming = other ? opinionOf(other.social, pawn.id, snapshot.tick) : null;
        const memories = socialMemoryView(pawn.social, snapshot.tick, id);
        return <details key={id} data-testid="social-relation" data-other-id={id} data-opinion={outgoing} data-reverse-opinion={incoming ?? ''}>
          <summary><b>{name(id)}{info?.dead ? ' · 已死亡' : info?.departed ? ' · 已离开' : ''}</b>
            <span>{pawn.name} → 对方 <em className={outgoing < 0 ? 'negative' : outgoing > 0 ? 'positive' : ''}>{signed(outgoing)}</em></span>
            <span>对方 → {pawn.name} <em className={incoming !== null && incoming < 0 ? 'negative' : incoming !== null && incoming > 0 ? 'positive' : ''}>{incoming === null ? '暂无当前资料' : signed(incoming)}</em></span>
          </summary>
          {other && <button onClick={() => focus(other)}>查看 {other.name}</button>}
          <b className="voxel-social-memory-heading">{pawn.name} 对 {name(id)} 的记忆</b>
          {!memories.length && <small>没有仍在生效的人际记忆，当前好感为中立。</small>}
          {memories.map(memory => <div className="voxel-social-memory" key={`${memory.kind}:${memory.createdTick}`} data-testid="social-memory"
            data-kind={memory.kind} data-other-id={id} data-effect={memory.effect} data-value={memory.value} data-created-tick={memory.createdTick} data-expires={memory.expires}>
            <span>{memory.label}{memory.kind === 'chitchat' ? '累计' : ''}</span><b className={memory.value < 0 ? 'negative' : 'positive'}>{memory.effect === 'opinion' ? '好感' : '心情'} {signed(memory.value)}</b>
            <small>{memory.kind === 'insulted' || memory.kind === 'insultedMood' ? `${name(id)} 侮辱了 ${pawn.name}` : `${pawn.name} 与 ${name(id)} ${memory.label}`}
              {' · '}{memory.kind === 'chitchat' ? '累计起于 ' : ''}{duration(snapshot.tick - memory.createdTick)}前</small>
            <small>剩余 {duration(memory.remainingTicks)}{memory.kind === 'chitchat' ? '（若不再闲聊）' : ` · 初始影响 ${signed(memory.amount)}`}</small>
          </div>)}
        </details>;
      })}
    </div>
    <details className="voxel-social-recent" open><summary>最近互动</summary>
      {!recent.length && <small>尚未发生普通社交互动。安排共同休闲和相近的工作位置，能增加碰面的机会。</small>}
      {recent.map(event => <div key={`${event.tick}:${event.initiatorId}`} data-testid="social-event" data-kind={event.kind} data-tick={event.tick}
        data-initiator-id={event.initiatorId} data-recipient-id={event.recipientId}>
        <b>{name(event.initiatorId)} → {name(event.recipientId)} · {SOCIAL_NAMES[event.kind]}</b>
        <small>{duration(snapshot.tick - event.tick)}前</small>
      </div>)}
    </details>
    <small>闲聊与深入交谈影响人际好感；受到侮辱还会留下独立的短期心情影响。</small>
  </section>;
}
