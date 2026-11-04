# Read-only projections of the retained ordinary construction trial.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$runtime=Join-Path $root '.local-research/runtime/furniture-quality-20261104'
$profile=Join-Path $root '.local-research/runtime/profile-furniture-quality-20261104'
$out=Join-Path $root 'docs/research/rimworld/evidence';$shots=Join-Path $out 'furniture-quality-runtime'
New-Item -ItemType Directory -Path $shots -Force|Out-Null
function Digest([string]$file){(Get-FileHash -LiteralPath $file).Hash.ToLowerInvariant()}
function Project($node,[string[]]$fields){if(!$node){return $null};$copy=$node.CloneNode($false);foreach($child in $node.ChildNodes){if($child.LocalName -in $fields){[void]$copy.AppendChild($child.CloneNode($true))}};$copy.OuterXml}
$saves=@(foreach($name in @('quality-baseline.rws','New Arrivals1.rws','New Arrivals2.rws','New Arrivals3.rws','New Arrivals4.rws')){
 $file=Join-Path $profile "Saves/$name";$doc=[xml](Get-Content -LiteralPath $file -Raw);$nodes=@();$objects=@()
 $xp='//maps/li/things/thing[id="Human958"]';$pawn=$doc.SelectSingleNode($xp)
 $fields=@('def','id','name','pos','jobs','records')
 $nodes+=,[ordered]@{role='worker';xpath=$xp;fields=$fields;xml=(Project $pawn $fields)}
 $sx=$xp+'/skills/skills/li[def="Construction"]';$skill=$doc.SelectSingleNode($sx)
 $nodes+=,[ordered]@{role='construction_skill';xpath=$sx;xml=$skill.OuterXml}
 $worker=[ordered]@{id=[string]$pawn.id;name=[string]$pawn.name.nick;position=[string]$pawn.pos;job=[string]$pawn.jobs.curJob.def;job_id=[int]$pawn.jobs.curJob.loadID;target_a=[string]$pawn.jobs.curJob.targetA;player_forced=([string]$pawn.jobs.curJob.playerForced -eq 'True');construction_level=[int]$skill.level;construction_xp=[double]$skill.xpSinceLastLevel;record_values=@($pawn.records.records.vals.li|ForEach-Object{[double]$_})}
 foreach($id in @('Frame_Bed221082','Bed221087')){
  $qx='//maps/li/things/thing[id="'+$id+'"]';$selected=$doc.SelectNodes($qx);$node=$selected|Select-Object -First 1
  if($node){$nodes+=,[ordered]@{role=$id;xpath=$qx;xml=$node.OuterXml}}
  $objects+=,[ordered]@{id=$id;xpath=$qx;count=$selected.Count;def=[string]$node.def;position=[string]$node.pos;stuff=[string]$node.stuff;health=[int]$node.health;quality_present=($null -ne $node.quality);quality=[string]$node.quality;author_name_present=($null -ne $node.authorName);work_done=[double]$node.workDone;resource_count=[int]$node.resourceContainer.innerList.li.stackCount;spawned_tick=[int]$node.spawnedTick}
 }
 [ordered]@{file=".local-research/runtime/profile-furniture-quality-20261104/Saves/$name";sha256=(Digest $file);ticks_game=[int]$doc.savegame.game.tickManager.ticksGame;worker=$worker;objects=$objects;nodes=$nodes}
})
if(($saves.ticks_game -join ',') -ne '79055,79638,80357,80357,80358'){throw 'Unexpected tick sequence'}
Add-Type -AssemblyName System.Drawing
$specs=@(
 @('FQR01','021-frame-selected.png','ordinary-frame-panel.png',0,1235,700,170),
 @('FQR02','023-bed-selected.png','completed-poor-bed.png',0,1235,1150,170),
 @('FQR03','025-comfort-detail.png','poor-bed-comfort.png',805,340,950,760),
 @('FQR04','026-rest-detail.png','poor-bed-rest.png',805,340,950,760),
 @('FQR05','027-value-detail.png','poor-bed-market-value.png',805,340,950,760),
 @('FQR06','037-reloaded-bed.png','reloaded-poor-bed.png',0,1235,1150,170)
)
$images=@(foreach($s in $specs){
 $src=Join-Path $runtime $s[1];$dst=Join-Path $shots $s[2];$bitmap=[Drawing.Bitmap]::new($src);$dimensions=@($bitmap.Width,$bitmap.Height)
 $rect=[Drawing.Rectangle]::new([int]$s[3],[int]$s[4],[int]$s[5],[int]$s[6]);$crop=$bitmap.Clone($rect,$bitmap.PixelFormat)
 try{$crop.Save($dst,[Drawing.Imaging.ImageFormat]::Png)}finally{$crop.Dispose();$bitmap.Dispose()}
 [ordered]@{id=$s[0];source_file=".local-research/runtime/furniture-quality-20261104/$($s[1])";source_sha256=(Digest $src);source_dimensions=$dimensions;crop=@($s[3],$s[4],$s[5],$s[6]);file="furniture-quality-runtime/$($s[2])";sha256=(Digest $dst)}
})
$actions=@(Get-ChildItem -LiteralPath $runtime -Filter '*.png.actions.jsonl'|Sort-Object Name|ForEach-Object{
 foreach($line in Get-Content -LiteralPath $_.FullName){if(!$line.Trim()){continue};$a=$line|ConvertFrom-Json;$img=[IO.Path]::GetFileName($a.image)
  [ordered]@{source_file=".local-research/runtime/furniture-quality-20261104/$($_.Name)";source_sha256=(Digest $_.FullName);started_utc=$a.started_utc;finished_utc=$a.finished_utc;action=$a.action;x=$a.x;y=$a.y;end_x=$a.end_x;end_y=$a.end_y;text=$a.text;virtual_key=$a.virtual_key;control=$a.control;duration_ms=$a.duration_ms;wheel_delta=$a.wheel_delta;wait_ms=$a.wait_ms;park_x=$a.park_x;park_y=$a.park_y;image_name=$img;image_sha256=(Digest (Join-Path $runtime $img))}
 }
})
$running=@(Get-CimInstance Win32_Process -Filter "Name='RimWorld.exe' OR Name='RimWorldWin64.exe'");if($running.Count){throw 'Native still running'}
$modsPath=Join-Path $profile 'Config/ModsConfig.xml';$mods=[xml](Get-Content $modsPath -Raw)
$launch=Get-Content (Join-Path $runtime 'launch-record.json') -Raw|ConvertFrom-Json
$exit=Get-Content (Join-Path $runtime 'exit-record.json') -Raw|ConvertFrom-Json
$e=[ordered]@{
 evidence_id='RW17-NATIVE-FURNITURE-QUALITY';date_local='2026-11-04';version='1.7.4980 rev60'
 kind='One ordinary wooden-bed construction, stat UI and five native saves; normal reload; no result injection'
 launch=[ordered]@{pid=$launch.pid;started_utc=$launch.started_utc;executable=$launch.executable;profile='.local-research/runtime/profile-furniture-quality-20261104';record_file='.local-research/runtime/furniture-quality-20261104/launch-record.json';record_sha256=(Digest (Join-Path $runtime 'launch-record.json'));baseline_source='.local-research/runtime/profile-social-20261104/Saves/New Arrivals4.rws';baseline_source_sha256=$launch.baseline_sha256;baseline_copy_sha256=$saves[0].sha256;prefs_sha256=$launch.prefs_sha256;mods_sha256=$launch.mods_sha256;active_mods=@($mods.ModsConfigData.activeMods.li)}
 preparation=[ordered]@{developer_mode_enabled=$true;developer_action_this_trial=$false;edited_saves=$false;method='Copied previous social-trial baseline into isolated profile. Baseline contains prior developer-prepared scene/furniture. This trial uses ordinary Architect wooden-bed blueprint, ordinary Prioritize working, native material hauling and FinishFrame; no God mode, spawn, skill change or quality setting.';no_statistical_calibration=$true}
 targets=[ordered]@{worker='Human958';frame='Frame_Bed221082';bed='Bed221087';position='(115, 0, 132)';spawned_tick=80086}
 saves=$saves;images=$images;actions=$actions
 observations=@(
  [ordered]@{id='FQR-OBS01';finding='At79638 Prophet Construction3 has playerForced FinishFrame53929 targeting Frame_Bed221082; frame contains45 WoodLog, health23 and workDone152.617462. Baseline had neither target frame nor bed.';evidence=@('saves','FQR01')},
  [ordered]@{id='FQR-OBS02';finding='At80357 frame is absent and Bed221087 exists at the same position, spawned80086, WoodLog, health91, qualityPoor. Prophet remains Construction3; XP129.674652→169.049194. Raw record slot26 changes11→12, consistent with static completion increment; ordinal alone is not independently named ThingsConstructed.';evidence=@('saves','FQR02')},
  [ordered]@{id='FQR-OBS03';finding='Native stat UI confirms Poor,91/91HP,comfort .75*88%=.66,rest100%*92%=92%,materials/labor displayed56 and quality75% with health100% producing displayed42. Exact underlying base calculation56.016 is static, not read from this rounded UI.';evidence=@('FQR03','FQR04','FQR05')},
  [ordered]@{id='FQR-OBS04';finding='Completed Poor bed has no authorName node. Creator attribution follows the sampled precompletion FinishFrame actor and static call chain, not a nonexistent persistent creator ID or an uninterrupted frame-by-frame trace.';evidence=@('saves')},
  [ordered]@{id='FQR-OBS05';finding='Paused repeat saves have identical selected state at80357. Ordinary load then save advances one tick to80358, with same bed ID,location,quality,HP and spawnedTick. Ordinary Quit to OS follows; fresh CIM reports no RimWorld process.';evidence=@('saves','FQR06','shutdown')}
 )
 shutdown=[ordered]@{record_file='.local-research/runtime/furniture-quality-20261104/exit-record.json';record_sha256=(Digest (Join-Path $runtime 'exit-record.json'));observed_utc=$exit.checkedAtUtc;method=$exit.quitRequestedVia;capture_result=$exit.postQuitCapture;rimworld_processes_after_exit=@($exit.remainingProcesses)}
 limitations=@('Single naturally rolled Poor bed only; no probability fitting, rerolls, forced quality or all-quality runtime validation.','Prior baseline contains developer-prepared objects; this new bed is ordinarily hauled and built.','No failure, damaged-frame completion, multiworker handoff, inspiration, artistic-quality author or maxGain cap branch was executed.','Quality and other attributes are interpreted with static component ancestry; missing authorName is observed, not generalized to every furniture quality.','The prior scene includes other pawns hauling wood; total ground resource deltas are not treated as isolated bed material accounting.','Action10 clicked an occupied location while leaving designator; action13/14 is the successful ordinary prioritize operation.','No action041 screenshot or completed action log exists because the normal exit ended the process before post-input capture.','Selected nodes/crops/hashes are public; full raw saves/screenshots remain local.','Reload advanced1tick; only the bed state, not the entire world state, is claimed unchanged across reload.')
}
[IO.File]::WriteAllText((Join-Path $out 'furniture-quality-runtime-evidence.json'),($e|ConvertTo-Json -Depth 22).Replace("`r`n","`n")+"`n",[Text.UTF8Encoding]::new($false))
"$($actions.Count) actions; $($images.Count) crops; $($saves.Count) saves; native exited."
