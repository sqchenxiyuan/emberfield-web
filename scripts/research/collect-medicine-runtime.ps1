# Offline collection only: existing original saves, screenshots and guarded-input ledgers.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$runtime=Join-Path $root '.local-research/runtime'
$dir=Join-Path $root 'docs/research/rimworld/evidence'
$utf8=[Text.UTF8Encoding]::new($false)
$files=@(Get-Item (Join-Path $runtime 'profile-20261102/Saves/ranged-final-paused-b.rws'))+@(Get-ChildItem (Join-Path $runtime 'profile-20261102/Saves') -Filter 'medicine-*.rws'|Sort-Object LastWriteTimeUtc,Name)
$snapshots=@($files|ForEach-Object{[ordered]@{name=$_.BaseName;path=".local-research/runtime/profile-20261102/Saves/$($_.Name)";save=(& (Join-Path $PSScriptRoot 'read-medicine-runtime-save.ps1') -SavePath $_.FullName|ConvertFrom-Json)}})
$names=@($snapshots.name)
if('medicine-final-paused-b' -notin $names){throw 'Final paused evidence is required before collection.'}
$pairs=@($names|Where-Object {$_ -like 'medicine-*-a'}|ForEach-Object{[ordered]@{a=$_;b=($_ -replace '-a$','-b')}})
$actions=@(Get-ChildItem -LiteralPath $runtime -Filter 'medicine-*.png.actions.jsonl'|ForEach-Object{$ledger=$_.Name;Get-Content -LiteralPath $_.FullName|ForEach-Object{[ordered]@{kind='completed-guarded-ui-input';source_ledger=".local-research/runtime/$ledger";data=($_|ConvertFrom-Json -DateKind String)}}}|Sort-Object {$_.data.started_utc})
$actionPath=Join-Path $dir 'native-medicine-actions.jsonl'
[IO.File]::WriteAllText($actionPath,(($actions|ForEach-Object{ConvertTo-Json $_ -Depth 12 -Compress}) -join "`n")+"`n",$utf8)
Add-Type -AssemblyName System.Drawing
$specs=@(
 @('care-policy','medicine-012-policy-hover.png',0,775,650,450,'Ordinary care-policy menu; subsequent action selects Herbal medicine or worse.'),
 @('prepared-cut','medicine-028-cut-added.png',0,775,635,450,'Developer-added Torso Cut; preparation, not a naturally acquired injury.'),
 @('tend-order','medicine-030-patient-orders.png',1100,350,450,170,'Ordinary Prioritize tending to Prophet option available to Grump.'),
 @('bedside','medicine-033-bedside-run.png',1000,250,350,400,'Bedside scene; save records separately identify carried herbal medicine and active tending toil.'),
 @('cut-quality','medicine-038-cut-quality.png',0,775,635,450,'Original UI Cut0.5, Bandaged quality33%; raw tendQuality .334181815.'),
 @('doctor-quality','medicine-048-tend-stats.png',805,340,950,760,'Original Medical tend quality57%: Medical4 x60%,Manipulation95%,Sight100%.'),
 @('doctor-speed','medicine-049-doctor-tend-speed.png',805,340,950,760,'Original Medical tend speed61%; distinct from the random quality of a completed tend.'),
 @('prepared-infection','medicine-044-infection-added.png',0,775,635,450,'Developer-added Infection on Torso; not a natural infection probability sample.'),
 @('infection-first','medicine-055-infection-first-tooltip.png',0,775,760,610,'Original infection tooltip after the first ordinary herbal tend.'),
 @('patient-immunity-speed','medicine-059-immunity-stat.png',805,340,950,760,'Original immunity speed82%: starving70%,in bed107%,resting110%,other displayed factors100%.'),
 @('before-retend','medicine-061-before-retend-tooltip.png',0,775,760,610,'Before repeat tending: existing quality and expiry remain separate from next-tend eligibility.'),
 @('retend-too-early','medicine-063-too-early-menu.png',1100,350,450,170,'At tick177073 the ordinary right-click menu lacks Prioritize tending; saved remaining duration7993.'),
 @('retend-available','medicine-066-retend-available-menu.png',1100,350,450,170,'At tick177692 the ordinary right-click menu offers Prioritize tending; saved remaining duration7374.'),
 @('retend-result','medicine-071-retend-tooltip.png',0,775,760,610,'After repeat tending: Infection34%,quality31%,immunity34.9%,next tend14h,expiry17h. Display is rounded.'),
 @('care-restored','medicine-073-care-restored.png',0,775,635,450,'Original Best medical-care icon restored at final tick179408; raw medCare field provides exact identity.'),
 @('final-paused','medicine-final-paused-b-return.png',2250,1080,310,330,'Final paused map after canonical save; pair equality independently checks the retained state.')
)
$screenshots=@(foreach($row in $specs){
 $source=Join-Path $runtime $row[1];$relative="runtime/medicine-$($row[0]).png";$destination=Join-Path $dir $relative
 $bmp=[Drawing.Bitmap]::new($source)
 try{$crop=$bmp.Clone([Drawing.Rectangle]::new($row[2],$row[3],$row[4],$row[5]),$bmp.PixelFormat);try{$crop.Save($destination,[Drawing.Imaging.ImageFormat]::Png)}finally{$crop.Dispose()}}finally{$bmp.Dispose()}
 $meta=Get-Content -LiteralPath ($source+'.jsonl')|Select-Object -Last 1|ConvertFrom-Json -DateKind String
 [ordered]@{id=$row[0];image=$relative;sha256=(Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant();source_file=".local-research/runtime/$($row[1])";source_sha256=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant();source_size=@(2560,1440);crop_xywh=@($row[2],$row[3],$row[4],$row[5]);observed_utc=$meta.timestamp_utc;observation=$row[6]}
})
$sources=@('read-medicine-runtime-save.ps1','medicine-runtime-input.ps1','save-medicine-runtime.ps1','save-medicine-runtime-pair.ps1','open-medicine-runtime-tool.ps1','native-window.ps1')|ForEach-Object{[ordered]@{file="scripts/research/$_";sha256=(Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $_) -Algorithm SHA256).Hash.ToLowerInvariant();kind='current repository research helper; not original game code'}}
$final=($snapshots|Where-Object name -eq 'medicine-final-paused-b').save
$runSpecs=@(
 @('medicine-032-fetch-run.png','medicine-herbal-ordered-b','medicine-herbal-carry-b'),
 @('medicine-033-bedside-run.png','medicine-herbal-carry-b','medicine-herbal-bedside-b'),
 @('medicine-034-tending-run.png','medicine-herbal-bedside-b','medicine-herbal-tending-b'),
 @('medicine-053-infection-tend-run.png','medicine-infection-ordered','medicine-infection-first-tend-b')
)
for($i=1;$i -le 20;$i++){
 $index=$i.ToString('00');$before=if($i -eq 1){'medicine-infection-first-tend-b'}else{'medicine-infection-progress-'+($i-1).ToString('00')+'-b'}
 $runSpecs+=,@("medicine-progress-$index-run.png",$before,"medicine-infection-progress-$index-b")
}
$runSpecs+=,@('medicine-065-retend-eligibility-run.png','medicine-infection-progress-20-b','medicine-infection-retend-eligible-b')
$runSpecs+=,@('medicine-068-retend-work-run.png','medicine-infection-retend-ordered','medicine-infection-retend-working-b')
$runSpecs+=,@('medicine-069-retend-complete-run.png','medicine-infection-retend-working-b','medicine-infection-retend-done-b')
$runWindows=@(foreach($spec in $runSpecs){
 $before=($snapshots|Where-Object name -eq $spec[1]).save;$after=($snapshots|Where-Object name -eq $spec[2]).save
 if(!$before -or !$after){throw "Missing run boundary: $($spec -join ',')"}
 [ordered]@{action_image=$spec[0];before_save=$spec[1];after_save=$spec[2];before_tick=$before.tick;after_tick=$after.tick;advanced_ticks=($after.tick-$before.tick)}
})
$r=[ordered]@{
 schema_version=1;evidence_id='RW17-NATIVE-MEDICINE-RUNTIME';version_text='1.7.4980 rev60';assembly_sha256='eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3';process_id=29920;window_handle=988850;executable='F:\SteamLibrary\steamapps\common\RimWorld\RimWorld.exe';profile='.local-research/runtime/profile-20261102';active_mods=@('ludeon.rimworld','ludeon.rimworld.odyssey')
 method='REA skill v42 evidence discipline; same isolated Windows process with guarded foreground UI input. Not REA native UI provider execution. Original XML and manual screenshot reading; no OCR or injected game code.';provider_boundary_reference='native-plants-runtime.json';baseline_reference='native-ranged-runtime.json';body_identity_reference='anatomy-human.json';sources=@($sources);snapshots=$snapshots;screenshots=$screenshots
 preparation=[ordered]@{patient='Human958';doctor='Human965';bed='Bed77946';ordinary_care_policy='HerbalOrWorse';developer_mode=$true;god_mode=$false;dev_spawn_herbal_units=4;dev_added_cut=[ordered]@{id=148;severity=.5;part_index=0;tick=144413};dev_added_infection=[ordered]@{id=151;part_index=0;tick=146173};new_bed_created=$false;skills_modified=$false;work_priorities_modified=$false;save_xml_modified=$false;immunity_modified=$false;disease_severity_modified_after_creation=$false;tend_countdown_modified=$false;dev_healing=$false;normal_profile_touched=$false;reloads=0}
 ui=[ordered]@{source='Manually read original screenshot text; rounded display values remain separate from saved numeric fields.';doctor=[ordered]@{medicine_skill=4;passion='Minor';tend_quality_percent=57;tend_speed_percent=61;skill_quality_factor_percent=60;manipulation_percent=95;sight_percent=100};patient=[ordered]@{immunity_gain_speed_percent=82;starving_factor_percent=70;in_bed_factor_percent=107;resting_factor_percent=110;rested_factor_percent=100;blood_filtration_percent=100;age=34};bed=[ordered]@{def='Bed';stuff='WoodLog';quality='Normal';medical=$true};cut_tend_quality_percent=33}
 clock=[ordered]@{entry_tick=144413;final_tick=$final.tick;total_advanced_ticks=($final.tick-144413);equal_pause_pairs=$pairs;bounded_runs=@($actions|Where-Object {$_.data.action -eq 'pulse'}|ForEach-Object{$_.data});run_windows=$runWindows;last_input_finished_utc=$actions[-1].data.finished_utc;note='Every completed bounded run is linked to before/after saves and followed by equal-state double saves. Wall-clock pulse durations include input overhead; saved ticks remain authoritative.'}
 actions=[ordered]@{file='native-medicine-actions.jsonl';sha256=(Get-FileHash -LiteralPath $actionPath -Algorithm SHA256).Hash.ToLowerInvariant();count=$actions.Count;complete_attempt_coverage=$false;note='Completed guarded actions only. Four early focus guard failures are described separately; one failed after dispatch of its first menu click and has no complete action ledger.'}
 guard_failures=@([ordered]@{phase='first medicine-entry-a attempt';stage='before input';message='Target is not foreground; no input sent.'},[ordered]@{phase='first medicine-entry-b attempt';stage='after first menu click';message='Focus changed after input.';retained_action_record=$false},[ordered]@{phase='first medicine-015 spawn attempt';stage='before input';message='Target is not foreground; no input sent.'},[ordered]@{phase='first medicine-034 pulse attempt';stage='before input';message='Target is not foreground; no input sent.'})
 detours=@('Escape closed the selected panel but did not clear the Spawn thing target; a subsequent intended panel click spawned the fourth herbal unit away from the main stack. Right-click then cleared the tool.','Medicine helper gained IsIconic/ShowWindow restore for the same authorized process after early focus rejections; foreground checks remained in place. sources hashes describe the final repository helper.','Patient inherited hunger, old injuries and medical-bed state. Doctor retained a Neck scar. No ideal-health or same-condition medicine comparison was prepared.')
 limitations=@('One prepared wound and one developer-added infection on one patient. Does not estimate natural infection probability or treatment quality distributions.','Medicine selection policy and tending were ordinary UI actions. Spawned herbal medicine does not establish farming or crafting.','Patient was already injured and starving; immunity speed82% is this observed state, not a universal human value.','Single infection instance only; a shared hediffDef immunity record is observed, but multiple same-def body-part infections were not tested.','Raw saves and full screenshots are local ignored files. Portable verification checks retained identities and field consistency; local mode rereads originals. Neither performs combat/medical replay or OCR.','One focus failure occurred after an attempted click and lacks a completed action record. Subsequent equal-tick entry saves confirm no simulation advancement, not exact reconstruction of that click.')
 outcomes=[ordered]@{ordinary_wound_tends=1;ordinary_infection_tends=2;herbal_units_consumed=3;herbal_units_remaining=1;infection_load_id=151;retend_observed_unavailable_at=7993;retend_observed_available_at=7374;retend_added_duration=37500;full_recovery_observed=$false}
 final_state=[ordered]@{canonical_save='medicine-final-paused-b.rws';canonical_sha256=$final.sha256;patient_care_restored='Best';tick=$final.tick;paused=$true;equal_double_save=$true;input_released=$true;game_files_modified=$false;normal_profile_touched=$false}
}
[IO.File]::WriteAllText((Join-Path $dir 'native-medicine-runtime.json'),(ConvertTo-Json $r -Depth 45).Replace("`r`n","`n")+"`n",$utf8)
"Collected $($snapshots.Count) saves, $($screenshots.Count) crops, $($actions.Count) completed actions."
