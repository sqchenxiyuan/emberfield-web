# Read existing isolated runtime artifacts; do not launch or control the target.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$runtime=Join-Path $root '.local-research/runtime'
$profile=Join-Path $runtime 'profile-prisoners-20261104'
$output=Join-Path $root 'docs/research/rimworld/evidence'
$shots=Join-Path $output 'prisoners-runtime'
New-Item -ItemType Directory -Path $shots -Force|Out-Null
$launch=Get-Content (Join-Path $runtime 'prisoner-launch.json') -Raw|ConvertFrom-Json
function Digest([string]$path){(Get-FileHash -LiteralPath $path).Hash.ToLowerInvariant()}
$baseline=Join-Path $profile 'Saves/prisoner-baseline.rws'
$save=Join-Path $profile 'Saves/New Arrivals1.rws'
$baselineXml=[xml](Get-Content -LiteralPath $baseline -Raw)
$saveXml=[xml](Get-Content -LiteralPath $save -Raw)
$bedNodes=$saveXml.SelectNodes('//maps/li/things/thing[def="SleepingSpot" or def="Bed"]')
$beds=@(foreach($node in $bedNodes){[ordered]@{id=$node.id;def=$node.def;position=$node.pos;for_owner_type_raw=$node.forOwnerType;spawned_tick=$node.spawnedTick;xml=$node.OuterXml}})
if(@($beds|Where-Object {$_.def -eq 'SleepingSpot' -and $_.for_owner_type_raw -eq 'Prisoner'}).Count -ne 2){throw 'Expected two prisoner sleeping spots'}
Add-Type -AssemblyName System.Drawing
$specs=@(
 @('PRR01','prisoner-009-outdoor-disabled.png','outdoor-bed-rejected.png',0,1240,1090,165),
 @('PRR02','prisoner-018-spot-selected.png','room-before.png',1500,500,320,320),
 @('PRR03','prisoner-019-toggle-prisoner.png','room-after.png',1500,500,320,320),
 @('PRR04','prisoner-020-other-bed-synced.png','other-bed-prisoner-panel.png',0,1230,1070,175)
)
$images=@(foreach($spec in $specs){
 $src=Join-Path $runtime $spec[1]; $dst=Join-Path $shots $spec[2]
 $bitmap=[Drawing.Bitmap]::new($src)
 $rect=[Drawing.Rectangle]::new([int]$spec[3],[int]$spec[4],[int]$spec[5],[int]$spec[6])
 $crop=$bitmap.Clone($rect,$bitmap.PixelFormat)
 try{$crop.Save($dst,[Drawing.Imaging.ImageFormat]::Png)}finally{$crop.Dispose();$bitmap.Dispose()}
 [ordered]@{id=$spec[0];source_file=".local-research/runtime/$($spec[1])";source_sha256=(Digest $src);source_dimensions=@(2560,1440);crop=@($spec[3],$spec[4],$spec[5],$spec[6]);file="prisoners-runtime/$($spec[2])";sha256=(Digest $dst)}
})
$actions=@(Get-ChildItem -LiteralPath $runtime -Filter 'prisoner-*.png.actions.jsonl'|Sort-Object Name|ForEach-Object{
 foreach($line in Get-Content -LiteralPath $_.FullName){
  if(!$line.Trim()){continue};$a=$line|ConvertFrom-Json
  [ordered]@{source_file=".local-research/runtime/$($_.Name)";source_sha256=(Digest $_.FullName);started_utc=$a.started_utc;finished_utc=$a.finished_utc;action=$a.action;x=$a.x;y=$a.y;text=$a.text;virtual_key=$a.virtual_key;control=$a.control;wait_ms=$a.wait_ms;image_name=[IO.Path]::GetFileName($a.image)}
 }
})
$running=@(Get-CimInstance Win32_Process -Filter "Name='RimWorld.exe'"|Select-Object ProcessId,ExecutablePath)
if($running.Count){throw 'RimWorld is still running; do not claim exited'}
$baselineTick=[int]$baselineXml.savegame.game.tickManager.ticksGame
$finalTick=[int]$saveXml.savegame.game.tickManager.ticksGame
$e=[ordered]@{
 evidence_id='RW17-NATIVE-PRISONER-ROOM-UI';date_local='2026-11-04';version='1.7.4980 rev60'
 kind='Original native UI actions and original-game save, not a Web harness or modified save'
 launch=[ordered]@{started_utc=$launch.started_utc;pid=$launch.pid;launch_record='.local-research/runtime/prisoner-launch.json';launch_record_sha256=(Digest (Join-Path $runtime 'prisoner-launch.json'));profile='.local-research/runtime/profile-prisoners-20261104';mods_config_sha256=$launch.mods_config_sha256;active_mods=@('ludeon.rimworld','ludeon.rimworld.odyssey')}
 baseline=[ordered]@{file='.local-research/runtime/profile-prisoners-20261104/Saves/prisoner-baseline.rws';sha256=(Digest $baseline);ticks_game=$baselineTick;copied_from='.local-research/runtime/profile-20261102/Saves/trade-buy-verified-b.rws';source_sha256=$launch.baseline_sha256;copy_matches_source=((Digest $baseline) -eq $launch.baseline_sha256)}
 final_save=[ordered]@{file='.local-research/runtime/profile-prisoners-20261104/Saves/New Arrivals1.rws';sha256=(Digest $save);ticks_game=$finalTick;tick_delta_from_baseline=($finalTick-$baselineTick);bed_xpath='//maps/li/things/thing[def="SleepingSpot" or def="Bed"]';beds=$beds}
 observations=@(
  [ordered]@{id='PRR01';finding='Outdoor wooden bed rejects the For prisoners toggle; UI says Only beds in enclosed spaces can be set for prisoners.';evidence=@('PRR01')},
  [ordered]@{id='PRR02';finding='Two sleeping spots placed through normal Architect/Furniture UI in one existing room; selected spot initially reads For colonist use.';evidence=@('PRR02')},
  [ordered]@{id='PRR03';finding='Toggling the first sleeping spot changes both room spots to yellow and room role to Prison barracks.';evidence=@('PRR03')},
  [ordered]@{id='PRR04';finding='Selecting the other spot independently shows For prisoner use; final original save contains two Prisoner owner-type spots.';evidence=@('PRR04','final_save')}
 )
 images=$images;actions=$actions
 shutdown=[ordered]@{method='Ordinary native Quit to OS button clicked at client (2215,1315) from observed main menu after save';attempted_capture='prisoner-027-quit-confirm.png';capture_result='Guard rejected capture after target lost foreground; no image claimed';observed_utc=[DateTime]::UtcNow.ToString('o');rimworld_processes_after_exit=$running;normal_profile_or_user_save_loaded=$false}
 limitations=@('Initial speed/pause keys during loading did not establish a paused map; final save is 13913 ticks after the copied baseline.','Save-name typing did not change the default name; actual successful file is New Arrivals1.rws, not the requested prisoner-room-verified.rws.','Single final save and visual pause evidence; no equal-tick save-pair proof.','No newly captured enemy, prisoner feeding, conversation, actual recruitment or release was observed in this run.','Roof absence was not tested; the no-explicit-roof claim is static PR01 only.','Screenshots are diagnostic crops with source hashes, not gameplay assets.','The isolated profile had development mode enabled from prior Config; no developer spawning, instant recruit, save XML edit or code injection was used in this run.')
}
[IO.File]::WriteAllText((Join-Path $output 'prisoners-runtime-evidence.json'),($e|ConvertTo-Json -Depth 16).Replace("`r`n","`n")+"`n",[Text.UTF8Encoding]::new($false))
"$($actions.Count) input records; $($images.Count) crops; ticks $baselineTick -> $finalTick; 2 prisoner sleeping spots; native process exited."
