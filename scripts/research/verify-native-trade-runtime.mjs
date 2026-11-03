import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const r = JSON.parse(readFileSync('docs/research/rimworld/evidence/native-trade-runtime.json', 'utf8'));
assert.equal(r.kind, 'native-runtime-observed');
assert.equal(r.version, '1.7.4980 rev60');
assert.equal(r.saves.length, 4);
for (const s of r.saves) {
  assert(/^[a-f0-9]{64}$/.test(s.sha256));
  assert.equal(s.traderKind, 'Caravan_Neolithic_ShamanMerchant');
  if (process.argv.includes('--local')) assert.equal(sha(s.file), s.sha256);
}
for (const [a, b] of [[r.saves[0], r.saves[1]], [r.saves[2], r.saves[3]]]) {
  assert.equal(a.tick, b.tick); assert.deepEqual(a.goods, b.goods);
}
const before = r.saves[1], after = r.saves[3];
assert.equal(after.tick - before.tick, 796);
const item = (s, id) => { const rows = s.goods.filter(g => g.id === id); assert.equal(rows.length, 1); return rows[0]; };
const colonySilver = s => ['Silver41859', 'Silver38564', 'Silver78580'].reduce((n, id) => n + item(s, id).count, 0);
assert.equal(colonySilver(before), 1300); assert.equal(colonySilver(after), 1273);
assert.equal(item(before, 'Silver78589').count, 974); assert.equal(item(after, 'Silver78589').count, 1001);
assert(!after.goods.some(g => g.id === 'Silver78400'), 'unrelated world-pawn inventory is outside this map summary');
const oldHerbs = item(before, 'MedicineHerbal78594'), herbs = item(after, 'MedicineHerbal78594');
assert.equal(oldHerbs.count, 2); assert.equal(herbs.count, 2);
assert.equal(oldHerbs.owner, 'Muffalo78603'); assert.equal(herbs.owner, '');
assert.equal(herbs.pos, '(122, 0, 128)');
assert.equal(r.terminal.observedCurrentProcess, 'not-running');
assert(r.unobserved.includes('completed sale'));
for (const image of r.images) {
  assert.equal(sha(image.file), image.sha256);
  if (process.argv.includes('--local')) assert.equal(sha(image.source), image.sourceSha256);
}
console.log('PASS retained native purchase: real item transfer, silver conservation, explicit unobserved branches.');
