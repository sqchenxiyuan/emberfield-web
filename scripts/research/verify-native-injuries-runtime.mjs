import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const wound = (save) => save.patient.hediffs.find((h) => h.id === 83);

// Verifies recorded evidence. Does not execute RimWorld, send input or perform OCR.
export function verifyNativeInjuriesRuntime({ root = projectRoot, local = false } = {}) {
  const dir = path.join(root, 'docs/research/rimworld/evidence');
  const r = JSON.parse(readFileSync(path.join(dir, 'native-injuries-runtime.json'), 'utf8'));
  assert.equal(r.schema_version, 1);
  assert.equal(r.evidence_id, 'RW17-NATIVE-INJURIES-RUNTIME');
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
    'apparel-stopped-b',
    'injuries-entry-a',
    'injuries-entry-b',
    'injuries-prepared',
    'injuries-doctor-blocked',
    'injuries-tend-ready',
    'injuries-tending',
    'injuries-tending-wait',
    'injuries-stopped-a',
    'injuries-stopped-b',
  ];
  assert.deepEqual(
    r.snapshots.map((x) => x.name),
    names,
  );
  assert.deepEqual(
    r.snapshots.map((x) => x.save.tick),
    [75374, 75374, 75374, 75374, 75374, 75374, 75699, 76102, 77192, 77192],
  );
  // Pins reviewed summaries, including raw save hashes; local mode re-extracts originals.
  assert.equal(
    sha(JSON.stringify(r.snapshots)),
    '0e77b5ddefabbc7a4aee78995984544e11cd392c61bce64caceb64479aae66b6',
  );
  const [base, entryA, entryB, prepared, blocked, ready, progress, waiting, stopA, final] =
    r.snapshots.map((x) => x.save);
  assert.equal(base.sha256, 'a52de787f59a254793359992f9208c6b123cd54dc2ace4d95488c1fc44bfb3ae');
  for (const x of r.snapshots) {
    const s = x.save;
    assert.equal(x.path, `${r.profile}/Saves/${x.name}.rws`);
    assert.equal(s.file, `${x.name}.rws`);
    assert(/^[a-f0-9]{64}$/.test(s.sha256));
    assert(s.bytes > 0);
    assert.equal(s.version, r.version_text);
    assert.deepEqual(s.mods, r.active_mods);
    assert.equal(s.patient.id, 'Human965');
    assert.equal(s.patient.nick, 'Grump');
    assert.equal(s.patient.health_state_explicit, 'Down');
    assert.equal(s.patient.pos, '(113, 0, 124)');
    assert.equal(s.patient.job.def, 'LayDown');
    assert.equal(s.patient.job.target_a, 'Thing_Bed77946');
    assert.equal(s.doctor.id, 'Human958');
    assert.equal(s.doctor.nick, 'Prophet');
    assert.equal(s.doctor.medicine_skill.level.value, 0);
    assert.equal(s.doctor.medicine_skill.level.present, false);
    assert.equal(s.patient.hediffs.find((h) => h.def === 'Anesthetic').tick_added, 64249);
    assert(s.patient.hediffs.some((h) => h.def === 'Bite' && h.permanent));
    assert.deepEqual(s.medicines, base.medicines);
    assert.deepEqual(s.beds, [
      { id: 'Bed77946', pos: '(113, 0, 124)', medical: true, spawned_tick: 64249 },
    ]);
    assert(s.scope.startsWith('Read-only explicit XML'));
  }
  for (const s of [entryA, entryB]) {
    assert.deepEqual(s.patient, base.patient);
    assert.deepEqual(s.doctor, base.doctor);
    assert.equal(wound(s), undefined);
  }
  assert.equal(base.patient.medical_care, 'Best');
  for (const s of [prepared, blocked, ready, progress, waiting, stopA, final]) {
    assert.equal(s.patient.medical_care, 'NoMeds');
    const h = wound(s);
    assert.equal(h.def, 'Cut');
    assert.equal(h.class, 'Hediff_Injury');
    assert.equal(h.body, 'Human');
    assert.deepEqual(h.part_index, { value: 25, present: true });
    assert.equal(h.tick_added, 75374);
    assert.equal(h.permanent, false);
    assert.deepEqual(h.tend_quality, { value: 0, present: false });
  }
  assert.equal(wound(prepared).severity, 0.5);
  assert.equal(wound(progress).severity, 0.5);
  assert.equal(wound(waiting).severity, 0.340000004);
  for (const s of [prepared, blocked, ready, progress, waiting])
    assert.deepEqual(wound(s).tend_ticks_left, { value: -1, present: false });
  const changes = blocked.doctor.work_priority_values
    .map((v, i) => [i, prepared.doctor.work_priority_values[i], v])
    .filter(([, a, b]) => a !== b);
  assert.deepEqual(changes, [[2, 3, 0]]); // Index meaning comes from the recorded Work UI, not guessed from this vector.
  assert.deepEqual(ready.doctor.work_priority_values, prepared.doctor.work_priority_values);
  for (const s of [ready, progress, waiting]) {
    assert.equal(s.doctor.job.def, 'TendPatient');
    assert.equal(s.doctor.job.driver, 'JobDriver_TendPatient');
    assert.equal(s.doctor.job.target_a, 'Thing_Human965');
    assert.equal(s.doctor.job.target_b, '');
    assert.equal(s.doctor.job.player_forced, true);
    assert.equal(s.doctor.job.start_tick, 75374);
    assert.deepEqual(s.doctor.carried, []);
  }
  assert.equal(progress.doctor.job.toil_index, 3);
  assert.equal(waiting.doctor.job.toil_index, 3);
  assert.equal(progress.doctor.job.ticks_left, 1389);
  assert.equal(waiting.doctor.job.ticks_left, 986);
  assert.equal(
    progress.doctor.job.ticks_left - waiting.doctor.job.ticks_left,
    waiting.tick - progress.tick,
  );
  assert.equal(wound(final).severity, 0.0200000107);
  assert.deepEqual(wound(final).tend_ticks_left, { value: 1, present: true });
  assert.equal(final.doctor.job.def, 'FeedPatient');
  assert.equal(final.doctor.job.start_tick, 77089);
  assert.equal(final.doctor.medicine_skill.xp_since_level.value, 87.5);
  assert.deepEqual(stopA.patient, final.patient);
  assert.deepEqual(stopA.doctor, final.doctor);
  assert.equal(r.preparation.dev_added_hediff, 'Cut');
  assert.equal(r.preparation.hediff_load_id, 83);
  assert.equal(r.preparation.severity, 0.5);
  assert.equal(r.preparation.tick, 75374);
  assert.equal(r.preparation.body_part_ui, 'Left arm');
  assert.equal(r.preparation.medical_policy_chosen_normally, 'NoMeds');
  assert.equal(r.preparation.doctor_normally_disabled_then_enabled, true);
  for (const k of ['bed_newly_created', 'skills_modified', 'medicine_spawned', 'save_xml_edited'])
    assert.equal(r.preparation[k], false);
  assert.equal(r.ui.initial_bleeding_percent_per_day, 3);
  assert.equal(r.ui.initial_treatment, 'Needs tending now');
  assert.equal(r.ui.blocked_reason, 'Not assigned to doctoring');
  assert.equal(r.ui.final_treatment, 'Bandaged (quality 0%)');
  assert.equal(r.ui.final_tend_quality_percent, 0);
  assert.equal(r.ui.final_bleeding_marker_absent, true);
  assert.equal(r.ui.final_patient_unconscious, true);
  for (const k of [
    'normal_work_assignment_gate_observed',
    'normal_tend_patient_completed',
    'no_medicine_policy_and_job_observed',
    'medicine_stack_quantities_unchanged',
    'bandaged_zero_quality_observed',
    'bleeding_ui_disappeared',
    'severity_decreased_before_tend_completion',
  ])
    assert.equal(r.outcomes[k], true);
  for (const k of [
    'wound_fully_healed',
    'patient_recovered',
    'natural_combat_injury_tested',
    'herbal_medicine_tested',
    'infection_or_immunity_runtime_tested',
    'quality_distribution_tested',
  ])
    assert.equal(r.outcomes[k], false);
  assert.equal(r.outcomes.countdown_decrement_observed, 403);
  assert.equal(r.outcomes.treated_same_hediff_id, 83);
  assert.deepEqual(r.clock.entry_ticks, [75374, 75374]);
  assert.deepEqual(r.clock.final_ticks, [77192, 77192]);
  assert.equal(r.clock.total_advanced_ticks, 1818);
  assert.equal(r.clock.reloads, 0);
  assert.equal(r.clock.space_inputs, 0);
  assert.equal(r.clock.exact_total_tend_duration_measured, false);
  assert.equal(r.clock.exact_tend_finish_tick_observed, false);
  assert.equal(r.actions.file, 'native-injuries-actions.jsonl');
  assert.equal(
    r.actions.sha256,
    '3f34ebbe2f662eaf8f1d7e91e27f0f2c4c2e6b308544a1c9d2cb0bfa58d4c62b',
  );
  const ledger = readFileSync(path.join(dir, r.actions.file));
  assert.equal(sha(ledger), r.actions.sha256);
  const actions = ledger.toString().trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(actions.length, 85);
  assert.equal(r.actions.count, 85);
  assert.equal(new Set(actions.map((a) => a.data.image)).size, 85);
  let previous = 0;
  for (const a of actions) {
    assert.equal(a.kind, 'guarded-ui-input');
    assert.equal(a.data.pid, 29920);
    assert(a.data.profile.replaceAll('\\', '/').endsWith('/' + r.profile));
    assert(/injuries-[a-z0-9-]+\.png$/.test(a.data.image));
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
      [1, 75374, 75699, 4000],
      [1, 75699, 76102, 5000],
      [3, 76102, 77192, 1700],
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
  assert(actions.at(-1).data.image.endsWith('injuries-stopped-b-return.png'));
  assert.equal(r.screenshots.length, 13);
  assert.equal(new Set(r.screenshots.map((s) => s.id)).size, 13);
  for (const s of r.screenshots) {
    assert.equal(s.image, `runtime/injuries-${s.id}.png`);
    assert(/^\.local-research\/runtime\/injuries-[a-z0-9-]+\.png$/.test(s.source_file));
    const b = readFileSync(path.join(dir, s.image));
    assert.equal(sha(b), s.sha256);
    assert.equal(b.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    const [x, y, width, height] = s.crop_xywh;
    assert.deepEqual(s.source_size, [2560, 1440]);
    assert(x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= 2560 && y + height <= 1440);
    assert.equal(b.readUInt32BE(16), width);
    assert.equal(b.readUInt32BE(20), height);
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
      assert.equal(meta.timestamp_utc, s.observed_utc);
      assert.equal(meta.pid, 29920);
    }
  }
  for (const k of [
    'paused',
    'pause_confirmed_by_two_equal_saves',
    'baseline_untouched',
    'developer_mode',
    'god_mode',
  ])
    assert.equal(r.final_state[k], true);
  for (const k of ['normal_profile_touched', 'game_files_modified', 'mods_installed'])
    assert.equal(r.final_state[k], false);
  assert.equal(r.final_state.canonical_save, 'injuries-stopped-b.rws');
  assert.equal(r.limitations.length, 10);
  if (local)
    for (const x of r.snapshots) {
      const file = path.join(root, x.path);
      assert.equal(sha(readFileSync(file)), x.save.sha256);
      const output = execFileSync(
        'pwsh',
        [
          '-NoProfile',
          '-File',
          path.join(root, 'scripts/research/read-injuries-runtime-save.ps1'),
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
    saveSnapshots: 10,
    crops: 13,
    actions: 85,
    controlledRunWindows: 3,
    advancedTicks: 1818,
    noMedicineTendingCompleted: true,
    bandagedQualityPercent: 0,
    fullyHealed: false,
    finalPauseVerified: true,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(
    JSON.stringify(verifyNativeInjuriesRuntime({ local: process.argv.includes('--local') })),
  );
