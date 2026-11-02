# Rebuild evidence from existing saves and captures only. No original-game input.
$ErrorActionPreference='Stop'
$project=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$runtime=Join-Path $project '.local-research/runtime'
$dir=Join-Path $project 'docs/research/rimworld/evidence'
$utf8=[Text.UTF8Encoding]::new($false)
$reader=Join-Path $PSScriptRoot 'read-stonecutting-runtime-save.ps1'
$snapshots=@(foreach($name in @('start','ready','working','final')){$rel=".local-research/runtime/profile-20261102/Saves/stonecutting-$name.rws";[ordered]@{stage=$name;path=$rel;save=(& $reader -SavePath (Join-Path $project $rel)|ConvertFrom-Json)}})
Add-Type -AssemblyName System.Drawing
$specs=@(
 @('needs-prepared','stonecutting-010-rest-plus-3.png',0,520,620,650,'Developer Need + controls prepared Squint Food and Rest; ready save confirms both 1.'),
 @('outdoor-table','stonecutting-017-select-table.png',0,1100,700,310,'Wooden stonecutter table; Work speed factor 80% (outdoors).'),
 @('bill-one','stonecutting-020-granite-bill.png',0,530,900,880,'Make granite blocks bill, Do 1 time.'),
 @('craft-disabled','stonecutting-031-work-menu.png',1580,1130,720,200,'Cannot cut stone blocks: Not assigned to crafting.'),
 @('prioritize','stonecutting-036-prioritize-menu.png',1580,1130,720,200,'After enabling Craft, Prioritize cutting stone blocks is available.'),
 @('working-paused','stonecutting-039-pause-working.png',0,1100,2560,340,'Squint: Cutting stone blocks from chunk; game paused before saving working.'),
 @('bill-complete','stonecutting-041-pause-final.png',0,0,650,100,'Native message: Bill complete: Make granite blocks.'),
 @('output20-paused','stonecutting-042-final-blocks.png',0,1100,2560,340,'Granite blocks x20 selected; original game remains paused.')
)
$shots=@()
foreach($row in $specs){
 $source=Join-Path $runtime $row[1];$relative="runtime/stonecutting-$($row[0]).png";$destination=Join-Path $dir $relative
 $bmp=[Drawing.Bitmap]::new($source)
 try{$crop=$bmp.Clone([Drawing.Rectangle]::new($row[2],$row[3],$row[4],$row[5]),$bmp.PixelFormat);try{$crop.Save($destination,[Drawing.Imaging.ImageFormat]::Png)}finally{$crop.Dispose()}}finally{$bmp.Dispose()}
 $capture=Get-Content -LiteralPath ($source+'.jsonl')|Select-Object -Last 1|ConvertFrom-Json
 $shots += [ordered]@{id=$row[0];image=$relative;sha256=(Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant();source_file=".local-research/runtime/$($row[1])";source_sha256=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant();source_size=@(2560,1440);crop_xywh=@($row[2],$row[3],$row[4],$row[5]);observed_utc=$capture.timestamp_utc;observation=$row[6]}
}
$actions=@(Get-ChildItem -LiteralPath $runtime -Filter 'stonecutting-*.png.actions.jsonl'|ForEach-Object{Get-Content -LiteralPath $_.FullName|ForEach-Object{[ordered]@{kind='guarded-ui-input';data=($_|ConvertFrom-Json)}}}|Sort-Object {$_.data.started_utc})
$actionPath=Join-Path $dir 'native-stonecutting-actions.jsonl'
[IO.File]::WriteAllText($actionPath,(($actions|ForEach-Object{ConvertTo-Json $_ -Depth 10 -Compress}) -join "`n")+"`n",$utf8)
$working=($snapshots|Where-Object stage -eq 'working').save
$final=($snapshots|Where-Object stage -eq 'final').save
$output=@($final.explicit_granite_things|Where-Object def -eq 'BlocksGranite')
$input=@($working.explicit_granite_things|Where-Object def -eq 'ChunkGranite')
$backup=Join-Path $runtime 'stonecutting-before-20261102.rws'
$record=[ordered]@{
 schema_version=1;evidence_id='RW17-NATIVE-STONECUTTING-RUNTIME';version_text='1.7.4980 rev60';assembly_sha256='eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3';process_id=29920;executable='F:/SteamLibrary/steamapps/common/RimWorld/RimWorld.exe';profile='.local-research/runtime/profile-20261102';active_mods=@('ludeon.rimworld','ludeon.rimworld.odyssey')
 method='Existing isolated native process, foreground UI, developer needs/table/material preparation, ordinary pawn DoBill job, game-clock pause/save/resume, read-only original-save extraction.'
 backup=@{path='.local-research/runtime/stonecutting-before-20261102.rws';sha256=(Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash.ToLowerInvariant();source='logistics-final.rws'}
 snapshots=$snapshots;experiment_input_id='ChunkGranite42145';experiment_output_id='BlocksGranite42147';observed_input_count=$input[0].count;observed_output_count=$output[0].count;observed_table_outdoor_speed_factor=0.8
 outcomes=@{normal_pawn_cutting_observed=($working.pawn.job -eq 'DoBill');input_one_output_twenty_observed=($input[0].count -eq 1 -and $output[0].count -eq 20);clock_pause_save_resume_completed=$true;reload_continuation_tested=$false;bill_suspension_tested=$false;mining_chunk_drop_tested=$false;normal_table_construction_tested=$false;automatic_work_selection_tested=$false;stockpile_delivery_demonstrated=$false}
 screenshots=$shots;actions=@{file='native-stonecutting-actions.jsonl';sha256=(Get-FileHash -LiteralPath $actionPath -Algorithm SHA256).Hash.ToLowerInvariant();count=$actions.Count}
 chronology=@('19:30:10 UTC begin from paused logistics-final state, tick46372; make backup and save stonecutting-start','Developer Needs + sets Squint Food/Rest to1; God-build wooden stonecutter table; add Make granite blocks repeat1; developer-spawn ChunkGranite','Save stonecutting-ready at tick46372; right-click rejects because Craft is disabled','Enable Craft; ordinary Prioritize cutting stone blocks command accepted','Run at speed3 briefly, explicitly pause; stonecutting-working tick47518 records DoBill workLeft1195.07764, ingredient ChunkGranite42145 count1','Resume same game clock for bounded run, explicitly pause; native Bill complete notification','stonecutting-final tick50881 records BlocksGranite42147 count20, spawnedTick49485; no bill repeat remaining','19:52:11 UTC select Granite blocks x20 for final paused screenshot; end UI experiment')
 limitations=@('Core + Odyssey, developer mode and God mode active. Food/Rest were raised with developer controls; table was God-built and input chunk was developer-spawned.','Actual processing used ordinary pawn DoBill, player-forced via right-click, not autonomous work selection. No developer finish-work or time-increment command was used.','The ready save has compressedThingMapDeflate; its explicit granite list is empty. This extractor does not decode that structure and does not claim the input was absent. The working save explicitly names the ingredient and count.','Squint retains WakeUpAddiction and Malnutrition. Outdoors reduces table speed to80%; exact work duration is not a universal recipe constant.','Only the game clock was paused and saved before continuing. No load-from-save, bill suspension, bill cancellation, or restarted-job progress retention test was performed.','Four snapshot tick values bracket preparation and operation; intermediate completion tick is the output spawnedTick, not a precisely sampled animation frame.','The completed blocks remain at the work position. No granite stockpile delivery or ordinary mining/table construction was demonstrated.','Portable checks validate recorded summaries, action integrity and crops; local mode rereads originals. Neither mode reruns gameplay.')
 final_state=@{paused=$true;developer_mode=$true;god_mode=$true;normal_profile_touched=$false;game_files_modified=$false;mods_installed=$false}
}
[IO.File]::WriteAllText((Join-Path $dir 'native-stonecutting-runtime.json'),(ConvertTo-Json $record -Depth 24)+"`n",$utf8)
"Collected $($snapshots.Count) save snapshots, $($shots.Count) crops, $($actions.Count) UI records; input $($input[0].count), output $($output[0].count)."
