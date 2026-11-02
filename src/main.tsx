import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { GameClient } from './client';
import {
  BUILDINGS,
  JOB_NAMES,
  PARTS,
  RESOURCE_NAMES,
  RESOURCES,
  TECHS,
  WORK_NAMES,
  WORKS,
} from './sim/defs';
import { DAY, HOUR, TPS, type BuildingKind, type Pawn, type Resource, type Summary, type Inspection } from './sim/types';
import './style.css';
import './layout.css';
import { campAudio } from './audio';
const client = new GameClient();
const n = (v: number) => Math.floor(v).toLocaleString('zh-CN');
const day = (tick: number) => Math.floor((tick + HOUR * 8) / DAY) + 1;
const hour = (tick: number) =>
  `${String(Math.floor((tick / HOUR + 8) % 24)).padStart(2, '0')}:${String(Math.floor(((tick % HOUR) / HOUR) * 60)).padStart(2, '0')}`;
const names: Record<string, string> = {
  select: '选择',
  build: '建造',
  stock: '仓储区',
  farm: '谷物田',
  herb: '药草田',
  cut: '伐木',
  mine: '采矿',
  harvest: '采集浆果',
  cancel: '取消指令',
  demolish: '拆除',
  erase: '擦除区域',
};
const icons: Record<string, string> = {
  wood: '▤',
  steel: '▰',
  components: '⚙',
  raw: '♧',
  meal: '◒',
  ration: '▣',
  medicine: '✚',
  stone: '◆',
  silver: '◈',
};
function Bar({
  label,
  value,
  color = 'sage',
  suffix = '',
}: {
  label: string;
  value: number;
  color?: string;
  suffix?: string;
}) {
  return (
    <div className="need">
      <div>
        <span>{label}</span>
        <b>
          {Math.round(value)}
          {suffix}
        </b>
      </div>
      <i>
        <em className={color} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </i>
    </div>
  );
}
const natureNames = { tree: '树木', ore: '金属矿脉', berry: '浆果丛', rock: '岩石' };
function inspectionName(d: Inspection) {
  if (d.kind === 'missing') return '对象已消失';
  if (d.kind === 'pawn') return d.value.name + (d.value.animal ? ' · 野生动物' : d.value.enemy ? ' · 敌对' : '');
  if (d.kind === 'item') return RESOURCE_NAMES[d.value.kind];
  if (d.kind === 'nature') return natureNames[d.value.kind];
  if (d.kind === 'building') return BUILDINGS[d.value.kind].name;
  return d.value.crop === 'herb' ? '药草' : '谷物';
}
function ObjectInspector({ detail: d, tick }: { detail: Inspection; tick: number }) {
  if (d.kind === 'missing') return <p className="subtle">该对象已经耗尽、被搬走或移除。请重新选择。</p>;
  const v = d.value;
  return <div className="object-inspector" data-object-kind={d.kind} data-object-id={d.id}>
    <span className="eyebrow">{d.kind === 'pawn' ? '生物' : d.kind === 'item' ? '物品堆' : d.kind === 'nature' ? '自然资源' : '作物'}</span>
    <p className="subtle">坐标 {v.x.toFixed(1)}, {v.y.toFixed(1)} · 再次点击同一格可切换对象</p>
    {d.kind === 'pawn' && <>
      <p className="current-job">{d.value.dead ? '已经死亡' : d.value.downed ? '倒地' : d.value.job ? JOB_NAMES[d.value.job.kind] + (d.value.job.path.length ? ' · 正在移动' : '') : d.value.reason}</p>
      {d.value.animal && !d.value.job && !d.value.dead && d.value.waitUntil > tick && <p>{d.value.reason.includes('通行') ? '通路恢复后会继续漫游。' : `短暂休息 · 约 ${Math.ceil((d.value.waitUntil - tick) / TPS)} 秒`}</p>}
      <Bar label="血液" value={d.value.blood} color="rose" />
      <p>伤口 {d.value.wounds.length} 处 · 总伤害 {d.value.wounds.reduce((sum, w) => sum + w.damage, 0).toFixed(1)}</p>
      {!d.value.animal && <p>武器：{d.value.weapon === 'gun' ? '步枪' : '短刀'}</p>}
      <p className="subtle">{d.value.animal ? '野生动物自行活动，不能征召。' : d.value.enemy ? '敌对单位不可直接指挥；选择殖民者后右键攻击。' : d.value.dead ? '这名殖民者已经死亡。' : '选择殖民者头像可下达指令。'}</p>
    </>}
    {d.kind === 'item' && <>
      <div className="thought"><span>数量</span><b>{d.value.count.toFixed(1)}</b></div>
      <div className="thought"><span>已预留</span><b>{d.value.reserved.toFixed(1)}</b></div>
      <div className="thought"><span>可用数量</span><b>{Math.max(0, d.value.count - d.value.reserved).toFixed(1)}</b></div>
      <div className="thought"><span>存放时间</span><b>{(d.value.age / DAY).toFixed(2)} 日</b></div>
    </>}
    {d.kind === 'nature' && <>
      <div className="thought"><span>剩余产量</span><b>{d.value.amount}</b></div>
      <p>{d.value.marked ? '已安排采集 / 清理' : '尚未标记工作'}</p>
    </>}
    {d.kind === 'crop' && <Bar label="生长进度" value={d.value.growth * 100} />}
    <button onClick={() => client.focus(v.x, v.y)}>⌖ 定位</button>
  </div>;
}
function App() {
  const state = useSyncExternalStore(client.subscribe, client.snapshot);
  const s = state.summary;
  const host = useRef<HTMLDivElement>(null),
    file = useRef<HTMLInputElement>(null);
  const [tool, setTool] = useState('select'),
    [kind, setKind] = useState<BuildingKind>('bed'),
    [category, setCategory] = useState('居所'),
    [tab, setTab] = useState('overview'),
    [panelOpen, setPanelOpen] = useState(false),
    [detailTab, setDetailTab] = useState('needs'),
    [modal, setModal] = useState<string | null>('welcome'),
    [toast, setToast] = useState(''),
    [grid, setGrid] = useState(false),
    [seed, setSeed] = useState('73129'),
    [busy, setBusy] = useState(false),
    [audioEnabled, setAudioEnabled] = useState(true);
  useEffect(() => {
    const unlock = () => campAudio.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    client.onNotice = setToast;
    client.onToolCancel = () => choose('select');
    client.onInspect = (id) => {
      setPanelOpen(id !== null);
      if (id !== null) setTab('overview');
    };
    if (host.current) void client.mount(host.current);
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setModal(null);
        setPanelOpen(false);
        client.select([]);
        client.inspect(null, false);
        choose('select');
      }
    };
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', esc);
      client.destroy();
    };
  }, []);
  useEffect(() => {
    if (state.selection.length) {
      client.inspect(null, false);
      setTab('overview');
      setDetailTab('needs');
      setPanelOpen(true);
    }
  }, [state.selection]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 4500);
    return () => clearTimeout(id);
  }, [toast]);
  const choose = (t: string, b?: BuildingKind) => {
    setTool(t);
    setPanelOpen(false);
    if (b) setKind(b);
    client.tool(t, b);
  };
  const showPanel = (next: string) => {
    setTool('select');
    client.tool('select');
    setTab(next);
    setPanelOpen(true);
  };
  const togglePanel = (next: string) => {
    if (panelOpen && tab === next && !pawn && !inspection) setPanelOpen(false);
    else {
      client.select([]);
      client.inspect(null, false);
      showPanel(next);
    }
  };
  const cmd = (c: Parameters<typeof client.command>[0]) =>
    client.command(c).catch((e) => setToast(e.message));
  const action = async (fn: () => Promise<any>, success?: string) => {
    setBusy(true);
    try {
      await fn();
      if (success) setToast(success);
    } catch (e) {
      setToast(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };
  const save = () => action(() => client.save(), '营地已保存到浏览器');
  const exportSave = () =>
    action(async () => {
      const data = await client.export();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data)], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = `emberfield-day-${day(data.tick)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, '存档文件已导出');
  const colonists = s?.pawns.filter((p) => !p.enemy) ?? [];
  const selected = colonists.filter((p) => state.selection.includes(p.id));
  const pawn = selected[0];
  const inspection = state.inspection;
  const building = inspection?.kind === 'building' ? inspection.value : undefined;
  const threats = s?.pawns.filter((p) => p.enemy && !p.dead && !p.downed) ?? [];
  const foods = s
    ? (s.inventory.meal + s.inventory.ration + s.inventory.raw / 18) /
      Math.max(1, colonists.filter((p) => !p.dead).length) /
      2.2
    : 0;
  const progress = s
    ? [
        {
          label: '建造三张床',
          done:
            s.buildings.filter((b) => b.kind === 'bed' && b.paid && b.progress >= 400).length >= 3,
        },
        { label: '种下第一片谷物', done: s.cropCount >= 12 },
        { label: '烹饪第一顿简餐', done: s.stats.cooked > 0 },
        { label: '抵御首次袭击', done: s.stats.raids > 0 && !threats.length },
        {
          label: '研究通信，建造信标',
          done: s.buildings.some((b) => b.kind === 'beacon' && b.progress >= 3000),
        },
      ]
    : [];
  const open = (m: string) => {
    client.speed(0);
    setModal(m);
  };
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <div>
            <strong>余烬边境</strong>
            <small>松风前哨 · 温带山谷</small>
          </div>
        </div>
        <div className="top-actions">
          <button onClick={() => open('help')} title="操作说明">
            ? <span>指南</span>
          </button>
          <button onClick={() => void save()} disabled={busy}>
            ↓ <span>保存</span>
          </button>
        </div>
      </header>
      <div className="resource-strip">
        <div className="resource-label">营地资源</div>
        {(
          [
            'silver',
            'wood',
            'steel',
            'stone',
            'raw',
            'meal',
            'ration',
            'medicine',
            'components',
          ] as Resource[]
        ).map((r) => (
          <div
            className={`resource ${r === 'meal' && s && s.inventory.meal < 3 ? 'low' : ''}`}
            key={r}
            title={`${RESOURCE_NAMES[r]}：总计${n(s?.inventory[r] ?? 0)} / 可用${n(s?.available[r] ?? 0)}`}
          >
            <span>{icons[r]}</span>
            <div>
              <small>{RESOURCE_NAMES[r]}</small>
              <b>{n(s?.inventory[r] ?? 0)}</b>
            </div>
          </div>
        ))}
        <div className="food-days">
          <small>预计口粮</small>
          <strong className={foods < 1.5 ? 'danger-text' : ''}>
            {foods.toFixed(1)} <span>日</span>
          </strong>
        </div>
      </div>
      <main className="workspace">
        <section className="map-area" aria-label="游戏区域">
          <div ref={host} className="canvas-host" />
          <div className="map-vignette" />
          <div className="map-top">
            <div className="map-tools">
              <button
                onClick={() => {
                  setGrid(!grid);
                  client.grid(!grid);
                }}
                className={grid ? 'active' : ''}
                title="显示格网"
              >
                ▦
              </button>
              <button onClick={() => client.focus(45, 47)} title="返回营地">
                ⌖
              </button>
              <button onClick={() => open('metrics')} title="性能监视">
                ◴
              </button>
            </div>
          </div>
          <div className="colonist-row">
            {colonists.map((p) => (
              <button
                key={p.id}
                className={`colonist-card ${state.selection.includes(p.id) ? 'selected' : ''} ${p.dead ? 'dead' : ''}`}
                onClick={() => {
                  client.select([p.id]);
                  client.focus(p.x, p.y);
                  client.inspect(null, false);
                  showPanel('overview');
                }}
                aria-label={`选择${p.name}`}
              >
                <span
                  className="portrait"
                  style={{ '--person': `#${p.color.toString(16)}` } as React.CSSProperties}
                >
                  <i />
                  <em />
                </span>
                <div>
                  <strong>
                    {p.name}
                    <span>{p.dead ? ' †' : p.drafted ? ' ⚑' : ''}</span>
                  </strong>
                  <small>
                    {p.dead
                      ? '已逝'
                      : p.downed
                        ? '倒地 · 需要救援'
                        : p.job
                          ? JOB_NAMES[p.job.kind]
                          : '待命'}
                  </small>
                  <i className="mini-meter">
                    <b style={{ width: `${p.mood}%` }} />
                  </i>
                </div>
              </button>
            ))}
          </div>
          {state.speed === 0 && state.ready && modal !== 'welcome' && (
            <div className="paused-badge">
              Ⅱ 时间已暂停 <small>SPACE 继续</small>
            </div>
          )}
          {threats.length > 0 && (
            <button
              className="threat-alert"
              onClick={() => {
                client.focus(threats[0].x, threats[0].y);
                showPanel('events');
              }}
            >
              ⚠ {threats.length} 名掠夺者正在营地附近 · 点击定位
            </button>
          )}
          <div className="hud-notices" aria-label="营地提醒">
            {foods < 1.5 && (
              <button
                className="notice-warning"
                onClick={() => {
                  client.select([]);
                  client.inspect(null, false);
                  showPanel('overview');
                }}
              >
                食物储备不足 <b>{foods.toFixed(1)} 日</b>
              </button>
            )}
            {(s?.stats.built ?? 0) < 3 && (
              <button onClick={() => choose('build')}>
                需要住所 <span>安排床铺与灶台</span>
              </button>
            )}
            {!s?.tutorialHidden && (
              <button
                onClick={() => {
                  client.select([]);
                  client.inspect(null, false);
                  showPanel('overview');
                }}
              >
                营地指引{' '}
                <span>
                  {progress.filter((p) => p.done).length} / {progress.length}
                </span>
              </button>
            )}
            <button className="research-notice" onClick={() => showPanel('research')}>
              <span>研究 · {s?.researchTarget ? TECHS[s.researchTarget]?.name : '尚未安排'}</span>
              <small>
                {s?.researchTarget
                  ? `${n(s.research[s.researchTarget] ?? 0)} / ${TECHS[s.researchTarget]?.cost ?? 0}`
                  : ''}
              </small>
            </button>
          </div>
          {!state.ready && (
            <div className="loading">
              正在展开山谷…<small>初始化模拟与渲染线程</small>
            </div>
          )}
          {state.error && (
            <div className="runtime-error">
              <strong>运行遇到问题</strong>
              <p>{state.error}</p>
              <button onClick={() => (location.href = '?backend=main')}>
                使用兼容模式重新打开
              </button>
            </div>
          )}
          <div className="map-bottom" hidden={tool === 'select'}>
            <div className="context-hint">
              <span>
                {tool === 'select' ? '↖' : tool === 'build' ? BUILDINGS[kind].icon : '▧'}
              </span>
              <div>
                <strong>{tool === 'build' ? `放置${BUILDINGS[kind].name}` : names[tool]}</strong>
                <small>
                  {tool === 'select'
                    ? '左键选择 / 框选 · 右键指令 · 中键平移 · 滚轮缩放'
                    : tool === 'build'
                      ? `${kind === 'wall' || kind === 'wire' ? '拖拽直线放置蓝图' : '点击放置蓝图'} · 工人搬料施工 · 右键 / ESC 退出`
                      : '拖动框选区域 · 松开鼠标确认 · ESC 退出'}
                </small>
              </div>
              <span className="coords">
                {state.hover ? `${state.hover.x} , ${state.hover.y}` : '45 , 47'}
              </span>
            </div>
            {tool === 'build' && (
              <div className="build-palette">
                <div className="palette-tabs">
                  {['居所', '生产', '电力', '防御'].map((c) => (
                    <button
                      key={c}
                      className={category === c ? 'active' : ''}
                      onClick={() => setCategory(c)}
                    >
                      {c}
                    </button>
                  ))}
                  <small>{kind === 'wall' || kind === 'wire' ? '拖拽直线 · 松手整段放置' : '蓝图不立即扣材料'}</small>
                </div>
                {state.preview && (
                  <div className={`build-preview-status ${state.preview.ok ? state.preview.warnings.length ? 'warning' : 'valid' : 'invalid'}`} role="status" aria-label="建造预览">
                    <strong>{state.preview.reason}</strong>
                    {state.preview.warnings.map((warning) => <span key={warning}>{warning}</span>)}
                    <span>总需求：{Object.entries(state.preview.cost).map(([r, v]) => `${v}${RESOURCE_NAMES[r as Resource]}`).join(' · ') || '无'}</span>
                    {!!Object.keys(state.preview.missing).length && <span>尚缺：{Object.entries(state.preview.missing).map(([r, v]) => `${Math.ceil(v!)}${RESOURCE_NAMES[r as Resource]}`).join(' · ')}（可先规划）</span>}
                    {!state.preview.ok && <span>红格无效，整段不会放置；请调整终点。</span>}
                  </div>
                )}
                <div className="build-items">
                  {(Object.keys(BUILDINGS) as BuildingKind[])
                    .filter((k) => BUILDINGS[k].category === category)
                    .map((k) => {
                      const b = BUILDINGS[k],
                        locked = b.tech && (!s || (s.research[b.tech] ?? 0) < TECHS[b.tech].cost);
                      return (
                        <button
                          key={k}
                          onClick={() => choose('build', k)}
                          disabled={!!locked}
                          className={`${kind === k ? 'active' : ''} ${locked ? 'locked' : ''}`}
                          title={`${b.description}${locked ? ' · 需要' + TECHS[b.tech!].name : ''}`}
                        >
                          <span>{locked ? '⌑' : b.icon}</span>
                          <strong>{b.name}</strong>
                          <small>
                            {Object.entries(b.cost)
                              .map(([r, v]) => `${v}${RESOURCE_NAMES[r as Resource]}`)
                              .join(' · ')}
                          </small>
                        </button>
                      );
                    })}
                </div>
              </div>
            )}
            {['stock', 'farm', 'herb', 'erase'].includes(tool) && (
              <div className="zone-palette">
                {[
                  ['stock', '▦', '仓储区', '工人把散落物资搬来'],
                  ['farm', '♧', '谷物田', '3日成熟 · 每格8食材'],
                  ['herb', '✚', '药草田', '6日成熟 · 每格2药品'],
                  ['erase', '⊘', '擦除区域', '已有作物保留'],
                ].map(([t, icon, label, desc]) => (
                  <button key={t} className={tool === t ? 'active' : ''} onClick={() => choose(t)}>
                    <span>{icon}</span>
                    <div>
                      <strong>{label}</strong>
                      <small>{desc}</small>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {['cut', 'harvest'].includes(tool) && (
              <div className="zone-palette">
                {[
                  ['cut', '♧', '伐木', '每棵树提供25木材'],
                  ['harvest', '◒', '采集浆果', '应急食材来源'],
                ].map(([t, icon, label, desc]) => (
                  <button key={t} className={tool === t ? 'active' : ''} onClick={() => choose(t)}>
                    <span>{icon}</span>
                    <div>
                      <strong>{label}</strong>
                      <small>{desc}</small>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
        <aside
          className={`sidebar panel-${tab} ${pawn || inspection ? 'inspector' : 'colony-panel'}`}
          hidden={!panelOpen}
          aria-label="信息面板"
        >
          <div className="sidebar-head">
            <h2>
              {tab === 'work'
                ? '工作与作息'
                : tab === 'research'
                  ? '研究'
                  : tab === 'events'
                    ? '营地纪事'
                    : pawn
                      ? `${pawn.name} · 幸存者`
                      : building
                        ? BUILDINGS[building.kind].name
                        : inspection ? inspectionName(inspection) : '营地概览'}
            </h2>
            <button
              onClick={() => { setPanelOpen(false); client.inspect(null, false); }}
              aria-label="收起信息面板"
              title="收起信息面板 · Esc"
            >
              ×
            </button>
          </div>
          <div className="side-scroll">
            {tab === 'overview' && (
              <>
                {pawn ? (
                  <>
                    <div className="person-heading">
                      <p className="person-role">{pawn.role}</p>
                      <p className="current-job">
                        {pawn.dead
                          ? '生命已经结束'
                          : pawn.downed
                            ? '倒地 · 正在等待救援'
                            : pawn.job
                              ? `${JOB_NAMES[pawn.job.kind]}${pawn.job.path.length ? ' · 正在赶往目标' : ''}`
                              : pawn.reason}
                      </p>
                    </div>
                    <div className="button-row">
                      <button
                        className={pawn.drafted ? 'primary' : ''}
                        onClick={() =>
                          void cmd({ type: 'draft', ids: state.selection, value: !pawn.drafted })
                        }
                        disabled={pawn.dead || pawn.downed}
                      >
                        {pawn.drafted ? '解除征召' : '⚑ 征召'} <kbd>R</kbd>
                      </button>
                      <button onClick={() => client.focus(pawn.x, pawn.y)}>⌖ 定位</button>
                    </div>
                    <nav className="detail-tabs" aria-label="人物信息分类">
                      {[
                        ['needs', '状态'],
                        ['health', '健康'],
                        ['skills', '技能'],
                      ].map(([id, label]) => (
                        <button
                          key={id}
                          className={detailTab === id ? 'active' : ''}
                          onClick={() => setDetailTab(id)}
                        >
                          {label}
                        </button>
                      ))}
                    </nav>
                    {detailTab === 'needs' && (
                      <>
                        <div className="needs">
                          <Bar label="营养" value={pawn.food * 100} />
                          <Bar label="精力" value={pawn.rest} />
                          <Bar label="心情" value={pawn.mood} color="gold" />
                          <Bar label="娱乐" value={pawn.joy} />
                          <Bar label="血液" value={pawn.blood} color="rose" />
                        </div>
                        {pawn.thoughts.map((t) => (
                          <div className="thought" key={t.text}>
                            <span>{t.text}</span>
                            <b className={t.value > 0 ? 'good-text' : 'danger-text'}>
                              {t.value > 0 ? '+' : ''}
                              {t.value}
                            </b>
                          </div>
                        ))}
                      </>
                    )}
                    {detailTab === 'health' && (
                      <>
                        <h3>身体状况</h3>
                        {pawn.wounds.length ? (
                          pawn.wounds.map((v, i) => (
                            <div key={i} className="wound">
                              <b>{PARTS[v.part]}</b>
                              <span>
                                {v.damage.toFixed(1)} 伤害 · {v.tended ? '已包扎' : '出血中'}
                              </span>
                            </div>
                          ))
                        ) : (
                          <p className="subtle">身体健康，可以正常工作。</p>
                        )}
                      </>
                    )}
                    {detailTab === 'skills' && (
                      <>
                        <h3>岗位技能</h3>
                        <div className="skills">
                          {WORKS.map((k) => (
                            <div key={k}>
                              <span>{WORK_NAMES[k]}</span>
                              <b>{pawn.skills[k]}</b>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </>
                ) : building ? (
                  <>
                    <span className="eyebrow">STRUCTURE / {building.id}</span>
                    <h2>{BUILDINGS[building.kind].name}</h2>
                    <p className="subtle">{BUILDINGS[building.kind].description}</p>
                    <Bar
                      label="施工进度"
                      value={(building.progress / BUILDINGS[building.kind].work / HOUR) * 100}
                    />
                    <h3>已送达材料</h3>
                    {Object.entries(BUILDINGS[building.kind].cost).map(([r, c]) => (
                      <div className="thought" key={r}>
                        <span>{RESOURCE_NAMES[r as Resource]}</span>
                        <b>
                          {n(building.delivered[r as Resource] ?? 0)} / {c}
                        </b>
                      </div>
                    ))}
                    <p className="subtle">
                      {building.powered
                        ? '● 正在运行 / 已供电'
                        : building.paid
                          ? '材料齐备'
                          : '等待搬运材料'}
                    </p>
                    <button onClick={() => void cmd({ type: 'toggle', id: building.id })}>
                      {building.enabled ? '关闭设备' : '启用设备'}
                    </button>
                  </>
                ) : inspection ? (
                  <ObjectInspector detail={inspection} tick={s?.tick ?? 0} />
                ) : (
                  <>
                    <div className="weather-card">
                      <span>
                        {s?.weather === 'rain' ? '☂' : s?.weather === 'cold' ? '❄' : '☀'}
                      </span>
                      <div>
                        <strong>
                          {s?.weather === 'rain'
                            ? '山谷有雨'
                            : s?.weather === 'cold'
                              ? '冷空气过境'
                              : '晴朗的山谷'}
                        </strong>
                        <small>{Math.round(s?.temperature ?? 22)}°C · 适宜生存</small>
                      </div>
                    </div>
                    <div className="summary-cards">
                      <div>
                        <span>幸存者</span>
                        <b>
                          {colonists.filter((p) => !p.dead).length}
                          <small> 人</small>
                        </b>
                      </div>
                      <div>
                        <span>营地建筑</span>
                        <b>
                          {s?.stats.built ?? 0}
                          <small> 座</small>
                        </b>
                      </div>
                    </div>
                    <p className="intro-copy">
                      {(s?.stats.built ?? 0) < 3 ? (
                        <>
                          我们还没有家。
                          <br />
                          但我们有彼此，还有这片山谷。
                        </>
                      ) : (
                        <>
                          一座营地，正在成为家。
                          <br />
                          愿每一盏灯，都能等到归人。
                        </>
                      )}
                    </p>
                    <p className="subtle">
                      选择一名幸存者，查看需求、伤情和当前工作。任务会按照工作优先级自动执行。
                    </p>
                  </>
                )}
                {!pawn && !inspection && (
                  <>
                    {!s?.tutorialHidden && (
                      <div className="objectives">
                        <div className="section-title">
                          <h3>从一处落脚点开始</h3>
                          <span>
                            {progress.filter((p) => p.done).length}/{progress.length}
                          </span>
                        </div>
                        {progress.map((p, i) => (
                          <div className={p.done ? 'complete' : ''} key={p.label}>
                            <span>{p.done ? '✓' : String(i + 1).padStart(2, '0')}</span>
                            <p>{p.label}</p>
                          </div>
                        ))}
                        <button
                          className="text-button"
                          onClick={() => void cmd({ type: 'tutorial' })}
                        >
                          收起指引
                        </button>
                      </div>
                    )}
                    <h3>厨房账单</h3>
                    <div className="bill">
                      <span>简餐储备目标</span>
                      <div>
                        <button
                          onClick={() =>
                            void cmd({ type: 'mealTarget', value: (s?.mealTarget ?? 14) - 2 })
                          }
                        >
                          −
                        </button>
                        <b>{s?.mealTarget ?? 14}</b>
                        <button
                          onClick={() =>
                            void cmd({ type: 'mealTarget', value: (s?.mealTarget ?? 14) + 2 })
                          }
                        >
                          +
                        </button>
                      </div>
                    </div>
                    <p className="subtle small">达到目标后自动停工。每餐消耗10食材和0.4木材。</p>
                    <h3>电力与救援</h3>
                    <div className="power-row">
                      <span>发电 / 负载</span>
                      <b>
                        {n(s?.power.generated ?? 0)} / {n(s?.power.demand ?? 0)} W
                      </b>
                    </div>
                    <div className="power-row">
                      <span>蓄电</span>
                      <b>{(s?.power.stored ?? 0).toFixed(2)} kWh</b>
                    </div>
                    {s?.outcome === 'won' ? (
                      <p className="subtle">救援已完成，继续经营。营地仍会遇到普通袭击。</p>
                    ) : s?.beaconActive ? (
                      <>
                        <Bar
                          label="救援信号"
                          value={(s.beaconTicks / (DAY * 2)) * 100}
                          color="gold"
                        />
                        <p className="subtle">需要持续供电。半日、一日半各有一波袭击。</p>
                      </>
                    ) : (
                      <button
                        className="beacon-button"
                        onClick={() => void cmd({ type: 'beacon' })}
                      >
                        ⌁ 启动救援信标
                      </button>
                    )}
                  </>
                )}
              </>
            )}
            {tab === 'work' && (
              <>
                <h3>让合适的人，做合适的事。</h3>
                <p className="subtle">
                  1最优先，4最低，—不参与。点击数字循环调整。低营养和休息会优先于工作。
                </p>
                <div className="work-table">
                  <div className="work-row heading">
                    <span>幸存者</span>
                    {WORKS.map((k) => (
                      <b key={k}>{WORK_NAMES[k]}</b>
                    ))}
                  </div>
                  {colonists.map((p) => (
                    <div className="work-row" key={p.id}>
                      <span>{p.name}</span>
                      {WORKS.map((k) => (
                        <button
                          key={k}
                          className={`priority p${p.priorities[k]}`}
                          title={`${p.name} · ${WORK_NAMES[k]} · 技能 ${p.skills[k]}`}
                          aria-label={`${p.name}的${WORK_NAMES[k]}优先级`}
                          onClick={() =>
                            void cmd({
                              type: 'priority',
                              id: p.id,
                              work: k,
                              value: (p.priorities[k] + 1) % 5,
                            })
                          }
                        >
                          {p.priorities[k] || '—'}
                          <small>{p.skills[k]}</small>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
                <h3>作息安排</h3>
                {colonists.map((p) => (
                  <label className="schedule" key={p.id}>
                    <span>{p.name}</span>
                    <select
                      value={p.schedule}
                      onChange={(e) =>
                        void cmd({
                          type: 'schedule',
                          id: p.id,
                          value: e.target.value as Pawn['schedule'],
                        })
                      }
                    >
                      <option value="balanced">白天工作 · 夜晚休息</option>
                      <option value="night">夜间工作 · 白天休息</option>
                      <option value="work">优先工作 · 疲劳才休息</option>
                    </select>
                  </label>
                ))}
                <button
                  onClick={() =>
                    void cmd({
                      type: 'draft',
                      ids: colonists.filter((p) => !p.dead).map((p) => p.id),
                      value: false,
                    })
                  }
                >
                  全员解除征召
                </button>
              </>
            )}
            {tab === 'research' && (
              <>
                <h3>从木屋，走向星空。</h3>
                <p className="subtle">
                  需要建成研究桌，并启用研究岗位。研究消耗实际劳动；完成基础电力后可以选择分支。
                </p>
                {Object.entries(TECHS).map(([id, t]) => {
                  const value = s?.research[id] ?? 0,
                    done = value >= t.cost,
                    locked = !!t.prereq && (s?.research[t.prereq] ?? 0) < TECHS[t.prereq].cost;
                  return (
                    <button
                      className={`tech ${s?.researchTarget === id ? 'active' : ''} ${done ? 'done' : ''}`}
                      key={id}
                      disabled={locked || done}
                      onClick={() => void cmd({ type: 'research', target: id })}
                    >
                      <div>
                        <span>
                          {done ? '✓' : locked ? '⌑' : s?.researchTarget === id ? '◌' : '◇'}
                        </span>
                        <strong>{t.name}</strong>
                        <small>
                          {n(value)}/{t.cost}
                        </small>
                      </div>
                      <p>{t.description}</p>
                      <i>
                        <em style={{ width: `${(value / t.cost) * 100}%` }} />
                      </i>
                    </button>
                  );
                })}
              </>
            )}
            {tab === 'events' && (
              <>
                <div className="section-title">
                  <h3>每一天都留下痕迹</h3>
                  <span>{s?.logs.length ?? 0}</span>
                </div>
                <div className="journal">
                  {[...(s?.logs ?? [])].reverse().map((l) => (
                    <button
                      className={`journal-entry ${l.type}`}
                      key={l.id}
                      onClick={() => {
                        if (l.x !== undefined && l.y !== undefined) client.focus(l.x, l.y);
                      }}
                    >
                      <small>
                        第 {day(l.tick)} 日 · {hour(l.tick)}
                      </small>
                      <p>{l.text}</p>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="side-footer">
            <span className="live-dot" /> 本地单人世界
            <span>
              {state.metrics.backend}
              {state.metrics.renderWorker ? ' · Worker' : ''}
            </span>
          </div>
        </aside>
      </main>
      <footer className="timebar">
        <div className="command-bar">
          <div className="tool-rail">
            {[
              ['select', '↖', '选择'],
              ['build', '⌂', '建造'],
              ['stock', '▦', '区域'],
              ['cut', '♧', '采集'],
              ['mine', '◆', '采矿'],
            ].map(([id, icon, label]) => (
              <button
                key={id}
                className={
                  tool === id ||
                  (id === 'stock' && ['farm', 'herb', 'erase'].includes(tool)) ||
                  (id === 'cut' && tool === 'harvest')
                    ? 'active'
                    : ''
                }
                onClick={() => choose(id)}
                title={label}
              >
                <span>{icon}</span>
                <small>{label}</small>
              </button>
            ))}
            <i />
            <button onClick={() => choose('cancel')} className={tool === 'cancel' ? 'active' : ''}>
              <span>⊘</span>
              <small>取消</small>
            </button>
            <button
              onClick={() => choose('demolish')}
              className={tool === 'demolish' ? 'active' : ''}
            >
              <span>⌫</span>
              <small>拆除</small>
            </button>
          </div>
          <nav className="colony-nav" aria-label="营地管理">
            {[
              ['overview', '概览'],
              ['work', '分工'],
              ['research', '研究'],
              ['events', '纪事'],
            ].map(([id, label]) => (
              <button
                key={id}
                className={panelOpen && tab === id ? 'active' : ''}
                aria-expanded={panelOpen && tab === id}
                onClick={() => togglePanel(id)}
              >
                {label}
              </button>
            ))}
            <button onClick={() => open('settings')} aria-label="菜单与存档">
              菜单
            </button>
          </nav>
        </div>
        <div className="world-status">
          <div className="environment-status">
            <span>
              {s?.weather === 'rain' ? '☂ 雨' : s?.weather === 'cold' ? '❄ 寒潮' : '☀ 晴'}
            </span>
            <span>室外 {Math.round(s?.temperature ?? 22)}°C</span>
            <span>{state.hover ? `${state.hover.x}, ${state.hover.y}` : '松风前哨'}</span>
          </div>
          <div className="date">
            <span>◷</span>
            <strong>第 {day(s?.tick ?? 0)} 日</strong>
            <small>{hour(s?.tick ?? 0)} · 春</small>
          </div>
          <div className="speed-controls">
            {[
              [0, 'Ⅱ'],
              [1, '▶'],
              [3, '▶▶'],
              [6, '▶▶▶'],
            ].map(([v, label]) => (
              <button
                key={v}
                onClick={() => client.speed(Number(v))}
                className={state.speed === v ? 'active' : ''}
                aria-label={v === 0 ? '暂停' : `${v}倍速`}
              >
                <span>{label}</span>
                <small>{v === 0 ? '暂停' : `${v}×`}</small>
              </button>
            ))}
          </div>
          <button className="save-status" onClick={() => open('settings')}>
            {state.metrics.saveStatus} <span>↗</span>
          </button>
        </div>
      </footer>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      {modal && (
        <div className="modal-backdrop">
          <section
            className={`modal ${modal === 'welcome' ? 'welcome' : ''}`}
            role="dialog"
            aria-modal="true"
          >
            <button className="modal-close" onClick={() => setModal(null)} aria-label="关闭">
              ×
            </button>
            {modal === 'welcome' && (
              <>
                <div className="welcome-art">
                  <div className="orbit o1" />
                  <div className="orbit o2" />
                  <div className="planet" />
                  <span className="star s1">✦</span>
                  <span className="star s2">✦</span>
                  <div className="welcome-coordinates">
                    SIGNAL LOST / 07:42
                    <br />
                    CREW SURVIVING / 03
                  </div>
                  <div className="welcome-trees">♠ ♠ ♠</div>
                </div>
                <div className="welcome-copy">
                  <span className="eyebrow">一段新的殖民地故事</span>
                  <h1>
                    星光熄灭之后，
                    <br />
                    还有一簇余烬。
                  </h1>
                  <p>
                    三名勘探者，一艘坠毁的逃生舱。
                    <br />
                    在失联星球的山谷中，建造住所、种植粮食，
                    <br />
                    照顾彼此，寻找回家的信号。
                  </p>
                  <div className="welcome-facts">
                    <span>
                      3 <small>名幸存者</small>
                    </span>
                    <span>
                      96² <small>格原野</small>
                    </span>
                    <span>
                      01 <small>个新起点</small>
                    </span>
                  </div>
                  <button
                    className="primary start-button"
                    disabled={!state.ready}
                    onClick={() => {
                      setModal(null);
                      client.speed(1);
                    }}
                  >
                    建立我们的营地 <span>↗</span>
                  </button>
                  <small className="welcome-note">
                    建议先暂停，建三张床、灶台和一片 6×8 谷物田。
                  </small>
                </div>
              </>
            )}
            {modal === 'help' && (
              <>
                <span className="eyebrow">FIELD GUIDE</span>
                <h2>你安排方向，他们负责生活。</h2>
                <div className="help-grid">
                  <p>
                    <b>① 安顿</b>
                    在建造栏放置三张床、燃木灶台，拖动划定仓储区。工人会自行搬运、施工。
                  </p>
                  <p>
                    <b>② 食物</b>
                    划一片6×8谷物田。谷物约3日成熟，灶台按账单自动补足简餐。持续伐木补充燃料。
                  </p>
                  <p>
                    <b>③ 防御与救援</b>
                    第4日前后有首次袭击。选择人物按R征召，右键站位；射程内自动攻击。战后解除征召，医师会救援和包扎。
                  </p>
                  <p>
                    <b>④ 回家的信号</b>
                    建研究桌，研究基础电力→远程通信→救援信标。发电机用导线连接信标，启动后坚持两日，抵御两波袭击。
                  </p>
                </div>
                <div className="keyboard-help">
                  <span>
                    <kbd>SPACE</kbd> 暂停
                  </span>
                  <span>
                    <kbd>1 / 2 / 3</kbd> 倍速
                  </span>
                  <span>
                    <kbd>WASD</kbd> 镜头
                  </span>
                  <span>
                    <kbd>R</kbd> 征召
                  </span>
                  <span>中键拖动 · 滚轮缩放</span>
                </div>
                <p className="subtle">
                  地图中的闪亮矿石可以开采金属；浆果提供应急食材。无法工作时，查看人物面板的原因。高危事件默认自动暂停。
                </p>
                <button className="primary" onClick={() => setModal(null)}>
                  回到营地
                </button>
              </>
            )}
            {modal === 'settings' && (
              <>
                <span className="eyebrow">CAMP RECORDS</span>
                <h2>把这段故事留下来。</h2>
                <p className="subtle">
                  手动与自动存档分别保存。页面切到后台会暂停；浏览器清理站点数据会删除本地存档，请定期导出。
                </p>
                <div className="settings-actions">
                  <button onClick={() => void save()} disabled={busy}>
                    保存到手动槽
                  </button>
                  <button
                    onClick={() => void action(() => client.load(), '已载入手动存档')}
                    disabled={busy}
                  >
                    读取手动存档
                  </button>
                  <button
                    onClick={() => void action(() => client.load('auto'), '已载入自动存档')}
                    disabled={busy}
                  >
                    读取自动存档
                  </button>
                  <button onClick={() => void exportSave()} disabled={busy}>
                    导出 JSON 存档
                  </button>
                  <button onClick={() => file.current?.click()} disabled={busy}>
                    导入存档文件
                  </button>
                  <button onClick={() => setModal('metrics')}>性能与内存</button>
                </div>
                <input
                  ref={file}
                  type="file"
                  accept=".json"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f)
                      void action(async () => {
                        if (f.size > 20 * 1024 * 1024) throw new Error('文件超过20MiB，无法导入');
                        await client.import(JSON.parse(await f.text()));
                      }, '存档已导入');
                    e.target.value = '';
                  }}
                />
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={s?.autoPause ?? true}
                    onChange={(e) => void cmd({ type: 'autoPause', value: e.target.checked })}
                  />{' '}
                  袭击、倒地和死亡时自动暂停
                </label>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={audioEnabled}
                    onChange={(e) => {
                      setAudioEnabled(e.target.checked);
                      campAudio.enabled = e.target.checked;
                    }}
                  />{' '}
                  游戏音效
                </label>
                <div className="new-world">
                  <h3>新的山谷</h3>
                  <p className="subtle">当前未保存的进度将被新世界替换。</p>
                  <input
                    aria-label="世界种子"
                    value={seed}
                    onChange={(e) => setSeed(e.target.value)}
                    inputMode="numeric"
                  />
                  <button
                    onClick={() =>
                      void action(async () => {
                        await client.newGame(Number(seed) || 73129);
                        setModal(null);
                        client.focus(45, 47);
                        choose('select');
                      }, '新营地已建立，时间暂停')
                    }
                  >
                    使用此种子重新开始
                  </button>
                </div>
              </>
            )}
            {modal === 'metrics' && (
              <>
                <span className="eyebrow">RUNTIME OBSERVATORY</span>
                <h2>世界正在怎样运行</h2>
                <div className="metrics-grid">
                  {[
                    ['渲染后端', state.metrics.backend],
                    ['渲染线程', state.metrics.renderWorker ? '专用 Worker' : '主线程兼容路径'],
                    ['画面帧率', `${state.metrics.fps.toFixed(0)} FPS`],
                    ['实际逻辑频率', `${state.metrics.tps.toFixed(1)} TPS`],
                    ['平均 tick', `${state.metrics.tickMs.toFixed(3)} ms`],
                    ['tick P95', `${state.metrics.tickP95.toFixed(3)} ms`],
                    ['显示传输', `${(state.metrics.sentBytes / 1024).toFixed(0)} KiB/s`],
                    ['在场实体', n(s?.entityCount ?? 0)],
                    ['格网数组', `${((s?.gridBytes ?? 0) / 1024).toFixed(0)} KiB`],
                    ['显示缓冲', `${(state.metrics.displayBytes / 1024).toFixed(0)} KiB`],
                    ['生成图集估算', `${(state.metrics.textureBytes / 1024).toFixed(0)} KiB`],
                    ['缓冲池上限', '3 个'],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <small>{label}</small>
                      <strong>{value}</strong>
                    </div>
                  ))}
                </div>
                <p className="subtle">
                  这些是应用资源计数和时间测量，不代表整页内存、GPU驱动或浏览器进程占用。全量内存需用浏览器任务管理器和各Worker堆快照检查。
                </p>
                <div className="button-row">
                  <a href="?backend=webgpu">WebGPU</a>
                  <a href="?backend=webgl">WebGL Worker</a>
                  <a href="?backend=main">兼容模式</a>
                </div>
                <p className="subtle small">切换路径会重新加载页面，请先保存。</p>
              </>
            )}
          </section>
        </div>
      )}
      {s && (s.outcome === 'lost' || (s.outcome === 'won' && !s.continueAfterWin)) && (
        <div className="modal-backdrop outcome">
          <section className="modal">
            <span className="eyebrow">
              {s.outcome === 'won' ? 'SIGNAL RECEIVED' : 'END OF CHAPTER'}
            </span>
            <h1>{s.outcome === 'won' ? '我们等到了，回家的光。' : '山谷记得你们来过。'}</h1>
            <p>
              {s.outcome === 'won'
                ? '救援飞船收到了信标，你们的故事可以在这里画上句号，也可以继续。'
                : '营地已经没有幸存者。你可以读取先前存档，重新选择他们的命运。'}
            </p>
            <div className="welcome-facts">
              <span>
                {day(s.tick)}
                <small>个日夜</small>
              </span>
              <span>
                {s.stats.built}
                <small>座建筑</small>
              </span>
              <span>
                {s.stats.cooked}
                <small>顿热饭</small>
              </span>
            </div>
            <div className="button-row">
              {s.outcome === 'won' && (
                <button className="primary" onClick={() => void cmd({ type: 'continue' })}>
                  留下，继续经营
                </button>
              )}
              <button onClick={() => void action(() => client.load())}>读取存档</button>
              <button onClick={() => void exportSave()}>导出这段故事</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
declare global {
  interface Window {
    ember: {
      snapshot: () => ReturnType<GameClient['snapshot']>;
      command: GameClient['command'];
      exportSave: GameClient['export'];
      speed: GameClient['speed'];
      focus: GameClient['focus'];
    };
  }
}
window.ember = {
  snapshot: client.snapshot,
  command: (c) => client.command(c),
  exportSave: () => client.export(),
  speed: (v) => client.speed(v),
  focus: (x, y) => client.focus(x, y),
};
createRoot(document.getElementById('root')!).render(<App />);
