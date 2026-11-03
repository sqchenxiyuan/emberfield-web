# Read existing isolated runtime artifacts; never launch or control the target.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$runtime=Join-Path $root '.local-research/runtime'
$profile=Join-Path $runtime 'profile-hygiene-20261104'
$output=Join-Path $root 'docs/research/rimworld/evidence'
$shots=Join-Path $output 'hygiene-runtime'
New-Item -ItemType Directory -Path $shots -Force|Out-Null
function Digest([string]$path){(Get-FileHash -LiteralPath $path).Hash.ToLowerInvariant()}
$launch=Get-Content (Join-Path $runtime 'hygiene-launch.json') -Raw|ConvertFrom-Json
$saveNames=@('hygiene-baseline.rws','New Arrivals1.rws','New Arrivals2.rws','New Arrivals3.rws')
$saves=@(foreach($name in $saveNames){
 $file=Join-Path $profile "Saves/$name";$doc=[xml](Get-Content -LiteralPath $file -Raw)
 $filth=$doc.SelectSingleNode('//maps/li/things/thing[id="Filth_Blood78450"]')
 $pawn=$doc.SelectSingleNode('//maps/li/things/thing[id="Human961"]')
 [ordered]@{file=".local-research/runtime/profile-hygiene-20261104/Saves/$name";sha256=(Digest $file);ticks_game=[int]$doc.savegame.game.tickManager.ticksGame
  home_true_count=[int]$doc.SelectSingleNode('//maps/li/areaManager/areas/li[@Class="Area_Home"]/innerGrid/trueCount').InnerText
  selected_filth=if($filth){[ordered]@{id=$filth.id;def=$filth.def;position=$filth.pos;thickness=[int]$filth.thickness;grow_tick=[int]$filth.growTick;xml=$filth.OuterXml}}else{$null}
  pawn=[ordered]@{id=$pawn.id;position=$pawn.pos;job_def=$pawn.jobs.curJob.def;job_target=$pawn.jobs.curJob.targetA;player_forced=$pawn.jobs.curJob.playerForced;job_start_tick=$pawn.jobs.curJob.startTick;job_xml=$pawn.jobs.curJob.OuterXml;driver_xml=$pawn.jobs.curDriver.OuterXml}}
})
if($saves[1].pawn.job_def -ne 'Clean' -or $saves[1].pawn.job_target -ne 'Thing_Filth_Blood78450' -or $saves[1].selected_filth.thickness -ne 2){throw 'Pre-clean save does not match observed target'}
if($saves[2].selected_filth -or $saves[3].selected_filth){throw 'Selected filth still exists'}
if($saves[2].ticks_game -ne $saves[3].ticks_game){throw 'Post-clean saves do not confirm stable tick'}
Add-Type -AssemblyName System.Drawing
$specs=@(
 @('HYR01','hygiene-009-home-overlay.png','home-before.png',1150,390,670,440),
 @('HYR02','hygiene-010-home-added.png','home-after.png',1150,390,670,440),
 @('HYR03','hygiene-024-prioritize-menu.png','prioritize-cleaning.png',1280,510,370,110),
 @('HYR04','hygiene-015-blood-hover.png','blood-before.png',1150,390,670,440),
 @('HYR05','hygiene-035-clean-run.png','blood-after.png',1150,390,670,440),
 @('HYR06','hygiene-015-blood-hover.png','blood-hover-label.png',0,1330,560,75)
)
$images=@(foreach($spec in $specs){
 $src=Join-Path $runtime $spec[1];$dst=Join-Path $shots $spec[2]
 $bitmap=[Drawing.Bitmap]::new($src);$rect=[Drawing.Rectangle]::new([int]$spec[3],[int]$spec[4],[int]$spec[5],[int]$spec[6]);$crop=$bitmap.Clone($rect,$bitmap.PixelFormat)
 try{$crop.Save($dst,[Drawing.Imaging.ImageFormat]::Png)}finally{$crop.Dispose();$bitmap.Dispose()}
 [ordered]@{id=$spec[0];source_file=".local-research/runtime/$($spec[1])";source_sha256=(Digest $src);source_dimensions=@(2560,1440);crop=@($spec[3],$spec[4],$spec[5],$spec[6]);file="hygiene-runtime/$($spec[2])";sha256=(Digest $dst)}
})
$actions=@(Get-ChildItem -LiteralPath $runtime -Filter 'hygiene-*.png.actions.jsonl'|Sort-Object Name|ForEach-Object{
 foreach($line in Get-Content -LiteralPath $_.FullName){
  if(!$line.Trim()){continue};$a=$line|ConvertFrom-Json
  [ordered]@{source_file=".local-research/runtime/$($_.Name)";source_sha256=(Digest $_.FullName);started_utc=$a.started_utc;finished_utc=$a.finished_utc;action=$a.action;x=$a.x;y=$a.y;text=$a.text;virtual_key=$a.virtual_key;control=$a.control;duration_ms=$a.duration_ms;wait_ms=$a.wait_ms;park_x=$a.park_x;park_y=$a.park_y;image_name=[IO.Path]::GetFileName($a.image)}
 }
})
$running=@(Get-CimInstance Win32_Process -Filter "Name='RimWorld.exe'"|Select-Object ProcessId,ExecutablePath)
if($running.Count){throw 'RimWorld is still running; do not claim exited'}
$e=[ordered]@{
 evidence_id='RW17-NATIVE-SANITATION-CLEANING';date_local='2026-11-04';version='1.7.4980 rev60'
 kind='Original native UI actions and original-game saves; no Web harness, edited saves or injected game code'
 launch=[ordered]@{started_utc=$launch.started_utc;pid=$launch.pid;launch_record='.local-research/runtime/hygiene-launch.json';launch_record_sha256=(Digest (Join-Path $runtime 'hygiene-launch.json'));profile='.local-research/runtime/profile-hygiene-20261104';mods_config_sha256=$launch.mods_config_sha256;active_mods=@('ludeon.rimworld','ludeon.rimworld.odyssey')}
 target=[ordered]@{pawn_id='Human961';filth_id='Filth_Blood78450';position='(93, 0, 144)';type='Filth_Blood';thickness_before=2}
 saves=$saves
 timing=[ordered]@{baseline_to_pre_clean_ticks=($saves[1].ticks_game-$saves[0].ticks_game);observed_cleaning_window_ticks=($saves[2].ticks_game-$saves[1].ticks_game);after_save_pair_equal_ticks=($saves[2].ticks_game -eq $saves[3].ticks_game);exact_cleaning_duration_measured=$false}
 observations=@(
  [ordered]@{id='HYR01';finding='Existing blood lies outside the shown Home overlay before the area edit.';evidence=@('HYR01','HYR04','HYR06')},
  [ordered]@{id='HYR02';finding='Ordinary Expand home area UI adds coverage at the blood cell; another nearby click was made later and saved Home trueCount increases by two from baseline.';evidence=@('HYR02','saves')},
  [ordered]@{id='HYR03';finding='Squint right-click menu offers Prioritize cleaning blood of a monitor lizard x2; before save records player-forced Clean targeting this exact entity.';evidence=@('HYR03','saves')},
  [ordered]@{id='HYR04';finding='After one bounded run the same blood entity is absent in two native saves and the pawn has moved on to Wait_Wander; other visible blood remains.';evidence=@('HYR04','HYR05','saves')}
 )
 images=$images;actions=$actions
 shutdown=[ordered]@{method='Ordinary Quit to OS clicked at (2215,1315) after the second post-clean save';attempted_capture='hygiene-041-quit.png';capture_result='Foreground guard rejected capture after native exit; no exit screenshot claimed';observed_utc=[DateTime]::UtcNow.ToString('o');rimworld_processes_after_exit=$running}
 limitations=@('Game advanced between initial load and confirmed pause; baseline-to-pre-clean delta is not clean-job time.','The 1475-tick interval includes walking, cleaning and later idle time; no exact cleaning-speed or per-layer timing claim.','Early right-click captures moved the cursor away and lost the floating menu, so they do not prove a rejected outside-Home order.','IME text was not committed when naming the before save; actual original saves are New Arrivals1/2/3, never renamed or XML-edited.','No native kitchen pollution, contamination chance, stack mixing, disease stages, natural recovery or treatment experiment.','Development mode was enabled in the copied isolated Config; no developer action was used in this run.','Only diagnostic crops and selected save fields are committed; full screenshots and saves remain local.')
}
[IO.File]::WriteAllText((Join-Path $output 'hygiene-runtime-evidence.json'),($e|ConvertTo-Json -Depth 16).Replace("`r`n","`n")+"`n",[Text.UTF8Encoding]::new($false))
"$($actions.Count) actions; $($images.Count) crops; $($saves[1].ticks_game) -> $($saves[2].ticks_game); stable post-save pair; native exited."
