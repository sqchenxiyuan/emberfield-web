import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const identity = {
  version: '1.7.4980 rev60',
  assembly: 'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3',
  engine: 'ICSharpCode.Decompiler', versionEngine: '11.2.0.10050',
  engineHash: '587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78',
};
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const hash = v => createHash('sha256').update(v).digest('hex');
const hashPattern = /^[a-f0-9]{64}$/;
const clamp01 = v => Math.max(0, Math.min(1, v));
const roundEven = v => {
  const low = Math.floor(v), fraction = v - low;
  return fraction === 0.5 ? low + (low % 2) : Math.round(v);
};
// Handwritten analytic models. No code or formulas are evaluated from evidence JSON.
const models = {
  'H01 Rest bands': i => {
    const categories = i.levels.map(v => v < 0.01 ? 'Exhausted' : v < 0.14 ? 'VeryTired' : v < 0.28 ? 'Tired' : 'Rested');
    const factors = { Rested: 1, Tired: 0.7, VeryTired: 0.3, Exhausted: 0.6 };
    const multipliers = categories.map(v => factors[v]);
    const lossPerDay = multipliers.map(v => v * i.baseLossPerDay);
    return { categories, multipliers, lossPerDay, currentLossPerTick: lossPerDay.map(v => v / i.currentDayTicks) };
  },
  'H02 Sleep recovery': i => {
    const hours = i.effectiveness.map(e => (i.end - i.start) * i.fullSleepHours / (e * i.restRateMultiplier));
    return { hours, currentTicks: hours.map(h => h / 24 * i.currentDayTicks),
      gainPerCurrentTick: i.effectiveness.map(e => 24 / i.fullSleepHours / i.currentDayTicks * e * i.restRateMultiplier) };
  },
  'H03 Sleep selection': i => ({
    priority: i.rows.map(r => r.blocked || r.rest >= 0.75 || r.schedule === 'Work' ? 0
      : r.schedule === 'Sleep' || r.rest < 0.3 ? 8 : 0),
    defaultSleepHours: Array.from({ length: 24 }, (_, h) => h).filter(h => h < 6 || h >= 22),
  }),
  'H04 Sleep continuation': i => ({ reason: i.rows.map(r => r.rest >= 1 ? 'full' : r.disturbed ? 'disturbance'
    : r.schedule === 'Work' && r.rest >= 0.2 ? 'work'
      : r.urgentFood && r.foodAvailable && r.rest > 0.14 ? 'food' : 'continue') }),
  'H05 Comfort': i => ({
    targets: i.qualityFactors.map(q => clamp01(i.baseComfort * q)),
    after: i.rows.map(r => r.target > r.start ? Math.min(r.target, r.start + r.hours * i.risePerHour)
      : Math.max(r.target, r.start - r.hours * i.fallPerHour)),
  }),
  'H06 Bed geometry': i => ({
    slots: i.sizes.map(([width]) => width),
    rotatedExtents: i.directions.map(([dx]) => dx === 0 ? [1, 2] : [2, 1]),
    customFeet: i.directions.map(([dx, dy]) => [i.anchor[0] + dx, i.anchor[1] + dy, i.anchor[2]]),
  }),
  'H07 Door timing and clock policies': i => {
    const originalOpenTicks = i.doorSpeeds.map(s => roundEven(45 / s));
    const scale = i.currentTPS / i.originalTPS;
    return { originalOpenTicks, poweredOpenTicks: i.doorSpeeds.map(s => roundEven(45 / s * 0.25)),
      currentOpenTicksCeil: originalOpenTicks.map(t => Math.ceil(t * scale)),
      currentCloseTicksCeil: Math.ceil(i.closeTicks * scale),
      currentRecheckTicksRound: Math.round(i.recheckTicks * scale),
      currentDisturbanceTicksRound: Math.round(i.disturbanceTicks * scale),
      currentNeedIntervalPreserveDay: i.needInterval * i.currentDayTicks / i.originalDayTicks,
      originalDaySeconds: i.originalDayTicks / i.originalTPS, currentDaySeconds: i.currentDayTicks / i.currentTPS };
  },
  'H08 Door predicates': i => ({
    freePassage: i.rows.map(r => r.open && (r.hold || !r.willCloseSoon)),
    mayClose: i.rows.map(r => !r.hold && !r.blocked),
  }),
  'H09 Room boundaries': i => {
    const mergeable = new Set(['Normal', 'ImpassableFreeAirExchange', 'Fence']);
    return { sameRoom: i.pairs.map(([a, b]) => mergeable.has(a) && mergeable.has(b)),
      doorRegionTypes: i.doorOpenStates.map(() => 'Portal'),
      usesOutdoorTemperature: i.roofRows.map(r => r.edge || r.unroofed >= Math.ceil(r.area * 0.25)) };
  },
  'H10 Material construction work': i => {
    const woodWork = i.baseWork.map(v => v * i.woodFactor);
    return { woodWork, stoneWork: i.baseWork.map(v => v * i.stoneFactor + i.stoneOffset),
      currentWoodWorkCeil: woodWork.map(v => Math.ceil(v * i.currentTPS / i.originalTPS)) };
  },
};

function validateData(v, label) {
  if (typeof v === 'number') assert(Number.isFinite(v), `${label}: nonfinite number`);
  else if (Array.isArray(v)) v.forEach((item, n) => validateData(item, `${label}[${n}]`));
  else if (isObject(v)) Object.entries(v).forEach(([k, item]) => validateData(item, `${label}.${k}`));
  else assert(v === null || typeof v === 'string' || typeof v === 'boolean', `${label}: invalid JSON value`);
}

export function verifyHousingEvidence({ root = projectRoot, local = false } = {}) {
  const dir = path.join(root, 'docs/research/rimworld/evidence');
  const read = name => JSON.parse(readFileSync(path.join(dir, name), 'utf8').replace(/^\uFEFF/, ''));
  const groups = ['housing', 'food', 'generation', 'work', 'environment'];
  const manifests = {}, types = new Map(), selectedTypes = new Set();
  for (const group of groups) {
    const m = manifests[group] = read(`${group}-manifest.json`);
    assert.equal(m.evidence_id, `RW17-${group.toUpperCase()}`);
    assert.equal(m.source, 'Assembly-CSharp.dll'); assert.equal(m.source_sha256, identity.assembly);
    assert.equal(m.version_text, identity.version); assert.equal(m.engine, identity.engine);
    assert.equal(m.engine_version, identity.versionEngine); assert.equal(m.engine_sha256, identity.engineHash);
    assert.equal(m.line_endings, 'LF'); assert.equal(m.encoding, 'UTF-8 without BOM');
    assert(Array.isArray(m.types) && m.types.length > 0, `Empty manifest: ${group}`);
    assert.deepEqual(read(`${group}-types.json`), m.types.map(t => t.type));
    for (const t of m.types) {
      const key = `${group}:${t.type}`;
      assert(typeof t.type === 'string' && /^[A-Za-z_][A-Za-z0-9_.+`]*$/.test(t.type), `Invalid type: ${key}`);
      assert(!types.has(key), `Duplicate type: ${key}`);
      assert.equal(t.local_file, `.local-research/${group}/${t.type}.cs`);
      assert(hashPattern.test(t.sha256) && Number.isInteger(t.lines) && t.lines > 0, `Invalid type metadata: ${key}`);
      types.set(key, t); if (group === 'housing') selectedTypes.add(key);
    }
  }
  assert.equal(manifests.housing.types.length, 28, 'Review changed housing type set');
  const snapshot = read('housing-xml.json'), records = new Map(), xmlHashes = new Map(), xmlSources = new Set();
  assert.equal(snapshot.evidence_id, 'RW17-HOUSING-XML'); assert.equal(snapshot.version_text, identity.version);
  assert.equal(snapshot.assembly_sha256, identity.assembly);
  assert(Array.isArray(snapshot.records) && snapshot.records.length === 25, 'Review changed housing XML selection');
  let xmlLeaves = 0;
  for (const r of snapshot.records) {
    assert(!records.has(r.id) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(r.id), `Invalid/duplicate XML record: ${r.id}`);
    assert(typeof r.group === 'string' && r.group && typeof r.parent_name === 'string', `Invalid XML metadata: ${r.id}`);
    const s = r.source;
    assert(isObject(s) && /^Data\/(?:[A-Za-z0-9_-]+\/)+[A-Za-z0-9_-]+\.xml$/.test(s.path), `Invalid XML path: ${r.id}`);
    assert(hashPattern.test(s.sha256), `Invalid XML hash: ${r.id}`);
    if (xmlHashes.has(s.path)) assert.equal(xmlHashes.get(s.path), s.sha256, `Mixed XML hashes: ${s.path}`);
    xmlHashes.set(s.path, s.sha256);
    const match = /^\/Defs\/([A-Za-z_][A-Za-z0-9_]*)\[(?:defName|@Name)='([A-Za-z_][A-Za-z0-9_]*)'\]$/.exec(s.xpath);
    assert(match && r.id === `${match[1]}_${match[2]}` && r.def_name === match[2], `Invalid XML XPath/id: ${r.id}`);
    const sourceKey = `${s.path}:${s.xpath}`;
    assert(!xmlSources.has(sourceKey), `Duplicate XML source: ${r.id}`); xmlSources.add(sourceKey);
    assert(Array.isArray(r.fields), `Invalid XML fields: ${r.id}`);
    const fields = new Set();
    for (const f of r.fields) {
      assert(typeof f.xpath === 'string' && f.xpath.startsWith(`${s.xpath}/`), `XML field outside record: ${r.id}`);
      const suffix = f.xpath.slice(s.xpath.length + 1);
      assert(/^[A-Za-z_][A-Za-z0-9_]*(?:\[[1-9][0-9]*\])?(?:\/[A-Za-z_][A-Za-z0-9_]*(?:\[[1-9][0-9]*\])?)*$/.test(suffix), `Invalid field XPath: ${r.id}`);
      assert(!fields.has(f.xpath), `Duplicate XML field: ${r.id}`); fields.add(f.xpath);
      assert(typeof f.value === 'string' && isObject(f.attributes), `Invalid XML field value: ${r.id}`);
      for (const [k, v] of Object.entries(f.attributes)) assert(/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(k) && typeof v === 'string', `Invalid field attribute: ${r.id}`);
      xmlLeaves++;
    }
    records.set(r.id, r);
  }
  const claims = read('housing-claims.json'), cases = read('housing-cases.json'), ids = new Set();
  assert(Array.isArray(claims) && claims.length === 22, 'Review changed claim set');
  let codeReferences = 0, xmlReferences = 0, localDerivedFilesVerified = 0;
  for (const c of claims) {
    assert(/^HS\d{2}$/.test(c.id) && !ids.has(c.id), `Invalid/duplicate claim: ${c.id}`); ids.add(c.id);
    assert(['static-derived', 'xml-declared', 'xml-and-static-derived'].includes(c.kind), `Invalid claim kind: ${c.id}`);
    assert(typeof c.statement === 'string' && c.statement.trim() && Array.isArray(c.sources) && c.sources.length, `Empty claim: ${c.id}`);
    for (const s of c.sources) {
      assert(groups.includes(s.group) && Boolean(s.type) !== Boolean(s.xml_record), `Invalid claim reference: ${c.id}`);
      if (s.type) {
        const key = `${s.group}:${s.type}`, t = types.get(key);
        assert(t, `Unmanifested type: ${c.id}/${key}`);
        assert(Number.isInteger(s.line_start) && Number.isInteger(s.line_end) && s.line_start > 0
          && s.line_end >= s.line_start && s.line_end <= t.lines, `Invalid line range: ${c.id}/${key}`);
        selectedTypes.add(key); codeReferences++;
      } else {
        assert(s.group === 'housing' && records.has(s.xml_record), `Invalid XML reference: ${c.id}`); xmlReferences++;
      }
    }
  }
  assert.deepEqual([...ids].sort(), Array.from({ length: 22 }, (_, n) => `HS${String(n + 1).padStart(2, '0')}`));
  if (local) for (const key of selectedTypes) {
    const t = types.get(key), bytes = readFileSync(path.join(root, t.local_file));
    assert.equal(hash(bytes), t.sha256, `Changed derived file: ${key}`);
    assert.equal(bytes.toString('utf8').split('\n').length, t.lines, `Changed line count: ${key}`);
    localDerivedFilesVerified++;
  }
  let analyticAssertions = 0;
  function compare(actual, expected, label) {
    if (typeof expected === 'number') {
      assert(typeof actual === 'number' && Number.isFinite(actual) && Math.abs(actual - expected) < 1e-9, `${label}: ${actual} != ${expected}`);
      analyticAssertions++;
    } else if (Array.isArray(expected)) {
      assert(Array.isArray(actual) && actual.length === expected.length, `${label}: array shape differs`);
      expected.forEach((v, n) => compare(actual[n], v, `${label}[${n}]`));
    } else if (isObject(expected)) {
      assert(isObject(actual), `${label}: expected object`);
      assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${label}: output fields differ`);
      for (const [k, v] of Object.entries(expected)) compare(actual[k], v, `${label}.${k}`);
    } else { assert.equal(actual, expected, label); analyticAssertions++; }
  }
  assert(Array.isArray(cases) && cases.length === 10, 'Review changed case set');
  const labels = new Set();
  for (const c of cases) {
    assert(Object.hasOwn(models, c.label) && !labels.has(c.label), `Unknown/duplicate case: ${c.label}`); labels.add(c.label);
    assert(Array.isArray(c.claims) && c.claims.length > 0, `Missing case claims: ${c.label}`);
    for (const id of c.claims) assert(ids.has(id), `Unknown case claim: ${id}`);
    assert(isObject(c.inputs) && isObject(c.expected), `Invalid case shape: ${c.label}`);
    validateData(c.inputs, `${c.label}.inputs`); validateData(c.expected, `${c.label}.expected`);
    compare(models[c.label](c.inputs), c.expected, c.label);
  }
  assert.equal(analyticAssertions, 141, 'Review changed analytic assertion coverage');
  return { status: 'pass', evidenceId: 'RW17-HOUSING-PORTABLE-VALIDATION', version: identity.version,
    recordedAssemblySha256: identity.assembly, housingTypes: manifests.housing.types.length,
    reusedTypes: selectedTypes.size - manifests.housing.types.length, claims: claims.length, codeReferences, xmlReferences,
    xmlFiles: xmlHashes.size, xmlRecords: records.size, xmlLeaves, analyticCases: cases.length, analyticAssertions,
    localDerivedFilesVerified, originalGameExecuted: false, originalGameFilesRead: false,
    scope: local ? 'recorded identities, metadata, derived hashes, source locations, independent analytic models'
      : 'recorded identities, metadata, declared source locations, independent analytic models',
    xmlValidation: 'Metadata only. Run verify-housing-evidence.ps1 against the matching installation for original XML hashes and selected field values.' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  assert(args.every(a => a === '--local' || a === '--help'), 'Usage: node scripts/research/verify-housing-evidence.mjs [--local]');
  if (args.includes('--help')) console.log('Usage: node scripts/research/verify-housing-evidence.mjs [--local]\n--local additionally verifies local derived files; no original game files are read.');
  else console.log(JSON.stringify(verifyHousingEvidence({ local: args.includes('--local') }), null, 2));
}
