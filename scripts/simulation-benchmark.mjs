import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
await mkdir('test-results/performance', { recursive: true });
await build({
  entryPoints: ['src/sim/world.ts'],
  outfile: 'test-results/performance/sim.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
});
const { Simulation } = await import('../test-results/performance/sim.mjs');
const s = new Simulation(),
  w = s.world;
const original = w.pawns.find((p) => !p.animal),
  animal = w.pawns.find((p) => p.animal);
for (let n = 3; n < 8; n++) {
  const p = structuredClone(original);
  p.id = w.nextId++;
  p.name = `测试殖民者${n + 1}`;
  p.x = 43 + (n % 4);
  p.y = 47 + Math.floor(n / 4);
  w.pawns.push(p);
}
for (let n = w.pawns.filter((p) => p.animal).length; n < 20; n++) {
  const p = structuredClone(animal);
  p.id = w.nextId++;
  p.x = 20 + n;
  p.y = 36;
  w.pawns.push(p);
}
for (let n = w.items.length; n < 1000; n++) {
  const x = 15 + (n % 45),
    y = 20 + Math.floor(n / 45);
  w.items.push({
    id: w.nextId++,
    x,
    y,
    kind: n % 2 ? 'wood' : 'raw',
    count: 25,
    age: 0,
    reserved: 0,
  });
}
const commands = [
  { type: 'zone', zone: 2, x: 49, y: 45, x2: 56, y2: 52 },
  { type: 'zone', zone: 1, x: 40, y: 50, x2: 45, y2: 55 },
];
for (let i = 0; i < 8; i++) commands.push({ type: 'build', kind: 'bed', x: 38 + i * 2, y: 40 });
commands.push({ type: 'build', kind: 'stove', x: 46, y: 43 });
for (const c of commands) assert.ok(s.command(c).ok);
await writeFile('test-results/performance/stress-save.json', JSON.stringify(s.save()));
s.step(1000);
const times = [],
  before = process.memoryUsage(),
  start = performance.now();
for (let i = 0; i < 12000; i++) {
  const t = performance.now();
  s.step();
  times.push(performance.now() - t);
}
const wallMs = performance.now() - start;
times.sort((a, b) => a - b);
const report = {
  scenario: {
    map: '96x96',
    colonists: 8,
    animals: 20,
    itemStacks: 1000,
    timedTicks: 12000,
    warmupTicks: 1000,
  },
  runtime: process.version,
  averageMs: times.reduce((s, n) => s + n, 0) / times.length,
  p95Ms: times[Math.floor(times.length * 0.95)],
  p99Ms: times[Math.floor(times.length * 0.99)],
  maxMs: times.at(-1),
  wallMs,
  memoryBefore: before,
  memoryAfter: process.memoryUsage(),
  finalStats: w.stats,
  scope:
    'Synthetic Node simulation load fixture with extra population/items; exercises real rules, not UI/rendering or product population progression. Not a browser capacity guarantee.',
};
await writeFile('test-results/performance/report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
assert.ok(report.averageMs < 2, 'Reference simulation average tick budget exceeded');
assert.ok(w.items.every((i) => i.count >= 0 && i.reserved >= 0 && i.reserved <= i.count + 1e-4));
