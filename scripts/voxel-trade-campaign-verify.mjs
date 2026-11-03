import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

// --pilot is explicitly exploratory. Formal evidence requires a separately
// reviewed/frozen source hash and --run; --plan never constructs a simulation.
const SCENARIO_READY = true;
const pilot = process.argv.includes('--pilot');
const run = process.argv.includes('--run') || pilot;
const OUT = process.env.VOXEL_TRADE_OUT ?? 'test-results/voxel-trade-exploratory';
const formal = !pilot && process.env.VOXEL_TRADE_FINAL === '1';
const DAY = 12000;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const built = await build({
  stdin: {
    contents: "export { VoxelSimulation } from './src/voxel/world.ts'; export { initialTrade } from './src/voxel/trade.ts'; export { quoteTrade } from './src/voxel/tradeWorld.ts';",
    resolveDir: process.cwd(),
  }, bundle: true, platform: 'node', format: 'esm', write: false, metafile: true,
});
const bundleBytes = Buffer.from(built.outputFiles[0].text);
const { VoxelSimulation, initialTrade, quoteTrade } = await import('data:text/javascript;base64,' + bundleBytes.toString('base64'));
const calendar = initialTrade(73129);
if (!run) {
  console.log(JSON.stringify({
    status: 'planned', planningOnly: true, scenarioReady: SCENARIO_READY, seed: 73129,
    firstOpportunityTick: calendar.nextVisit,
    firstOpportunityDay: calendar.nextVisit === null ? null : calendar.nextVisit / DAY,
    currentSourceSha256: sha(bundleBytes),
    ordinaryPlan: [
      'Create a fresh warm flat seed-73129 colony; retain the actual 800-silver scenario baseline.',
      'Ordinary stockpiles, rice and cotton farms, stove, real beds, and an accessible tailor/crafting spot.',
      'Record all naturally occurring caravans, including opportunities missed during preparation; never respawn or change their inventory.',
      'Negotiate with a capable actual colonist, walk to the merchant, and use only the actual quoted eligible stock.',
      'Complete at least two ordinary trade receipts, including real produced goods and a purchased material actually consumed in production or equipment actually equipped.',
      'Check both parties, silver settlement, food age mass, unique gear, cancellation/replay, normal reload and actual off-map departure.',
    ],
    notExecuted: ['No simulation constructor/step/command was called.', 'No inventory, clock, caravan or random state was changed.', 'This planning output is not validation evidence.'],
  }, null, 2));
  process.exit(0);
}
assert(pilot || process.env.VOXEL_TRADE_EXPECT_SOURCE, 'A campaign run must identify its reviewed frozen game bundle');
if (!pilot) assert.equal(sha(bundleBytes), process.env.VOXEL_TRADE_EXPECT_SOURCE);
await mkdir(OUT, { recursive: true });
const execution = {
  bundle: `${OUT}/executed-world.mjs`, sha256: sha(bundleBytes),
  script: `${OUT}/executed-campaign.mjs`, scriptSha256: sha(await readFile(new URL(import.meta.url))),
  sources: await Promise.all(Object.keys(built.metafile.inputs).filter((path) => path !== '<stdin>').sort()
    .map(async (path) => ({ path, sha256: sha(await readFile(path)) }))),
};
await writeFile(execution.bundle, bundleBytes, { flag: 'wx' });
await writeFile(execution.script, await readFile(new URL(import.meta.url)), { flag: 'wx' });
let s = new VoxelSimulation(73129, { biome: 'temperate', hilliness: 'flat', meanTemperature: 24, rainfall: 1500, latitude: 0 });
const report = {
  status: 'running', formal, pilot, startedAt: new Date().toISOString(), execution,
  scope: 'Fresh fixed-seed colony. Only normal command/step/save/load changes gameplay. Read-only terrain, paths, current stocks and the deterministic initial calendar guide planning. No resource, silver, skill, health, caravan, event, clock or RNG edits. Native merchant approach/departure stages remain tradable until actual conditions fail or the merchant exits.',
  commands: [], checks: [], fixtures: {}, visits: [], samples: [], transactions: [], errors: [],
  coverage: { foodProduction: false, cottonHarvest: false, productionSale: false, buyAndSell: false, purchasedUse: false, foodAge: false, equipmentIdentity: false, cancellation: false, repeatedCommit: false, reload: false, departure: false },
};
const initial = structuredClone(s.counts());
const pilotCheckpoint = process.env.VOXEL_TRADE_PILOT_CHECKPOINT;
if (pilotCheckpoint) {
  assert(pilot, 'A diagnostic branch is never a formal fresh campaign');
  const bytes = await readFile(pilotCheckpoint);
  s = VoxelSimulation.load(JSON.parse(bytes));
  report.diagnosticBranch = { file: pilotCheckpoint, sha256: sha(bytes), tick: s.tick, purpose: 'Short ordinary-command diagnosis from an unchanged real earlier pilot checkpoint; not a formal mainline continuation.' };
}
const point = ({ x, y, z }) => ({ x, y, z });
const key = (p) => `${p.x}/${p.y}/${p.z}`;
const at = (p) => (p.z * 64 + p.y) * 64 + p.x;
const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
const colonists = () => s.pawns.filter((p) => p.faction === 'colony');
const captures = new Map();
const seenVisits = new Set();
function command(value, expectOk = true) {
  const before = !expectOk ? structuredClone(s.save()) : null;
  const result = s.command(value);
  report.commands.push({ tick: s.tick, command: value, result });
  assert.equal(result.ok, expectOk, JSON.stringify({ value, result }));
  if (!expectOk) assert.deepEqual(s.save(), before, 'rejected command leaves gameplay unchanged');
  return result;
}
const place = (tool, p, extra = {}) => command({ type: 'designate', tool, from: point(p), ...extra });
function check(name, details = {}) {
  report.checks.push({ tick: s.tick, name, ...details });
  console.log('PASS', s.tick, name);
}
function ownership() {
  const owners = new Map();
  const add = (piece, owner) => {
    if (!piece) return;
    assert(!owners.has(piece.id), `equipment ${piece.id} duplicated`);
    owners.set(piece.id, { owner, piece: structuredClone(piece) });
  };
  for (const item of s.items) { add(item.weapon, `ground:${item.id}`); add(item.apparel, `ground:${item.id}`); }
  for (const pawn of s.pawns) {
    add(pawn.weapon, `pawn:${pawn.id}`);
    pawn.worn.forEach((piece) => add(piece, `worn:${pawn.id}`));
    add(pawn.cargo?.weapon, `cargo:${pawn.id}`); add(pawn.cargo?.apparel, `cargo:${pawn.id}`);
  }
  for (const caravan of s.trade.caravans) for (const item of caravan.stock) {
    add(item.weapon, `merchant:${caravan.id}:${item.id}`); add(item.apparel, `merchant:${caravan.id}:${item.id}`);
  }
  return [...owners].sort(([a], [b]) => a - b);
}
function audit() {
  const inventory = s.counts();
  for (const resource of Object.keys(initial)) {
    const actual = inventory[resource] + s.stats.consumed[resource] + s.stats.spoiled[resource] + s.stats.destroyed[resource];
    const expected = initial[resource] + s.stats.produced[resource] + s.trade.imported[resource] - s.trade.exported[resource];
    assert.equal(actual, expected, `${resource} colony ledger at ${s.tick}`);
  }
  ownership();
  assert.equal(new Set(s.items.map(key)).size, s.items.length, 'one ground stack per cell');
  for (const p of colonists()) assert(!p.dead && !p.downed, `retain real colonist loss at tick ${s.tick}`);
}
function step() {
  if (pilot && s.tick >= Number(process.env.VOXEL_TRADE_MAX_TICKS ?? 150000)) throw new Error('PILOT_LIMIT: diagnostic tick budget reached');
  s.step();
  for (const caravan of s.trade.caravans) if (!seenVisits.has(caravan.id)) {
    seenVisits.add(caravan.id);
    report.visits.push({ tick: s.tick, caravan: structuredClone(caravan) });
    captures.set(`visitor-${caravan.id}`, structuredClone(s.save()));
  }
  if (s.tick % 100 === 0) audit();
  if (s.tick % (DAY / 2) === 0) {
    report.samples.push({ tick: s.tick, inventory: s.counts(), trade: structuredClone(s.trade), colonists: colonists().map((p) => ({ id: p.id, food: p.food, rest: p.rest })) });
    console.log('HALF_DAY', s.tick / DAY);
  }
}
function until(name, predicate, limit = DAY * 3) {
  const start = s.tick;
  while (!predicate() && s.tick - start < limit) step();
  assert(predicate(), `${name}: tick ${s.tick}; ${JSON.stringify({ inventory: s.counts(), visitors: s.trade.caravans.map((c) => ({ id: c.id, kind: c.kind, stage: c.stage })), colonists: colonists().map((p) => ({ id: p.id, reason: p.reason, food: p.food, rest: p.rest })) })}`);
  audit(); check(name, { elapsed: s.tick - start });
}
async function save(name, data = s.save()) {
  const bytes = Buffer.from(JSON.stringify(data) + '\n'), file = `${OUT}/${name}.json`;
  await writeFile(file, bytes, { flag: 'wx' });
  report.fixtures[name] = { file, sha256: sha(bytes), tick: data.tick, version: data.version };
  return structuredClone(data);
}
function surfacePlan() {
  const blocked = new Set([...s.items, ...s.trees, ...s.stockpiles].map(key));
  const surface = [];
  for (let y = 2; y < 62; y++) for (let x = 2; x < 62; x++) {
    let z = 14;
    while (z > 0 && !s.blocks[at({ x, y, z })]) z--;
    const p = { x, y, z: z + 1 };
    if (s.standable(p) && s.path(colonists()[0], p) !== null) surface.push(p);
  }
  surface.sort((a, b) => distance(a, s.spawn) - distance(b, s.spawn) || at(a) - at(b));
  const reserve = (p) => { blocked.add(key(p)); return p; };
  const tailor = surface.find((p) => [0, 1, 2, 3].every((dx) => [-1, 0, 1].every((dy) => {
    const q = { x: p.x + dx, y: p.y + dy, z: p.z };
    return s.standable(q) && !blocked.has(key(q)) && s.path(colonists()[0], q) !== null;
  })));
  assert(tailor, 'tailor footprint and operating aisle');
  for (let dx = 0; dx <= 3; dx++) for (let dy = -1; dy <= 1; dy++) reserve({ x: tailor.x + dx, y: tailor.y + dy, z: tailor.z });
  const free = () => surface.find((p) => !blocked.has(key(p)));
  const stove = reserve(free()), craftingSpot = reserve(free()), beds = [];
  for (let i = 0; i < 3; i++) {
    const bed = surface.find((p) => !blocked.has(key(p)) && !blocked.has(key({ ...p, x: p.x + 1 })) && s.standable({ ...p, x: p.x + 1 }));
    assert(bed); beds.push(bed); reserve(bed); reserve({ ...bed, x: bed.x + 1 });
  }
  const storage = surface.filter((p) => !blocked.has(key(p))).slice(0, 48);
  storage.forEach(reserve);
  const farms = surface.filter((p) => !blocked.has(key(p)) && [1, 8].includes(s.blocks[at({ ...p, z: p.z - 1 })])).slice(0, 192);
  assert.equal(farms.length, 192, '128 food plots plus 64 cotton plots');
  const trees = s.trees.filter((t) => t.growth >= 1 && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => s.path(colonists()[0], { ...t, x: t.x + dx, y: t.y + dy }) !== null))
    .sort((a, b) => distance(a, s.spawn) - distance(b, s.spawn)).slice(0, 16);
  assert(trees.length >= 12, 'finite reachable mature timber');
  return { tailor, stove, craftingSpot, beds, storage, farms, trees: trees.map(point) };
}
function ordinaryOpening() {
  const layout = surfacePlan(); report.layout = layout;
  command({ type: 'difficulty', difficulty: 'peaceful' });
  for (const p of colonists()) for (const [work, value] of Object.entries({ build: 1, cook: 1, grow: 2, cut: 2, craft: 2, haul: 3, research: 0 }))
    command({ type: 'priority', pawnId: p.id, work, value });
  layout.storage.forEach((p) => place('stock', p));
  place('stove', layout.stove); place('tailor', layout.tailor, { axis: 'x' }); place('craftingSpot', layout.craftingSpot);
  layout.beds.forEach((p) => place('bed', p, { axis: 'x' }));
  layout.farms.forEach((p, i) => place('farm', p, { crop: i < 128 ? 'rice' : 'cotton' }));
  layout.trees.forEach((p) => place('cut', p));
  command({ type: 'homeArea', from: { x: Math.max(0, s.spawn.x - 12), y: Math.max(0, s.spawn.y - 12), z: s.spawn.z }, to: { x: Math.min(63, s.spawn.x + 12), y: Math.min(63, s.spawn.y + 12), z: s.spawn.z }, enabled: true });
  until('ordinary food and textile infrastructure built', () => s.stoves.length === 1 && s.tailors.length === 1 && s.beds.length === 3, DAY * 5);
  command({ type: 'bill', stoveId: s.stoves[0].id, target: 10, paused: false });
}
function negotiate(caravanId) {
  const pawn = colonists().filter((p) => !p.dead && !p.downed && !p.drafted)
    .sort((a, b) => b.skills.social.level - a.skills.social.level)[0];
  assert(pawn, 'ordinary negotiator available');
  for (let offset = 0; offset < 4; offset++) command({ type: 'schedule', pawnId: pawn.id, hour: (Math.floor(s.tick / (DAY / 24)) + offset) % 24, assignment: 'work' });
  until('negotiator has normally eaten and rested before talking', () => pawn.food >= 40 && pawn.rest >= 20, DAY / 3);
  for (let attempt = 0; attempt < 3; attempt++) {
    command({ type: 'tradeTalk', pawnId: pawn.id, caravanId });
    until('ordinary negotiation reaches a quote or is naturally interrupted', () => quoteTrade(s) !== null || s.trade.session === null, DAY / 2);
    if (quoteTrade(s)) { check('colonist physically reaches the actual merchant'); return quoteTrade(s); }
    report.samples.push({ tick: s.tick, interruptedNegotiation: { pawnId: pawn.id, reason: pawn.reason } });
    until('interrupted negotiator normally recovers needs', () => pawn.food >= 40 && pawn.rest >= 20, DAY / 3);
  }
  assert.fail('three ordinary negotiations were naturally interrupted');
}
function independentRound(value) {
  const floor = Math.floor(value), fraction = value - floor;
  return fraction < .5 ? floor : fraction > .5 ? floor + 1 : floor % 2 === 0 ? floor : floor + 1;
}
function transact(lines, gift = false, acceptShortfall = false) {
  const quote = quoteTrade(s); assert(quote);
  const before = { save: structuredClone(s.save()), inventory: s.counts(), ownership: ownership() };
  const sums = { colony: 0, trader: 0 };
  for (const line of lines) {
    const offer = quote.offers.find((o) => o.side === line.side && o.stockId === line.stockId); assert(offer);
    sums[line.side] += offer.unitPrice * line.amount;
  }
  const quoted = gift ? 0 : independentRound(sums.colony - sums.trader);
  const expectedSilver = gift ? 0 : Math.min(quoted, quote.traderSilver);
  const value = { type: 'tradeCommit', sessionId: quote.sessionId, quoteKey: quote.key, lines, gift, acceptShortfall };
  command(value);
  const receipt = s.trade.receipts.at(-1); assert(receipt);
  assert.deepEqual(physicalTotals(s.save()), physicalTotals(before.save), 'both parties retain every physical resource across an instantaneous exchange');
  const agesBefore = foodAge(before.save), agesAfter = foodAge(s.save());
  for (const [resource, age] of Object.entries(agesBefore)) assert(Math.abs((agesAfter[resource] ?? 0) - age) < Math.max(1e-5, age * 1e-12), `${resource} food age mass remains conserved`);
  const pieces = list => list.map(([id, value]) => [id, value.piece]);
  assert.deepEqual(pieces(ownership()), pieces(before.ownership), 'trade changes equipment ownership, never identity/condition');
  for (const line of lines) {
    const original = quote.offers.find(o => o.side === line.side && o.stockId === line.stockId);
    const transfer = receipt.transferred.find(row => row.side === line.side && row.stockId === line.stockId);
    assert(transfer); assert.equal(transfer.batch.amount, line.amount);
    for (const field of ['resource', 'crop', 'rotProgress', 'weapon', 'apparel']) assert.deepEqual(transfer.batch[field], original.batch[field]);
  }
  assert.equal(receipt.quotedSilverToColony, quoted);
  assert.equal(receipt.silverToColony, expectedSilver);
  assert.equal(s.counts().silver, before.inventory.silver + expectedSilver - (gift ? lines.filter((line) => quote.offers.find((o) => o.side === line.side && o.stockId === line.stockId)?.currency).reduce((n, line) => n + line.amount, 0) : 0));
  report.transactions.push({ tick: s.tick, quote, lines, receipt: structuredClone(receipt), before: { inventory: before.inventory, ownership: before.ownership }, after: { inventory: s.counts(), ownership: ownership() } });
  command(value, false); report.coverage.repeatedCommit = true;
  report.coverage.foodAge ||= lines.some(line => quote.offers.find(o => o.side === line.side && o.stockId === line.stockId)?.batch.rotProgress !== undefined);
  report.coverage.equipmentIdentity ||= lines.some(line => ['weapon', 'apparel'].includes(quote.offers.find(o => o.side === line.side && o.stockId === line.stockId)?.batch.resource));
  report.coverage.buyAndSell ||= lines.some(line => line.side === 'colony') && lines.some(line => line.side === 'trader');
  audit();
  return receipt;
}

function batches(data) {
  return [...data.items, ...data.pawns.flatMap(p => p.cargo ? [p.cargo] : []),
    ...data.jobs.flatMap(j => j.deliveredBatches), ...data.trade.caravans.flatMap(c => c.stock)];
}
function physicalTotals(data) {
  const result = Object.fromEntries(Object.keys(initial).map(k => [k, 0]));
  for (const b of batches(data)) result[b.resource] += b.amount;
  for (const p of data.pawns) { result.weapon += Number(!!p.weapon); result.apparel += p.worn.length; }
  for (const j of data.jobs) for (const [r, amount] of Object.entries(j.delivered))
    if (!['grain', 'meal', 'herb'].includes(r)) result[r] += amount;
  return result;
}
function foodAge(data) {
  const result = {};
  for (const b of batches(data)) if (b.rotProgress !== undefined) {
    const k = `${b.resource}/${b.crop ?? ''}`; result[k] = (result[k] ?? 0) + b.amount * b.rotProgress;
  }
  return result;
}
function physicalProjection(data) {
  const copy = structuredClone(data);
  const omit = (objects, fields) => objects.forEach(o => { if (o) fields.forEach(f => delete o[f]); });
  omit(copy.pawns, ['path', 'jobId', 'destination', 'phase', 'reason', 'moveTick', 'workTarget']);
  omit(copy.jobs, ['owner', 'reason']);
  omit(copy.devices, ['active', 'watts', 'network', 'reason']);
  omit(copy.weaponBenches.map(b => b.power), ['active', 'watts', 'network', 'reason']);
  return copy;
}
function reload() {
  const prior = structuredClone(s.save());
  s = VoxelSimulation.load(structuredClone(prior));
  assert.deepEqual(physicalProjection(s.save()), physicalProjection(prior), 'ordinary load preserves physical save, receipts and trade calendar');
  report.coverage.reload = true; audit();
}
const line = (offer, amount = 1) => ({ side: offer.side, stockId: offer.stockId, amount });
function pauseProduction() {
  for (const p of colonists()) command({ type: 'priority', pawnId: p.id, work: 'craft', value: 0 });
}
function resumeProduction() {
  for (const p of colonists()) command({ type: 'priority', pawnId: p.id, work: 'craft', value: 1 });
}
async function tradeVisit(caravanId) {
  const caravan = s.trade.caravans.find(c => c.id === caravanId); assert(caravan);
  for (const p of colonists()) for (const work of ['grow', 'haul']) command({ type: 'priority', pawnId: p.id, work, value: 0 });
  await save(`before-talk-${caravanId}`);
  let q = negotiate(caravanId);
  const cancelBefore = { counts: s.counts(), imported: structuredClone(s.trade.imported), exported: structuredClone(s.trade.exported), receipts: structuredClone(s.trade.receipts), stock: structuredClone(caravan.stock) };
  command({ type: 'tradeCancel', sessionId: q.sessionId });
  assert.deepEqual({ counts: s.counts(), imported: s.trade.imported, exported: s.trade.exported, receipts: s.trade.receipts, stock: caravan.stock }, cancelBefore);
  report.coverage.cancellation = true; check('walking to merchant then canceling transfers no goods or currency');
  q = negotiate(caravanId);
  await save(`quote-${caravanId}`);
  if (!report.fixtures['browser-ready']) await save('browser-ready');
  if (caravan.kind === 'bulk') {
    const cloth = q.offers.find(o => o.side === 'trader' && o.batch.resource === 'cloth');
    const grain = q.offers.find(o => o.side === 'colony' && o.batch.resource === 'grain');
    const merchantFood = q.offers.find(o => o.side === 'trader' && o.batch.resource === 'grain' && o.batch.crop === grain?.batch.crop);
    assert(cloth && grain && merchantFood, 'real bulk stock and produced grain available');
    const originalCloth = s.counts().cloth, consumedCloth = s.stats.consumed.cloth;
    const clothSales = q.offers.filter(o => o.side === 'colony' && o.batch.resource === 'cloth');
    assert.equal(clothSales.reduce((n, o) => n + o.amount, 0), originalCloth, 'all previously harvested cloth physically eligible for sale');
    report.purchasedMaterial = { resource: 'cloth', before: originalCloth, sold: originalCloth, purchased: 20, consumedBefore: consumedCloth };
    transact([line(cloth, 20), ...clothSales.map(o => line(o, o.amount)), line(grain, Math.min(20, grain.amount)), line(merchantFood, 3)]);
    assert.equal(s.counts().cloth, 20, 'remaining cloth came from actual purchase after all prior cloth was sold');
    report.coverage.productionSale = true;
    await save('after-first-trade'); reload();
    // All preexisting cloth was sold and cotton work is paused. Depleting these
    // twenty physical units proves actual use of purchased material.
    const target = 1;
    assert(target >= 1 && target <= 100);
    command({ type: 'tailorBill', tailorId: s.tailors[0].id, kind: 'tuque', target, paused: false });
    resumeProduction();
    until('bought cloth actually consumed by tailoring', () => s.stats.consumed.cloth >= consumedCloth + 20, DAY * 3);
    report.coverage.purchasedUse = true;
    command({ type: 'tailorBill', tailorId: s.tailors[0].id, kind: 'tuque', target: 0, paused: true });
    until('crafted garment has physically landed', () => s.items.some(i => i.apparel?.kind === 'tuque'), DAY);
    if (!s.trade.caravans.some(c => c.id === caravanId && s.pawns.some(p => p.id === c.traderId))) return;
    q = negotiate(caravanId);
    const garment = q.offers.find(o => o.side === 'colony' && o.batch.apparel?.kind === 'tuque');
    assert(garment, 'merchant accepts actually crafted garment');
    await save('second-trade-ready');
    transact([line(garment)]);
  } else {
    const buy = q.offers.filter(o => o.side === 'trader' && o.batch.weapon).sort((a, b) => a.unitPrice - b.unitPrice)[0];
    const sale = q.offers.find(o => o.side === 'colony' && o.batch.weapon?.kind === 'steelKnife');
    assert(buy && sale, 'actual weapon catalog and colony-produced knife');
    const boughtId = buy.batch.weapon.id;
    transact([line(buy), line(sale)]); report.coverage.productionSale = true;
    await save('after-first-trade'); reload();
    const p = colonists().find(p => !p.drafted && !p.dead && !p.downed); assert(p);
    command({ type: 'equipWeapon', pawnId: p.id, weaponId: boughtId });
    until('purchased weapon physically equipped by actual colonist', () => p.weapon?.id === boughtId, DAY);
    report.coverage.purchasedUse = true;
    q = negotiate(caravanId);
    const second = q.offers.filter(o => o.side === 'trader' && o.batch.weapon).sort((a, b) => a.unitPrice - b.unitPrice)[0]; assert(second);
    await save('second-trade-ready'); transact([line(second)]);
  }
  await save(`traded-${caravanId}`); reload();
  check('natural caravan exchanged physical goods twice and purchased goods entered actual use');
}
try {
  assert.equal(initial.silver, 800); await save(pilotCheckpoint ? 'diagnostic-start' : 'initial');
  if (!pilotCheckpoint) { ordinaryOpening(); await save('prepared'); }
  until('real rice harvest and cooked meals', () => s.stats.produced.grain >= 20 && s.stats.produced.meal > 0, DAY * 12);
  report.coverage.foodProduction = true;
  pauseProduction(); await save('production-ready');
  const handled = new Set();
  while (report.transactions.length < 2 || !report.coverage.foodAge || !report.coverage.equipmentIdentity || !report.coverage.purchasedUse) {
    until('natural caravan arrives without summons', () => s.trade.caravans.some(c => !handled.has(c.id) && s.pawns.some(p => p.id === c.traderId && !p.dead && !p.downed)), DAY * 70);
    const caravan = s.trade.caravans.find(c => !handled.has(c.id) && s.pawns.some(p => p.id === c.traderId && !p.dead && !p.downed));
    handled.add(caravan.id); await tradeVisit(caravan.id);
    if (report.coverage.purchasedUse && report.coverage.equipmentIdentity && report.coverage.foodAge) {
      const end = s.trade.caravans.find(c => c.id === caravan.id);
      if (end?.visitingAt !== null && end) {
        const target = end.visitingAt + end.stayTicks - 100;
        until('ordinary near-departure checkpoint', () => s.tick >= target, DAY);
        await save('before-departure');
      }
      until('actual merchant and companions leave the map', () => !s.trade.caravans.some(c => c.id === caravan.id), DAY * 3);
      report.coverage.departure = true;
    }
  }
  for (const p of colonists()) for (const [work, value] of [['grow', 2], ['haul', 3]]) command({ type: 'priority', pawnId: p.id, work, value });
  until('planted cotton reaches maturity and is physically harvested', () => s.stats.produced.cloth >= 20, DAY * 15);
  report.coverage.cottonHarvest = true;
  for (const [name, value] of Object.entries(report.coverage)) assert(value, `required campaign coverage: ${name}`);
  await save('final'); reload();
  report.status = pilot ? 'pilot-passed' : 'passed';
} catch (error) {
  report.status = String(error).includes('PILOT_LIMIT:') ? 'pilot-limited' : 'failed';
  report.errors.push(error.stack ?? String(error));
  await save('failure'); console.error(error);
  if (report.status === 'failed') process.exitCode = 1;
} finally {
  for (const [name, data] of captures) await save(name, data);
  report.finishedAt = new Date().toISOString(); report.finalTick = s.tick;
  report.finalInventory = s.counts(); report.finalTrade = structuredClone(s.trade);
  report.finalOwnership = ownership();
  await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: report.status, formal, pilot, tick: s.tick, checks: report.checks.length, coverage: report.coverage, report: `${OUT}/report.json` }, null, 2));
}
