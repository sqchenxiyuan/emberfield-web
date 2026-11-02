import { Simulation } from './sim/world';
import { BUILDINGS, JOB_NAMES, RESOURCES } from './sim/defs';
import { TPS, type Command } from './sim/types';
import { STRIDE } from './protocol';
const ctx = self as unknown as {
  postMessage: (m: unknown, t?: Transferable[]) => void;
  onmessage: ((e: MessageEvent) => void) | null;
};
let sim = new Simulation(),
  speed = 0,
  port: MessagePort | null = null,
  ready = false;
let previous = performance.now(),
  balance = 0,
  lastDisplay = 0,
  lastUI = 0,
  lastMetrics = 0,
  lastAutosave = performance.now(),
  steps = 0,
  tickTotal = 0,
  byteCount = 0,
  sequence = 0;
let times: number[] = [],
  buffers: ArrayBuffer[] = Array.from({ length: 3 }, () => new ArrayBuffer(4096 * STRIDE * 4));
let saveStatus = '尚未保存',
  saving = false,
  generation = 0,
  lastTerrainBuilt = 0;
const buildingKinds = Object.keys(BUILDINGS),
  jobs = Object.keys(JOB_NAMES);
async function db() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open('emberfield-v1', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('slots');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function save(slot = 'manual') {
  if (saving) throw new Error('正在保存，请稍候');
  saving = true;
  saveStatus = '保存中…';
  try {
    const data = sim.save(),
      database = await db();
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction('slots', 'readwrite');
      tx.objectStore('slots').put({ data, savedAt: Date.now() }, slot);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('保存事务中止'));
    });
    database.close();
    saveStatus = `${slot === 'auto' ? '自动' : '手动'}保存 · ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
  } catch (e) {
    saveStatus = '保存失败';
    throw e;
  } finally {
    saving = false;
  }
}
async function load(slot = 'manual') {
  const database = await db();
  const record = await new Promise<{ data: unknown } | undefined>((resolve, reject) => {
    const r = database.transaction('slots', 'readonly').objectStore('slots').get(slot);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  database.close();
  if (!record) throw new Error('该存档槽为空');
  sim.load(record.data);
  reset();
  saveStatus = '已载入，游戏暂停';
}
function terrain() {
  if (!port) return;
  const terrain = sim.world.terrain.slice(),
    zones = sim.world.zones.slice();
  port.postMessage({ type: 'terrain', terrain, zones, seed: sim.world.seed, generation }, [
    terrain.buffer,
    zones.buffer,
  ]);
}
function reset() {
  generation++;
  lastTerrainBuilt = sim.world.stats.built;
  speed = 0;
  balance = 0;
  previous = performance.now();
  terrain();
  publish();
  ui();
}
function ui() {
  ctx.postMessage({ type: 'summary', summary: sim.summary(), speed, saveStatus });
}
function publish() {
  if (!port || !buffers.length) return;
  const w = sim.world;
  if (w.stats.built !== lastTerrainBuilt) {
    lastTerrainBuilt = w.stats.built;
    terrain();
  }
  const needed =
    (w.nature.length + w.items.length + w.buildings.length + w.pawns.length + w.crops.length) *
    STRIDE *
    4;
  let buffer = buffers.pop()!;
  if (buffer.byteLength < needed) buffer = new ArrayBuffer(2 ** Math.ceil(Math.log2(needed)));
  const f = new Float32Array(buffer);
  let count = 0;
  const write = (
    id: number,
    type: number,
    x: number,
    y: number,
    progress = 0,
    hp = 100,
    color = 0,
    state = 0,
    job = 0,
    carry = 0,
    marked = 0,
    extra = 0,
  ) => {
    f.set(
      [id, type, x, y, progress, hp, color, state, job, carry, marked, extra],
      count++ * STRIDE,
    );
  };
  for (const n of w.nature)
    if (n.amount > 0)
      write(
        n.id,
        1 + ['tree', 'ore', 'berry', 'rock'].indexOf(n.kind),
        n.x,
        n.y,
        0,
        100,
        0,
        0,
        0,
        0,
        n.marked ? 1 : 0,
      );
  for (const b of w.buildings)
    write(
      b.id,
      20 + buildingKinds.indexOf(b.kind),
      b.x,
      b.y,
      b.progress / (BUILDINGS[b.kind].work * 500),
      b.hp,
      0,
      b.powered ? 1 : 0,
      0,
      0,
      b.demolish ? 1 : 0,
      b.enabled ? 1 : 0,
    );
  for (const i of w.items)
    if (i.count > 0.01) write(i.id, 50 + RESOURCES.indexOf(i.kind), i.x, i.y, i.count);
  for (const c of w.crops)
    write(-1 - c.y * 96 - c.x, c.crop === 'herb' ? 91 : 90, c.x, c.y, c.growth);
  for (const p of w.pawns)
    write(
      p.id,
      p.animal ? 82 : p.enemy ? 81 : 80,
      p.x,
      p.y,
      p.food,
      p.blood,
      p.color,
      p.dead
        ? 5
        : p.downed
          ? 4
          : p.job?.kind === 'sleep'
            ? 3
            : p.job?.path.length
              ? 1
              : p.job
                ? 2
                : 0,
      jobs.indexOf(p.job?.kind ?? ''),
      p.carry ? 1 : 0,
      p.drafted ? 1 : 0,
      p.cooldown,
    );
  byteCount += count * STRIDE * 4;
  port.postMessage({ type: 'frame', buffer, count, tick: w.tick, sequence: sequence++ }, [buffer]);
}
ctx.onmessage = async ({ data: m }) => {
  try {
    if (m.type === 'init') {
      sim = new Simulation(m.seed || 73129);
      ready = true;
      reset();
      ctx.postMessage({ type: 'ready' });
    }
    if (m.type === 'connect') {
      port = m.port;
      port!.onmessage = ({ data }) => {
        if (data.type === 'return' && buffers.length < 3) buffers.push(data.buffer);
        if (data.type === 'baseline') terrain();
      };
      port!.start();
      terrain();
      publish();
    }
    if (m.type === 'command') {
      const result = sim.command(m.command as Command);
      if (m.command.type === 'zone') terrain();
      ctx.postMessage({ type: 'result', requestId: m.requestId, ...result });
      publish();
      ui();
    }
    if (m.type === 'speed') {
      speed = [0, 1, 3, 6].includes(m.value) ? m.value : 0;
      balance = 0;
      previous = performance.now();
      ui();
    }
    if (m.type === 'save') {
      await save(m.slot);
      ctx.postMessage({ type: 'response', requestId: m.requestId, ok: true, value: saveStatus });
      ui();
    }
    if (m.type === 'load') {
      await load(m.slot);
      ctx.postMessage({ type: 'response', requestId: m.requestId, ok: true });
    }
    if (m.type === 'export')
      ctx.postMessage({ type: 'response', requestId: m.requestId, ok: true, value: sim.save() });
    if (m.type === 'import') {
      sim.load(m.value);
      reset();
      ctx.postMessage({ type: 'response', requestId: m.requestId, ok: true });
    }
    if (m.type === 'new') {
      sim = new Simulation(m.seed || 73129);
      reset();
      ctx.postMessage({ type: 'response', requestId: m.requestId, ok: true });
    }
    if (m.type === 'hidden') {
      speed = 0;
      balance = 0;
      ui();
      if (!saving) await save('auto');
    }
  } catch (e) {
    ctx.postMessage({
      type: 'response',
      requestId: m.requestId,
      ok: false,
      error: String(e instanceof Error ? e.message : e),
    });
    ui();
  }
};
function loop() {
  const now = performance.now(),
    elapsed = Math.min(250, now - previous);
  previous = now;
  if (ready && speed > 0) {
    balance = Math.min(TPS * speed * 2, balance + (elapsed / 1000) * TPS * speed);
    let batch = 0,
      start = performance.now();
    while (balance >= 1 && batch < 8 && performance.now() - start < 4) {
      const t = performance.now();
      sim.step();
      const dt = performance.now() - t;
      times.push(dt);
      tickTotal += dt;
      steps++;
      batch++;
      balance--;
      if (sim.pauseRequested) {
        sim.pauseRequested = false;
        speed = 0;
        balance = 0;
        break;
      }
    }
  }
  if (now - lastDisplay >= 50) {
    publish();
    lastDisplay = now;
  }
  if (now - lastUI >= 200) {
    ui();
    lastUI = now;
  }
  if (now - lastMetrics >= 1000) {
    times.sort((a, b) => a - b);
    ctx.postMessage({
      type: 'metrics',
      value: {
        tps: (steps * 1000) / (now - lastMetrics || 1000),
        tickMs: steps ? tickTotal / steps : 0,
        tickP95: times[Math.floor(times.length * 0.95)] ?? 0,
        sentBytes: byteCount,
        bufferCount: 3,
        saveStatus,
      },
    });
    steps = 0;
    tickTotal = 0;
    times = [];
    byteCount = 0;
    lastMetrics = now;
  }
  if (now - lastAutosave >= 30000 && ready && !saving) {
    lastAutosave = now;
    save('auto').catch((e) =>
      ctx.postMessage({ type: 'notice', text: `自动保存失败：${e.message}` }),
    );
  }
  setTimeout(loop, 4);
}
loop();
