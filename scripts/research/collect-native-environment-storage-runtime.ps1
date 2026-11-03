# Read retained UI captures, original saves and logs. Does not launch or control RimWorld.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$runtime=Join-Path $root '.local-research/runtime'
$profile=Join-Path $runtime 'profile-environment-storage-20261104'
$output=Join-Path $root 'docs/research/rimworld/evidence'
$shots=Join-Path $output 'environment-storage-runtime'
New-Item -ItemType Directory -Path $shots -Force|Out-Null
function Digest([string]$path){(Get-FileHash -LiteralPath $path).Hash.ToLowerInvariant()}
$launch=Get-Content (Join-Path $runtime 'environment-storage-launch.json') -Raw|ConvertFrom-Json
$saveNames=@('environment-storage-baseline.rws','New Arrivals1.rws','New Arrivals2.rws','New Arrivals3.rws')
$targetIds=@('Cloth222220','Cloth222221','Cloth222222')
$saves=@(foreach($name in $saveNames){
 $file=Join-Path $profile "Saves/$name";$doc=[xml](Get-Content -LiteralPath $file -Raw)
 $manager=$doc.SelectSingleNode('//maps/li/weatherManager')
 $items=@($doc.SelectNodes('//maps/li/things/thing[def="Cloth"]')|Sort-Object id|ForEach-Object {
  [ordered]@{id=$_.id;position=$_.pos;hit_points=[int]$_.health;stack_count=[int]$_.stackCount;forbidden=($_.forbidden -eq 'True');spawned_tick=[int]$_.spawnedTick;target=($_.id -in $targetIds);xml=$_.OuterXml}
 })
 [ordered]@{file=".local-research/runtime/profile-environment-storage-20261104/Saves/$name";sha256=(Digest $file);ticks_game=[int]$doc.savegame.game.tickManager.ticksGame;weather=[ordered]@{current=$manager.curWeather;previous=$manager.lastWeather;age=[int]$manager.curWeatherAge;xml=$manager.OuterXml};cloth=$items}
})
if($saves[1].ticks_game -ne 213091 -or $saves[2].ticks_game -ne 219037 -or $saves[2].ticks_game -ne $saves[3].ticks_game){throw 'Unexpected observation ticks'}
if(@($saves[1].cloth|Where-Object target).Count -ne 3){throw 'Preparation items missing'}
Add-Type -AssemblyName System.Drawing
$specs=@(
 @('ESR01','environment-storage-019-forbid-outdoor.png','outdoor-before.png',0,1240,530,165),
 @('ESR02','environment-storage-023-forbid-indoor.png','indoor-before.png',0,1240,530,165),
 @('ESR03','environment-storage-035-outdoor-after.png','outdoor-after.png',0,1240,530,165),
 @('ESR04','environment-storage-036-indoor-after.png','indoor-after.png',0,1240,530,165),
 @('ESR05','environment-storage-037-indoor-ground.png','indoor-roof-floor.png',0,1318,500,85),
 @('ESR06','environment-storage-038-outdoor-ground.png','outdoor-ground.png',0,1330,500,75),
 @('ESR07','environment-storage-035-outdoor-after.png','cloth-layout.png',1400,710,420,300)
)
$images=@(foreach($spec in $specs){
 $src=Join-Path $runtime $spec[1];$dst=Join-Path $shots $spec[2]
 $bitmap=[Drawing.Bitmap]::new($src);$dims=@($bitmap.Width,$bitmap.Height)
 $rect=[Drawing.Rectangle]::new([int]$spec[3],[int]$spec[4],[int]$spec[5],[int]$spec[6]);$crop=$bitmap.Clone($rect,$bitmap.PixelFormat)
 try{$crop.Save($dst,[Drawing.Imaging.ImageFormat]::Png)}finally{$crop.Dispose();$bitmap.Dispose()}
 [ordered]@{id=$spec[0];source_file=".local-research/runtime/$($spec[1])";source_sha256=(Digest $src);source_dimensions=$dims;crop=@($spec[3],$spec[4],$spec[5],$spec[6]);file="environment-storage-runtime/$($spec[2])";sha256=(Digest $dst)}
})
$actions=@(Get-ChildItem -LiteralPath $runtime -Filter 'environment-storage-*.png.actions.jsonl'|Sort-Object Name|ForEach-Object{
 foreach($line in Get-Content -LiteralPath $_.FullName){
  if(!$line.Trim()){continue};$a=$line|ConvertFrom-Json
  [ordered]@{source_file=".local-research/runtime/$($_.Name)";source_sha256=(Digest $_.FullName);started_utc=$a.started_utc;finished_utc=$a.finished_utc;action=$a.action;x=$a.x;y=$a.y;text=$a.text;virtual_key=$a.virtual_key;duration_ms=$a.duration_ms;wait_ms=$a.wait_ms;park_x=$a.park_x;park_y=$a.park_y;image_name=[IO.Path]::GetFileName($a.image)}
 }
})
$running=@(Get-CimInstance Win32_Process -Filter "Name='RimWorld.exe'"|Select-Object ProcessId,ExecutablePath)
if($running.Count){throw 'RimWorld still running; cannot claim exit'}
$e=[ordered]@{
 evidence_id='RW17-NATIVE-ENVIRONMENT-STORAGE';date_local='2026-11-04';version='1.7.4980 rev60'
 kind='Native developer item preparation followed by ordinary forbidding, simulation, inspection and original saves; no injected code or save editing'
 launch=[ordered]@{started_utc=$launch.started_utc;pid=$launch.pid;launch_record='.local-research/runtime/environment-storage-launch.json';launch_record_sha256=(Digest (Join-Path $runtime 'environment-storage-launch.json'));profile='.local-research/runtime/profile-environment-storage-20261104';mods_config_sha256=$launch.mods_config_sha256;baseline_source_sha256=$launch.source_sha256;baseline_copy_sha256=$launch.copy_sha256;active_mods=@('ludeon.rimworld','ludeon.rimworld.odyssey')}
 preparation=[ordered]@{developer_action=$true;method='Spawn full thing stack -> Cloth; click indoors and outdoors while paused, then right-click to cancel and ordinary F to forbid all prepared stacks';reused_existing_rain=$true;extra_spawn='Escape opened the game menu without cancelling the spawn tool. A later map click placed one additional outdoor stack; all three new stacks are retained and reported.';no_statistical_calibration=$true}
 targets=@(
  [ordered]@{id='Cloth222220';role='enclosed-room-control';position='(104, 0, 140)';ui_client=@(1660,850);surface='Constructed roof; wood floor; indoors';expected_before_hp=80;observed_after_hp=80},
  [ordered]@{id='Cloth222221';role='unroofed-outdoor-target';position='(97, 0, 140)';ui_client=@(1450,850);surface='Unroofed; sand; outdoors';expected_before_hp=80;observed_after_hp=78},
  [ordered]@{id='Cloth222222';role='extra-unroofed-stack';position='(98, 0, 140)';ui_client=@(1475,850);surface='Adjacent unroofed sand cell; included because of extra preparation click';expected_before_hp=80;observed_after_hp=78}
 )
 saves=$saves
 timing=[ordered]@{load_to_before_ticks=($saves[1].ticks_game-$saves[0].ticks_game);observed_deterioration_window_ticks=($saves[2].ticks_game-$saves[1].ticks_game);after_save_pair_equal_ticks=($saves[2].ticks_game -eq $saves[3].ticks_game);exact_damage_ticks_measured=$false}
 observations=@(
  [ordered]@{id='ESR-OBS01';finding='The ordinary outdoor cloth panel shows 80/80, stack 75 and Unroofed, raining, outdoors (20/day) before running.';evidence=@('ESR01','saves')},
  [ordered]@{id='ESR-OBS02';finding='After four bounded speed-3 runs, the same outdoor target is 78/80 and the indoor control remains 80/80; target identity, position, stack count and forbidden flag stay unchanged.';evidence=@('ESR03','ESR04','saves')},
  [ordered]@{id='ESR-OBS03';finding='Native hover identifies constructed roof and wood floor for the enclosed control, versus outdoor sand; this contrasts storage conditions but does not isolate every environmental variable.';evidence=@('ESR05','ESR06','ESR07')}
 )
 images=$images;actions=$actions
 shutdown=[ordered]@{method='Ordinary Quit to OS at (2215,1315) after the second final save';attempted_capture='environment-storage-044-quit.png';capture_result='Foreground guard rejected post-exit capture; no successful final action entry or exit screenshot claimed';observed_utc=[DateTime]::UtcNow.ToString('o');rimworld_processes_after_exit=$running}
 limitations=@('The initial load advanced 3693 ticks before confirmed pause and preparation.','Rain came from the prior developer-prepared weather save; this is not natural weather occurrence evidence.','One extra outdoor stack was unintentionally placed while cancelling the developer tool; it is disclosed, not omitted.','The enclosed control is cold and has wood flooring; the exposed target is on sand. Cloth does not rot, and both selected terrains have no extra deterioration factor, but this is not a single-variable roof-only experiment.','Only four bounded 4-second input runs; no long-run or rate-distribution calibration.','No recreation interruption, snow thought, filth-washing, stack-merging, worn-apparel or roofed-outdoor-shelter runtime experiment.','Full screenshots and original saves remain local; selected excerpts and crops are committed.')
}
[IO.File]::WriteAllText((Join-Path $output 'environment-storage-runtime-evidence.json'),($e|ConvertTo-Json -Depth 16).Replace("`r`n","`n")+"`n",[Text.UTF8Encoding]::new($false))
"$($actions.Count) actions; $($images.Count) crops; $($saves[1].ticks_game) -> $($saves[2].ticks_game); final saves equal; native exited."
