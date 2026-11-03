import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const pawn = (s) => s.pawns.find((x) => x.id === 'Human958');
const intellectual = (p) => p.skills.find((x) => x.def === 'Intellectual');
const xp = (s) => intellectual(pawn(s)).xp_since_level.value;
const progress = (s, def) => s.research.progress.find((x) => x.def === def).progress;
const near = (actual, expected, tolerance = 1e-8) =>
  assert(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const same = (a, b, keys) => keys.forEach((key) => assert.deepEqual(a[key], b[key], key));
const stateKeys = ['tick', 'research', 'pawns', 'benches', 'materials', 'material_totals'];
const BENCH = 'SimpleResearchBench78107';
const FRAME = 'Frame_SimpleResearchBench78099';
const EXTRA = 'Blueprint_SimpleResearchBench78093';

// This validates retained evidence, never executes gameplay, input, or OCR.
export function verifyNativeResearchRuntime({ root = projectRoot, local = false } = {}) {
  const dir = path.join(root, 'docs/research/rimworld/evidence');
  const r = JSON.parse(readFileSync(path.join(dir, 'native-research-runtime.json'), 'utf8'));
  assert.equal(r.schema_version, 1);
  assert.equal(r.evidence_id, 'RW17-NATIVE-RESEARCH-RUNTIME');
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
    'skills-stopped-b',
    'research-entry-a',
    'research-entry-b',
    'research-selected',
    'research-build-ready',
    'research-constructing',
    'research-extra-cancelled',
    'research-bench-built',
    'research-battery-progress',
    'research-battery-paused',
    'research-switched-solar',
    'research-solar-progress',
    'research-resumed-battery',
    'research-battery-resumed-progress',
    'research-stopped-a',
    'research-stopped-b',
  ];
  assert.deepEqual(
    r.snapshots.map((x) => x.name),
    names,
  );
  // Pins the reviewed extraction, including raw save hashes and omitted-field markers.
  assert.equal(
    sha(JSON.stringify(r.snapshots)),
    'c4c3282c5f0f69516a087bff8d64aa5eee365e57f78a3c4ec2e19d792c87ccba',
  );
  const saves = r.snapshots.map((x) => x.save);
  const [
    base,
    entryA,
    entryB,
    selected,
    ready,
    constructing,
    cancelled,
    built,
    battery,
    paused,
    switched,
    solar,
    resumed,
    renewed,
    stopA,
    final,
  ] = saves;
  assert.equal(base.sha256, 'a1198e345bc9a6af03d46decd2a557aaf1bbc0f7ad1f8431fc9c10a46f157d33');
  assert.equal(final.sha256, '01e8033f0c7a1b7d7cf9e96839e81f13168bbdfb2cf3d247898590f6eecbf6db');
  const expected = [
    [86183, '', 0, 0, 0],
    [86183, '', 0, 0, 0],
    [86183, '', 0, 0, 0],
    [86183, 'Batteries', 0, 0, 0],
    [86183, 'Batteries', 0, 0, 0],
    [87466, 'Batteries', 0, 0, 0],
    [87466, 'Batteries', 0, 0, 0],
    [89361, 'Batteries', 0.195254251, 0, 4.62000036],
    [90998, 'Batteries', 2.61819053, 0, 61.9497681],
    [90998, 'Batteries', 2.61819053, 0, 61.9497681],
    [90998, 'SolarPanels', 2.61819053, 0, 61.9497681],
    [92765, 'SolarPanels', 2.61819053, 2.60951614, 123.796669],
    [92765, 'Batteries', 2.61819053, 2.60951614, 123.796669],
    [93839, 'Batteries', 4.0841136, 2.60951614, 161.175461],
    [94520, '', 4.0841136, 2.60951614, 161.175461],
    [94520, '', 4.0841136, 2.60951614, 161.175461],
  ];
  assert.deepEqual(
    saves.map((s) => [
      s.tick,
      s.research.current_project,
      progress(s, 'Batteries'),
      progress(s, 'SolarPanels'),
      xp(s),
    ]),
    expected,
  );
  assert.deepEqual(
    base.research.progress.filter((x) => x.progress > 0),
    [
      { def: 'ComplexFurniture', progress: 300 },
      { def: 'PassiveCooler', progress: 400 },
      { def: 'Stonecutting', progress: 300 },
      { def: 'ComplexClothing', progress: 600 },
      { def: 'Electricity', progress: 1600 },
      { def: 'NutrientPaste', progress: 400 },
      { def: 'AirConditioning', progress: 500 },
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
    assert.equal(s.storyteller, 'Cassandra');
    assert.equal(s.difficulty, 'Rough');
    assert.equal(s.player_faction, 'PlayerColony');
    assert.equal(s.research.progress.length, 86);
    assert.equal(new Set(s.research.progress.map((p) => p.def)).size, 86);
    const inactive = (s) =>
      s.research.progress.filter((p) => !['Batteries', 'SolarPanels'].includes(p.def));
    assert.deepEqual(inactive(s), inactive(base));
    same(s.research, base.research, ['techprints_xml', 'knowledge_xml']);
    assert.equal(s.research.current_project_field_present, s.research.current_project !== '');
    assert.deepEqual(
      s.pawns.map((p) => p.id),
      ['Human958', 'Human961', 'Human965'],
    );
    for (const [i, p] of s.pawns.entries()) {
      const b = base.pawns[i];
      assert.equal(p.skills.length, 12);
      assert.deepEqual(p.work_priority_values, b.work_priority_values);
      assert.deepEqual(intellectual(p).level, intellectual(b).level);
      assert.equal(intellectual(p).passion, 'None');
      assert.equal(intellectual(p).passion_field_present, false);
      assert.equal(p.last_xp_reset_tick, b.last_xp_reset_tick);
      assert.deepEqual(p.traits, b.traits);
    }
    assert.deepEqual(intellectual(pawn(s)).level, { value: 3, present: true });
    assert.equal(intellectual(pawn(s)).xp_since_midnight.value, xp(s));
    assert.equal(pawn(s).last_xp_reset_tick, 45181);
    assert.deepEqual(pawn(s).hediffs, pawn(base).hediffs);
    assert.equal(new Set(s.materials.map((m) => m.id)).size, s.materials.length);
    for (const def of ['WoodLog', 'Steel'])
      assert.equal(
        s.material_totals[def],
        s.materials.filter((m) => m.def === def).reduce((n, m) => n + m.count, 0),
      );
    assert.deepEqual(
      s.materials.filter((m) => m.forbidden),
      base.materials.filter((m) => m.forbidden),
    );
    assert.deepEqual(
      s.material_totals,
      s.tick < built.tick ? { WoodLog: 387, Steel: 1140 } : { WoodLog: 312, Steel: 1115 },
    );
    assert(s.scope.includes('Read-only explicit XML'));
  }
  for (const s of [entryA, entryB]) same(s, base, stateKeys);
  for (const s of [base, entryA, entryB, selected]) assert.deepEqual(s.benches, []);
  same(
    selected,
    base,
    stateKeys.filter((k) => k !== 'research'),
  );
  assert.deepEqual(selected.research.progress, base.research.progress);
  assert.deepEqual(
    base.pawns.map((p) => intellectual(p).level.value),
    [3, 1, 11],
  );
  assert.equal(
    base.materials
      .filter((m) => m.def === 'WoodLog' && !m.forbidden)
      .reduce((n, m) => n + m.count, 0),
    87,
  );
  assert.equal(
    base.materials
      .filter((m) => m.def === 'Steel' && !m.forbidden)
      .reduce((n, m) => n + m.count, 0),
    36,
  );
  assert.deepEqual(
    ready.benches.map((b) => b.id),
    ['Blueprint_SimpleResearchBench78092', EXTRA],
  );
  for (const b of ready.benches) {
    assert.equal(b.stuff_to_use, 'WoodLog');
    assert.equal(b.spawned_tick, 86183);
    assert.deepEqual(b.resources, []);
  }
  assert.equal(pawn(ready).job.def, 'HaulToContainer');
  assert.equal(pawn(ready).job.player_forced, true);
  assert.equal(pawn(ready).job.target_b, 'Thing_Blueprint_SimpleResearchBench78092');
  assert.deepEqual(
    constructing.benches.map((b) => b.id),
    [EXTRA, FRAME],
  );
  assert.deepEqual(constructing.benches[0], ready.benches[1]);
  assert.equal(constructing.benches[0].pos, '(104, 0, 154)');
  assert.deepEqual(cancelled.benches, [constructing.benches[1]]);
  same(
    cancelled,
    constructing,
    stateKeys.filter((k) => k !== 'benches'),
  );
  const frame = cancelled.benches[0];
  assert.equal(frame.spawned_tick, 86860);
  assert.equal(frame.pos, '(115, 0, 133)');
  assert.equal(frame.health.value, 41);
  assert.deepEqual(frame.work_done, { value: 312.69342, present: true });
  assert.deepEqual(
    frame.resources.map((m) => [m.id, m.def, m.count]),
    [
      ['Steel78096', 'Steel', 25],
      ['WoodLog78100', 'WoodLog', 75],
    ],
  );
  for (const m of frame.resources) {
    assert.equal(m.container_owner, FRAME);
    assert.deepEqual(
      cancelled.materials.find((x) => x.id === m.id),
      m,
    );
  }
  for (const s of saves.slice(7)) {
    assert.equal(s.benches.length, 1);
    assert.deepEqual(s.benches, built.benches);
    assert.equal(s.materials.find((m) => m.id === 'Steel38585').count, 11);
    assert(!s.materials.some((m) => ['Steel78096', 'WoodLog78100'].includes(m.id)));
  }
  const bench = built.benches[0];
  assert.equal(bench.id, BENCH);
  assert.equal(bench.def, 'SimpleResearchBench');
  assert.equal(bench.stuff, 'WoodLog');
  assert.equal(bench.pos, '(115, 0, 133)');
  assert.equal(bench.spawned_tick, 89191);
  assert.equal(bench.health.value, 162);
  assert.deepEqual(bench.resources, []);
  assert.equal(base.material_totals.WoodLog - final.material_totals.WoodLog, 75);
  assert.equal(base.material_totals.Steel - final.material_totals.Steel, 25);
  for (const s of saves.slice(7, 14)) {
    const j = pawn(s).job;
    assert.equal(j.def, 'Research');
    assert.equal(j.work_giver, 'Research');
    assert.equal(j.player_forced, false);
    assert.equal(j.driver, 'JobDriver_Research');
    assert.equal(j.toil_index, 1);
    assert.equal(j.target_a, 'Thing_' + BENCH);
    assert.equal(j.load_id, s === renewed ? 81517 : 78274);
    assert.equal(j.start_tick, s === renewed ? 93232 : 89194);
  }
  assert.deepEqual(
    saves.slice(7, 14).map((s) => pawn(s).job.ticks_left),
    [3868, 2231, 2231, 2231, 464, 464, 3393],
  );
  same(battery, paused, stateKeys);
  for (const [before, after] of [
    [paused, switched],
    [solar, resumed],
  ]) {
    same(
      before,
      after,
      stateKeys.filter((k) => k !== 'research'),
    );
    assert.deepEqual(before.research.progress, after.research.progress);
  }
  assert.equal(progress(switched, 'Batteries'), progress(solar, 'Batteries'));
  assert.equal(progress(resumed, 'SolarPanels'), progress(renewed, 'SolarPanels'));
  assert.equal(battery.tick - built.tick, 1637);
  assert.equal(pawn(built).job.ticks_left - pawn(battery).job.ticks_left, 1637);
  near(xp(battery) - xp(built), 57.32976774);
  // Preserve the one-work-tick-scale mismatch; do not assert map ticks equal rewarded work.
  assert(Math.abs(xp(battery) - xp(built) - 1637 * 0.035) > 0.03);
  near(xp(battery) - xp(built), 1638 * 0.035, 0.001);
  near(xp(solar) - xp(switched), 1767 * 0.035, 0.002);
  for (const s of [stopA, final]) {
    assert.equal(s.research.current_project, '');
    assert.equal(s.research.current_project_field_present, false);
    assert.deepEqual(s.research.progress, renewed.research.progress);
    assert.equal(xp(s), xp(renewed));
    assert.equal(pawn(s).job.def, 'GotoWander');
    assert.equal(s.tick - renewed.tick, 681);
  }
  same(stopA, final, stateKeys);
  for (const key of [
    'god_mode_inherited',
    'dev_spawned_items',
    'dev_spawned_materials',
    'skills_modified',
    'research_debug_modified',
    'save_xml_edited',
    'work_assignments_changed',
    'manual_priorities_changed',
  ])
    assert.equal(r.preparation[key], false);
  assert.equal(r.preparation.developer_mode_retained, true);
  assert.equal(r.preparation.baseline, 'skills-stopped-b');
  assert.equal(r.preparation.extra_blueprint, EXTRA);
  assert.equal(r.preparation.extra_blueprint_cancelled_normally, true);
  assert.equal(r.preparation.extra_blueprint_materials_delivered, 0);
  assert.equal(r.ui.bench_speed_percent, 42);
  assert.equal(r.ui.learning_percent, 35);
  assert.equal(r.ui.intellectual_level, 3);
  assert.equal(r.ui.next_level_xp, 4000);
  assert.equal(r.ui.battery_cost, 400);
  assert.equal(r.ui.solar_cost, 600);
  assert.equal(r.ui.select_without_bench, true);
  assert.equal(r.ui.manual_priorities, false);
  assert.deepEqual(r.ui.research_work_enabled, ['Prophet']);
  assert.deepEqual(r.ui.research_work_disabled, ['Squint', 'Grump']);
  assert.equal(r.ui.rightclick_squint_menu_observed, false);
  for (const key of [
    'ordinary_bench_completed',
    'normal_research_automatically_started',
    'switch_preserves_progress',
    'inactive_project_frozen',
    'global_pause_frozen',
    'ordinary_stop_preserves_progress',
    'after_stop_xp_frozen',
  ])
    assert.equal(r.outcomes[key], true);
  for (const key of [
    'research_player_forced',
    'multiple_benches_tested',
    'power_gate_tested',
    'skill_gate_tested',
    'level_up_tested',
    'probability_tested',
  ])
    assert.equal(r.outcomes[key], false);
  assert.equal(r.outcomes.projects_completed_this_round, 0);
  assert.equal(r.outcomes.intellectual_xp_after, xp(final));
  assert.equal(r.outcomes.battery_after, progress(final, 'Batteries'));
  assert.equal(r.outcomes.solar_after, progress(final, 'SolarPanels'));
  assert.equal(r.outcomes.wood_consumed, 75);
  assert.equal(r.outcomes.steel_consumed, 25);
  assert.equal(r.outcomes.after_stop_advanced_ticks, 681);
  assert.deepEqual(r.clock.entry_ticks, [86183, 86183]);
  assert.deepEqual(r.clock.final_ticks, [94520, 94520]);
  assert.equal(r.clock.total_advanced_ticks, final.tick - base.tick);
  assert.equal(r.clock.total_advanced_ticks, 8337);
  assert.equal(r.clock.reloads, 0);
  assert.equal(r.clock.space_inputs, 0);
  assert.equal(r.clock.exact_action_duration_measured, false);
  near(r.clock.freeze.elapsed_wall_seconds, 139.6470358);
  near(
    (Date.parse(r.clock.freeze.after_capture_utc) - Date.parse(r.clock.freeze.before_capture_utc)) /
      1000,
    139.6470358,
    0.001,
  );
  assert.equal(r.clock.freeze.both_tick, paused.tick);
  assert.equal(r.clock.freeze.both_battery_progress, progress(paused, 'Batteries'));
  assert.equal(r.clock.freeze.both_intellectual_xp, xp(paused));
  const ledger = readFileSync(path.join(dir, r.actions.file));
  assert.equal(r.actions.file, 'native-research-actions.jsonl');
  assert.equal(
    r.actions.sha256,
    '0603a2612d04aa01f5fb5d62f44a66b066844fb0849df8ca6fd43e78d9e532ed',
  );
  assert.equal(sha(ledger), r.actions.sha256);
  const actions = ledger.toString().trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(r.actions.count, 143);
  assert.equal(actions.length, 143);
  assert.equal(new Set(actions.map((a) => a.data.image)).size, 143);
  let previous = 0;
  for (const a of actions) {
    assert.equal(a.kind, 'guarded-ui-input');
    assert.equal(a.data.pid, 29920);
    assert(a.data.profile.replaceAll('\\', '/').endsWith('/' + r.profile));
    assert(/research-[a-z0-9-]+\.png$/.test(a.data.image));
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
    actions.filter((a) => a.data.action === 'key' && [49, 50, 51, 52].includes(a.data.virtual_key))
      .length,
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
      [3, 86183, 87466, 2500],
      [3, 87466, 89361, 4000],
      [3, 89361, 90998, 3500],
      [3, 90998, 92765, 3500],
      [3, 92765, 93839, 1500],
      [3, 93839, 94520, 500],
    ],
  );
  for (const w of r.clock.run_windows) {
    const a = actions.find((a) => a.data.image.endsWith(w.start_image)).data;
    const p = actions.find((a) => a.data.image.endsWith(w.pause_image)).data;
    assert.equal(a.action, 'key');
    assert.equal(a.virtual_key, 51);
    assert.equal(a.started_utc, w.input_start_utc);
    assert.equal(a.wait_ms, w.requested_capture_wait_ms);
    assert.equal(p.action, 'click');
    assert.deepEqual([p.x, p.y], [2441, 1305]);
    assert.equal(p.started_utc, w.pause_input_start_utc);
    assert(Date.parse(p.started_utc) > Date.parse(a.finished_utc));
    assert(Date.parse(p.started_utc) - Date.parse(a.started_utc) < 12000);
  }
  assert(actions.at(-1).data.image.endsWith('research-stopped-b-return.png'));
  assert.equal(r.screenshots.length, 24);
  assert.equal(new Set(r.screenshots.map((s) => s.id)).size, 24);
  for (const s of r.screenshots) {
    assert.equal(s.image, `runtime/research-${s.id}.png`);
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
      assert.equal(Date.parse(meta.timestamp_utc), Date.parse(s.observed_utc));
      assert.equal(meta.pid, 29920);
    }
  }
  for (const key of [
    'paused',
    'pause_confirmed_by_two_equal_saves',
    'baseline_untouched',
    'developer_mode',
    'work_assignments_equal_baseline',
  ])
    assert.equal(r.final_state[key], true);
  for (const key of ['god_mode', 'normal_profile_touched', 'game_files_modified', 'mods_installed'])
    assert.equal(r.final_state[key], false);
  assert.equal(r.final_state.canonical_save, 'research-stopped-b.rws');
  assert.equal(r.final_state.active_project, '');
  assert.equal(r.final_state.researcher_job, 'GotoWander');
  assert.equal(r.limitations.length, 12);
  if (local) {
    for (const x of r.snapshots) {
      const file = path.join(root, x.path);
      assert.equal(sha(readFileSync(file)), x.save.sha256);
      const output = execFileSync(
        'pwsh',
        [
          '-NoProfile',
          '-File',
          path.join(root, 'scripts/research/read-research-runtime-save.ps1'),
          '-SavePath',
          file,
        ],
        { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
      );
      assert.deepEqual(JSON.parse(output.replace(/^\uFEFF/, '')), x.save);
    }
    for (const [name, timestamp] of [
      [r.clock.freeze.before_save, r.clock.freeze.before_capture_utc],
      [r.clock.freeze.after_save, r.clock.freeze.after_capture_utc],
    ]) {
      const meta = JSON.parse(
        readFileSync(path.join(root, `.local-research/runtime/${name}-saved.png.jsonl`), 'utf8')
          .trim()
          .split(/\r?\n/)
          .at(-1),
      );
      assert.equal(Date.parse(meta.timestamp_utc), Date.parse(timestamp));
    }
  }
  return {
    ok: true,
    mode: local ? 'local-original-saves-and-captures' : 'portable-recorded-summary',
    saveSnapshots: 16,
    crops: 24,
    actions: 143,
    controlledRunWindows: 6,
    advancedTicks: 8337,
    woodConsumed: 75,
    steelConsumed: 25,
    intellectualLevel: 3,
    passion: 'None',
    intellectualXp: xp(final),
    batteryProgress: progress(final, 'Batteries'),
    solarProgress: progress(final, 'SolarPanels'),
    projectSwitchPreservesProgress: true,
    pauseFrozen: true,
    afterStopTicks: 681,
    completedProjectsThisRound: 0,
    finalPauseVerified: true,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(
    JSON.stringify(verifyNativeResearchRuntime({ local: process.argv.includes('--local') })),
  );
