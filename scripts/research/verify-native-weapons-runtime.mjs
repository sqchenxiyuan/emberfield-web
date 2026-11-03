import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const KNIFE = 'MeleeWeapon_Knife38570';
const CLUB = 'MeleeWeapon_Club78067';
const ground = (s, id) => s.ground_weapons.find((x) => x.id === id);
const equipped = (s, id) => s.worker.equipment.find((x) => x.id === id);

// Evidence verification only: never runs the game, sends input, or claims OCR.
export function verifyNativeWeaponsRuntime({ root = projectRoot, local = false } = {}) {
  const dir = path.join(root, 'docs/research/rimworld/evidence');
  const r = JSON.parse(readFileSync(path.join(dir, 'native-weapons-runtime.json'), 'utf8'));
  assert.equal(r.schema_version, 1);
  assert.equal(r.evidence_id, 'RW17-NATIVE-WEAPONS-RUNTIME');
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
    'injuries-stopped-b',
    'weapons-entry-a',
    'weapons-entry-b',
    'weapons-knife-ready',
    'weapons-knife-equipped',
    'weapons-craft-ready',
    'weapons-crafting',
    'weapons-crafting-progress',
    'weapons-crafted',
    'weapons-swap-ready',
    'weapons-club-equipped',
    'weapons-drop-ready',
    'weapons-dropped',
    'weapons-stopped-a',
    'weapons-stopped-b',
  ];
  assert.deepEqual(
    r.snapshots.map((x) => x.name),
    names,
  );
  assert.deepEqual(
    r.snapshots.map((x) => x.save.tick),
    [
      77192, 77192, 77192, 77192, 78093, 78093, 79302, 79865, 80782, 80782, 81017, 81017, 81128,
      81128, 81128,
    ],
  );
  // Pins the reviewed save summaries, including their original raw file digests.
  assert.equal(
    sha(JSON.stringify(r.snapshots)),
    'f9c328532d1b91d56548cf9239745b351c22e6d86742e924adb8517a66b0d7fe',
  );
  const [
    base,
    a,
    b,
    knifeReady,
    knifeEquipped,
    craftReady,
    crafting,
    progress,
    crafted,
    swapReady,
    swapped,
    dropReady,
    dropped,
    stopA,
    final,
  ] = r.snapshots.map((x) => x.save);
  assert.equal(base.sha256, '2ed58c52089a455d700a0e2f43105e731f6ddb5d94f1666356df479bfd2dcf97');
  assert.equal(final.sha256, '2699fc8b81d98ecf94b2839a928804b964498165fdec94120e42164778197edf');
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
    assert.equal(s.worker.crafting.level, 3);
    assert.deepEqual(s.worker.work_priority_values, base.worker.work_priority_values);
    assert.deepEqual(s.worker.inventory, base.worker.inventory);
    assert.deepEqual(s.worker.carried, []);
    assert.equal(
      s.wood_total,
      s.wood.reduce((n, x) => n + x.count, 0),
    );
    assert.equal(new Set(s.wood.map((x) => x.id)).size, s.wood.length);
    assert.deepEqual(
      s.wood.filter((x) => x.forbidden),
      base.wood.filter((x) => x.forbidden),
    );
    for (const id of ['Gun_BoltActionRifle38568', 'Gun_Revolver38569'])
      assert.deepEqual(ground(s, id), ground(base, id));
    const items = [
      ...s.ground_weapons,
      ...s.worker.equipment,
      ...s.worker.inventory,
      ...s.worker.carried,
    ];
    assert.equal(items.filter((x) => x.id === KNIFE).length, 1, 'Same knife must have one owner');
    assert.equal(
      items.filter((x) => x.id === CLUB).length,
      s.tick >= crafted.tick ? 1 : 0,
      'No duplicate or premature product',
    );
    assert(s.scope.includes('Active map subtree only'));
  }
  for (const s of [a, b]) {
    assert.deepEqual(s.worker, base.worker);
    assert.deepEqual(s.ground_weapons, base.ground_weapons);
    assert.deepEqual(s.wood, base.wood);
  }
  assert.deepEqual(base.worker.equipment, []);
  assert.equal(ground(base, KNIFE).forbidden, true);
  assert.equal(knifeReady.worker.job.def, 'Equip');
  assert.equal(knifeReady.worker.job.target_a, 'Thing_' + KNIFE);
  assert.equal(knifeReady.worker.job.player_forced, true);
  assert.equal(equipped(knifeEquipped, KNIFE).stuff, 'Plasteel');
  assert.equal(equipped(knifeEquipped, KNIFE).quality, 'Normal');
  assert.equal(equipped(knifeEquipped, KNIFE).health, 276);
  assert.deepEqual(knifeEquipped.spots, []);
  for (const s of [
    craftReady,
    crafting,
    progress,
    crafted,
    swapReady,
    swapped,
    dropReady,
    dropped,
    stopA,
    final,
  ]) {
    assert.equal(s.spots.length, 1);
    assert.equal(s.spots[0].id, 'CraftingSpot78052');
    assert.equal(s.spots[0].spawned_tick, 78093);
    assert.equal(s.spots[0].bills.length, 1);
    assert.equal(s.spots[0].bills[0].recipe, 'Make_MeleeWeapon_Club');
    assert.deepEqual(s.spots[0].bills[0].allowed_materials, ['WoodLog']);
  }
  for (const s of [craftReady, crafting, progress]) {
    assert.equal(s.worker.job.def, 'DoBill');
    assert.equal(s.worker.job.target_a, 'Thing_CraftingSpot78052');
    assert.equal(s.worker.job.bill, 'Bill_Make_MeleeWeapon_Club_2');
    assert.equal(s.worker.job.player_forced, true);
    assert.equal(s.spots[0].bills[0].repeat_count, 1);
    assert.equal(s.wood_total, 427);
  }
  assert.equal(craftReady.worker.job.target_b, 'Thing_WoodLog42142');
  assert.equal(craftReady.worker.job.count, 40);
  assert.equal(craftReady.wood.find((x) => x.id === 'WoodLog42142').count, 75);
  for (const s of [crafting, progress]) {
    assert.equal(s.unfinished.length, 1);
    const u = s.unfinished[0];
    assert.equal(u.id, 'UnfinishedWeapon78056');
    assert.equal(u.creator, 'Thing_Human961');
    assert.equal(u.recipe, 'Make_MeleeWeapon_Club');
    assert.equal(u.work_left, s.worker.job.work_left);
    assert.equal(u.ingredients.length, 1);
    assert.equal(u.ingredients[0].id, 'WoodLog78055');
    assert.equal(u.ingredients[0].def, 'WoodLog');
    assert.equal(u.ingredients[0].count, 40);
    assert.equal(s.wood.find((x) => x.id === 'WoodLog42142').count, 35);
    assert.equal(s.wood.find((x) => x.id === 'WoodLog78055').ingredient_of, u.id);
    assert.equal(s.spots[0].bills[0].bound_uft, 'Thing_' + u.id);
    assert.equal(s.worker.job.toil_index, 14);
  }
  assert.equal(crafting.worker.job.work_left, 471.596252);
  assert.equal(progress.worker.job.work_left, 247.194092);
  assert.equal(progress.tick - crafting.tick, 563);
  assert.equal(
    progress.worker.job.ticks_spent_recipe - crafting.worker.job.ticks_spent_recipe,
    561,
  );
  assert(
    Math.abs((crafting.worker.job.work_left - progress.worker.job.work_left) / 561 - 0.4) < 0.00001,
  );
  for (const s of [crafted, swapReady, swapped, dropReady, dropped, stopA, final]) {
    assert.deepEqual(s.unfinished, []);
    assert.equal(s.wood_total, 387);
    assert.equal(s.spots[0].bills[0].repeat_count, 0);
    assert.equal(s.spots[0].bills[0].repeat_count_field_present, false);
    assert.equal(s.spots[0].bills[0].bound_uft, 'null');
    const club = ground(s, CLUB) ?? equipped(s, CLUB);
    assert.equal(club.stuff, 'WoodLog');
    assert.equal(club.health, 65);
    assert.equal(club.quality, '');
    assert.equal(club.quality_field_present, false);
  }
  assert.equal(craftReady.wood_total - crafted.wood_total, 40);
  assert.equal(ground(crafted, CLUB).forbidden, false);
  assert.equal(ground(crafted, CLUB).spawned_tick, 80481);
  assert.equal(swapReady.worker.job.def, 'Equip');
  assert.equal(swapReady.worker.job.target_a, 'Thing_' + CLUB);
  assert.equal(equipped(swapped, CLUB).despawned_tick, 80937);
  assert.equal(ground(swapped, KNIFE).spawned_tick, 80937);
  assert.equal(ground(swapped, KNIFE).forbidden, false);
  assert.equal(dropReady.worker.job.def, 'DropEquipment');
  assert.equal(dropReady.worker.job.target_a, 'Thing_' + CLUB);
  assert.equal(dropReady.worker.job.ticks_left, 30);
  assert.equal(dropReady.worker.job.start_tick, 81017);
  assert.equal(ground(dropped, CLUB).spawned_tick, 81047);
  assert.equal(ground(dropped, CLUB).spawned_tick - dropReady.worker.job.start_tick, 30);
  assert.equal(ground(dropped, CLUB).forbidden, true);
  assert.deepEqual(dropped.worker.equipment, []);
  for (const key of ['worker', 'wood', 'ground_weapons', 'spots', 'unfinished'])
    assert.deepEqual(stopA[key], final[key]);
  for (const key of [
    'god_mode_inherited',
    'god_mode_disabled_before_actions',
    'spot_placed_normally',
    'ordinary_wood_only_filter',
  ])
    assert.equal(r.preparation[key], true);
  for (const key of [
    'dev_spawned_items',
    'dev_spawned_materials',
    'skills_modified',
    'research_modified',
    'save_xml_edited',
    'ordinary_work_assignment_changed',
  ])
    assert.equal(r.preparation[key], false);
  for (const key of [
    'normal_initial_equip_completed',
    'normal_crafting_completed',
    'unfinished_ingredients_observed',
    'normal_swap_completed',
    'normal_drop_completed',
    'dropped_forbidden',
  ])
    assert.equal(r.outcomes[key], true);
  for (const key of [
    'produced_quality_field_present',
    'swapped_out_forbidden',
    'combat_tested',
    'quality_distribution_tested',
    'research_unlock_tested',
    'precise_duration_tested',
  ])
    assert.equal(r.outcomes[key], false);
  assert.equal(r.outcomes.wood_consumed, 40);
  assert.equal(r.outcomes.produced_item, CLUB);
  assert.equal(r.ui.spot_work_speed_percent, 40);
  assert.deepEqual(r.clock.entry_ticks, [77192, 77192]);
  assert.deepEqual(r.clock.final_ticks, [81128, 81128]);
  assert.equal(r.clock.total_advanced_ticks, 3936);
  assert.equal(r.clock.reloads, 0);
  assert.equal(r.clock.space_inputs, 0);
  assert.equal(r.clock.exact_action_duration_measured, false);
  const ledger = readFileSync(path.join(dir, r.actions.file));
  assert.equal(r.actions.file, 'native-weapons-actions.jsonl');
  assert.equal(
    r.actions.sha256,
    '0c35856e478f0eb42b2f2f3b0cca591cab762b1ea1e366ee96bd487d233d6509',
  );
  assert.equal(sha(ledger), r.actions.sha256);
  const actions = ledger.toString().trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(r.actions.count, 130);
  assert.equal(actions.length, 130);
  assert.equal(new Set(actions.map((a) => a.data.image)).size, 130);
  let previous = 0;
  for (const a of actions) {
    assert.equal(a.kind, 'guarded-ui-input');
    assert.equal(a.data.pid, 29920);
    assert(a.data.profile.replaceAll('\\', '/').endsWith('/' + r.profile));
    assert(/weapons-[a-z0-9-]+\.png$/.test(a.data.image));
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
    6,
  );
  assert.deepEqual(
    r.clock.run_windows.map((w) => [
      w.speed_key,
      w.before_tick,
      w.after_tick,
      w.requested_capture_wait_ms,
    ]),
    [
      [3, 77192, 78093, 1400],
      [3, 78093, 79302, 2300],
      [3, 79302, 79865, 500],
      [3, 79865, 80782, 1300],
      [1, 80782, 81017, 2600],
      [1, 81017, 81128, 600],
    ],
  );
  for (const w of r.clock.run_windows) {
    const a = actions.find((a) => a.data.image.endsWith(w.start_image)).data;
    const p = actions.find((a) => a.data.image.endsWith(w.pause_image)).data;
    assert.equal(a.action, 'key');
    assert.equal(a.virtual_key, w.speed_key === 1 ? 49 : 51);
    assert.equal(a.started_utc, w.input_start_utc);
    assert.equal(a.wait_ms, w.requested_capture_wait_ms);
    assert.equal(p.action, 'click');
    assert.deepEqual([p.x, p.y], [2441, 1305]);
    assert.equal(p.started_utc, w.pause_input_start_utc);
    assert(Date.parse(p.started_utc) > Date.parse(a.finished_utc));
    assert(Date.parse(p.started_utc) - Date.parse(a.started_utc) < 12000);
  }
  assert(actions.at(-1).data.image.endsWith('weapons-stopped-b-return.png'));
  assert.equal(r.screenshots.length, 18);
  assert.equal(new Set(r.screenshots.map((s) => s.id)).size, 18);
  for (const s of r.screenshots) {
    assert.equal(s.image, `runtime/weapons-${s.id}.png`);
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
      // PowerShell JSON DateTime serialization can trim a trailing fractional zero.
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
  assert.equal(r.final_state.canonical_save, 'weapons-stopped-b.rws');
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
          path.join(root, 'scripts/research/read-weapons-runtime-save.ps1'),
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
    saveSnapshots: 15,
    crops: 18,
    actions: 130,
    controlledRunWindows: 6,
    advancedTicks: 3936,
    woodConsumed: 40,
    producedClubHasQuality: false,
    swapForbidden: false,
    explicitDropForbidden: true,
    finalPauseVerified: true,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(
    JSON.stringify(verifyNativeWeaponsRuntime({ local: process.argv.includes('--local') })),
  );
