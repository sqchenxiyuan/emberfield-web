import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { VoxelClient } from './client';
import {
  BLOCK_NAMES,
  JOB_NAMES,
  RESOURCE_NAMES,
  TOOL_NAMES,
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
  'remove',
  'cancel',
];
const icons = ['↖', '♠', '⛏', '↧', '↥', '▱', '▥', '☷', '▧', '⌫', '×'];
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
  const jobs = p ? (s?.jobs.filter((v) => equal(v, p)) ?? []) : [];
  const pawn = s?.pawns.find((v) => v.id === selectedPawn) ?? people[0];
  const block = p ? client.blockAt(p) : 0;
  const title = p
    ? (people[0]?.name ??
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
            当前是多层施工切片。人物会进食和休息；战斗、房间温度、电网及农业尚未迁入。
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
        {items.map((i) => (
          <div className="voxel-info-row" key={i.id}>
            <span>{RESOURCE_NAMES[i.resource]}</span>
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
              {j.cost > 0 ? ` · 木材 ${j.delivered}/${j.cost}` : ''}
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
                饱食
                <progress value={pawn.food} max={100} />
              </label>
              <label>
                精力
                <progress value={pawn.rest} max={100} />
              </label>
            </div>
            {pawn.cargo && (
              <p>
                携带 {RESOURCE_NAMES[pawn.cargo.resource]} × {pawn.cargo.amount}
              </p>
            )}
            <div className="voxel-priorities">
              {(['dig', 'cut', 'build', 'haul'] as Work[]).map((w, i) => (
                <label key={w}>
                  {['挖掘', '伐木', '施工', '搬运'][i]}
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
          <span className="voxel-kicker">{TOOL_NAMES[state.tool]}</span>
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
              第 {Math.floor((s?.tick ?? 0) / 12000) + 1} 日 ·{' '}
              {(s?.tick ?? 0) / 20 < 60 ? '清晨' : '探索中'}
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
                64×64×16；逻辑 20
                TPS。两格净空，一格高差可走；梯子可携货，暂无坍塌、流体和摔伤。未迁入完整农业、温度、战斗。地下与二层通过真实方块和路径连接。
              </p>
              <p>
                地形数组 {((s?.gridBytes ?? 0) / 1024).toFixed(0)} KiB；寻路数组{' '}
                {((s?.navigationBytes ?? 0) / 1024).toFixed(0)} KiB；最近平均 tick{' '}
                {(s?.tickMs ?? 0).toFixed(2)} ms。以下为渲染计数，并非整页或 GPU 驱动内存。
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
