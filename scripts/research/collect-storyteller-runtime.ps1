# Offline only. Rebuilds retained evidence from original saves and UI capture ledgers.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$runtime=Join-Path $root '.local-research/runtime'
$dir=Join-Path $root 'docs/research/rimworld/evidence'
$utf8=[Text.UTF8Encoding]::new($false)
$files=@(Get-Item (Join-Path $runtime 'profile-20261102/Saves/medicine-final-paused-b.rws'))+@(Get-ChildItem (Join-Path $runtime 'profile-20261102/Saves') -Filter 'storyteller-*.rws'|Sort-Object LastWriteTimeUtc,Name)
$snapshots=@($files|ForEach-Object{[ordered]@{name=$_.BaseName;path=".local-research/runtime/profile-20261102/Saves/$($_.Name)";save=(& (Join-Path $PSScriptRoot 'read-storyteller-runtime-save.ps1') -SavePath $_.FullName|ConvertFrom-Json)}})
$names=@($snapshots.name)
if('storyteller-final-paused-b' -notin $names){throw 'Final paused original save is required.'}
$pairs=@($names|Where-Object {$_ -like 'storyteller-*-a'}|ForEach-Object{[ordered]@{a=$_;b=($_ -replace '-a$','-b')}})
$actions=@(Get-ChildItem -LiteralPath $runtime -Filter 'storyteller-*.png.actions.jsonl'|ForEach-Object{$ledger=$_.Name;Get-Content -LiteralPath $_.FullName|ForEach-Object{[ordered]@{kind='completed-guarded-ui-input';source_ledger=".local-research/runtime/$ledger";data=($_|ConvertFrom-Json -DateKind String)}}}|Sort-Object {$_.data.started_utc})
$actionPath=Join-Path $dir 'native-storyteller-actions.jsonl'
[IO.File]::WriteAllText($actionPath,(($actions|ForEach-Object{ConvertTo-Json $_ -Depth 12 -Compress}) -join "`n")+"`n",$utf8)
Add-Type -AssemblyName System.Drawing
$specs=@(
 @('baseline-wealth','storyteller-004-statistics-panel.png',0,795,650,315,'Statistics after History open force-recount: total16739/items11933/buildings3196/pawns1610. F0 display.'),
 @('spawn-wealth','storyteller-017-silver-wealth.png',0,795,650,315,'Same tick after spawning500 silver:17239/12433/3196/1610. F0 display.'),
 @('forbidden-wealth','storyteller-022-forbidden-wealth.png',0,795,650,315,'Same tick after ordinary forbid toggle:17239/12433/3196/1610. F0 display.'),
 @('carry-wealth','storyteller-044-carry-wealth.png',0,795,650,315,'Paused while silver500 is in Squint carryTracker:17239/12433/3196/1610. F0 display.'),
 @('stored-wealth','storyteller-048-stored-wealth.png',0,795,650,315,'After ordinary stockpile delivery:17239/12433/3196/1610. F0 display.'),
 @('silver-selected','storyteller-015-silver-selected.png',0,1235,530,170,'Selected newly spawned Silver x500. Developer preparation, not earned income.'),
 @('silver-forbidden','storyteller-020-silver-forbidden.png',0,1235,530,170,'Ordinary F key toggles forbid for this silver stack; raw field checked separately.'),
 @('no-storage','storyteller-027-silver-orders.png',1080,350,500,170,'Ordinary haul menu first reports no accessible configured storage.'),
 @('grump-incapable','storyteller-036-haul-order-menu.png',1080,350,500,170,'After adding a stockpile, Grump reports Will never do hauling.'),
 @('squint-order','storyteller-039-squint-haul-menu.png',1080,350,500,170,'Squint offers ordinary Prioritize hauling silver x500.'),
 @('carry-scene','storyteller-042-haul-pickup-run.png',1000,300,400,300,'Native scene after pickup; saved ownership independently identifies the carried stack.'),
 @('settings','storyteller-053-storyteller-settings.png',930,520,310,325,'Cassandra Classic and selected Strive to survive, viewed without changing either setting.'),
 @('final-paused','storyteller-062-final-return.png',2250,1080,310,330,'Final map after successful retry save, visibly paused; extracted final pair equality checked separately.')
)
$screenshots=@(foreach($row in $specs){
 $source=Join-Path $runtime $row[1];$relative="runtime/storyteller-$($row[0]).png";$destination=Join-Path $dir $relative
 $bmp=[Drawing.Bitmap]::new($source)
 try{$crop=$bmp.Clone([Drawing.Rectangle]::new($row[2],$row[3],$row[4],$row[5]),$bmp.PixelFormat);try{$crop.Save($destination,[Drawing.Imaging.ImageFormat]::Png)}finally{$crop.Dispose()}}finally{$bmp.Dispose()}
 $meta=Get-Content -LiteralPath ($source+'.jsonl')|Select-Object -Last 1|ConvertFrom-Json -DateKind String
 [ordered]@{id=$row[0];image=$relative;sha256=(Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant();source_file=".local-research/runtime/$($row[1])";source_sha256=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant();source_size=@(2560,1440);crop_xywh=@($row[2],$row[3],$row[4],$row[5]);observed_utc=$meta.timestamp_utc;observation=$row[6]}
})
$sources=@('read-storyteller-runtime-save.ps1','read-medicine-runtime-save.ps1','storyteller-runtime-input.ps1','save-storyteller-runtime.ps1','save-storyteller-runtime-pair.ps1','open-storyteller-runtime-tool.ps1','native-window.ps1','collect-storyteller-runtime.ps1')|ForEach-Object{[ordered]@{file="scripts/research/$_";sha256=(Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $_) -Algorithm SHA256).Hash.ToLowerInvariant();kind='current repository research helper, not original game code; open-storyteller-runtime-tool.ps1 was prepared but not invoked'}}
$final=($snapshots|Where-Object name -eq 'storyteller-final-paused-b').save
$runSpecs=@(
 @('storyteller-041-haul-first-run.png','storyteller-haul-ordered-b','storyteller-haul-first-b'),
 @('storyteller-042-haul-pickup-run.png','storyteller-haul-first-b','storyteller-haul-pickup-b'),
 @('storyteller-046-haul-finish-run.png','storyteller-haul-pickup-b','storyteller-haul-finish-b')
)
$runWindows=@(foreach($spec in $runSpecs){
 $before=($snapshots|Where-Object name -eq $spec[1]).save;$after=($snapshots|Where-Object name -eq $spec[2]).save
 if(!$before -or !$after){throw 'Missing run boundary.'}
 [ordered]@{action_image=$spec[0];before_save=$spec[1];after_save=$spec[2];before_tick=$before.tick;after_tick=$after.tick;advanced_ticks=($after.tick-$before.tick)}
})
$observations=@(
 @('baseline-wealth','storyteller-entry-b',16739,11933,3196,1610),
 @('spawn-wealth','storyteller-silver-spawned-b',17239,12433,3196,1610),
 @('forbidden-wealth','storyteller-silver-forbidden-b',17239,12433,3196,1610),
 @('carry-wealth','storyteller-haul-pickup-b',17239,12433,3196,1610),
 @('stored-wealth','storyteller-haul-finish-b',17239,12433,3196,1610)
)|ForEach-Object{[ordered]@{screenshot=$_[0];paired_save=$_[1];total=$_[2];items=$_[3];buildings=$_[4];pawns=$_[5]}}
$r=[ordered]@{
 schema_version=1;evidence_id='RW17-NATIVE-STORYTELLER-RUNTIME';version_text='1.7.4980 rev60';assembly_sha256='eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3';process_id=29920;window_handle=988850;executable='F:\SteamLibrary\steamapps\common\RimWorld\RimWorld.exe';profile='.local-research/runtime/profile-20261102';active_mods=@('ludeon.rimworld','ludeon.rimworld.odyssey')
 method='REA skill v42 evidence discipline; existing isolated Windows process with guarded foreground UI input. Not REA native UI provider execution. Original XML, decoded historical float bytes and manually read screenshots; no OCR or injected game code.';provider_boundary_reference='native-plants-runtime.json';baseline_reference='native-medicine-runtime.json';sources=@($sources);snapshots=$snapshots;screenshots=$screenshots
 preparation=[ordered]@{developer_mode=$true;god_mode=$false;dev_spawn_silver_units=500;new_silver_id='Silver78580';ordinary_stockpile_id=3;ordinary_stockpile_label='Stockpile zone 2';ordinary_stockpile_cell='(116, 0, 123)';hauler='Human961';skills_modified=$false;work_priorities_modified=$false;health_modified=$false;save_xml_modified=$false;storyteller_changed=$false;difficulty_changed=$false;normal_profile_touched=$false;reloads=0}
 ui=[ordered]@{source='Manual original screenshot reading. Statistics wealth uses F0 display; observations are not raw cached float values. History is reopened to force recount.';storyteller='Cassandra Classic';difficulty='Strive to survive';wealth_observations=@($observations);major_threats=0;enemy_raids=0;colonists_killed=0;damage_taken=45.04674}
 history=[ordered]@{source='Original serialized float32 records and recordsDeflate, decoded offline with raw XML retained. Historical samples are separate from current Statistics values.';crossed_sample_tick=180000;wealth_frequency_ticks=30000;adaptation_frequency_ticks=60000;threat_points_record_scale=.1;live_debug_threat_points_invoked=$false;note='No fresh ThreatPoints log was requested. The saved ThreatPoints series uses points divided by ten; it does not establish an actual raid spawn or its threat budget.'}
 clock=[ordered]@{entry_tick=179408;final_tick=$final.tick;total_advanced_ticks=($final.tick-179408);equal_pause_pairs=$pairs;bounded_runs=@($actions|Where-Object {$_.data.action -eq 'pulse'}|ForEach-Object{$_.data});run_windows=$runWindows;last_input_finished_utc=$actions[-1].data.finished_utc;note='All three completed bounded runs have before/after save links and equal paused pairs. Simulation ticks, not wall duration, measure progression.'}
 actions=[ordered]@{file='native-storyteller-actions.jsonl';sha256=(Get-FileHash -LiteralPath $actionPath -Algorithm SHA256).Hash.ToLowerInvariant();count=$actions.Count;complete_attempt_coverage=$true;note='All dispatched actions retained, including the failed first final-b save attempt. Completed input does not prove that the intended UI transition occurred.'}
 guard_failures=@()
 workflow_failures=@([ordered]@{phase='first storyteller-final-paused-b save attempt';message='Expected original-game save was not written; inspect UI screenshots.';observed='Save menu click did not open the dialog; subsequent typing affected map camera. No save was written on this attempt.';first_capture='storyteller-final-paused-b-menu.png';last_capture='storyteller-final-paused-b-saved.png';recovery='Stepwise inspected actions057-062 wrote final-b without overwriting earlier captures. Final extracted state equals final-a and haul-finish-b at180004.'})
 detours=@('Capture002 is Factions despite its history filename; actual History begins003.','Haul order initially lacked accessible configured storage. One ordinary stockpile cell was added. Grump then reported Will never do hauling; Squint was selected without editing capabilities or work priorities.','Final-b save workflow initially failed. Camera movement is visible in its capture, and all five input records remain in the ledger. No blanket claim is made that every action reached its intended UI state.')
 limitations=@('Only one500-silver stack and one ordinary haul. Wealth UI is rounded and cannot exclude sub-unit changes.','Developer silver creation is controlled preparation, not evidence of natural earnings, mining, trade or crafting.','No new raid experiment, random event frequency estimate, difficulty comparison, building wealth weighting comparison or whole wealth reconstruction.','Original current wealth cache is not serialized here. Decoded history values are sampled data and must not be silently substituted for current wealth.','Medical conditions, needs and normal jobs naturally advanced during596 ticks; no claim that all world state stayed unchanged.','Portable checks validate retained evidence consistency, not OCR or native replay. Local mode rereads originals and capture metadata.')
 outcomes=[ordered]@{silver_before=800;silver_after=1300;spawn_display_delta_total=500;spawn_display_delta_items=500;forbidden_display_delta=0;carry_display_delta=0;stored_display_delta=0;ground_carry_ground_same_id=$true;historical_wealth_samples_added=1;raids_triggered_for_experiment=0}
 final_state=[ordered]@{canonical_save='storyteller-final-paused-b.rws';canonical_sha256=$final.sha256;tick=$final.tick;paused=$true;equal_double_save=$true;input_released=$true;storyteller_def='Cassandra';difficulty_def='Rough';patient_care='Best';patient_bed='Bed77946';silver_stack_count=500;silver_pos='(116, 0, 123)';game_files_modified=$false;normal_profile_touched=$false}
}
[IO.File]::WriteAllText((Join-Path $dir 'native-storyteller-runtime.json'),(ConvertTo-Json $r -Depth 45).Replace("`r`n","`n")+"`n",$utf8)
"Collected $($snapshots.Count) saves, $($screenshots.Count) crops, $($actions.Count) completed actions."
