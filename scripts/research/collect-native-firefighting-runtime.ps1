# Read retained isolated runtime artifacts; do not launch or control the game.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$runtime=Join-Path $root '.local-research/runtime'
$profile=Join-Path $runtime 'profile-fire-20261104'
$output=Join-Path $root 'docs/research/rimworld/evidence'
$shots=Join-Path $output 'fire-runtime'
New-Item -ItemType Directory -Path $shots -Force|Out-Null
function Digest([string]$path){(Get-FileHash -LiteralPath $path).Hash.ToLowerInvariant()}
$launch=Get-Content (Join-Path $runtime 'fire-launch.json') -Raw|ConvertFrom-Json
$saveNames=@('fire-baseline.rws','New Arrivals1.rws','New Arrivals2.rws','New Arrivals3.rws')
$saves=@(foreach($name in $saveNames){
 $file=Join-Path $profile "Saves/$name";$doc=[xml](Get-Content -LiteralPath $file -Raw)
 $fire=$doc.SelectSingleNode('//maps/li/things/thing[id="Fire186400"]')
 $pawn=$doc.SelectSingleNode('//maps/li/things/thing[id="Human961"]')
 $wall=$doc.SelectSingleNode('//maps/li/things/thing[id="Wall41899"]')
 [ordered]@{file=".local-research/runtime/profile-fire-20261104/Saves/$name";sha256=(Digest $file);ticks_game=[int]$doc.savegame.game.tickManager.ticksGame
  total_fire_count=$doc.SelectNodes('//thing[@Class="Fire"]').Count
  selected_fire=if($fire){[ordered]@{id=$fire.id;position=$fire.pos;size=[double]$fire.fireSize;parent=$fire.parent;spawned_tick=[int]$fire.spawnedTick;xml=$fire.OuterXml}}else{$null}
  wall=[ordered]@{id=$wall.id;position=$wall.pos;stuff=$wall.stuff;hit_points=[int]$wall.health;xml=$wall.OuterXml}
  pawn=[ordered]@{id=$pawn.id;position=$pawn.pos;job_def=$pawn.jobs.curJob.def;job_target=$pawn.jobs.curJob.targetA;player_forced=$pawn.jobs.curJob.playerForced;job_start_tick=$pawn.jobs.curJob.startTick;job_xml=$pawn.jobs.curJob.OuterXml;driver_xml=$pawn.jobs.curDriver.OuterXml}}
})
if($saves[1].pawn.job_def -ne 'ExtinguishFiresNearby' -or $saves[1].pawn.job_target -ne 'Thing_Fire186400' -or $saves[1].selected_fire.size -ne 1.75){throw 'Pre-fire save does not match target'}
if($saves[2].total_fire_count -or $saves[3].total_fire_count){throw 'Fires still exist'}
if($saves[2].ticks_game -ne $saves[3].ticks_game){throw 'Post-fire saves do not confirm stable tick'}
Add-Type -AssemblyName System.Drawing
$specs=@(
 @('FIR01','fire-009-search-commit.png','developer-preparation-menu.png',0,0,450,150),
 @('FIR02','fire-011-prepared.png','prepared-fire.png',1420,1070,650,220),
 @('FIR03','fire-017-prioritize.png','prioritize-extinguishing.png',1420,1070,650,220),
 @('FIR04','fire-024-extinguish-run.png','after-extinguishing.png',1420,1070,650,220)
)
$images=@(foreach($spec in $specs){
 $src=Join-Path $runtime $spec[1];$dst=Join-Path $shots $spec[2]
 $bitmap=[Drawing.Bitmap]::new($src);$rect=[Drawing.Rectangle]::new([int]$spec[3],[int]$spec[4],[int]$spec[5],[int]$spec[6]);$crop=$bitmap.Clone($rect,$bitmap.PixelFormat)
 try{$crop.Save($dst,[Drawing.Imaging.ImageFormat]::Png)}finally{$crop.Dispose();$bitmap.Dispose()}
 [ordered]@{id=$spec[0];source_file=".local-research/runtime/$($spec[1])";source_sha256=(Digest $src);source_dimensions=@(2560,1440);crop=@($spec[3],$spec[4],$spec[5],$spec[6]);file="fire-runtime/$($spec[2])";sha256=(Digest $dst)}
})
$actions=@(Get-ChildItem -LiteralPath $runtime -Filter 'fire-*.png.actions.jsonl'|Sort-Object Name|ForEach-Object{
 foreach($line in Get-Content -LiteralPath $_.FullName){
  if(!$line.Trim()){continue};$a=$line|ConvertFrom-Json
  [ordered]@{source_file=".local-research/runtime/$($_.Name)";source_sha256=(Digest $_.FullName);started_utc=$a.started_utc;finished_utc=$a.finished_utc;action=$a.action;x=$a.x;y=$a.y;text=$a.text;virtual_key=$a.virtual_key;duration_ms=$a.duration_ms;wait_ms=$a.wait_ms;park_x=$a.park_x;park_y=$a.park_y;image_name=[IO.Path]::GetFileName($a.image)}
 }
})
$running=@(Get-CimInstance Win32_Process -Filter "Name='RimWorld.exe'"|Select-Object ProcessId,ExecutablePath)
if($running.Count){throw 'RimWorld still running; do not claim exited'}
$e=[ordered]@{
 evidence_id='RW17-NATIVE-FIREFIGHTING';date_local='2026-11-04';version='1.7.4980 rev60'
 kind='Native UI developer preparation of one fire followed by ordinary pawn commands; original unedited saves; no injected game code'
 launch=[ordered]@{started_utc=$launch.started_utc;pid=$launch.pid;launch_record='.local-research/runtime/fire-launch.json';launch_record_sha256=(Digest (Join-Path $runtime 'fire-launch.json'));profile='.local-research/runtime/profile-fire-20261104';mods_config_sha256=$launch.mods_config_sha256;baseline_source_sha256=$launch.source_sha256;baseline_copy_sha256=$launch.copy_sha256;active_mods=@('ludeon.rimworld','ludeon.rimworld.odyssey')}
 preparation=[ordered]@{method='Developer Actions: T: Attach Fire, then click existing wooden wall';developer_action=$true;menu_click=@(100,124);map_click=@(1655,1180);no_spontaneous_ignition_claim=$true}
 target=[ordered]@{pawn_id='Human961';fire_id='Fire186400';wall_id='Wall41899';position='(104, 0, 126)';fire_size_before=1.75}
 saves=$saves
 timing=[ordered]@{baseline_to_pre_fire_ticks=($saves[1].ticks_game-$saves[0].ticks_game);observed_extinguishing_window_ticks=($saves[2].ticks_game-$saves[1].ticks_game);after_save_pair_equal_ticks=$true;exact_extinguishing_duration_measured=$false}
 observations=@(
  [ordered]@{id='FIR01';finding='Developer Attach Fire prepares one ground fire size1.75 at the wooden wall. Menu screenshot includes Destroy fire but the recorded click selects the separate Attach Fire row.';evidence=@('FIR01','FIR02','actions','saves')},
  [ordered]@{id='FIR02';finding='Ordinary right click offers Prioritize extinguishing fires; Squint native save records playerForced ExtinguishFiresNearby, not the automatic BeatFire job.';evidence=@('FIR03','saves')},
  [ordered]@{id='FIR03';finding='After one bounded run, Fire186400 and all other fire entities are absent in two same-tick native saves; Squint has moved on to Skygaze.';evidence=@('FIR04','saves')},
  [ordered]@{id='FIR04';finding='Target wall remains and HP changes195 to188. A nearby pawn already had a tantrum, so this observation does not isolate all damage to fire.';evidence=@('saves')}
 )
 images=$images;actions=$actions
 shutdown=[ordered]@{method='Ordinary Quit to OS clicked at (2215,1315) after the second post-fire save';attempted_capture='fire-030-quit.png';capture_result='Foreground guard rejected capture after native exit; no exit screenshot or successful action-log entry claimed';observed_utc=[DateTime]::UtcNow.ToString('o');rimworld_processes_after_exit=$running}
 limitations=@('Game advanced between load and confirmed pause; baseline delta4893 ticks is not firefighting time.','The906-tick window includes walking, extinguishing and subsequent leisure, so it is not exact beat time.','Developer preparation is explicit; no natural ignition or short-circuit probability was measured.','No outside-Home order experiment: the manual-vs-automatic distinction comes from static call paths.','Preexisting tantrum and other colony activity continued; do not attribute every building HP loss to flame.','No native repair, spread-frequency, rain, battery explosion or building-wealth experiment.','Only small diagnostic crops and selected save fields are committed; full screenshots and raw saves stay local.')
}
[IO.File]::WriteAllText((Join-Path $output 'fire-runtime-evidence.json'),($e|ConvertTo-Json -Depth 16).Replace("`r`n","`n")+"`n",[Text.UTF8Encoding]::new($false))
"$($actions.Count) actions; $($images.Count) crops; $($saves[1].ticks_game) -> $($saves[2].ticks_game); stable post-save pair; native exited."
