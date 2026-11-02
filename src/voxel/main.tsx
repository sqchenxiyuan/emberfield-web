import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { VoxelClient } from './client';
import { CROPS, NUTRITION } from './farming';
import { ASSIGNMENT_NAMES } from './rest';
import {
  BLOCK_NAMES,
  JOB_NAMES,
  RESOURCE_NAMES,
  TOOL_NAMES,
  DAY,
  bedCells,
  type Assignment,
  type CropKind,
  type Pos,
  type Resource,
  type Tool,
  type Work,
} from './types';
import './style.css';
const client = new VoxelClient();
const tools: Tool[] = [
  'inspect',
  'cut',
  'mine',
  'shaft',
  'up',
  'floor',
  'wall',
  'ladder',
  'stock',
  'farm',
  'stove',
  'bed',
  'door',
  'clearZone',
  'remove',
  'cancel',
];
const icons = ['↖', '♠', '⛏', '↧', '↥', '▱', '▥', '☷', '▧', '♧', '♨', '▰', '▯', '▨', '⌫', '×'];
const hints: Record<Tool, string> = {
  inspect: '点击人物、物资或地形查看详情。选中人物后，可在面板中选择目标位置并下达移动。',
  cut: '点击或框选成熟树木。工人伐木产生 27 木材，搬运到仓储。',
  mine: '点击或框选岩土。工人从相邻工作面挖开两格高通道；先建通路再深入。',
  shaft: '在可站立地面点击一次，向下逐格开凿三格梯井。完整入口消耗 8 木材。',
  up: '在可站立地面点击一次，向上搭建三格梯子。完整通路消耗 8 木材。',
  floor: '切到目标楼层，拖动规划楼板。每格 3 木材；从梯子旁向外延伸，等待支撑完成。',
  wall: '拖动连续造两格高的墙。每格 6 木材；需地板支撑，记得留出出入口。',
  ladder: '每格 2 木材。与地面或已有梯子相连后施工；角色可携带物资爬梯。',
  stock: '拖动划仓储。必须有地板和两格净空；散落物资自动送往最近的可达仓储。',
  farm: '拖动划定土壤种植区，自动播种、收获并补种。稻米约 8 日首收，三人长期供给建议 110–128 格。',
  stove: '规划灶台，消耗 20 木材。每份简餐需要 10 生食材 + 1 木材；点击灶台设置库存目标。',
  bed: '点击放置两格木床，45 木材。R 旋转朝向；点击床分配主人，未分配的床会自动认领。',
  door: '点击放置木门，25 木材。R 旋转朝向；自动开关、保持敞开或锁定。门仍分隔两侧房间。',
  clearZone: '拖动擦除种植区和仓储；会清理该区作物且没有收成，已建成设施保留。',
  remove: '拆除木墙、楼板或梯子，回收部分木材。正在支撑人物的结构会等待人物移开。',
  cancel: '拖动取消未完成任务；已经送到工地的材料退回现场。',
};
const equal = (a: Pos, b: Pos) => a.x === b.x && a.y === b.y && a.z === b.z;
const levelName = (z: number) => (z === 8 ? '地表' : z < 8 ? `地下 ${8 - z}` : `地上 +${z - 8}`);
async function db() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open('emberfield-voxel', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('saves');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function putSave(slot: string, value: unknown) {
  const database = await db();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction('saves', 'readwrite');
      tx.objectStore('saves').put(value, slot);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    database.close();
  }
}
async function getSave(slot: string) {
  const database = await db();
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const request = database.transaction('saves').objectStore('saves').get(slot);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}
function App() {
  const state = useSyncExternalStore(client.subscribe, client.snapshot),
    s = state.snapshot;
  const host = useRef<HTMLDivElement>(null),
    file = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState(''),
    [menu, setMenu] = useState(false),
    [help, setHelp] = useState(true),
    [busy, setBusy] = useState(false),
    [seed, setSeed] = useState('73129'),
    [selectedPawn, setSelectedPawn] = useState<number | null>(null),
    [saveStatus, setSaveStatus] = useState('尚未保存');
  useEffect(() => {
    client.notice = setNotice;
    return client.mount(host.current!);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    const t = setInterval(() => {
      if (client.snapshot().snapshot?.tick)
        void client
          .export()
          .then((v) => putSave('auto', v))
          .then(() =>
            setSaveStatus(
              '自动保存 ' +
                new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
            ),
          )
          .catch(() => setNotice('自动保存失败，请导出存档'));
    }, 60000);
    return () => clearInterval(t);
  }, []);
  const action = async (fn: () => Promise<unknown>, message?: string) => {
    setBusy(true);
    try {
      await fn();
      if (message) setNotice(message);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const p = state.selected;
  const people = p ? (s?.pawns.filter((v) => equal(v, p)) ?? []) : [];
  const items = p ? (s?.items.filter((v) => equal(v, p)) ?? []) : [];
  const tree = p ? s?.trees.find((v) => equal(v, p)) : null;
  const farm = p ? s?.farms.find((v) => equal(v, p)) : null;
  const crop = p ? s?.crops.find((v) => equal(v, p)) : null;
  const stove = p ? s?.stoves.find((v) => equal(v, p)) : null;
  const bed = p ? s?.beds.find((v) => bedCells(v).some((q) => equal(q, p))) : null;
  const door = p ? s?.doors.find((v) => equal(v, p)) : null;
  const room = p ? client.roomAt(p) : null;
  const condition = p ? s?.cropConditions.find((v) => equal(v, p)) : null;
  const jobs = p
    ? (s?.jobs.filter(
        (v) =>
          equal(v, p) ||
          (v.kind === 'bed' && bedCells({ ...v, axis: v.axis ?? 'x' }).some((q) => equal(q, p))),
      ) ?? [])
    : [];
  const pawn = s?.pawns.find((v) => v.id === selectedPawn) ?? people[0];
  const block = p ? client.blockAt(p) : 0;
  const title = p
    ? (people[0]?.name ??
      (bed
        ? '木床'
        : door
          ? '木门'
          : stove
            ? '烧木灶台'
            : crop
              ? CROPS[crop.kind].name
              : farm
                ? `${CROPS[farm.crop].name}种植区`
                : null) ??
      (tree
        ? '成熟林木'
        : items[0]
          ? RESOURCE_NAMES[items[0].resource]
          : client.ladderAt(p)
            ? '梯井通路'
            : (BLOCK_NAMES[block] ?? '地形')))
    : '营地概览';
  const focus = (target: Pos) => {
    client.focusOn(target);
    client.select(target);
  };
  return (
    <div className="voxel-app">
      <div className="voxel-scene" ref={host} />
      <header className="voxel-header">
        <div className="voxel-brand">
          <span className="voxel-mark">✦</span>
          <div>
            <b>余烬边境</b>
            <small>EMBERFIELD · 多层试玩</small>
          </div>
        </div>
        <div className="voxel-colonists">
          {s?.pawns.map((v) => (
            <button
              key={v.id}
              className={selectedPawn === v.id ? 'selected' : ''}
              onClick={() => {
                setSelectedPawn(v.id);
                focus(v);
              }}
            >
              <i style={{ background: '#' + v.color.toString(16) }} />
              <span>
                {v.name}
                <small>
                  {levelName(v.z)} · {v.reason}
                </small>
              </span>
              <em style={{ width: `${v.rest}%` }} />
            </button>
          ))}
        </div>
        <div className="voxel-header-actions">
          <button onClick={() => setHelp((v) => !v)} aria-label="玩法指引">
            ?
          </button>
          <button
            onClick={() => {
              void client.speed(0);
              setMenu(true);
            }}
          >
            菜单与存档
          </button>
        </div>
      </header>
      <aside className="voxel-resources">
        <span className="voxel-kicker">营地物资</span>
        {(Object.keys(RESOURCE_NAMES) as Resource[]).map((r) => (
          <div key={r}>
            <span>{RESOURCE_NAMES[r]}</span>
            <strong>{s?.inventory[r] ?? 0}</strong>
            <small>入库 {s?.stored[r] ?? 0}</small>
          </div>
        ))}
        <p>包括散落、携带和工地材料</p>
      </aside>
      <div className="voxel-layer-control">
        <button onClick={() => client.view({ level: state.level + 1 })} aria-label="上移一层">
          ＋
        </button>
        <div>
          <b>{levelName(state.level)}</b>
          <small>工作高度 Z {state.level} / 14</small>
        </div>
        <button onClick={() => client.view({ level: state.level - 1 })} aria-label="下移一层">
          −
        </button>
        <span />
        {[
          ['地下', 5],
          ['地表', 8],
          ['二层', 11],
        ].map(([label, z]) => (
          <button
            key={z}
            className={state.level === z ? 'active' : ''}
            onClick={() => client.view({ level: Number(z) })}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="voxel-camera">
        <button
          title="向左旋转 Q"
          onClick={() => client.view({ rotation: state.rotation - Math.PI / 2 })}
        >
          ↶
        </button>
        <button title="返回营地" onClick={() => client.home()}>
          ⌖
        </button>
        <button
          title="向右旋转 E"
          onClick={() => client.view({ rotation: state.rotation + Math.PI / 2 })}
        >
          ↷
        </button>
      </div>
      {help && (
        <aside className="voxel-guide">
          <div className="voxel-panel-title">
            <span className="voxel-kicker">从地表到地下</span>
            <button onClick={() => setHelp(false)} aria-label="收起指引">
              ×
            </button>
          </div>
          <h2>把营地向上、向下延伸。</h2>
          <ol>
            <li>
              <b>采木</b>
              <span>选「伐木」，点击营地旁的树。</span>
              <button
                onClick={() => {
                  client.choose('cut');
                  focus({ x: 27, y: 29, z: 8 });
                }}
              >
                定位树木
              </button>
            </li>
            <li>
              <b>打开地下</b>
              <span>选「下挖梯井」，在地面点击。完成后切到地下，挖掘矿石。</span>
              <button
                onClick={() => {
                  client.choose('shaft');
                  focus({ x: 33, y: 32, z: 8 });
                }}
              >
                定位建议入口
              </button>
            </li>
            <li>
              <b>建设楼上</b>
              <span>选「向上搭梯」。梯子完成后切二层，从梯旁铺楼板，留两格净空。</span>
              <button
                onClick={() => {
                  client.choose('up');
                  focus({ x: 31, y: 30, z: 8 });
                }}
              >
                定位上行位置
              </button>
            </li>
          </ol>
          <p className="voxel-guide-note">
            也可在土壤上划种植区、建灶台。稻米约 8
            日首收，初始口粮需节约使用。战斗、房间温度和电网尚未迁入。
          </p>
          <div className="voxel-progress">
            <span>
              已伐木 <b>{s?.stats.cut ?? 0}</b>
            </span>
            <span>
              挖开 <b>{s?.stats.mined ?? 0}</b>
            </span>
            <span>
              已施工 <b>{s?.stats.built ?? 0}</b>
            </span>
          </div>
        </aside>
      )}
      <section className="voxel-inspector" data-testid="voxel-inspector">
        <div className="voxel-panel-title">
          <span className="voxel-kicker">
            {p ? `${p.x}, ${p.y} · Z ${p.z}` : '三名幸存者 / 新的边境'}
          </span>
          {p && (
            <button
              onClick={() => {
                client.select(null);
                setSelectedPawn(null);
              }}
              aria-label="清除选择"
            >
              ×
            </button>
          )}
        </div>
        <h2>{title}</h2>
        {!p && <p>点击地图查看物资、人物与施工进度。先规划，再让殖民者工作。</p>}
        {p && (
          <p>
            {block
              ? BLOCK_NAMES[block]
              : client.ladderAt(p)
                ? '可携货爬行的梯子'
                : client.blockAt({ ...p, z: p.z - 1 })
                  ? '有地板支撑的空间'
                  : '空中或开口'}{' '}
            · {levelName(p.z)}
          </p>
        )}
        {tree && (
          <div className="voxel-info-row">
            <span>砍伐产出</span>
            <b>木材 × {tree.wood}</b>
          </div>
        )}
        {room && (
          <div className="voxel-room-detail">
            <b>{room.outdoor ? '室外连通空间' : '封闭房间'}</b>
            <p>
              {room.volume} 格体积 · {room.floorCells} 格地面 · Z {room.minZ}–{room.maxZ}
            </p>
            <small>按实际六向空气连通判断；视图切层不改变房间。</small>
          </div>
        )}
        {bed && (
          <div className="voxel-bill">
            <label>
              床位主人
              <select
                aria-label="床位主人"
                value={bed.owner ?? ''}
                onChange={(e) =>
                  void client.command({
                    type: 'bedOwner',
                    bedId: bed.id,
                    pawnId: e.target.value === '' ? null : Number(e.target.value),
                  })
                }
              >
                <option value="">未分配（可自动认领）</option>
                {s?.pawns.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <p>
              占地两格 · 睡眠恢复 100%
              <br />
              {s?.pawns.find((p) => p.sleepBedId === bed.id)?.reason ?? '当前无人使用'}
            </p>
          </div>
        )}
        {door && (
          <div className="voxel-bill">
            <label>
              门状态
              <select
                aria-label="门状态"
                value={door.mode}
                onChange={(e) =>
                  void client.command({
                    type: 'door',
                    doorId: door.id,
                    mode: e.target.value as typeof door.mode,
                  })
                }
              >
                <option value="auto">自动开关</option>
                <option value="open">保持敞开</option>
                <option value="locked">锁定禁止通行</option>
              </select>
            </label>
            <p>两格高 · 门口有人或物资时不能关门。打开仍保留房间边界。</p>
          </div>
        )}
        {farm && condition && (
          <div className="voxel-farm-detail">
            <div className="voxel-info-row">
              <span>本轮生长</span>
              <b>{crop ? `${(crop.growth * 100).toFixed(1)}%` : '等待播种'}</b>
            </div>
            <progress value={crop?.growth ?? 0} max={1} aria-label="作物生长" />
            <p>
              {condition.reason} · 肥力 {Math.round(condition.fertility * 100)}% · 光照{' '}
              {Math.round(condition.light * 100)}% · {condition.temperature.toFixed(1)}°C
            </p>
            <p>
              下次播种：{CROPS[farm.crop].name} · 成熟收获 {CROPS[crop?.kind ?? farm.crop].yield}{' '}
              生食材。上方楼板会遮光。
            </p>
          </div>
        )}
        {stove && (
          <div className="voxel-bill">
            <p>
              10 生食材 + 1 木材 → 1 简餐
              <br />
              全营地简餐低于目标时制作，含在制数量。
            </p>
            <label>
              库存目标
              <select
                aria-label="简餐库存目标"
                value={stove.target}
                onChange={(e) =>
                  void client.command({
                    type: 'bill',
                    stoveId: stove.id,
                    target: Number(e.target.value),
                    paused: stove.paused,
                  })
                }
              >
                {[...new Set([0, 1, 5, 10, 20, 40, stove.target])]
                  .sort((a, b) => a - b)
                  .map((n) => (
                    <option key={n} value={n}>
                      {n} 份
                    </option>
                  ))}
              </select>
            </label>
            <button
              onClick={() =>
                void client.command({
                  type: 'bill',
                  stoveId: stove.id,
                  target: stove.target,
                  paused: !stove.paused,
                })
              }
            >
              {stove.paused ? '恢复烹饪' : '暂停烹饪'}
            </button>
          </div>
        )}
        {items.map((i) => (
          <div className="voxel-info-row" key={i.id}>
            <span>
              {RESOURCE_NAMES[i.resource]}
              {NUTRITION[i.resource] ? ` · 营养 ${NUTRITION[i.resource]}/份` : ''}
            </span>
            <b>× {i.amount}</b>
          </div>
        ))}
        {jobs.map((j) => (
          <div className="voxel-job" key={j.id}>
            <div>
              <b>{JOB_NAMES[j.kind]}</b>
              <span>{Math.min(100, Math.floor((j.progress / j.work) * 100))}%</span>
            </div>
            <progress value={j.progress} max={j.work} />
            <small>
              {j.reason}
              {(Object.keys(j.cost) as Resource[])
                .map((r) => ` · ${RESOURCE_NAMES[r]} ${j.delivered[r] ?? 0}/${j.cost[r]}`)
                .join('')}
            </small>
          </div>
        ))}
        {pawn && (
          <div className="voxel-pawn-detail">
            <div className="voxel-info-row">
              <b>{pawn.name}</b>
              <span>{pawn.reason}</span>
            </div>
            <div className="voxel-needs">
              <label>
                饱食 {Math.round(pawn.food)}%
                {pawn.food <= 0
                  ? ' · 饥荒'
                  : pawn.food < 12
                    ? ' · 急饿'
                    : pawn.food < 24
                      ? ' · 饥饿'
                      : ''}
                <progress value={pawn.food} max={100} />
              </label>
              <label>
                精力 {Math.round(pawn.rest)}%
                <progress value={pawn.rest} max={100} />
              </label>
            </div>
            {pawn.cargo && (
              <p>
                携带 {RESOURCE_NAMES[pawn.cargo.resource]} × {pawn.cargo.amount}
              </p>
            )}
            <div className="voxel-priorities">
              {(['dig', 'cut', 'build', 'haul', 'grow', 'cook'] as Work[]).map((w, i) => (
                <label key={w}>
                  {['挖掘', '伐木', '施工', '搬运', '种植', '烹饪'][i]}
                  <select
                    aria-label={`${pawn.name} ${w}优先级`}
                    value={pawn.priorities[w]}
                    onChange={(e) =>
                      void client.command({
                        type: 'priority',
                        pawnId: pawn.id,
                        work: w,
                        value: Number(e.target.value),
                      })
                    }
                  >
                    {[0, 1, 2, 3, 4].map((n) => (
                      <option key={n} value={n}>
                        {n === 0 ? '停用' : n}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <small>1 优先，4 最后；0 停用</small>
            <details className="voxel-schedule">
              <summary>24 小时作息 · 点击调整</summary>
              <div>
                {pawn.schedule.map((a, h) => (
                  <label key={h}>
                    {String(h).padStart(2, '0')}
                    <select
                      aria-label={`${pawn.name} ${h}点作息`}
                      value={a}
                      onChange={(e) =>
                        void client.command({
                          type: 'schedule',
                          pawnId: pawn.id,
                          hour: h,
                          assignment: e.target.value as Assignment,
                        })
                      }
                    >
                      {(Object.keys(ASSIGNMENT_NAMES) as Assignment[]).map((k) => (
                        <option key={k} value={k}>
                          {ASSIGNMENT_NAMES[k]}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <small>自由时困倦才睡；睡眠时段提前休息，睡满再醒；工作时段精力 ≥20% 会醒来。</small>
            </details>
            <button
              disabled={pawn.rest >= 75 || pawn.phase === 'rest' || pawn.phase === 'sleepTravel'}
              onClick={() => void client.command({ type: 'rest', pawnId: pawn.id })}
            >
              现在去睡觉
            </button>
            {p && !equal(p, pawn) && (
              <button
                className="voxel-primary"
                onClick={() => void client.command({ type: 'move', pawnId: pawn.id, target: p })}
              >
                让 {pawn.name} 前往选中位置
              </button>
            )}
          </div>
        )}
        {p && (
          <button className="voxel-text-button" onClick={() => client.focusOn(p)}>
            ⌖ 对焦此处
          </button>
        )}
      </section>
      <div className="voxel-coordinates">
        <span>
          {state.worker ? '独立渲染线程' : '兼容渲染'} · {String(state.metrics.backend ?? 'WebGL2')}
        </span>
        <span>
          {Math.round(Number(state.metrics.fps ?? 0))} FPS · {s?.jobs.length ?? 0} 项规划
        </span>
      </div>
      <footer className="voxel-footer">
        <div className="voxel-tool-hint">
          <span className="voxel-kicker">
            {TOOL_NAMES[state.tool]}
            {['bed', 'door'].includes(state.tool) && (
              <button onClick={() => client.rotatePlan()} aria-label="旋转建造朝向">
                朝向 {state.axis.toUpperCase()} · R
              </button>
            )}
            {state.tool === 'farm' && (
              <select
                aria-label="种植作物"
                value={state.crop}
                onChange={(e) => client.chooseCrop(e.target.value as CropKind)}
              >
                {(Object.keys(CROPS) as CropKind[]).map((k) => (
                  <option key={k} value={k}>
                    {CROPS[k].name}
                  </option>
                ))}
              </select>
            )}
          </span>
          <p>{hints[state.tool]}</p>
          <small>Q / E 旋转 · [ / ] 切层 · 中键拖转 · 滚轮缩放 · WASD 平移 · 右键退出工具</small>
        </div>
        <div className="voxel-bottom-row">
          <nav>
            {tools.map((t, i) => (
              <button
                key={t}
                className={state.tool === t ? 'active' : ''}
                title={hints[t]}
                aria-label={TOOL_NAMES[t]}
                onClick={() => client.choose(t)}
              >
                <span>{icons[i]}</span>
                {TOOL_NAMES[t]}
              </button>
            ))}
          </nav>
          <div className="voxel-time">
            <small>
              第 {Math.floor((s?.tick ?? 0) / DAY) + 1} 日 ·{' '}
              {String(Math.floor(s?.hour ?? 8)).padStart(2, '0')}:
              {String(Math.floor(((s?.hour ?? 8) % 1) * 60)).padStart(2, '0')} ·{' '}
              {Math.round(s?.temperature ?? 21)}°C
            </small>
            <div>
              {[0, 1, 2, 3].map((v) => (
                <button
                  key={v}
                  aria-label={v === 0 ? '暂停' : `${v}倍速`}
                  className={s?.speed === v ? 'active' : ''}
                  onClick={() => void client.speed(v)}
                >
                  {v === 0 ? 'Ⅱ' : `${v}×`}
                </button>
              ))}
            </div>
          </div>
        </div>
      </footer>
      {!state.ready && <div className="voxel-loading">正在生成三维山谷…</div>}
      {notice && (
        <div role="status" className="voxel-toast">
          {notice}
        </div>
      )}
      {menu && (
        <div className="voxel-modal-backdrop">
          <section role="dialog" aria-modal="true" className="voxel-modal">
            <button
              className="voxel-modal-close"
              aria-label="关闭菜单"
              onClick={() => setMenu(false)}
            >
              ×
            </button>
            <span className="voxel-kicker">CAMP RECORDS</span>
            <h2>留下这座立体营地。</h2>
            <p>
              体素存档与二维营地分别保存。每分钟自动保存；浏览器清理数据会删除本地存档，请定期导出。
            </p>
            <div className="voxel-save-actions">
              <button
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await putSave('manual', await client.export());
                    setSaveStatus('手动保存成功');
                  }, '手动存档已保存')
                }
              >
                保存营地
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    const save = await getSave('manual');
                    if (!save) throw new Error('还没有手动存档');
                    await client.import(save);
                    setMenu(false);
                  })
                }
              >
                读取营地
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    const save = await getSave('auto');
                    if (!save) throw new Error('还没有自动存档');
                    await client.import(save);
                    setMenu(false);
                  })
                }
              >
                读取自动存档
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    const save = await client.export(),
                      url = URL.createObjectURL(
                        new Blob([JSON.stringify(save)], { type: 'application/json' }),
                      ),
                      a = document.createElement('a');
                    a.href = url;
                    a.download = `emberfield-voxel-${save.seed}-${save.tick}.json`;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                  })
                }
              >
                导出体素存档
              </button>
              <button disabled={busy} onClick={() => file.current?.click()}>
                导入体素存档
              </button>
              <input
                ref={file}
                type="file"
                accept=".json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f)
                    void action(async () => {
                      if (f.size > 4 * 1024 * 1024) throw new Error('存档超过 4 MiB 上限');
                      await client.import(JSON.parse(await f.text()));
                      setMenu(false);
                    });
                  e.target.value = '';
                }}
              />
            </div>
            <p className="voxel-kicker">{saveStatus}</p>
            <div className="voxel-new-world">
              <label>
                世界种子
                <input
                  aria-label="体素世界种子"
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                />
              </label>
              <button
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    const n = Number(seed);
                    if (!Number.isSafeInteger(n)) throw new Error('请输入整数种子');
                    await client.newGame(n);
                    setMenu(false);
                  }, '新世界已生成，时间暂停')
                }
              >
                新开世界（替换当前进度）
              </button>
            </div>
            <details>
              <summary>试玩规则与性能计数</summary>
              <p>
                64×64×16；逻辑 20 TPS，1 日 10
                分钟。两格净空，一格高差可走；梯子可携货。种植、烹饪、床位、作息和三维房间已接通；简化天光与温度，无季节、腐坏、食物中毒和饥荒伤害。房间温度、电网、战斗、坍塌和流体尚未实现。
              </p>
              <p>
                地形数组 {((s?.gridBytes ?? 0) / 1024).toFixed(0)} KiB；寻路数组{' '}
                {((s?.navigationBytes ?? 0) / 1024).toFixed(0)} KiB；最近平均 tick{' '}
                {(s?.tickMs ?? 0).toFixed(2)} ms。以下为渲染计数，并非整页或 GPU 驱动内存。
              </p>
              <p>
                房间工作数组 {((s?.roomBytes ?? 0) / 1024).toFixed(0)}{' '}
                KiB；房间编号仅在地形或门位置变化时重新计算。
              </p>
              <pre>{JSON.stringify(state.metrics, null, 2)}</pre>
            </details>
            <a className="voxel-return" href="?">
              返回二维营地（请先保存） ↗
            </a>
          </section>
        </div>
      )}
    </div>
  );
}
declare global {
  interface Window {
    voxel: {
      snapshot: VoxelClient['snapshot'];
      project: VoxelClient['project'];
      exportSave: VoxelClient['export'];
      blockAt: VoxelClient['blockAt'];
      ladderAt: VoxelClient['ladderAt'];
    };
  }
}
window.voxel = {
  snapshot: client.snapshot,
  project: client.project,
  exportSave: client.export,
  blockAt: client.blockAt,
  ladderAt: client.ladderAt,
};
createRoot(document.getElementById('root')!).render(<App />);
