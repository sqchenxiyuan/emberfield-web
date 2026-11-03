import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const PRODUCT = 'MeleeWeapon_Knife78091';
const SOURCE = 'Steel38585';
const ground = (s, id) => s.ground_weapons.find((x) => x.id === id);
const bill = (s) => s.spots[0].bills.find((x) => x.id === 3);
const xp = (s) => s.worker.crafting.xp_since_level.value;
const near = (actual, expected, tolerance = 1e-8) =>
  assert(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

// Retained evidence validation only: never executes game code, input, or OCR.
export function verifyNativeSkillsRuntime({ root = projectRoot, local = false } = {}) {
  const dir = path.join(root, 'docs/research/rimworld/evidence');
  const r = JSON.parse(readFileSync(path.join(dir, 'native-skills-runtime.json'), 'utf8'));
  assert.equal(r.schema_version, 1);
  assert.equal(r.evidence_id, 'RW17-NATIVE-SKILLS-RUNTIME');
  assert.equal(r.version_text, '1.7.4980 rev60');
  assert.equal(
    r.assembly_sha256,
    'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3',
  );
  assert.equal(r.executable, 'F:\\SteamLibrary\\steamapps\\common\\RimWorld\\RimWorld.exe');
  assert.equal(r.process_id, 29920);
  assert.equal(r.window_handle, 988850);
  assert.equal(r.profile, '.local-research/runtime/profile-20261102');
  assert.deepEqual(r.active_mods, ['ludeon.rimworld', 'ludeon.rimworld.odyssey']);
  assert(r.method.includes('not REA native UI execution'));
  assert.equal(r.provider_boundary_reference, 'native-plants-runtime.json');
  const names = [
    'weapons-stopped-b',
    'skills-entry-a',
    'skills-entry-b',
    'skills-knife-ready',
    'skills-crafting',
    'skills-crafting-progress',
    'skills-crafted',
    'skills-gate-blocked',
    'skills-gate-allowed',
    'skills-stopped-a',
    'skills-stopped-b',
  ];
  assert.deepEqual(
    r.snapshots.map((x) => x.name),
    names,
  );
  assert.deepEqual(
    r.snapshots.map((x) => x.save.tick),
    [81128, 81128, 81128, 81128, 82773, 84455, 86183, 86183, 86183, 86183, 86183],
  );
  // Pins the reviewed extraction, including each raw save hash and field presence.
  assert.equal(
    sha(JSON.stringify(r.snapshots)),
    'edb74c98964b3c41493b22dafbcf893ec80f208175e49a12e549d6dcbbc48a04',
  );
  const [base, entryA, entryB, ready, crafting, progress, crafted, blocked, allowed, stopA, final] =
    r.snapshots.map((x) => x.save);
  assert.equal(base.sha256, '2699fc8b81d98ecf94b2839a928804b964498165fdec94120e42164778197edf');
  assert.equal(final.sha256, 'a1198e345bc9a6af03d46decd2a557aaf1bbc0f7ad1f8431fc9c10a46f157d33');
  assert.deepEqual(
    r.snapshots.map((x) => xp(x.save)),
    [
      178.499756, 178.499756, 178.499756, 178.499756, 223.437927, 282.239349, 336.109985,
      336.109985, 336.109985, 336.109985, 336.109985,
    ],
  );
  for (const x of r.snapshots) {
    const s = x.save;
    assert.equal(x.path, `${r.profile}/Saves/${x.name}.rws`);
    assert.equal(s.file, `${x.name}.rws`);
    assert(/^[a-f0-9]{64}$/.test(s.sha256));
    assert(s.bytes > 0);
    assert.equal(s.version, r.version_text);
    assert.deepEqual(s.mods, r.active_mods);
    assert.equal(s.worker.id, 'Human961');
    assert.equal(s.worker.nick, 'Squint');
    const skill = s.worker.crafting;
    assert.equal(skill.def, 'Crafting');
    assert.deepEqual(skill.level, { value: 3, present: true });
    assert.equal(skill.passion, 'None');
    assert.equal(skill.passion_field_present, false);
    assert.equal(skill.xp_since_level.present, true);
    assert.equal(skill.xp_since_midnight.present, true);
    assert.equal(skill.xp_since_midnight.value, xp(s));
    assert.equal(s.worker.last_xp_reset_tick, 45039);
    assert.equal(s.worker.inspiration_null, true);
    assert.deepEqual(s.worker.traits, ['BodyPurist']);
    assert.equal(s.worker.skills.length, 12);
    assert.deepEqual(
      s.worker.skills.find((x) => x.def === 'Crafting'),
      skill,
    );
    assert.deepEqual(
      s.worker.skills.filter((x) => x.def !== 'Crafting'),
      base.worker.skills.filter((x) => x.def !== 'Crafting'),
    );
    assert.deepEqual(s.worker.work_priority_values, base.worker.work_priority_values);
    assert.deepEqual(s.worker.inventory, base.worker.inventory);
    assert.deepEqual(s.worker.equipment, []);
    assert.deepEqual(s.worker.carried, []);
    assert.equal(
      s.steel_total,
      s.steel.reduce((n, x) => n + x.count, 0),
    );
    assert.equal(new Set(s.steel.map((x) => x.id)).size, s.steel.length);
    assert.deepEqual(
      s.steel.filter((x) => ![SOURCE, 'Steel78070'].includes(x.id)),
      base.steel.filter((x) => x.id !== SOURCE),
    );
    for (const item of base.ground_weapons) assert.deepEqual(ground(s, item.id), item);
    const items = [
      ...s.ground_weapons,
      ...s.worker.equipment,
      ...s.worker.inventory,
      ...s.worker.carried,
    ];
    assert.equal(items.filter((x) => x.id === PRODUCT).length, s.tick >= crafted.tick ? 1 : 0);
    assert.equal(s.spots.length, 1);
    assert.equal(s.spots[0].id, 'CraftingSpot78052');
    assert.equal(s.spots[0].pos, '(108, 0, 130)');
    assert.equal(s.spots[0].spawned_tick, 78093);
    assert.deepEqual(s.spots[0].bills[0], base.spots[0].bills[0]);
    assert(s.scope.includes('Read-only explicit XML'));
  }
  for (const s of [entryA, entryB])
    for (const key of ['worker', 'steel', 'spots', 'ground_weapons', 'unfinished'])
      assert.deepEqual(s[key], base[key]);
  assert.equal(base.steel.length, 21);
  assert.equal(base.steel.find((x) => x.id === SOURCE).count, 66);
  assert.equal(base.steel.find((x) => x.id === SOURCE).forbidden, true);
  assert.equal(ready.steel.find((x) => x.id === SOURCE).forbidden, false);
  assert.equal(ready.worker.job.target_b, 'Thing_' + SOURCE);
  assert.equal(ready.worker.job.count, 30);
  for (const s of [ready, crafting, progress, crafted, blocked, allowed, stopA, final]) {
    assert.equal(s.spots[0].bills.length, 2);
    assert.equal(bill(s).recipe, 'Make_MeleeWeapon_Knife');
    assert.deepEqual(bill(s).allowed_materials, ['Steel']);
    assert.equal(bill(s).repeat_mode, 'RepeatCount');
    assert.equal(bill(s).store_mode, 'BestStockpile');
    assert.equal(bill(s).allowed_skill_range, s === blocked ? '4~20' : '0~20');
    assert.equal(s.steel.find((x) => x.id === SOURCE).forbidden, false);
  }
  for (const s of [ready, crafting, progress]) {
    assert.equal(s.worker.job.def, 'DoBill');
    assert.equal(s.worker.job.target_a, 'Thing_CraftingSpot78052');
    assert.equal(s.worker.job.bill, 'Bill_Make_MeleeWeapon_Knife_3');
    assert.equal(s.worker.job.player_forced, true);
    assert.equal(bill(s).repeat_count, 1);
    assert.equal(s.steel_total, 1170);
  }
  assert.deepEqual(ready.unfinished, []);
  for (const s of [crafting, progress]) {
    assert.equal(s.unfinished.length, 1);
    const u = s.unfinished[0];
    assert.equal(u.id, 'UnfinishedWeapon78071');
    assert.equal(u.stuff, 'Steel');
    assert.equal(u.creator, 'Thing_Human961');
    assert.equal(u.recipe, 'Make_MeleeWeapon_Knife');
    assert.equal(u.bill, 'Bill_Make_MeleeWeapon_Knife_3');
    assert.equal(u.spawned_tick, 81492);
    assert.equal(u.work_left, s.worker.job.work_left);
    assert.equal(u.ingredients.length, 1);
    assert.equal(u.ingredients[0].id, 'Steel78070');
    assert.equal(u.ingredients[0].def, 'Steel');
    assert.equal(u.ingredients[0].count, 30);
    assert.equal(s.steel.find((x) => x.id === 'Steel78070').ingredient_of, u.id);
    assert.equal(s.steel.find((x) => x.id === SOURCE).count, 36);
    assert.equal(bill(s).bound_uft, 'Thing_' + u.id);
    assert.equal(s.worker.job.toil_index, 14);
  }
  assert.equal(crafting.worker.job.work_left, 1286.4209);
  assert.equal(progress.worker.job.work_left, 614.427368);
  assert.equal(crafting.worker.job.ticks_spent_recipe, 1284);
  assert.equal(progress.worker.job.ticks_spent_recipe, 2964);
  assert.equal(progress.tick - crafting.tick, 1682);
  assert.equal(
    progress.worker.job.ticks_spent_recipe - crafting.worker.job.ticks_spent_recipe,
    1680,
  );
  near(xp(progress) - xp(crafting), 58.801422);
  near(crafting.worker.job.work_left - progress.worker.job.work_left, 671.993532);
  // Agreement within observed numeric drift; no claim of exact per-frame accounting.
  near(xp(progress) - xp(crafting), 1680 * 0.1 * 0.35, 0.002);
  near(crafting.worker.job.work_left - progress.worker.job.work_left, 1680 * 0.4, 0.007);
  near(xp(crafted) - xp(base), 157.610229);
  assert(Math.abs(xp(crafted) - xp(base) - 157.5) > 0.1);
  for (const s of [crafted, blocked, allowed, stopA, final]) {
    assert.deepEqual(s.unfinished, []);
    assert.equal(s.steel_total, 1140);
    assert.equal(s.steel.find((x) => x.id === SOURCE).count, 36);
    assert.equal(bill(s).bound_uft, 'null');
    const item = ground(s, PRODUCT);
    assert.equal(item.def, 'MeleeWeapon_Knife');
    assert.equal(item.stuff, 'Steel');
    assert.equal(item.quality, 'Poor');
    assert.equal(item.quality_field_present, true);
    assert.equal(item.health, 100);
    assert.equal(item.spawned_tick, 86049);
    assert.equal(item.forbidden, false);
    assert.equal(item.pos, '(109, 0, 129)');
    assert.equal(s.worker.job.def, 'HaulToCell');
  }
  assert.equal(ready.steel_total - crafted.steel_total, 30);
  for (const s of [blocked, allowed]) {
    assert.equal(bill(s).repeat_count, 1);
    for (const key of ['worker', 'steel', 'ground_weapons', 'unfinished'])
      assert.deepEqual(s[key], crafted[key]);
  }
  for (const s of [crafted, stopA, final]) {
    assert.equal(bill(s).repeat_count, 0);
    assert.equal(bill(s).repeat_count_field_present, false);
  }
  for (const key of ['worker', 'steel', 'spots', 'ground_weapons', 'unfinished'])
    assert.deepEqual(stopA[key], final[key]);
  for (const key of [
    'god_mode_inherited',
    'dev_spawned_items',
    'dev_spawned_materials',
    'skills_modified',
    'research_modified',
    'save_xml_edited',
    'ordinary_work_assignment_changed',
  ])
    assert.equal(r.preparation[key], false);
  for (const key of [
    'developer_mode_retained',
    'ordinary_steel_only_filter',
    'ordinary_bill_range_changed_and_restored',
  ])
    assert.equal(r.preparation[key], true);
  assert.equal(r.preparation.baseline, 'weapons-stopped-b');
  assert.equal(r.preparation.spot_placed_normally_in_chapter, 43);
  for (const key of [
    'normal_crafting_completed',
    'unfinished_ingredients_observed',
    'bill_range_gate_observed',
  ])
    assert.equal(r.outcomes[key], true);
  for (const key of [
    'second_product_crafted',
    'level_up_tested',
    'decay_tested',
    'saturation_tested',
    'inspiration_tested',
    'quality_distribution_tested',
    'recipe_minimum_gate_tested',
    'combat_tested',
  ])
    assert.equal(r.outcomes[key], false);
  assert.equal(r.outcomes.produced_item, PRODUCT);
  assert.equal(r.outcomes.produced_quality, 'Poor');
  assert.equal(r.outcomes.steel_consumed, 30);
  near(r.outcomes.xp_delta, xp(crafted) - xp(base));
  near(r.outcomes.between_samples_xp_delta, xp(progress) - xp(crafting));
  assert.equal(r.outcomes.between_samples_map_ticks, 1682);
  assert.equal(r.outcomes.between_samples_recipe_ticks, 1680);
  assert.equal(r.ui.crafting_before.learning_percent, 35);
  assert.equal(r.ui.minor_passion_hover.learning_percent, 100);
  assert.equal(r.ui.major_passion_hover.learning_percent, 150);
  assert.equal(r.ui.crafting_before.next_level_xp, 4000);
  assert.equal(r.ui.spot_work_speed_percent, 40);
  assert.deepEqual(r.clock.entry_ticks, [81128, 81128]);
  assert.deepEqual(r.clock.final_ticks, [86183, 86183]);
  assert.equal(r.clock.total_advanced_ticks, final.tick - base.tick);
  assert.equal(r.clock.total_advanced_ticks, 5055);
  assert.equal(r.clock.reloads, 0);
  assert.equal(r.clock.space_inputs, 0);
  assert.equal(r.clock.exact_action_duration_measured, false);
  const ledger = readFileSync(path.join(dir, r.actions.file));
  assert.equal(r.actions.file, 'native-skills-actions.jsonl');
  assert.equal(
    r.actions.sha256,
    'cfe8eb0431102a40913c3c7b3ff7e1f465efe58e37911eaa2bf1ea61c4c38d4f',
  );
  assert.equal(sha(ledger), r.actions.sha256);
  const actions = ledger.toString().trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(r.actions.count, 110);
  assert.equal(actions.length, 110);
  assert.equal(new Set(actions.map((x) => x.data.image)).size, 110);
  let previous = 0;
  for (const a of actions) {
    assert.equal(a.kind, 'guarded-ui-input');
    assert.equal(a.data.pid, 29920);
    assert(a.data.profile.replaceAll('\\', '/').endsWith('/' + r.profile));
    assert(/skills-[a-z0-9-]+\.png$/.test(a.data.image));
    const t = Date.parse(a.data.started_utc);
    assert(t >= previous);
    assert(Date.parse(a.data.finished_utc) >= t);
    previous = t;
  }
  assert.equal(
    actions.filter((a) => a.data.action === 'key' && a.data.virtual_key === 32).length,
    0,
  );
  assert.equal(
    actions.filter((a) => a.data.action === 'key' && [49, 51].includes(a.data.virtual_key)).length,
    3,
  );
  assert.deepEqual(
    r.clock.run_windows.map((w) => [
      w.speed_key,
      w.before_tick,
      w.after_tick,
      w.requested_capture_wait_ms,
    ]),
    [
      [3, 81128, 82773, 3500],
      [3, 82773, 84455, 3500],
      [3, 84455, 86183, 3500],
    ],
  );
  for (const w of r.clock.run_windows) {
    const a = actions.find((a) => a.data.image.endsWith(w.start_image)).data;
    const p = actions.find((a) => a.data.image.endsWith(w.pause_image)).data;
    assert.equal(a.action, 'key');
    assert.equal(a.virtual_key, 51);
    assert.equal(a.started_utc, w.input_start_utc);
    assert.equal(a.wait_ms, 3500);
    assert.equal(p.action, 'click');
    assert.deepEqual([p.x, p.y], [2441, 1305]);
    assert.equal(p.started_utc, w.pause_input_start_utc);
    assert(Date.parse(p.started_utc) > Date.parse(a.finished_utc));
    assert(Date.parse(p.started_utc) - Date.parse(a.started_utc) < 12000);
  }
  assert(actions.at(-1).data.image.endsWith('skills-stopped-b-return.png'));
  assert.equal(r.screenshots.length, 21);
  assert.equal(new Set(r.screenshots.map((s) => s.id)).size, 21);
  for (const s of r.screenshots) {
    assert.equal(s.image, `runtime/skills-${s.id}.png`);
    const bytes = readFileSync(path.join(dir, s.image));
    assert.equal(sha(bytes), s.sha256);
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    const [x, y, width, height] = s.crop_xywh;
    assert.deepEqual(s.source_size, [2560, 1440]);
    assert(x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= 2560 && y + height <= 1440);
    assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [width, height]);
    assert(actions.some((a) => a.data.image.replaceAll('\\', '/').endsWith('/' + s.source_file)));
    if (local) {
      const original = readFileSync(path.join(root, s.source_file));
      assert.equal(sha(original), s.source_sha256);
      assert.deepEqual([original.readUInt32BE(16), original.readUInt32BE(20)], s.source_size);
      const meta = JSON.parse(
        readFileSync(path.join(root, s.source_file + '.jsonl'), 'utf8')
          .trim()
          .split(/\r?\n/)
          .at(-1),
      );
      // PowerShell DateTime JSON may trim trailing fractional zeros.
      assert.equal(Date.parse(meta.timestamp_utc), Date.parse(s.observed_utc));
      assert.equal(meta.pid, 29920);
    }
  }
  for (const key of [
    'paused',
    'pause_confirmed_by_two_equal_saves',
    'baseline_untouched',
    'developer_mode',
  ])
    assert.equal(r.final_state[key], true);
  for (const key of ['god_mode', 'normal_profile_touched', 'game_files_modified', 'mods_installed'])
    assert.equal(r.final_state[key], false);
  assert.equal(r.final_state.canonical_save, 'skills-stopped-b.rws');
  assert.equal(r.final_state.knife_bill_repeat_count, 0);
  assert.equal(r.final_state.knife_bill_allowed_range, '0~20');
  assert.equal(r.limitations.length, 12);
  if (local)
    for (const x of r.snapshots) {
      const file = path.join(root, x.path);
      assert.equal(sha(readFileSync(file)), x.save.sha256);
      const output = execFileSync(
        'pwsh',
        [
          '-NoProfile',
          '-File',
          path.join(root, 'scripts/research/read-skills-runtime-save.ps1'),
          '-SavePath',
          file,
        ],
        { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
      );
      assert.deepEqual(JSON.parse(output.replace(/^\uFEFF/, '')), x.save);
    }
  return {
    ok: true,
    mode: local ? 'local-original-saves-and-captures' : 'portable-recorded-summary',
    saveSnapshots: 11,
    crops: 21,
    actions: 110,
    controlledRunWindows: 3,
    advancedTicks: 5055,
    steelConsumed: 30,
    craftingLevel: 3,
    passion: 'None',
    xpDelta: 157.610229,
    producedQuality: 'Poor',
    billSkillRangeGate: true,
    qualityDistributionTested: false,
    finalPauseVerified: true,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(
    JSON.stringify(verifyNativeSkillsRuntime({ local: process.argv.includes('--local') })),
  );
