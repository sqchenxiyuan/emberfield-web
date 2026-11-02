import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const identity = Object.freeze({
  version: '1.7.4980 rev60',
  assembly: 'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3',
  engine: 'ICSharpCode.Decompiler',
  engineVersion: '11.2.0.10050',
  engineHash: '587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78',
});
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const clamp01 = value => Math.max(0, Math.min(1, value));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// Handwritten reference models. JSON formula/prose fields are never executed.
const models = {
  'F01 Fertility and environment': i => ({
    fertilityFactors: i.sensitivities.map(s => i.fertility.map(f => f * s + 1 - s)),
    lightFactors: i.light.map(light => clamp01((light - 0.51) / 0.49)),
    temperatureFactors: i.temperature.map(t => t < 6 ? clamp01(t / 6) : t > 42 ? clamp01((58 - t) / 16) : 1),
  }),
  'F02 Ideal crop calendar duration': i => {
    const calendarDays = i.growDays.map(days => days * i.referenceGrowth / (i.activeDayFraction * i.factor));
    return { calendarDays, currentMinutes: calendarDays.map(days => days * 10) };
  },
  'F03 Meal ingredient quantity': i => {
    let remaining = i.requiredNutrition;
    const selected = i.availableStacks.map(available => {
      const taken = Math.min(Math.ceil(remaining / i.rawNutrition), available);
      remaining -= taken * i.rawNutrition;
      return taken;
    });
    const rawCount = selected.reduce((sum, count) => sum + count, 0);
    return {
      selected, rawCount, inputNutrition: rawCount * i.rawNutrition,
      outputNutrition: i.mealNutrition, ratio: i.mealNutrition / i.requiredNutrition,
    };
  },
  'F04 Cooking timing policies': i => {
    const originalTicks = i.work / (i.workerRate * i.tableRate);
    return {
      originalTicks, originalSeconds: originalTicks / i.originalTPS,
      currentTicksPreserveSeconds: originalTicks * i.currentTPS / i.originalTPS,
      currentTicksPreserveDay: originalTicks * i.currentDay / i.originalDay,
      currentSecondsKeepWork: originalTicks / i.currentTPS,
    };
  },
  'F05 Hunger thresholds': i => {
    const categories = i.foodLevels.map(v => v <= 0 ? 'Starving' : v < i.wantEat * 0.4
      ? 'UrgentlyHungry' : v < i.wantEat * 0.8 ? 'Hungry' : 'Fed');
    const rates = { Fed: 1, Hungry: 0.5, UrgentlyHungry: 0.25, Starving: 0 };
    const multipliers = categories.map(category => rates[category]);
    return {
      wantEat: i.foodLevels.map(v => v < i.wantEat), categories, multipliers,
      perDay: multipliers.map(rate => rate * i.basePerDay),
    };
  },
  'F06 Whole meal and overflow': i => {
    const itemsTaken = i.levels.map(level => Math.max(1, Math.min(i.maxNumToIngest,
      Math.ceil((i.maxNutrition - level) / i.mealNutrition))));
    const raw = i.levels.map((level, n) => level + itemsTaken[n] * i.mealNutrition);
    const after = raw.map(level => Math.min(level, i.maxNutrition));
    return { itemsTaken, after, overflow: raw.map((level, n) => level - after[n]) };
  },
  'F07 Tick conversion': i => ({
    originalSecondsPerDay: i.originalDay / i.originalTPS,
    currentSecondsPerDay: i.currentDay / i.currentTPS,
    dayRateMultiplier: i.originalDay / i.currentDay,
    originalHungerPerTick: i.hungerPerDay / i.originalDay,
    currentHungerPerTick: i.hungerPerDay / i.currentDay,
    originalGrowthPerActiveTick: 1 / (i.originalDay * i.growDays),
    currentGrowthPerActiveTick: 1 / (i.currentDay * i.growDays),
  }),
  'F08 Sustained meal planning': i => {
    const nearThresholdMealsPerPersonDay = i.hungerPerDay / (i.maxNutrition - i.nearEatThreshold);
    const colonyMealsPerDay = nearThresholdMealsPerPersonDay * i.colonists;
    return {
      idealMealsPerPersonDay: i.hungerPerDay / i.mealNutrition,
      nearThresholdMealsPerPersonDay, colonyMealsPerDay,
      stockDaysAtSteadyRate: i.startMeals / colonyMealsPerDay,
      colonyRawPerDay: colonyMealsPerDay * i.rawPerMeal,
    };
  },
  'F09 Custom voxel daylight integration': i => {
    assert(Number.isInteger(i.samples) && i.samples > 0 && i.samples <= 1_000_000, 'Invalid F09 sample count');
    assert(i.sunriseHour >= 0 && i.sunriseHour < i.sunsetHour && i.sunsetHour <= 24, 'Invalid F09 daylight window');
    const dailyAverageGrowthFactors = i.amplitudes.map(amplitude => {
      let sum = 0;
      for (let k = 0; k < i.samples; k++) {
        const hour = (k + 0.5) * 24 / i.samples;
        const light = hour < i.sunriseHour || hour > i.sunsetHour ? 0 : Math.min(1,
          amplitude * Math.sin(Math.PI * (hour - i.sunriseHour) / (i.sunsetHour - i.sunriseHour)));
        sum += clamp01((light - 0.51) / 0.49) / i.samples;
      }
      return sum;
    });
    const idealRiceDays = dailyAverageGrowthFactors.map(factor => i.growDays / factor);
    return {
      dailyAverageGrowthFactors, idealRiceDays,
      minimumRiceTiles: idealRiceDays.map(days => Math.ceil(i.colonyRawPerDay / (i.harvestYield / days))),
    };
  },
};

function validateData(value, label) {
  if (typeof value === 'number') assert(Number.isFinite(value), `${label}: non-finite number`);
  else if (Array.isArray(value)) value.forEach((item, n) => validateData(item, `${label}[${n}]`));
  else if (isObject(value)) Object.entries(value).forEach(([key, item]) => validateData(item, `${label}.${key}`));
  else assert(typeof value === 'string' || typeof value === 'boolean' || value === null, `${label}: invalid data`);
}

export function verifyFoodEvidence({ root = projectRoot, local = false } = {}) {
  const evidence = path.join(root, 'docs/research/rimworld/evidence');
  const read = name => JSON.parse(readFileSync(path.join(evidence, name), 'utf8').replace(/^\uFEFF/, ''));
  const groups = ['food', 'generation'];
  const typeIndex = new Map(), recordIndex = new Map(), xmlHashes = new Map();
  const recordSources = new Set();
  const manifests = {}, snapshots = {};

  for (const group of groups) {
    const manifest = manifests[group] = read(`${group}-manifest.json`);
    assert.equal(manifest.evidence_id, `RW17-${group.toUpperCase()}`);
    assert.equal(manifest.version_text, identity.version);
    assert.equal(manifest.source, 'Assembly-CSharp.dll');
    assert.equal(manifest.source_sha256, identity.assembly);
    assert.equal(manifest.engine, identity.engine);
    assert.equal(manifest.engine_version, identity.engineVersion);
    assert.equal(manifest.engine_sha256, identity.engineHash);
    assert.equal(manifest.line_endings, 'LF');
    assert.equal(manifest.encoding, 'UTF-8 without BOM');
    assert(Array.isArray(manifest.types) && manifest.types.length > 0);
    assert.deepEqual(read(`${group}-types.json`), manifest.types.map(item => item.type));
    for (const item of manifest.types) {
      assert(typeof item.type === 'string' && /^[A-Za-z_][A-Za-z0-9_.+`]*$/.test(item.type), 'Invalid type name');
      const key = `${group}:${item.type}`;
      assert(!typeIndex.has(key), `Duplicate type: ${key}`);
      assert.equal(item.local_file, `.local-research/${group}/${item.type}.cs`);
      assert(validHash(item.sha256), `Invalid derived hash: ${key}`);
      assert(Number.isInteger(item.lines) && item.lines > 0, `Invalid line count: ${key}`);
      typeIndex.set(key, item);
    }

    const snapshot = snapshots[group] = read(`${group}-xml.json`);
    assert.equal(snapshot.evidence_id, `RW17-${group.toUpperCase()}-XML`);
    assert.equal(snapshot.version_text, identity.version);
    assert.equal(snapshot.assembly_sha256, identity.assembly);
    assert(Array.isArray(snapshot.records) && snapshot.records.length > 0);
    for (const record of snapshot.records) {
      assert(typeof record.id === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(record.id), 'Invalid XML record id');
      const key = `${group}:${record.id}`, source = record.source;
      assert(typeof record.group === 'string' && record.group.length > 0, `Missing XML category: ${key}`);
      assert(typeof record.parent_name === 'string', `Missing parent declaration: ${key}`);
      assert(isObject(source), `Missing XML source: ${key}`);
      assert(typeof source.path === 'string' && /^Data\/(?:[A-Za-z0-9_-]+\/)+[A-Za-z0-9_-]+\.xml$/.test(source.path), `Invalid XML path: ${key}`);
      assert(validHash(source.sha256), `Invalid XML hash: ${key}`);
      if (xmlHashes.has(source.path)) assert.equal(source.sha256, xmlHashes.get(source.path), `Mixed hashes for ${source.path}`);
      xmlHashes.set(source.path, source.sha256);
      const selector = /^\/Defs\/[A-Za-z_][A-Za-z0-9_]*\[(?:defName|@Name)='([A-Za-z_][A-Za-z0-9_]*)'\]$/.exec(source.xpath);
      assert(selector && selector[1] === record.id, `Invalid root XPath: ${key}`);
      // Def names can repeat across Def classes (e.g. world/map Terrain).
      // A bare xml_record reference below must still resolve unambiguously.
      const sourceKey = `${group}:${source.path}:${source.xpath}`;
      assert(!recordSources.has(sourceKey), `Duplicate XML source record: ${sourceKey}`);
      recordSources.add(sourceKey);
      assert(Array.isArray(record.fields), `Missing fields: ${key}`);
      const fieldPaths = new Set();
      for (const field of record.fields) {
        assert(typeof field.xpath === 'string' && field.xpath.startsWith(`${source.xpath}/`), `Field outside XML root: ${key}`);
        const suffix = field.xpath.slice(source.xpath.length + 1);
        assert(/^[A-Za-z_][A-Za-z0-9_]*(?:\[[1-9][0-9]*\])?(?:\/[A-Za-z_][A-Za-z0-9_]*(?:\[[1-9][0-9]*\])?)*$/.test(suffix), `Invalid field XPath: ${key}`);
        assert(!fieldPaths.has(field.xpath), `Duplicate field XPath: ${key}`);
        fieldPaths.add(field.xpath);
        assert(typeof field.value === 'string', `Non-string XML value: ${key}`);
        assert(isObject(field.attributes), `Invalid XML attributes: ${key}`);
        for (const [name, value] of Object.entries(field.attributes)) {
          assert(/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(name) && typeof value === 'string', `Invalid XML attribute: ${key}`);
        }
      }
      recordIndex.set(key, [...(recordIndex.get(key) ?? []), record]);
    }
  }

  const claims = read('food-claims.json'), cases = read('food-cases.json');
  function resolveRecord(key) {
    const candidates = recordIndex.get(key);
    assert(candidates?.length === 1, `Missing or ambiguous XML reference: ${key}`);
    return candidates[0];
  }
  assert(Array.isArray(claims) && claims.length === 19, 'Review changed food claim set');
  const ids = new Set();
  const selectedTypes = new Set(manifests.food.types.map(item => `food:${item.type}`));
  const selectedRecords = new Set(snapshots.food.records.map(record => `food:${record.id}`));
  let codeReferences = 0, xmlReferences = 0, localDerivedFilesVerified = 0;
  for (const claim of claims) {
    assert(/^FD\d{2}$/.test(claim.id) && !ids.has(claim.id), `Invalid or duplicate claim: ${claim.id}`);
    ids.add(claim.id);
    assert(['static-derived', 'xml-declared', 'xml-and-static-derived'].includes(claim.kind), `Unknown claim kind: ${claim.id}`);
    assert(typeof claim.statement === 'string' && claim.statement.trim().length > 0, `Missing statement: ${claim.id}`);
    assert(Array.isArray(claim.sources) && claim.sources.length > 0, `Missing sources: ${claim.id}`);
    for (const source of claim.sources) {
      assert(groups.includes(source.group), `Unknown source group: ${claim.id}`);
      assert(Boolean(source.type) !== Boolean(source.xml_record), `Ambiguous source: ${claim.id}`);
      if (source.type) {
        const key = `${source.group}:${source.type}`, item = typeIndex.get(key);
        assert(item, `Unmanifested type in ${claim.id}: ${key}`);
        assert(Number.isInteger(source.line_start) && Number.isInteger(source.line_end)
          && source.line_start > 0 && source.line_start <= source.line_end && source.line_end <= item.lines,
        `Invalid source lines: ${claim.id}/${key}`);
        selectedTypes.add(key); codeReferences++;
      } else {
        const key = `${source.group}:${source.xml_record}`;
        resolveRecord(key);
        selectedRecords.add(key); xmlReferences++;
      }
    }
  }
  assert.deepEqual([...ids].sort(), Array.from({ length: 19 }, (_, n) => `FD${String(n + 1).padStart(2, '0')}`));
  if (local) {
    for (const key of selectedTypes) {
      const item = typeIndex.get(key), bytes = readFileSync(path.join(root, item.local_file));
      assert.equal(sha(bytes), item.sha256, `Changed derived file: ${key}`);
      assert.equal(bytes.toString('utf8').split('\n').length, item.lines, `Changed line count: ${key}`);
      localDerivedFilesVerified++;
    }
  }

  let numericAssertions = 0;
  function compare(actual, expected, label) {
    if (typeof expected === 'number') {
      assert(typeof actual === 'number' && Number.isFinite(actual) && Number.isFinite(expected), `${label}: non-finite number`);
      assert(Math.abs(actual - expected) < 1e-6, `${label}: ${actual} != ${expected}`);
      numericAssertions++;
    } else if (Array.isArray(expected)) {
      assert(Array.isArray(actual) && actual.length === expected.length, `${label}: array shape differs`);
      expected.forEach((value, n) => compare(actual[n], value, `${label}[${n}]`));
    } else if (isObject(expected)) {
      assert(isObject(actual), `${label}: expected object`);
      assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${label}: output fields differ`);
      for (const [key, value] of Object.entries(expected)) compare(actual[key], value, `${label}.${key}`);
    } else {
      assert.equal(actual, expected, label); numericAssertions++;
    }
  }
  assert(Array.isArray(cases) && cases.length === 9, 'Review changed food case set');
  const labels = new Set();
  for (const example of cases) {
    assert(Object.hasOwn(models, example.label) && !labels.has(example.label), `Unknown or duplicate case: ${example.label}`);
    labels.add(example.label);
    assert(Array.isArray(example.claims) && example.claims.length > 0, `Missing case claims: ${example.label}`);
    for (const id of example.claims) assert(ids.has(id), `Unknown case claim: ${example.label}/${id}`);
    assert(isObject(example.inputs) && isObject(example.expected), `Invalid case shape: ${example.label}`);
    validateData(example.inputs, `${example.label}.inputs`);
    validateData(example.expected, `${example.label}.expected`);
    compare(models[example.label](example.inputs), example.expected, example.label);
  }
  assert.equal(numericAssertions, 85, 'Review changed analytic assertion coverage');
  const records = [...selectedRecords].map(resolveRecord);
  return {
    status: 'pass', evidenceId: 'RW17-FOOD-PORTABLE-VALIDATION',
    version: identity.version, recordedAssemblySha256: identity.assembly,
    foodTypes: manifests.food.types.length,
    reusedGenerationTypes: selectedTypes.size - manifests.food.types.length,
    claims: claims.length, codeReferences, xmlReferences,
    xmlFiles: new Set(records.map(record => record.source.path)).size,
    xmlRecords: records.length, xmlLeaves: records.reduce((sum, record) => sum + record.fields.length, 0),
    numericCases: cases.length, numericAssertions, localDerivedFilesVerified,
    scope: local ? 'recorded identities, metadata, derived hashes, reference locations, arithmetic'
      : 'recorded identities, metadata, declared reference locations, arithmetic',
    originalGameExecuted: false, originalGameFilesRead: false,
    xmlValidation: 'Recorded XML metadata only. Run verify-food-evidence.ps1 with the matching installation to verify original XML files and values.',
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  assert(args.every(arg => arg === '--local' || arg === '--help'), 'Usage: node scripts/research/verify-food-evidence.mjs [--local]');
  if (args.includes('--help')) console.log('Usage: node scripts/research/verify-food-evidence.mjs [--local]\n--local additionally verifies the selected local derived .cs hashes; no game files are read.');
  else console.log(JSON.stringify(verifyFoodEvidence({ local: args.includes('--local') }), null, 2));
}
