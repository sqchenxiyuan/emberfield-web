import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const identity = { version: '1.7.4980 rev60', assembly: 'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3',
  engine: 'ICSharpCode.Decompiler', engineVersion: '11.2.0.10050', engineHash: '587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78' };
const sha = v => createHash('sha256').update(v).digest('hex');
const validHash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const clamp01 = v => clamp(v, 0, 1);

// These handwritten analytic reference models do not invoke game classes or evaluate JSON code.
const models = {
  'E01 Construction mapping': i => ({ currentWorkCeil: i.baseWork.map(w => Math.ceil(w * i.currentTPS / i.originalTPS)) }),
  'E02 Fuel and refill': i => {
    const full = i.levels.map(f => i.target - f < 1), consumedWood = Math.max(1, Math.ceil(i.target * (1 - i.threshold)));
    const partialConsumed = i.partial.map(r => Math.min(Math.max(1, Math.ceil(i.target - r.fuel)), r.wood));
    const partialStored = i.partial.map((r, n) => Math.min(i.capacity, r.fuel + partialConsumed[n]));
    return { full, autoStart: i.levels.map((f, n) => f / i.target <= i.threshold && !full[n] && i.target > 0),
      requestedCounts: i.levels.map(f => Math.max(1, Math.ceil(i.target - f))), fullTankDays: i.capacity / i.consumptionPerDay,
      daysToAutoThreshold: (i.capacity - i.target * i.threshold) / i.consumptionPerDay, fuelPerCurrentTick: i.consumptionPerDay / i.currentDay,
      refillAtThreshold: { consumedWood, storedAfter: Math.min(i.capacity, i.target * i.threshold + consumedWood),
        fractionalOverflow: Math.max(0, i.target * i.threshold + consumedWood - i.capacity) },
      partialRefill: { consumedWood: partialConsumed, storedAfter: partialStored, hasFuel: partialStored.map(f => f > 0),
        autoStartAgain: partialStored.map(f => f / i.target <= i.threshold && i.target - f >= 1 && i.target > 0) } };
  },
  'E03 Solar roof factor': i => ({ outputW: i.rows.map(r => i.ratedW * clamp01(r.sky) * (i.area - r.roofed) / i.area) }),
  'E04 Sky final operators': i => ({ celestialGlow: i.sunDots.map(v => clamp01(v / 0.7)),
    weatherAtFullSun: i.weatherMaxGlow.map(v => Math.min(1, v)),
    transitionGlow: 1 + (i.weatherMaxGlow[1] - 1) * i.transition, darkenedGlow: 1 - i.darkenFactor }),
  'E05 Connector search square': i => {
    const eligible = i.candidates.map(([x, z]) => Math.abs(x - i.anchor[0]) <= i.range && Math.abs(z - i.anchor[1]) <= i.range);
    const candidates = i.candidates.filter((_, n) => eligible[n]);
    const dist = ([x, z]) => (x - i.anchor[0]) ** 2 + (z - i.anchor[1]) ** 2;
    candidates.sort((a, b) => dist(a) - dist(b) || a[1] - b[1] || a[0] - b[0]);
    return { eligible, nearest: candidates[0] ?? null, cornerDistanceSquared: dist(i.candidates[0]) };
  },
  'E06 Cardinal network components': i => ({ components: i.layouts.map(cells => {
    const left = new Set(cells.map(c => c.join(','))); let count = 0;
    while (left.size) { count++; const todo = [left.values().next().value]; left.delete(todo[0]);
      while (todo.length) { const [x, y] = todo.pop().split(',').map(Number);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const next = `${x + dx},${y + dy}`; if (left.delete(next)) todo.push(next); }
      }
    } return count;
  }) }),
  'E07 Battery balance': i => {
    const netChargeWdPerDay = i.surplusW * i.efficiency - i.selfDischargeW;
    return { netChargeWdPerDay, emptyToFullDays: i.capacity / netChargeWdPerDay,
      fullToEmptyDays: i.capacity / (i.loadW + i.selfDischargeW), netChargePerCurrentTick: netChargeWdPerDay / i.currentDay,
      loadPerCurrentTick: (i.loadW + i.selfDischargeW) / i.currentDay };
  },
  'E08 Room temperature migration': i => {
    const unique = [...new Map(i.cached.map(r => [r.id, r])).values()];
    const average = weights => unique.reduce((s, r, n) => s + r.temperature * weights[n], 0) / weights.reduce((a, b) => a + b, 0);
    return { oldRoomWeighted: average(unique.map(r => r.oldArea)), overlapWeightedAlternative: average(i.overlapAreas),
      splitTemperatures: [i.splitSourceTemperature, i.splitSourceTemperature] };
  },
  'E09 Temperature serialization': i => ({ decoded: i.temperatures.map(t => Math.trunc(clamp(t, -273.15, 1000) * 16) / 16) }),
  'E10 Update clocks': i => ({ seconds: i.originalIntervals.map(t => t / i.originalTPS),
    currentIntervalsCeil: i.originalIntervals.map(t => Math.ceil(t * i.currentTPS / i.originalTPS)),
    roomEqualize: i.probeTicks.map(t => t % 120 === 7) }),
  'E11 Heater target clipping': i => {
    const efficiency = i.temperature.map(t => clamp01((120 - t) / 100));
    const delta = i.temperature.map((t, n) => Math.max(0, Math.min(i.targets[n] - t, i.heatPerSecond * i.seconds * efficiency[n] / i.area)));
    return { efficiency, delta, powerW: delta.map(d => i.watts * (Math.abs(d) > 1e-10 ? 1 : i.standby)) };
  },
  'E12 Cooler exhaust and obstruction': i => {
    const efficiency = i.rows.map(r => Math.max(0, 1 - (r.hot - Math.min(r.cold, 40)) / 130));
    const energy = efficiency.map(e => i.heatPerSecond * i.seconds * e);
    const coldDelta = i.rows.map((r, n) => r.blocked ? 0 : Math.min(0, Math.max(r.target - r.cold, energy[n] / i.area)));
    return { efficiency, coldDelta, hotHeat: coldDelta.map((d, n) => Math.abs(d) > 1e-10 ? -energy[n] * 1.25 : 0),
      powerW: coldDelta.map(d => i.watts * (Math.abs(d) > 1e-10 ? 1 : i.standby)) };
  },
  'E13 Through building exchange': i => {
    const mean = i.rooms.reduce((s, r) => s + r.temperature, 0) / i.rooms.length;
    const scale = i.rates.map(rate => Math.min(1, ...i.rooms.filter(r => r.temperature !== mean).map(r => r.area / rate)));
    const after = i.rates.map((rate, n) => i.rooms.map(r => r.temperature + (mean - r.temperature) * rate * scale[n] / r.area));
    return { mean, scale, after, energyDelta: after.map(row => row.reduce((s, t, n) => s + (t - i.rooms[n].temperature) * i.rooms[n].area, 0)) };
  },
  'E14 Custom voxel unit mapping': i => ({ equivalentHeatCapacity: i.airVolume / i.capacityDivisor,
    currentHeatPerTick: i.heatPerSecond / i.currentTPS, currentTempRisePerTick: i.heatPerSecond / i.currentTPS / (i.airVolume / i.capacityDivisor),
    heatPerCurrentDay: i.heatPerSecond * i.currentDay / i.currentTPS, heatPerOriginalDay: i.heatPerSecond * i.originalDay / i.originalTPS,
    electricalWdPerCurrentTick: i.electricalW / i.currentDay, woodPerCurrentTick: i.woodPerDay / i.currentDay }),
  'E15 Startup buffer despite surplus generation': i => ({
    startupWithBattery: i.dayTicks.map(day => i.storedWd.map(s => (s >= 0.1 ? s - 5 : s) + i.generationW / day >= 0)),
    startupWithoutBattery: i.dayTicks.map(day => i.storedWd.map(s => s + i.generationW / day >= 0)),
    candidateAffordable: i.dayTicks.map(day => i.storedWd.map(s => s + i.generationW / day >= i.consumerW / day - 1e-7)),
    thresholdForBufferBranch: i.dayTicks.map(day => 5 - i.generationW / day),
  }),
};
function validateData(v) {
  if (typeof v === 'number') assert(Number.isFinite(v), 'Nonfinite data');
  else if (Array.isArray(v)) v.forEach(validateData);
  else if (object(v)) Object.values(v).forEach(validateData);
  else assert(v === null || typeof v === 'string' || typeof v === 'boolean', 'Invalid JSON data');
}

export function verifyEnergyEvidence({ root = projectRoot, local = false } = {}) {
  const evidence = path.join(root, 'docs/research/rimworld/evidence');
  const read = n => JSON.parse(readFileSync(path.join(evidence, n), 'utf8').replace(/^\uFEFF/, ''));
  const groups = ['energy', 'environment', 'housing', 'food', 'generation', 'work'];
  const types = new Map(), selected = new Set(), manifests = {};
  for (const g of groups) {
    const m = manifests[g] = read(`${g}-manifest.json`);
    assert.equal(m.evidence_id, `RW17-${g.toUpperCase()}`); assert.equal(m.version_text, identity.version);
    assert.equal(m.source, 'Assembly-CSharp.dll'); assert.equal(m.source_sha256, identity.assembly);
    assert.equal(m.engine, identity.engine); assert.equal(m.engine_version, identity.engineVersion); assert.equal(m.engine_sha256, identity.engineHash);
    assert.equal(m.line_endings, 'LF'); assert.equal(m.encoding, 'UTF-8 without BOM');
    assert(Array.isArray(m.types) && m.types.length > 0); assert.deepEqual(read(`${g}-types.json`), m.types.map(t => t.type));
    for (const t of m.types) {
      const key = `${g}:${t.type}`; assert(!types.has(key) && /^[A-Za-z_][A-Za-z0-9_.+`]*$/.test(t.type), `Invalid type ${key}`);
      assert.equal(t.local_file, `.local-research/${g}/${t.type}.cs`);
      assert(validHash(t.sha256) && Number.isInteger(t.lines) && t.lines > 0, `Invalid type metadata ${key}`);
      types.set(key, t); if (g === 'energy') selected.add(key);
    }
  }
  assert.equal(manifests.energy.types.length, 31, 'Review changed energy type set');
  const snapshot = read('energy-xml.json'), records = new Map(), xmlFiles = new Map(), sources = new Set();
  assert.equal(snapshot.evidence_id, 'RW17-ENERGY-XML'); assert.equal(snapshot.version_text, identity.version);
  assert.equal(snapshot.assembly_sha256, identity.assembly); assert.equal(snapshot.records.length, 14);
  let xmlLeaves = 0, xmlAttributeNodes = 0, xmlAbsentRoots = 0;
  for (const r of snapshot.records) {
    assert(!records.has(r.id) && typeof r.group === 'string' && r.group && typeof r.parent_name === 'string', `Invalid XML record ${r.id}`);
    const s = r.source; assert(object(s) && /^Data\/(?:[A-Za-z0-9_-]+\/)+[A-Za-z0-9_-]+\.xml$/.test(s.path) && validHash(s.sha256));
    const match = /^\/Defs\/([A-Za-z_][A-Za-z0-9_]*)\[(?:defName|@Name)='([A-Za-z_][A-Za-z0-9_]*)'\]$/.exec(s.xpath);
    assert(match && r.id === `${match[1]}_${match[2]}` && r.def_name === match[2], `Invalid record XPath ${r.id}`);
    if (xmlFiles.has(s.path)) assert.equal(xmlFiles.get(s.path), s.sha256); xmlFiles.set(s.path, s.sha256);
    const source = `${s.path}:${s.xpath}`; assert(!sources.has(source)); sources.add(source);
    assert(Array.isArray(r.selected_roots) && new Set(r.selected_roots).size === r.selected_roots.length);
    assert(r.selected_roots.every(t => /^[A-Za-z_][A-Za-z0-9_]*$/.test(t)));
    assert(Array.isArray(r.absent_roots) && new Set(r.absent_roots).size === r.absent_roots.length);
    assert(r.absent_roots.every(t => r.selected_roots.includes(t))); xmlAbsentRoots += r.absent_roots.length;
    const validPath = xp => {
      assert(typeof xp === 'string' && xp.startsWith(`${s.xpath}/`), `Field outside XML record ${r.id}`);
      const suffix = xp.slice(s.xpath.length + 1), first = suffix.split('/')[0].replace(/\[\d+\]$/, '');
      assert(/^[A-Za-z_][A-Za-z0-9_]*(?:\[[1-9][0-9]*\])?(?:\/[A-Za-z_][A-Za-z0-9_]*(?:\[[1-9][0-9]*\])?)*$/.test(suffix));
      assert(r.selected_roots.includes(first) && !r.absent_roots.includes(first), `Unselected or absent field ${r.id}`);
    };
    assert(Array.isArray(r.fields) && Array.isArray(r.node_attributes)); const fields = new Set(), attrs = new Set();
    for (const f of r.fields) { validPath(f.xpath); assert(!fields.has(f.xpath) && typeof f.value === 'string'); fields.add(f.xpath); xmlLeaves++; }
    for (const a of r.node_attributes) {
      validPath(a.xpath); assert(!attrs.has(a.xpath) && object(a.attributes) && Object.keys(a.attributes).length > 0); attrs.add(a.xpath);
      for (const [k, v] of Object.entries(a.attributes)) assert(/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(k) && typeof v === 'string');
      xmlAttributeNodes++;
    } records.set(r.id, r);
  }
  const claims = read('energy-claims.json'), cases = read('energy-cases.json'), ids = new Set();
  assert(Array.isArray(claims) && claims.length === 25); let codeReferences = 0, xmlReferences = 0, localDerivedFilesVerified = 0;
  for (const c of claims) {
    assert(/^EN\d{2}$/.test(c.id) && !ids.has(c.id)); ids.add(c.id);
    assert(['static-derived', 'xml-declared', 'xml-and-static-derived'].includes(c.kind) && typeof c.statement === 'string' && c.statement.trim());
    assert(Array.isArray(c.sources) && c.sources.length > 0);
    for (const s of c.sources) {
      assert(groups.includes(s.group) && Boolean(s.type) !== Boolean(s.xml_record));
      if (s.type) { const key = `${s.group}:${s.type}`, t = types.get(key); assert(t, `Missing type ${key}`);
        assert(Number.isInteger(s.line_start) && Number.isInteger(s.line_end) && s.line_start > 0 && s.line_start <= s.line_end && s.line_end <= t.lines, `Invalid lines ${c.id}/${key}`);
        selected.add(key); codeReferences++;
      } else { assert(s.group === 'energy' && records.has(s.xml_record), `Missing XML record ${c.id}`); xmlReferences++; }
    }
  }
  assert.deepEqual([...ids].sort(), Array.from({ length: 25 }, (_, n) => `EN${String(n + 1).padStart(2, '0')}`));
  if (local) for (const key of selected) { const t = types.get(key), bytes = readFileSync(path.join(root, t.local_file));
    assert.equal(sha(bytes), t.sha256, `Derived hash mismatch ${key}`); assert.equal(bytes.toString('utf8').split('\n').length, t.lines); localDerivedFilesVerified++;
  }
  assert(Array.isArray(cases) && cases.length === 15); const labels = new Set(); let analyticAssertions = 0;
  function compare(actual, expected, label) {
    if (typeof expected === 'number') { assert(typeof actual === 'number' && Number.isFinite(actual) && Math.abs(actual - expected) < 1e-9, `${label}: ${actual} != ${expected}`); analyticAssertions++; }
    else if (Array.isArray(expected)) { assert(Array.isArray(actual) && actual.length === expected.length, `Array shape ${label}`); expected.forEach((v, n) => compare(actual[n], v, `${label}[${n}]`)); }
    else if (object(expected)) { assert(object(actual)); assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort()); for (const [k, v] of Object.entries(expected)) compare(actual[k], v, `${label}.${k}`); }
    else { assert.equal(actual, expected, label); analyticAssertions++; }
  }
  for (const c of cases) { assert(Object.hasOwn(models, c.label) && !labels.has(c.label)); labels.add(c.label);
    assert(Array.isArray(c.claims) && c.claims.length && c.claims.every(id => ids.has(id)) && object(c.inputs) && object(c.expected));
    validateData(c.inputs); validateData(c.expected); compare(models[c.label](c.inputs), c.expected, c.label);
  }
  assert.equal(analyticAssertions, 186, 'Review changed analytic assertion coverage');
  // Bind important model inputs to recorded declarations, not just self-consistent formulas.
  const field = (id, suffix) => { const matches = records.get(id)?.fields.filter(f => f.xpath.endsWith(`/${suffix}`)); assert(matches?.length === 1, `Missing/ambiguous XML value ${id}/${suffix}`); return matches[0].value; };
  const buildings = ['PowerConduit', 'WoodFiredGenerator', 'SolarGenerator', 'Battery', 'Heater', 'Cooler', 'Vent'];
  assert.deepEqual(buildings.map(n => Number(field(`ThingDef_${n}`, 'statBases/WorkToBuild'))), cases[0].inputs.baseWork);
  assert.equal(Number(field('ThingDef_WoodFiredGenerator', 'fuelCapacity')), cases[1].inputs.capacity);
  assert.equal(Number(field('ThingDef_WoodFiredGenerator', 'fuelConsumptionRate')), cases[1].inputs.consumptionPerDay);
  assert.equal(Number(field('ThingDef_SolarGenerator', 'basePowerConsumption')), -cases[2].inputs.ratedW);
  assert.equal(field('ThingDef_SolarGenerator', 'size'), '(4,4)'); assert.equal(cases[2].inputs.area, 16);
  assert.equal(Number(field('ThingDef_Battery', 'storedEnergyMax')), cases[6].inputs.capacity);
  assert.equal(Number(field('ThingDef_Battery', 'efficiency')), cases[6].inputs.efficiency);
  assert.equal(Number(field('ThingDef_Heater', 'energyPerSecond')), cases[10].inputs.heatPerSecond);
  assert.equal(Number(field('ThingDef_Cooler', 'energyPerSecond')), cases[11].inputs.heatPerSecond);
  assert.equal(-Number(field('ThingDef_WoodFiredGenerator', 'basePowerConsumption')), cases[14].inputs.generationW);
  assert.equal(Number(field('ThingDef_Heater', 'basePowerConsumption')), cases[14].inputs.consumerW);
  for (const n of ['Clear', 'Rain', 'Fog', 'SnowHard']) assert(records.get(`WeatherDef_${n}`).absent_roots.includes('maxGlow'));
  const runtime = read('energy-runtime.json'); assert.equal(runtime.evidence_id, 'RW17-ENERGY-RUNTIME');
  assert.equal(runtime.version_text, identity.version); assert.equal(runtime.assembly_sha256, identity.assembly);
  assert.deepEqual(runtime.active_mods, ['ludeon.rimworld', 'ludeon.rimworld.odyssey']);
  assert.equal(runtime.developer_actions_performed, false); assert.equal(runtime.normal_construction_demonstrated, false);
  assert.equal(runtime.observations.length, 1); const o = runtime.observations[0]; assert.equal(o.id, 'ER01');
  assert(/^runtime\/energy-[a-z-]+\.png$/.test(o.image) && validHash(o.sha256)); assert.equal(sha(readFileSync(path.join(evidence, o.image))), o.sha256, 'Runtime screenshot mismatch');
  assert.equal(o.values.max_power_output_w, -Number(field('ThingDef_WoodFiredGenerator', 'basePowerConsumption')));
  assert.equal(o.values.steel, Number(field('ThingDef_WoodFiredGenerator', 'costList/Steel')));
  assert.equal(o.values.industrial_components, Number(field('ThingDef_WoodFiredGenerator', 'costList/ComponentIndustrial')));
  return { status: 'pass', evidenceId: 'RW17-ENERGY-PORTABLE-VALIDATION', version: identity.version, recordedAssemblySha256: identity.assembly,
    energyTypes: manifests.energy.types.length, reusedTypes: selected.size - manifests.energy.types.length, claims: claims.length, codeReferences, xmlReferences,
    xmlFiles: xmlFiles.size, xmlRecords: records.size, xmlLeaves, xmlAttributeNodes, xmlAbsentRoots, analyticCases: cases.length, analyticAssertions,
    localDerivedFilesVerified, runtimeUiScreenshotsVerified: 1, originalGameExecutedByVerifier: false, originalGameFilesRead: false,
    scope: local ? 'metadata,source bindings,derived hashes,independent analytic models,runtime screenshot integrity' : 'metadata,source bindings,independent analytic models,runtime screenshot integrity',
    limitations: 'UI observation is definition display only on Core+Odyssey. No runtime generation,refueling,solar curve,thermal timing or implementation equivalence verified. Original XML values require verify-energy-evidence.ps1.' };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2); assert(args.every(a => a === '--local' || a === '--help'), 'Usage: node scripts/research/verify-energy-evidence.mjs [--local]');
  if (args.includes('--help')) console.log('Usage: node scripts/research/verify-energy-evidence.mjs [--local]\n--local additionally checks derived files; original game files are not read.');
  else console.log(JSON.stringify(verifyEnergyEvidence({ local: args.includes('--local') }), null, 2));
}
