# Rebuild only research outputs from existing captures and saves; no game input.
$ErrorActionPreference='Stop'
$project=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$runtime=Join-Path $project '.local-research/runtime'
$dir=Join-Path $project 'docs/research/rimworld/evidence'
$utf8=[Text.UTF8Encoding]::new($false)
$reader=Join-Path $PSScriptRoot 'read-logistics-runtime-save.ps1'
$before=& $reader -SavePath (Join-Path $runtime 'logistics-before-20261102-185110.rws')|ConvertFrom-Json
$after=& $reader|ConvertFrom-Json
Add-Type -AssemblyName System.Drawing
$specs=@(
 @('one-cell','logistics-008-select-zone.png',0,1100,2560,340,'Stockpile zone 1; Size: 1'),
 @('filter','logistics-013-allow-wood.png',0,720,450,700,'Clear all, then enable Wood only'),
 @('spawn75','logistics-027-full-stack.png',0,1100,2560,340,'Developer-spawned full wood stack x75; outside storage'),
 @('haul-menu','logistics-029-wood-haul-menu.png',1370,1110,340,140,'Squint: Prioritize hauling wood x75'),
 @('stored71','logistics-033-zone-full.png',0,1100,2560,340,'Wood x71 at the designated storage cell after ordinary pawn hauling'),
 @('reject','logistics-035-full-reject-menu.png',1490,1110,350,160,'Cannot haul wood x75: No empty, accessible spot configured to store it'),
 @('after-attempt','logistics-045-expanded-menu.png',1490,1110,350,160,'Same rejection after unsuccessful zone expansion attempt')
)
$shots=@()
foreach($row in $specs){
 $source=Join-Path $runtime $row[1];$relative="runtime/logistics-$($row[0]).png";$destination=Join-Path $dir $relative
 $bmp=[Drawing.Bitmap]::new($source)
 try{$crop=$bmp.Clone([Drawing.Rectangle]::new($row[2],$row[3],$row[4],$row[5]),$bmp.PixelFormat);try{$crop.Save($destination,[Drawing.Imaging.ImageFormat]::Png)}finally{$crop.Dispose()}}finally{$bmp.Dispose()}
 $capture=Get-Content -LiteralPath ($source+'.jsonl')|Select-Object -Last 1|ConvertFrom-Json
 $shots += [ordered]@{id=$row[0];image=$relative;sha256=(Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant();source_file=".local-research/runtime/$($row[1])";source_sha256=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant();source_size=@(2560,1440);crop_xywh=@($row[2],$row[3],$row[4],$row[5]);observed_utc=$capture.timestamp_utc;observation=$row[6]}
}
$actions=@(Get-ChildItem -LiteralPath $runtime -Filter 'logistics-*.png.actions.jsonl'|ForEach-Object{Get-Content -LiteralPath $_.FullName|ForEach-Object{[ordered]@{kind='guarded-ui-input';data=($_|ConvertFrom-Json)}}})
$actions+=@{kind='native-window-drag';data=(Get-Content -LiteralPath (Join-Path $runtime 'logistics-042-expand-one-cell.png.jsonl')|Select-Object -Last 1|ConvertFrom-Json)}
$actions=@($actions|Sort-Object {if($_.data.started_utc){$_.data.started_utc}else{$_.data.timestamp_utc}})
$actionPath=Join-Path $dir 'native-logistics-actions.jsonl'
[IO.File]::WriteAllText($actionPath,(($actions|ForEach-Object{ConvertTo-Json $_ -Depth 10 -Compress}) -join "`n")+"`n",$utf8)
$record=[ordered]@{
 schema_version=1;evidence_id='RW17-NATIVE-LOGISTICS-RUNTIME';version_text='1.7.4980 rev60';assembly_sha256='eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3';process_id=29920;profile='.local-research/runtime/profile-20261102';active_mods=@('ludeon.rimworld','ludeon.rimworld.odyssey')
 method='Existing isolated native process, foreground mouse/keyboard UI, developer material preparation, explicit ordinary pawn prioritize-hauling order, read-only original save extraction'
 before_path='.local-research/runtime/logistics-before-20261102-185110.rws';after_path='.local-research/runtime/profile-20261102/Saves/logistics-final.rws';before=$before;after=$after;delta_ticks=$after.tick-$before.tick
 experiment_wood_ids=@('WoodLog42138','WoodLog42139','WoodLog42142');spawned_total=150;final_experiment_total=(@($after.wood|Where-Object{$_.id -in @('WoodLog42138','WoodLog42139','WoodLog42142')}|Measure-Object -Property count -Sum).Sum)
 outcomes=@{developer_full_stack75_observed=$true;normal_pawn_haul_observed=$true;stored_count=71;source_remainder=4;other_stack_count=75;partial_stack_merge_demonstrated=$false;full75_rejection_demonstrated=$false;generic_no_storage_rejection_observed=$true;expansion_succeeded=$false;hauling_after_expansion_demonstrated=$false;rejection_cause_isolated=$false}
 screenshots=$shots;actions=@{file='native-logistics-actions.jsonl';sha256=(Get-FileHash -LiteralPath $actionPath -Algorithm SHA256).Hash.ToLowerInvariant();count=$actions.Count}
 chronology=@('18:51:15 UTC initial paused screenshot; backup prior preservation-frozen-1 save','Create one normal outdoor stockpile cell; allow Wood only','Initial order on existing wood did not establish a successful haul; one bounded time run','Developer Spawn full thing stack used twice, each WoodLog75, placed outside the stockpile after camera shifted','Squint context menu Prioritize hauling wood x75 selected; ordinary simulation advances','71 wood appears in storage, 4 remains at source, second75 remains outside','Other75 context menu rejects hauling; sleeping Squint occupies/reserves storage cell','One expansion drag attempted; final XML still has one cell, so expansion failed','19:04:11 UTC final save returns to paused map; no further UI experiment')
 limitations=@('Core + Odyssey, developer mode and God mode were already enabled from prior isolated research.','The materials were developer-spawned; their production/acquisition was not demonstrated. Storage hauling itself used an ordinary pawn job.','Observed71 is not a full75 stack. The rejection does not prove the stack-limit boundary.','Squint is sleeping on the storage cell and reserves it; this is recorded state, not an isolated causal explanation.','Partial-stack merging, filling the last4, successful expansion and resumed hauling were not demonstrated.','The expansion attempt failed: final XML still contains exactly one stockpile cell.','No intermediate save was captured before hauling; before backup lacks the newly spawned materials. UI action trail and final three-stack150 conservation are complementary evidence.','Initial auto-closing context menus and a camera shift complicated UI navigation. The single bounded experiment ended rather than repeatedly repairing setup.','Portable verification checks committed summaries/crop hashes/arithmetic; local mode rereads original saves/captures. Neither reruns gameplay.')
 final_state=@{paused=$true;developer_mode=$true;god_mode=$true;normal_profile_touched=$false;game_files_modified=$false;mods_installed=$false}
}
[IO.File]::WriteAllText((Join-Path $dir 'native-logistics-runtime.json'),(ConvertTo-Json $record -Depth 20)+"`n",$utf8)
"Collected 2 save snapshots, $($shots.Count) crops, $($actions.Count) UI records."
