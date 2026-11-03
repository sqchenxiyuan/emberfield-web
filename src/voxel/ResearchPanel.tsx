import {
  RESEARCH_KEYS,
  RESEARCH_DEFS,
  researchComplete,
  researchBlockReason,
  simpleBenchFactor,
} from './research';
import {
  researchBenchInteraction,
  type ResearchBench,
  type VoxelCommand,
  type VoxelSnapshot,
} from './types';

const points = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 1 });

export function ResearchPanel({
  snapshot,
  command,
  close,
}: {
  snapshot: VoxelSnapshot;
  command: (command: VoxelCommand) => void;
  close: () => void;
}) {
  const state = snapshot.research;
  const current = state.current && RESEARCH_DEFS[state.current];
  const ordered = [...RESEARCH_KEYS].sort(
    (a, b) => Number(researchComplete(state, a)) - Number(researchComplete(state, b)),
  );
  return (
    <aside className="voxel-research-drawer" data-testid="research-panel" aria-label="研究科技">
      <div className="voxel-panel-title">
        <span className="voxel-kicker">营地研究</span>
        <button aria-label="关闭研究面板" onClick={close}>
          ×
        </button>
      </div>
      <h2>{current ? `正在研究：${current.name}` : '选择下一项研究'}</h2>
      {state.current && (
        <div className="voxel-research-current" data-testid="current-research">
          <progress
            value={state.progress[state.current]}
            max={current!.cost}
            aria-label="当前研究进度"
          />
          <span>
            {points(state.progress[state.current])} / {current!.cost} 研究点
          </span>
          <button onClick={() => command({ type: 'research', project: null })}>停止研究</button>
        </div>
      )}
      <p>选择项目后，开启「研究」分工的同伴会前往简易科研台。切换或停止项目会保留已有进度。</p>
      <small>
        {snapshot.researchBenches.length
          ? `已建科研台 ${snapshot.researchBenches.length} 座`
          : '尚无科研台：可以先选项目，再建造科研台。'}
      </small>
      {state.origin === 'legacy-unlocked' && (
        <p className="voxel-research-origin">
          旧营地保留已有建造与制作权限，所有当前科技均已掌握。
        </p>
      )}
      <div className="voxel-research-list">
        {ordered.map((key) => {
          const def = RESEARCH_DEFS[key],
            complete = researchComplete(state, key);
          const reason = researchBlockReason(state, key),
            active = state.current === key;
          return (
            <section
              key={key}
              data-research-key={key}
              className={`voxel-research-entry${active ? ' is-active' : ''}${complete ? ' is-complete' : ''}`}
            >
              <div>
                <b>{def.name}</b>
                <span>
                  {complete ? '已掌握' : active ? '研究中' : reason ? '待前置' : '可研究'}
                </span>
              </div>
              <progress
                value={state.progress[key]}
                max={def.cost}
                aria-label={`${def.name}研究进度`}
              />
              <small>
                {points(state.progress[key])} / {def.cost} 研究点
              </small>
              <p>解锁：{def.unlocks.join('、')}</p>
              {def.prerequisites.length > 0 && (
                <small>
                  前置：{def.prerequisites.map((p) => RESEARCH_DEFS[p].name).join('、')}
                </small>
              )}
              {!complete && (
                <button
                  disabled={!!reason || active}
                  title={reason ?? undefined}
                  aria-label={`研究${def.name}`}
                  onClick={() => command({ type: 'research', project: key })}
                >
                  {active ? '当前研究' : reason ? reason : '选择研究'}
                </button>
              )}
            </section>
          );
        })}
      </div>
    </aside>
  );
}

export function ResearchBenchPanel({
  bench,
  snapshot,
  openResearch,
}: {
  bench: ResearchBench;
  snapshot: VoxelSnapshot;
  openResearch: () => void;
}) {
  const stand = researchBenchInteraction(bench),
    current = snapshot.research.current;
  const job = snapshot.jobs.find(
    (j) =>
      j.kind === 'research' &&
      !j.cancelled &&
      j.x === bench.x &&
      j.y === bench.y &&
      j.z === bench.z,
  );
  const worker = job && snapshot.pawns.find((p) => p.jobId === job.id && p.id === job.owner);
  return (
    <section className="voxel-bill voxel-research-bench" data-testid="research-bench">
      <b>简易科研台</b>
      <p>{current ? `全营地项目：${RESEARCH_DEFS[current].name}` : '尚未选择研究项目'}</p>
      {current && (
        <>
          <progress
            aria-label="科研台项目进度"
            value={snapshot.research.progress[current]}
            max={RESEARCH_DEFS[current].cost}
          />
          <small>
            {points(snapshot.research.progress[current])} / {RESEARCH_DEFS[current].cost} 研究点
          </small>
        </>
      )}
      <p data-testid="research-bench-worker">
        {worker
          ? `${worker.name} · ${worker.reason}`
          : job?.reason || (current ? '等待研究员前来' : '选择项目后开始安排研究')}
      </p>
      <button onClick={openResearch}>选择研究项目</button>
      <small>
        操作位 {stand.x}, {stand.y} · Z {stand.z}。需要可达通路与「研究」分工。
      </small>
      <small>
        9–35°C 时台效率：室内 {points(simpleBenchFactor(false, 21) * 100)}%，露天{' '}
        {points(simpleBenchFactor(true, 21) * 100)}
        %；过冷或过热会继续降低效率。人物研究速度受智识与当前健康影响。
      </small>
    </section>
  );
}
