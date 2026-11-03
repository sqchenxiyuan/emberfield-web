# Rebuild from retained saves/screenshots only. No game execution or UI input.
$ErrorActionPreference='Stop'
$project=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$runtime=Join-Path $project '.local-research/runtime'
$dir=Join-Path $project 'docs/research/rimworld/evidence'
$utf8=[Text.UTF8Encoding]::new($false)
$reader=Join-Path $PSScriptRoot 'read-injuries-runtime-save.ps1'
$names=@('apparel-stopped-b','injuries-entry-a','injuries-entry-b','injuries-prepared','injuries-doctor-blocked','injuries-tend-ready','injuries-tending','injuries-tending-wait','injuries-stopped-a','injuries-stopped-b')
$snapshots=@(foreach($name in $names){$relative=".local-research/runtime/profile-20261102/Saves/$name.rws";[ordered]@{name=$name;path=$relative;save=(& $reader -SavePath (Join-Path $project $relative)|ConvertFrom-Json)}})
Add-Type -AssemblyName System.Drawing
$specs=@(
 @('health-before','injuries-003-health.png',0,775,640,440,'Inherited Bite scar, Malnutrition and developer-prepared Anesthetic from the prior study; no fresh Cut.'),
 @('dev-cut-choice','injuries-007-search-cut.png',0,0,440,170,'Developer Health Add hediff: Cut selected as experimental preparation, not combat.'),
 @('cut-untended','injuries-010-cut-tooltip.png',0,775,650,440,'Left arm Cut0.5, Bleeding3%/d, Needs tending now; screenshot includes tooltip and total bleeding.'),
 @('care-policy','injuries-011-med-care-menu.png',0,775,650,450,'Ordinary medical policy menu: Doctor care, but no medicine; chosen in next recorded action.'),
 @('doctor-disabled','injuries-014-doctor-disabled.png',0,1160,700,240,'Prophet Doctor checkbox normally disabled to test the work gate.'),
 @('tend-blocked','injuries-017-tend-blocked.png',1430,800,500,160,'Cannot tend to Grump, Blaster: Not assigned to doctoring.'),
 @('doctor-assigned','injuries-020-doctor-assigned.png',0,1160,700,240,'Prophet Doctor checkbox normally re-enabled, without skill editing.'),
 @('tend-allowed','injuries-022-tend-allowed.png',1430,800,500,130,'After assignment: Prioritize tending to Grump, Blaster.'),
 @('tending-activity','injuries-025-pause-tend.png',0,1220,700,190,'Prophet activity Tending to Grump. after normal travel to the medical bed.'),
 @('tending-scene','injuries-025-pause-tend.png',1370,780,180,130,'Doctor adjacent to patient in inherited medical bed during TendPatient.'),
 @('tending-wait','injuries-027-pause-tend-wait.png',0,1220,700,190,'Same tending activity after another bounded normal-speed window; save retains decreasing toil countdown.'),
 @('bandaged-tooltip','injuries-031-after-tooltip.png',0,775,650,440,'Left arm Cut displays0.0 by rounding, Bandaged(quality0%); bleeding marker/rate absent. Save residual severity is0.0200000107.'),
 @('final-paused','injuries-stopped-b-return.png',1800,920,760,520,'Explicit final pause; two independent ending saves both77192.')
)
$shots=@()
foreach($row in $specs){
 $source=Join-Path $runtime $row[1];$relative="runtime/injuries-$($row[0]).png";$destination=Join-Path $dir $relative
 $bmp=[Drawing.Bitmap]::new($source)
 try{$crop=$bmp.Clone([Drawing.Rectangle]::new($row[2],$row[3],$row[4],$row[5]),$bmp.PixelFormat);try{$crop.Save($destination,[Drawing.Imaging.ImageFormat]::Png)}finally{$crop.Dispose()}}finally{$bmp.Dispose()}
 $capture=Get-Content -LiteralPath ($source+'.jsonl')|Select-Object -Last 1|ConvertFrom-Json
 $shots+=[ordered]@{id=$row[0];image=$relative;sha256=(Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant();source_file=".local-research/runtime/$($row[1])";source_sha256=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant();source_size=@(2560,1440);crop_xywh=@($row[2],$row[3],$row[4],$row[5]);observed_utc=$capture.timestamp_utc;observation=$row[6]}
}
$actions=@(Get-ChildItem -LiteralPath $runtime -Filter 'injuries-*.png.actions.jsonl'|ForEach-Object{Get-Content -LiteralPath $_.FullName|ForEach-Object{[ordered]@{kind='guarded-ui-input';data=($_|ConvertFrom-Json)}}}|Sort-Object {$_.data.started_utc})
$actionPath=Join-Path $dir 'native-injuries-actions.jsonl'
[IO.File]::WriteAllText($actionPath,(($actions|ForEach-Object{ConvertTo-Json $_ -Depth 10 -Compress}) -join "`n")+"`n",$utf8)
$windows=@()
foreach($spec in @(@('024-run-tend','025-pause-tend',1,75374,75699),@('026-run-tend-wait','027-pause-tend-wait',1,75699,76102),@('028-run-finish','029-pause-finish',3,76102,77192))){
 $a=$actions|Where-Object {$_.data.image.EndsWith("injuries-$($spec[0]).png")};$b=$actions|Where-Object {$_.data.image.EndsWith("injuries-$($spec[1]).png")}
 $windows+=[ordered]@{start_image="injuries-$($spec[0]).png";pause_image="injuries-$($spec[1]).png";speed_key=$spec[2];input_start_utc=$a.data.started_utc;pause_input_start_utc=$b.data.started_utc;requested_capture_wait_ms=$a.data.wait_ms;before_tick=$spec[3];after_tick=$spec[4]}
}
$record=[ordered]@{
 schema_version=1;evidence_id='RW17-NATIVE-INJURIES-RUNTIME';version_text='1.7.4980 rev60';assembly_sha256='eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3'
 executable='F:\SteamLibrary\steamapps\common\RimWorld\RimWorld.exe';process_id=29920;window_handle=988850;profile='.local-research/runtime/profile-20261102';active_mods=@('ludeon.rimworld','ludeon.rimworld.odyssey')
 method='REA skill v42 evidence discipline. Reuses established Windows native UI unsupported boundary; actual input is guarded Windows foreground UI, not REA native UI execution.'
 provider_boundary_reference='native-plants-runtime.json';snapshots=$snapshots
 preparation=[ordered]@{baseline='apparel-stopped-b';patient='Human965';doctor='Human958';dev_added_hediff='Cut';hediff_load_id=83;body_part_ui='Left arm';body_part_index=25;severity=0.5;tick=75374;inherited_anesthetic_id=82;inherited_anesthetic_tick=64249;inherited_god_built_bed='Bed77946';bed_newly_created=$false;medical_policy_chosen_normally='NoMeds';doctor_normally_disabled_then_enabled=$true;skills_modified=$false;medicine_spawned=$false;save_xml_edited=$false}
 clock=[ordered]@{entry_ticks=@(75374,75374);run_windows=$windows;total_advanced_ticks=1818;reloads=0;space_inputs=0;final_ticks=@(77192,77192);final_pause_verified=$true;exact_total_tend_duration_measured=$false;exact_tend_finish_tick_observed=$false}
 ui=[ordered]@{initial_severity_display=0.5;initial_bleeding_percent_per_day=3;initial_treatment='Needs tending now';blocked_reason='Not assigned to doctoring';allowed_option='Prioritize tending to Grump, Blaster';activity='Tending to Grump.';final_treatment='Bandaged (quality 0%)';final_tend_quality_percent=0;final_severity_display=0.0;final_bleeding_marker_absent=$true;final_patient_unconscious=$true}
 outcomes=[ordered]@{normal_work_assignment_gate_observed=$true;normal_tend_patient_completed=$true;no_medicine_policy_and_job_observed=$true;medicine_stack_quantities_unchanged=$true;countdown_decrement_observed=403;treated_same_hediff_id=83;bandaged_zero_quality_observed=$true;bleeding_ui_disappeared=$true;severity_decreased_before_tend_completion=$true;wound_fully_healed=$false;patient_recovered=$false;natural_combat_injury_tested=$false;herbal_medicine_tested=$false;infection_or_immunity_runtime_tested=$false;quality_distribution_tested=$false}
 screenshots=$shots;actions=[ordered]@{file='native-injuries-actions.jsonl';sha256=(Get-FileHash -LiteralPath $actionPath -Algorithm SHA256).Hash.ToLowerInvariant();count=$actions.Count}
 limitations=@('One small developer-added Cut0.5 on a patient already down from prior Anesthetic, in a previously God-built medical bed. Not natural combat or natural injury-caused downing.','Doctor Medicine0 and inherited minor health penalties were not edited; one result of quality0% does not establish a skill curve or quality distribution.','NoMeds chosen through ordinary UI; targetB and carried medicine absent during TendPatient, all recorded medicine stack quantities unchanged. No herbal, industrial, ultratech or medicine-consumption comparison.','Severity fell0.5 to0.340000004 while the same untreated wound was still being tended. Final0.0200000107 is not fully healed, despite UI rounding to0.0. No claim that tending alone caused recovery.','Intermediate toil3 countdown1389 to986 tracks403simulated ticks. Observation windows include travel and later work; exact complete tending duration and finish tick were not continuously measured.','Final doctor job became FeedPatient starting77089; this was not an additional manually issued command and the new feeding completion was not observed.','Final tendQuality omitted uses source serialization default0; tendTicksLeft1 is the permanent-tend marker, not evidence of one tick remaining. Treatment evidence combines UI, stable wound ID and ordinary job execution.','No blood-loss disease progression, infection, immunity, medicine quality comparison, repeat tending, long-term recovery, bed-factor comparison or autonomous task-selection experiment.','Portable verifier checks retained semantic claims, hashes, PNG dimensions and input chronology; local mode re-reads original XML and raw screenshots. Neither reruns gameplay or performsOCR.','Normal profile and game installation untouched. Old baseline retained. Final double-save tick77192 confirms pause; no original input after2026-11-02T23:39:22Z.')
 final_state=[ordered]@{canonical_save='injuries-stopped-b.rws';paused=$true;pause_confirmed_by_two_equal_saves=$true;baseline_untouched=$true;normal_profile_touched=$false;game_files_modified=$false;mods_installed=$false;developer_mode=$true;god_mode=$true}
}
[IO.File]::WriteAllText((Join-Path $dir 'native-injuries-runtime.json'),(ConvertTo-Json $record -Depth 28)+"`n",$utf8)
"Collected $($snapshots.Count) saves, $($shots.Count) crops, $($actions.Count) actions; normal no-medicine tending completed, full healing not observed."
