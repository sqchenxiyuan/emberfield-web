import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const patient = (s) => s.pawns.find((p) => p.id === 'Human958');
const doctor = (s) => s.pawns.find((p) => p.id === 'Human961');
const cuts = (s) => patient(s).hediffs.filter((h) => h.def === 'Cut');
const missing = (s, index = 16) =>
  patient(s).hediffs.find((h) => h.def === 'MissingBodyPart' && h.part_index.value === index);
const medicine = (s) => doctor(s).skills.find((x) => x.def === 'Medicine');
const same = (a, b, keys) => keys.forEach((k) => assert.deepEqual(a[k], b[k], k));
const stateKeys = ['tick', 'pawns', 'medicines', 'beds'];

// Validates retained evidence only. No gameplay execution, UI input or OCR.
export function verifyNativeAnatomyRuntime({ root = projectRoot, local = false } = {}) {
  const dir = path.join(root, 'docs/research/rimworld/evidence');
  const r = JSON.parse(readFileSync(path.join(dir, 'native-anatomy-runtime.json'), 'utf8'));
  assert.equal(r.schema_version, 1);
  assert.equal(r.evidence_id, 'RW17-NATIVE-ANATOMY-RUNTIME');
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
  assert.equal(r.body_identity_reference, 'anatomy-human.json');
  const body = JSON.parse(readFileSync(path.join(dir, r.body_identity_reference), 'utf8'));
  assert.equal(body.nodes.length, 64);
  assert.equal(body.nodes.find((n) => n.index === 16).id, 'left-eye');
  assert.equal(body.nodes.find((n) => n.index === 39).id, 'right-hand');
  assert.deepEqual(body.nodes.find((n) => n.index === 39).childIds, [
    'right-pinky',
    'right-ring-finger',
    'right-middle-finger',
    'right-index-finger',
    'right-thumb',
  ]);
  const names = [
    'research-stopped-b',
    'anatomy-entry-a',
    'anatomy-entry-b',
    'anatomy-left-eye-pointfive',
    'anatomy-left-eye-five',
    'anatomy-left-eye-nine',
    'anatomy-left-eye-fresh',
    'anatomy-care-ready',
    'anatomy-at-bed',
    'anatomy-tend-ready',
    'anatomy-tending',
    'anatomy-tend-wait',
    'anatomy-eye-tended',
    'anatomy-right-hand-missing',
    'anatomy-stopped-a',
    'anatomy-stopped-b',
  ];
  assert.deepEqual(
    r.snapshots.map((s) => s.name),
    names,
  );
  // Pins reviewed original extraction, including field-absence markers and raw save hashes.
  assert.equal(
    sha(JSON.stringify(r.snapshots)),
    '126b8a1173fc3123b4f40ca06903fc545543559124867309f7d3d369e118b80a',
  );
  const saves = r.snapshots.map((x) => x.save);
  const [
    base,
    entryA,
    entryB,
    half,
    five,
    nine,
    fresh,
    care,
    bed,
    ready,
    walking,
    waiting,
    tended,
    hand,
    stopA,
    final,
  ] = saves;
  assert.deepEqual(
    saves.map((s) => s.tick),
    [
      94520, 94520, 94520, 94520, 94520, 94520, 94520, 94520, 95213, 95213, 95837, 96395, 98320,
      98320, 98320, 98320,
    ],
  );
  assert.equal(base.sha256, '01e8033f0c7a1b7d7cf9e96839e81f13168bbdfb2cf3d247898590f6eecbf6db');
  assert.equal(final.sha256, '76023aaf663c6cf1c4ffb05647d58cc59aada4932ee36a3cfa7c2df5a422634a');
  same(base, entryA, stateKeys);
  same(entryA, entryB, stateKeys);
  same(stopA, final, stateKeys);
  assert.deepEqual(
    base.pawns.map((p) => [p.id, p.nick]),
    [
      ['Human958', 'Prophet'],
      ['Human961', 'Squint'],
      ['Human965', 'Grump'],
    ],
  );
  for (const s of saves) {
    assert.deepEqual(s.mods, r.active_mods);
    assert.deepEqual(s.medicines, base.medicines);
    assert.deepEqual(s.beds, base.beds);
    const scar = patient(s).hediffs.find((h) => h.id === 10);
    assert.equal(scar.def, 'Stab');
    assert.equal(scar.severity.value, 2);
    assert.equal(scar.part_index.value, 0);
    assert.equal(scar.permanent.value, true);
    assert.equal(scar.pain_category, 'LowPain');
    assert(!s.pawns.some((p) => p.drafted.value));
    assert(
      !patient(s).hediffs.some(
          (h) => h.part_index.present && [17, 28, 29, 30, 31, 32, 33].includes(h.part_index.value),
      ),
    );
  }
  assert.equal(
    base.medicines.reduce((n, m) => n + m.count, 0),
    34,
  );
  assert(base.beds.some((b) => b.id === 'Bed77946' && b.medical));
  for (const [s, count, total] of [
    [half, 1, 0.5],
    [five, 10, 5],
    [nine, 18, 9],
  ]) {
    assert.equal(cuts(s).length, count);
    assert.equal(
      cuts(s).reduce((n, h) => n + h.severity.value, 0),
      total,
    );
    assert.deepEqual(
      cuts(s).map((h) => h.id),
      Array.from({ length: count }, (_, i) => 84 + i),
    );
    for (const h of cuts(s)) {
      assert.equal(h.body, 'Human');
      assert.deepEqual(h.part_index, { value: 16, present: true });
      assert.equal(h.severity.value, 0.5);
      assert.equal(h.tick_added.value, 94520);
      assert.equal(h.combat_log_entry, 'null');
    }
    assert(!missing(s));
  }
  // Paused preparation changed only Prophet's hediff set; other pawns stayed byte-for-field equal.
  for (const s of [half, five, nine, fresh, care]) {
    assert.deepEqual(s.pawns.slice(1), base.pawns.slice(1));
    same(patient(s), patient(base), ['skills', 'work_priority_values', 'traits', 'carried']);
  }
  assert.equal(cuts(fresh).length, 0);
  assert.equal(patient(fresh).hediffs.length, 2);
  assert.equal(missing(fresh).id, 103);
  assert.deepEqual(missing(fresh).fresh, { value: true, present: true });
  assert.equal(missing(fresh).last_injury, 'Cut');
  assert.equal(missing(fresh).severity.value, 0.5); // Not HP or prior injury sum.
  assert.equal(missing(fresh).tick_added.value, 94520);
  assert.equal(patient(care).medical_care, 'NoMeds');
  assert.equal(patient(care).job.def, 'LayDown');
  assert.equal(patient(care).job.target_a, 'Thing_Bed77946');
  assert.equal(patient(care).job.player_forced, true);
  assert.equal(patient(bed).pos, '(113, 0, 124)');
  assert.equal(doctor(bed).work_priority_values[2], 0);
  for (const s of [ready, walking, waiting]) {
    const j = doctor(s).job;
    assert.equal(j.def, 'TendPatient');
    assert.equal(j.load_id, 82353);
    assert.equal(j.target_a, 'Thing_Human958');
    assert.equal(j.target_b, '');
    assert.equal(j.work_giver, 'DoctorTendToHumanlikes');
    assert.equal(j.player_forced, true);
    assert.equal(j.start_tick, 95213);
    assert.equal(j.driver, 'JobDriver_TendPatient');
    assert.deepEqual(doctor(s).carried, []);
    assert.equal(doctor(s).work_priority_values[2], 3);
    assert.equal(missing(s).fresh.value, true);
    assert.equal(patient(s).medical_care, 'NoMeds');
  }
  assert.equal(doctor(waiting).job.toil_index, 3);
  assert.equal(doctor(waiting).job.ticks_left, 1350);
  assert.equal(missing(tended).id, 103);
  assert.deepEqual(missing(tended).fresh, { value: false, present: false });
  assert.equal(missing(tended).tick_added.value, 94520);
  assert.equal(missing(tended).last_injury, 'Cut');
  assert.equal(missing(tended).age_ticks.value, 3801);
  assert.equal(missing(tended).tend_quality.present, false);
  assert.deepEqual(missing(tended).tend_ticks_left, { value: 1, present: true });
  assert.equal(medicine(base).level.value, 0);
  assert.equal(medicine(tended).level.value, 0);
  assert.equal(medicine(tended).passion, 'None');
  assert.equal(medicine(tended).xp_since_level.value - medicine(base).xp_since_level.value, 87.5);
  assert.equal(
    patient(tended).hediffs.find((h) => h.def === 'BloodLoss').severity.value,
    0.0618000552,
  );
  assert.equal(doctor(tended).job.def, 'Wait_Wander');
  for (let i = 39; i <= 44; i++) {
    const h = missing(hand, i);
    assert.equal(h.id, i + 66);
    assert.equal(h.tick_added.value, 98320);
    assert.deepEqual(h.fresh, { value: false, present: false });
    assert.equal(h.last_injury, '');
    assert.equal(h.age_ticks.value, 0);
  }
  assert.deepEqual(patient(hand).hediffs.slice(0, 3), patient(tended).hediffs);
  assert.equal(patient(hand).hediffs.length, 9);
  for (let i = 0; i < base.pawns.length; i++) {
    same(base.pawns[i], final.pawns[i], [
      'work_priority_values',
      'medical_care',
      'self_tend',
      'traits',
    ]);
  }
  assert(
    patient(final)
      .hediffs.filter((h) => h.def === 'MissingBodyPart')
      .every((h) => !h.fresh.value),
  );
  assert.equal(r.preparation.doctor, 'Human961');
  assert.equal(r.preparation.left_eye_add_cut_count, 19);
  for (const key of [
    'god_mode_inherited',
    'natural_combat',
    'dev_tending',
    'dev_healing',
    'dev_spawned_items',
    'skills_modified',
    'save_xml_edited',
    'manual_priorities_changed',
    'debug_hediff_tooltips_final',
  ])
    assert.equal(r.preparation[key], false);
  for (const key of [
    'developer_mode_retained',
    'dev_injury_preparation',
    'direct_missing_right_hand',
    'work_assignments_changed',
    'debug_hediff_tooltips_temporarily_on',
  ])
    assert.equal(r.preparation[key], true);
  assert.deepEqual(
    r.ui.stages.map((s) => [
      s.stage,
      s.hp ?? s.hand_hp ?? null,
      s.sight_percent,
      s.manipulation_percent,
      s.bleeding_percent_per_day,
    ]),
    [
      ['baseline', null, 100, 100, 0],
      ['pointfive', 10, 100, 100, 3],
      ['one-screenshot-only', 9, 97, 100, 6],
      ['five', 5, 86, 100, 30],
      ['nine', 1, 75, 99, 54],
      ['fresh', 0, 75, 98, 120],
      ['eye-tended', 0, 75, 100, 0],
      ['right-hand-missing', 0, 75, 50, 0],
    ],
  );
  const ledger = readFileSync(path.join(dir, r.actions.file));
  assert.equal(r.actions.file, 'native-anatomy-actions.jsonl');
  assert.equal(
    r.actions.sha256,
    '8b5fa4952181811e7ef3f90b3d2ca2318bff1226e6df91886aebfdbb36a41df9',
  );
  assert.equal(sha(ledger), r.actions.sha256);
  const actions = ledger.toString().trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(r.actions.count, 300);
  assert.equal(actions.length, 300);
  assert.equal(new Set(actions.map((a) => a.data.image)).size, 300);
  let previous = 0;
  for (const a of actions) {
    assert.equal(a.kind, 'guarded-ui-input');
    assert.equal(a.data.pid, 29920);
    assert(a.data.profile.replaceAll('\\', '/').endsWith('/' + r.profile));
    assert(/anatomy-[a-z0-9-]+\.png$/.test(a.data.image));
    const t = Date.parse(a.data.started_utc);
    assert(t >= previous);
    assert(Date.parse(a.data.finished_utc) >= t);
    previous = t;
  }
  assert.equal(actions.filter((a) => /anatomy-left-eye-add-\d+-/.test(a.data.image)).length, 45);
  assert.equal(
    actions.filter((a) => /anatomy-eye-prep-\d+-added\.png$/.test(a.data.image)).length,
    18,
  );
  assert.equal(
    actions.filter((a) => a.data.action === 'key' && a.data.virtual_key === 32).length,
    0,
  );
  assert.equal(
    actions.filter((a) => a.data.action === 'key' && [49, 50, 51, 52].includes(a.data.virtual_key))
      .length,
    4,
  );
  assert.deepEqual(
    r.clock.run_windows.map((w) => [w.before_tick, w.after_tick, w.requested_capture_wait_ms]),
    [
      [94520, 95213, 500],
      [95213, 95837, 300],
      [95837, 96395, 150],
      [96395, 98320, 4000],
    ],
  );
  assert.equal(r.clock.total_advanced_ticks, 3800);
  assert.equal(r.clock.reloads, 0);
  assert.equal(r.clock.exact_action_duration_measured, false);
  assert.deepEqual(r.clock.final_ticks, [98320, 98320]);
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
  assert(actions.at(-1).data.image.endsWith('anatomy-stopped-b-return.png'));
  assert.equal(r.clock.last_input_finished_utc, actions.at(-1).data.finished_utc);
  assert.equal(r.screenshots.length, 24);
  assert.equal(new Set(r.screenshots.map((s) => s.id)).size, 24);
  for (const s of r.screenshots) {
    assert.equal(s.image, `runtime/anatomy-${s.id}.png`);
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
    'medical_care_equal_baseline',
    'left_eye_missing',
    'right_hand_missing',
    'input_released',
  ])
    assert.equal(r.final_state[key], true);
  for (const key of ['god_mode', 'normal_profile_touched', 'game_files_modified', 'mods_installed'])
    assert.equal(r.final_state[key], false);
  assert.equal(r.final_state.fresh_stumps, 0);
  assert.equal(r.final_state.canonical_save, 'anatomy-stopped-b.rws');
  if (local)
    for (const x of r.snapshots) {
      const file = path.join(root, x.path);
      assert.equal(sha(readFileSync(file)), x.save.sha256);
      const output = execFileSync(
        'pwsh',
        [
          '-NoProfile',
          '-File',
          path.join(root, 'scripts/research/read-anatomy-runtime-save.ps1'),
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
    saveSnapshots: 16,
    crops: 24,
    actions: 300,
    controlledRunWindows: 4,
    advancedTicks: 3800,
    leftEyeDamageFiveSight: 86,
    leftEyeMissingSight: 75,
    ordinaryNoMedicineTending: true,
    missingPartRetained: true,
    rightHandMissingManipulation: 50,
    rightHandMissingDescendants: 5,
    naturalCombat: false,
    finalPauseVerified: true,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(
    JSON.stringify(verifyNativeAnatomyRuntime({ local: process.argv.includes('--local') })),
  );
